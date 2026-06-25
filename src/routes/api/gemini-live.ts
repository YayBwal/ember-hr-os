// WebSocket proxy: browser <-> this route <-> Gemini Multimodal Live API.
// Runs on Cloudflare Workers; uses the runtime `WebSocketPair` + `fetch` upgrade.
// Auth: the browser passes its Supabase access token as `?token=...` query param.
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

const GEMINI_WS =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";

export const Route = createFileRoute("/api/gemini-live")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
          return new Response("expected websocket upgrade", { status: 400 });
        }

        const url = new URL(request.url);
        const token = url.searchParams.get("token") ?? "";
        if (!token) return new Response("Unauthorized", { status: 401 });

        // Verify the user with Supabase (publishable key, just for session lookup).
        const sbUrl = process.env.SUPABASE_URL;
        const sbKey = process.env.SUPABASE_PUBLISHABLE_KEY;
        if (!sbUrl || !sbKey) return new Response("Server misconfigured", { status: 500 });
        const sb = createClient(sbUrl, sbKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const { data: userRes, error: userErr } = await sb.auth.getUser(token);
        if (userErr || !userRes.user) return new Response("Unauthorized", { status: 401 });

        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) return new Response("GEMINI_API_KEY not configured", { status: 500 });

        // Connect upstream to Gemini Live via fetch-upgrade (Cloudflare Workers API).
        const upstreamRes = await fetch(`${GEMINI_WS}?key=${apiKey}`, {
          headers: { Upgrade: "websocket" },
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const upstream = (upstreamRes as unknown as { webSocket: any }).webSocket;
        if (!upstream) {
          return new Response("Failed to connect to Gemini Live", { status: 502 });
        }
        upstream.accept();

        // Create the client-facing socket pair.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const PairCtor = (globalThis as any).WebSocketPair;
        if (!PairCtor) return new Response("WebSocketPair unsupported in this runtime", { status: 500 });
        const pair = new PairCtor();
        const client = pair[0];
        const server = pair[1];
        server.accept();

        // Bidirectional forward.
        server.addEventListener("message", (e: MessageEvent) => {
          try {
            upstream.send(e.data);
          } catch {
            /* upstream closed */
          }
        });
        upstream.addEventListener("message", (e: MessageEvent) => {
          try {
            server.send(e.data);
          } catch {
            /* client closed */
          }
        });
        const closeBoth = () => {
          try { upstream.close(); } catch { /* noop */ }
          try { server.close(); } catch { /* noop */ }
        };
        server.addEventListener("close", closeBoth);
        upstream.addEventListener("close", closeBoth);
        server.addEventListener("error", closeBoth);
        upstream.addEventListener("error", closeBoth);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return new Response(null, { status: 101, webSocket: client } as any);
      },
    },
  },
});
