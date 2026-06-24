import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Msg = { role: "user" | "assistant" | "tool"; content: string; tool_call_id?: string; name?: string };
type Action =
  | { type: "navigate"; to: string }
  | { type: "highlight_candidates"; ids: string[] };

const tools = [
  {
    type: "function",
    function: {
      name: "navigate",
      description: "Navigate the app to a route. Use when the user wants to open/go to a page.",
      parameters: {
        type: "object",
        properties: {
          route: {
            type: "string",
            enum: ["/dashboard", "/pipeline", "/operations", "/delivery", "/financial", "/settings"],
          },
        },
        required: ["route"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_candidates",
      description:
        "Search the recruitment candidates table by full or partial name. Use when the user asks to find / look up / show a specific candidate.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Candidate name fragment, e.g. 'Kaung Set Paing'." },
        },
        required: ["query"],
      },
    },
  },
];

export const voiceChat = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { messages: Msg[] }) => {
    if (!data || !Array.isArray(data.messages)) throw new Error("messages required");
    return { messages: data.messages.slice(-16) };
  })
  .handler(async ({ data, context }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("LOVABLE_API_KEY missing");

    const system = `You are Mandai, a friendly HR/operations voice assistant inside an admin app.
LANGUAGE RULE: Mirror the user's language exactly.
- If the user speaks Burmese, reply in Burmese (မြန်မာ).
- If the user speaks English, reply in English.
- If the user mixes languages (e.g. Burmese with English names/terms), keep the same mix — DO NOT translate proper names. Example: user says "Candidates Kaung Set Paing ကိုရှာပေးပါ" → reply "Candidates Kaung Set Paing ကိုရှာပေးနေပါပြီ" then call the search_candidates tool.
Keep replies short (1–2 sentences) because they are spoken aloud. No markdown.
When the user asks to find/search/look up a candidate by name, ALWAYS call search_candidates.
When the user asks to open/go to a page (dashboard, pipeline, operations, delivery, financial, settings), call navigate.`;

    const messages: any[] = [{ role: "system", content: system }, ...data.messages];
    const actions: Action[] = [];

    // Up to 3 tool-call rounds.
    for (let round = 0; round < 3; round++) {
      const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Lovable-API-Key": apiKey,
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages,
          tools,
        }),
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`AI gateway ${res.status}: ${txt.slice(0, 200)}`);
      }
      const json = (await res.json()) as any;
      const msg = json.choices?.[0]?.message;
      if (!msg) break;
      messages.push(msg);

      const toolCalls = msg.tool_calls as any[] | undefined;
      if (!toolCalls || toolCalls.length === 0) {
        const reply = (msg.content ?? "").trim() || "OK";
        return { reply, actions };
      }

      for (const call of toolCalls) {
        const name = call.function?.name;
        let args: any = {};
        try { args = JSON.parse(call.function?.arguments ?? "{}"); } catch {}
        let result: any = { ok: true };

        if (name === "navigate") {
          const route = String(args.route ?? "");
          if (route) actions.push({ type: "navigate", to: route });
          result = { ok: true, navigated_to: route };
        } else if (name === "search_candidates") {
          const q = String(args.query ?? "").trim();
          if (!q) {
            result = { ok: false, error: "empty query" };
          } else {
            const { data: rows, error } = await (context as any).supabase
              .from("candidates")
              .select("id,name,email,role_applied,status,ai_match_score")
              .ilike("name", `%${q}%`)
              .limit(10);
            if (error) {
              result = { ok: false, error: error.message };
            } else {
              const list = rows ?? [];
              actions.push({ type: "navigate", to: "/pipeline" });
              if (list.length > 0) actions.push({ type: "highlight_candidates", ids: list.map((r: any) => r.id) });
              result = { ok: true, count: list.length, candidates: list };
            }
          }
        } else {
          result = { ok: false, error: `unknown tool ${name}` };
        }

        messages.push({
          role: "tool",
          tool_call_id: call.id,
          name,
          content: JSON.stringify(result),
        });
      }
    }

    return { reply: "OK", actions };
  });
