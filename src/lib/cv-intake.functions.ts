// Authenticated server function to generate a short-lived signed URL
// so HR can preview/download a Telegram-submitted CV.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getCvSignedUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => {
    const o = data as { storage_path?: string };
    if (!o?.storage_path) throw new Error("storage_path required");
    return { storage_path: o.storage_path };
  })
  .handler(async ({ data }): Promise<{ url: string }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: signed, error } = await supabaseAdmin.storage
      .from("candidate-cvs")
      .createSignedUrl(data.storage_path, 60 * 60); // 1 hour
    if (error || !signed?.signedUrl) {
      throw new Error(error?.message ?? "Could not sign URL");
    }
    return { url: signed.signedUrl };
  });
