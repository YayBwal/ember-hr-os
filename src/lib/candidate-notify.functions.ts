import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const notifyCandidate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => {
    const o = data as { candidate_id?: string; message?: string };
    if (!o?.candidate_id || !o?.message?.trim()) throw new Error("candidate_id and message required");
    return { candidate_id: o.candidate_id, message: o.message.trim() };
  })
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { tgSendMessage } = await import("@/lib/telegram.server");
    const { data: c, error } = await supabaseAdmin
      .from("candidates")
      .select("telegram_chat_id, full_name")
      .eq("id", data.candidate_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!c?.telegram_chat_id) {
      throw new Error("Candidate has no linked Telegram chat (must have applied via the bot).");
    }
    await tgSendMessage(Number(c.telegram_chat_id), data.message);
    return { ok: true };
  });
