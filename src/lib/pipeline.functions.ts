import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const PARSE_PROMPT = `You are an expert technical recruiter. The user uploads a candidate's CV (PDF or DOCX) for the role: "{ROLE}".

Return STRICT JSON with this exact shape (no prose, no markdown fences):
{
  "full_name": string,
  "email": string | null,
  "skills": string[],                 // 5-12 most relevant skills/technologies
  "ai_match_score": number,           // 0-100 integer, how well the CV matches the role
  "summary": string,                  // 1 sentence on the candidate
  "next_action": string               // imperative next step e.g. "Schedule Technical Screening", "Request portfolio", "Reject - insufficient experience"
}

Score honestly. If the CV is empty or unreadable, return ai_match_score 0 and next_action "Reject - unreadable CV".`;

interface ParseInput {
  fileBase64: string;
  mime: string;
  filename: string;
  role: string;
}

interface ParsedCv {
  full_name: string;
  email: string | null;
  skills: string[];
  ai_match_score: number;
  summary: string;
  next_action: string;
}

function isParseInput(v: unknown): v is ParseInput {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.fileBase64 === "string" &&
    typeof o.mime === "string" &&
    typeof o.filename === "string" &&
    typeof o.role === "string" &&
    o.fileBase64.length > 0 &&
    o.role.length > 0
  );
}

export const parseCv = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => {
    if (!isParseInput(data)) throw new Error("Invalid input");
    return data;
  })
  .handler(async ({ data }): Promise<ParsedCv> => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("LOVABLE_API_KEY not configured");

    const userPrompt = PARSE_PROMPT.replace("{ROLE}", data.role);

    // Gemini's file input only reliably supports PDFs and a few image/audio types.
    // DOCX/DOC are not accepted — ask the user to convert. TXT can be inlined as text.
    let content: unknown[];
    if (data.mime === "application/pdf") {
      content = [
        { type: "text", text: userPrompt },
        {
          type: "file",
          file: {
            filename: data.filename,
            file_data: `data:application/pdf;base64,${data.fileBase64}`,
          },
        },
      ];
    } else if (data.mime === "text/plain") {
      let decoded = "";
      try {
        decoded = Buffer.from(data.fileBase64, "base64").toString("utf-8");
      } catch {
        throw new Error("Could not read text file");
      }
      content = [
        { type: "text", text: `${userPrompt}\n\n--- CV TEXT ---\n${decoded.slice(0, 60000)}` },
      ];
    } else {
      throw new Error("Unsupported file type — please upload a PDF or TXT (convert DOCX to PDF first)");
    }

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": apiKey,
        "X-Lovable-AIG-SDK": "vercel-ai-sdk",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [{ role: "user", content }],
        response_format: { type: "json_object" },
      }),
    });


    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      if (res.status === 429) throw new Error("AI rate limit — please retry in a moment");
      if (res.status === 402) throw new Error("AI credits exhausted — add credits in workspace settings");
      throw new Error(`CV parse failed (${res.status}): ${errText.slice(0, 200)}`);
    }

    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = json.choices?.[0]?.message?.content ?? "{}";

    let parsed: Partial<ParsedCv> = {};
    try {
      parsed = JSON.parse(text);
    } catch {
      const m = text.match(/\{[\s\S]*\}/);
      if (m) parsed = JSON.parse(m[0]);
    }

    return {
      full_name: String(parsed.full_name ?? "Unknown candidate").slice(0, 120),
      email: parsed.email ? String(parsed.email).slice(0, 200) : null,
      skills: Array.isArray(parsed.skills) ? parsed.skills.slice(0, 12).map((s) => String(s)) : [],
      ai_match_score: Math.max(0, Math.min(100, Math.round(Number(parsed.ai_match_score ?? 0)))),
      summary: String(parsed.summary ?? ""),
      next_action: String(parsed.next_action ?? "Schedule initial screening"),
    };
  });

interface ScoreInput {
  full_name: string;
  email?: string | null;
  skills?: string[];
  role: string;
  notes?: string | null;
}

export const scoreManual = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => {
    const o = data as ScoreInput;
    if (!o?.full_name || !o?.role) throw new Error("full_name and role required");
    return o;
  })
  .handler(async ({ data }): Promise<{ ai_match_score: number; next_action: string }> => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("LOVABLE_API_KEY not configured");

    const prompt = `Score this candidate for the role "${data.role}" on 0-100 and give a one-line next action. Return JSON {"ai_match_score": number, "next_action": string}.\n\nCandidate: ${data.full_name}\nEmail: ${data.email ?? "n/a"}\nSkills: ${(data.skills ?? []).join(", ") || "none listed"}\nNotes: ${data.notes ?? "none"}`;

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": apiKey,
        "X-Lovable-AIG-SDK": "vercel-ai-sdk",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
      }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`Score failed (${res.status}): ${t.slice(0, 200)}`);
    }
    const j = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = j.choices?.[0]?.message?.content ?? "{}";
    let parsed: { ai_match_score?: number; next_action?: string } = {};
    try {
      parsed = JSON.parse(text);
    } catch {
      const m = text.match(/\{[\s\S]*\}/);
      if (m) parsed = JSON.parse(m[0]);
    }
    return {
      ai_match_score: Math.max(0, Math.min(100, Math.round(Number(parsed.ai_match_score ?? 50)))),
      next_action: String(parsed.next_action ?? "Schedule initial screening"),
    };
  });
