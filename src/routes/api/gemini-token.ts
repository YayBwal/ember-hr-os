// Mints a short-lived ephemeral auth token for Gemini Live so the browser
// can connect to Google's WSS endpoint directly (no server-side WebSocket
// proxy required — this works on runtimes without WebSocketPair).
//
// Auth: the browser sends its Supabase access token as Bearer header.
// The server verifies it, then calls Google's v1alpha/auth_tokens endpoint
// with the locked session config and returns the ephemeral token "name".
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

const AUTH_TOKENS_URL =
  "https://generativelanguage.googleapis.com/v1alpha/auth_tokens";

export const Route = createFileRoute("/api/gemini-token")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env.GEMINI_API_KEY;
        const sbUrl = process.env.SUPABASE_URL;
        const sbKey = process.env.SUPABASE_PUBLISHABLE_KEY;
        if (!apiKey) return new Response("GEMINI_API_KEY not configured", { status: 500 });
        if (!sbUrl || !sbKey) return new Response("Server misconfigured", { status: 500 });

        // Verify the caller is signed in.
        const authHeader = request.headers.get("authorization") ?? "";
        const token = authHeader.replace(/^Bearer\s+/i, "");
        if (!token) return new Response("Unauthorized", { status: 401 });
        const sb = createClient(sbUrl, sbKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const { data: userRes, error: userErr } = await sb.auth.getUser(token);
        if (userErr || !userRes.user) return new Response("Unauthorized", { status: 401 });

        // The client posts its locked session setup; we forward it inside the
        // bidiGenerateContentSetup so Google enforces it.
        let body: { setup?: Record<string, unknown> } = {};
        try {
          body = (await request.json()) as { setup?: Record<string, unknown> };
        } catch {
          /* empty body is ok */
        }

        const now = Date.now();
        // Token must be used to open a connection within 60s.
        // Once the WS session opens, it can run up to 10 minutes.
        const expireTime = new Date(now + 60_000).toISOString();
        const newSessionExpireTime = new Date(now + 10 * 60_000).toISOString();

        const res = await fetch(`${AUTH_TOKENS_URL}?key=${apiKey}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            uses: 1,
            expireTime,
            newSessionExpireTime,
            bidiGenerateContentSetup: body.setup ?? {},
          }),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          console.error("[gemini-token] mint failed", res.status, text);
          return new Response(
            `Token mint failed (${res.status}): ${text.slice(0, 300)}`,
            { status: 502 },
          );
        }
        const json = (await res.json()) as { name?: string };
        if (!json.name) {
          return new Response("Token response missing name", { status: 502 });
        }
        return Response.json({ token: json.name });
      },
    },
  },
});
