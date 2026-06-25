// Server fn invoked by the browser Gemini-Live client when the model emits a
// toolCall. Runs the existing dispatchTool with the user's RLS-scoped client.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { dispatchTool } from "@/lib/ai-tools";

export const dispatchAiTool = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { name: string; args: Record<string, unknown> }) => {
    if (!data?.name || typeof data.name !== "string") throw new Error("name required");
    return { name: data.name, args: data.args ?? {} };
  })
  .handler(async ({ data, context }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = await dispatchTool(data.name, data.args, context.supabase as any);
    return out;
  });
