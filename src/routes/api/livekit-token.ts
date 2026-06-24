import { createFileRoute } from "@tanstack/react-router";
import { AccessToken } from "livekit-server-sdk";
import { createClient } from "@supabase/supabase-js";

export const Route = createFileRoute("/api/livekit-token")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env.LIVEKIT_API_KEY;
        const apiSecret = process.env.LIVEKIT_API_SECRET;
        const url = process.env.LIVEKIT_URL;
        if (!apiKey || !apiSecret || !url) {
          return Response.json({ error: "LiveKit not configured" }, { status: 500 });
        }

        const authHeader = request.headers.get("authorization") ?? "";
        const accessToken = authHeader.replace(/^Bearer\s+/i, "");
        if (!accessToken) return new Response("Unauthorized", { status: 401 });

        const sb = createClient(
          process.env.SUPABASE_URL!,
          process.env.SUPABASE_PUBLISHABLE_KEY!,
          { auth: { persistSession: false, autoRefreshToken: false } },
        );
        const { data: userRes, error: userErr } = await sb.auth.getUser(accessToken);
        if (userErr || !userRes.user) return new Response("Unauthorized", { status: 401 });
        const userId = userRes.user.id;

        // Look up org for this user using service role (RLS-safe)
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: profile } = await supabaseAdmin
          .from("profiles")
          .select("org_id, full_name")
          .eq("id", userId)
          .maybeSingle();
        if (!profile) return new Response("No profile", { status: 403 });

        const room = `mandai-${userId.slice(0, 8)}-${Date.now()}`;
        const identity = `user-${userId}`;
        const metadata = JSON.stringify({
          userId,
          orgId: profile.org_id,
          displayName: profile.full_name ?? "User",
        });

        const at = new AccessToken(apiKey, apiSecret, {
          identity,
          name: profile.full_name ?? "User",
          metadata,
          ttl: 60 * 30,
        });
        at.addGrant({
          room,
          roomJoin: true,
          canPublish: true,
          canSubscribe: true,
          canPublishData: true,
        });
        const token = await at.toJwt();

        return Response.json({ token, url, room, identity, metadata: { userId, orgId: profile.org_id } });
      },
    },
  },
});
