import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Msg = { role: "user" | "assistant"; content: string };

export const voiceChat = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { messages: Msg[] }) => {
    if (!data || !Array.isArray(data.messages)) throw new Error("messages required");
    return { messages: data.messages.slice(-12) };
  })
  .handler(async ({ data }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("LOVABLE_API_KEY missing");

    const system = `You are Mandai, a friendly HR/operations voice assistant.
ALWAYS reply in Burmese (မြန်မာဘာသာ) using natural conversational tone.
Keep replies short — 1 to 3 sentences — because the user hears them spoken aloud.
Never use markdown, bullet points, or code blocks. Just plain spoken Burmese.`;

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": apiKey,
        "X-Lovable-AIG-SDK": "vercel-ai-sdk",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [{ role: "system", content: system }, ...data.messages],
      }),
    });

    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`AI gateway ${res.status}: ${txt.slice(0, 200)}`);
    }
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const reply = json.choices?.[0]?.message?.content?.trim() ?? "ဆောရီး၊ ပြန်ဖြေလို့မရဘူး။";
    return { reply };
  });
