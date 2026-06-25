import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { ALL_TOOLS, dispatchTool, type AiAction, type ChartSpec } from "@/lib/ai-tools";

type Msg = { role: "user" | "assistant" | "tool"; content: string; tool_call_id?: string; name?: string };

export type ToolTrace = {
  name: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  args: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  result: any;
  chart?: ChartSpec;
};

export const copilotChat = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { messages: Msg[] }) => {
    if (!data || !Array.isArray(data.messages)) throw new Error("messages required");
    return { messages: data.messages.slice(-20) };
  })
  .handler(async ({ data, context }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("LOVABLE_API_KEY missing");

    const system = `You are Mandai Copilot — an HR/operations text assistant inside an admin app.
LANGUAGE: mirror the user's language exactly. Keep proper names unchanged.
You can format answers with markdown: short paragraphs, bullet lists, and small tables.
When you call a data tool (kpi_ranking, bonus_totals, payroll_summary, attendance_summary, team_overview, search_candidates), the UI ALREADY renders the table/chart for the user — do NOT re-print every row. Instead write a 2–4 sentence interpretation: the key number, who's at the top/bottom, and one concrete next step.
Use navigate only when the user asks to open a page.`;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const messages: any[] = [{ role: "system", content: system }, ...data.messages];
    const actions: AiAction[] = [];
    const tools: ToolTrace[] = [];

    for (let round = 0; round < 4; round++) {
      const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Lovable-API-Key": apiKey },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages,
          tools: ALL_TOOLS,
        }),
      });
      if (!res.ok) {
        const txt = await res.text();
        if (res.status === 429) throw new Error("Rate limit — please retry shortly");
        if (res.status === 402) throw new Error("AI credits exhausted — add credits in workspace settings");
        throw new Error(`AI gateway ${res.status}: ${txt.slice(0, 200)}`);
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const json = (await res.json()) as any;
      const msg = json.choices?.[0]?.message;
      if (!msg) break;
      messages.push(msg);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const toolCalls = msg.tool_calls as any[] | undefined;
      if (!toolCalls || toolCalls.length === 0) {
        const reply = (msg.content ?? "").trim() || "OK";
        return { reply, actions, tools };
      }

      for (const call of toolCalls) {
        const name = call.function?.name;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let args: any = {};
        try { args = JSON.parse(call.function?.arguments ?? "{}"); } catch { /* ignore */ }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { result, action, chart } = await dispatchTool(name, args, (context as any).supabase);
        if (action) actions.push(action);
        if (name !== "navigate") {
          tools.push({ name, args, result, chart });
        }
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          name,
          content: JSON.stringify(result),
        });
      }
    }
    return { reply: "Reached step limit.", actions, tools };
  });
