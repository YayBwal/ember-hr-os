import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type ExtractedTask = {
  title: string;
  description?: string;
  effort_points?: number;
  assignee_hint?: string;
  due_in_days?: number;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { title, transcript } = (await req.json()) as { title?: string; transcript?: string };
    if (!transcript || transcript.trim().length < 20) {
      return new Response(JSON.stringify({ error: "Transcript too short" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // user-scoped client (RLS as caller)
    const { createClient } = await import("npm:@supabase/supabase-js@2");
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    // resolve org + employees for assignee guess
    const { data: profile } = await supabase.from("profiles").select("org_id").maybeSingle();
    if (!profile?.org_id) {
      return new Response(JSON.stringify({ error: "No org" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const { data: employees } = await supabase.from("employees").select("id, full_name").eq("org_id", profile.org_id);

    // create meeting in "transcribing" then "extracting" states for live indicator
    const { data: meeting } = await supabase
      .from("meetings")
      .insert({
        org_id: profile.org_id,
        title: title || "Untitled meeting",
        transcript,
        status: "extracting",
      })
      .select("id")
      .single();

    // call Lovable AI gateway
    const prompt = `You extract action items from meeting transcripts.
Return ONLY a JSON array of action items.
Each item has: title (short, imperative), description (one sentence), effort_points (1-8), assignee_hint (first name if mentioned, else null), due_in_days (number or null).
Transcript:
"""
${transcript}
"""`;

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: "You output strict JSON arrays only. No prose, no fences." },
          { role: "user", content: prompt },
        ],
      }),
    });

    if (!aiResp.ok) {
      const txt = await aiResp.text();
      await supabase.from("meetings").update({ status: "failed" }).eq("id", meeting!.id);
      return new Response(JSON.stringify({ error: `AI: ${aiResp.status} ${txt}` }), {
        status: aiResp.status === 429 || aiResp.status === 402 ? aiResp.status : 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const aiData = await aiResp.json();
    const content: string = aiData.choices?.[0]?.message?.content ?? "[]";
    const jsonStr = content.replace(/^```json\s*|```$/gim, "").trim();

    let extracted: ExtractedTask[] = [];
    try {
      extracted = JSON.parse(jsonStr);
      if (!Array.isArray(extracted)) extracted = [];
    } catch {
      extracted = [];
    }

    // map assignees
    function findEmp(hint?: string): string | null {
      if (!hint || !employees) return null;
      const h = hint.toLowerCase();
      const match = employees.find((e) => e.full_name.toLowerCase().includes(h));
      return match?.id ?? null;
    }

    const today = new Date();
    const rows = extracted.slice(0, 20).map((t) => ({
      org_id: profile.org_id,
      title: String(t.title ?? "Untitled task").slice(0, 200),
      description: t.description ? String(t.description).slice(0, 500) : null,
      status: "todo" as const,
      assignee_employee_id: findEmp(t.assignee_hint),
      meeting_id: meeting!.id,
      effort_points: Math.max(1, Math.min(8, Number(t.effort_points ?? 3))),
      due_date: t.due_in_days
        ? new Date(today.getTime() + Number(t.due_in_days) * 86400000).toISOString().slice(0, 10)
        : null,
    }));

    if (rows.length > 0) {
      const { error: insErr } = await supabase.from("tasks").insert(rows);
      if (insErr) {
        await supabase.from("meetings").update({ status: "failed" }).eq("id", meeting!.id);
        throw insErr;
      }
    }
    await supabase.from("meetings").update({ status: "ready" }).eq("id", meeting!.id);

    return new Response(JSON.stringify({ created: rows.length, meeting_id: meeting!.id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
