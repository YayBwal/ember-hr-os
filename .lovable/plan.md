# Burmese Speech‑to‑Speech Assistant (Global Mic)

A floating mic in the AppShell opens a live voice session. User speaks Burmese, hears Burmese back, and the assistant can read/control Pipeline, Operations, Delivery, and Financial in real time. Audio runs through a LiveKit Cloud room with Krisp noise cancellation; a LiveKit Agent worker uses Gemini Live as the realtime model.

## Important capability note

Lovable AI Gateway currently exposes chat, transcription, embeddings and image — **not** Gemini's bidirectional Live (realtime audio) API. True S2S therefore needs a direct Google AI Studio / Vertex `GEMINI_API_KEY` on the agent worker. I'll keep the rest on Lovable AI (intent parsing / Burmese summarisation fallbacks) so only one extra key is required.

Two things I need from you to proceed in build mode:
1. **LiveKit Cloud** project — `LIVEKIT_URL` (wss://…), `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`.
2. **Google AI Studio** key with Gemini Live access — `GEMINI_API_KEY`.
   (If you'd rather not, I'll downgrade to STT→LLM→TTS pseudo‑S2S over Lovable AI only — higher latency, no true interruption.)

## Architecture

```text
 Browser (AppShell mic)
   │  getUserMedia → KrispNoiseFilter (livekit/krisp-noise-filter)
   │  livekit-client → join room with short‑lived token
   ▼
 LiveKit Cloud Room  ───────────────►  LiveKit Agent Worker (Python, hosted by you on LiveKit Cloud Agents)
   ▲                                    │ plugins: google.beta.realtime (Gemini Live, my-MM)
   │ agent audio track                  │ tools: create_task, move_task, query_kpi, query_payroll, navigate
   │                                    │ → calls TanStack server fns over HTTPS w/ service JWT
   └──────────────── audio ◄────────────┘
```

Server functions exposed to the agent (signed call, service role):
- `agent.createTask({ title, assignee?, points?, due? })`
- `agent.moveTask({ taskId, status })`
- `agent.listTasks({ status?, assignee? })`
- `agent.getKpis()` / `agent.getPayrollSummary()`
- `agent.recalcPayroll()`
- `agent.navigate({ route })` → pushed back to browser via LiveKit data channel; client routes via TanStack router.

## Build steps

1. **Secrets**: request `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `GEMINI_API_KEY` via `add_secret`. Generate `AGENT_SERVICE_TOKEN` (HMAC shared secret between agent and our server fns).
2. **Token endpoint** — `src/routes/api/livekit-token.ts` (auth‑required). Mints a LiveKit JWT scoped to room `mandai-{userId}-{ts}` with publish/subscribe and metadata `{ userId, orgId }`.
3. **Agent tool endpoints** — `src/routes/api/public/agent/*.ts`. HMAC‑verified using `AGENT_SERVICE_TOKEN` + room metadata. Internally call existing Supabase logic with service role, scoped to the caller's org.
4. **LiveKit Agent worker** — `agents/mandai_voice/` (Python, livekit-agents 1.x). System prompt: "You are Mandai's Burmese operations assistant. Reply in Burmese (Myanmar). Use tools for any data action." Uses `google.beta.realtime.RealtimeModel(model="gemini-2.5-flash-native-audio-preview", language="my-MM", voice="Aoede")`. Includes `noise_cancellation=BVC()` as a backup; primary denoise stays client‑side via Krisp. Tools wrap the HTTP endpoints above. README documents `lk agent deploy`.
5. **Client integration**:
   - `bun add livekit-client @livekit/components-react @livekit/krisp-noise-filter`
   - `src/components/voice-assistant.tsx` — floating red mic FAB in `AppShell`. States: idle → connecting → listening (pulsing) → speaking → error. Shows live transcript captions (Burmese) and the active tool call (e.g. "✓ Task created: …").
   - On connect: fetch token → `Room.connect()` → `room.localParticipant.setMicrophoneEnabled(true, { processor: KrispNoiseFilter() })` → subscribe to agent audio track and play. Data channel listens for `{ type: 'navigate', to }` and calls `router.navigate`. On task/payroll mutations, invalidate the relevant React Query keys so KPIs/Kanban update without reload.
6. **UI affordances**:
   - Mic FAB bottom‑right, hidden on `/` and `/auth`.
   - Burmese helper text ("မိုက်ကိုနှိပ်၍ မြန်မာစကားပြောပါ").
   - Mute, end‑call, and a "Show transcript" drawer.
7. **Realtime task sync**: enable Supabase Realtime on `tasks` and `payroll` so when the agent inserts via service role, every open client sees it instantly (already wired in Delivery; extend to Financial).
8. **Verification**: `invoke-server-function` against token endpoint; `curl` the agent tool endpoints with HMAC; manual voice test via Playwright is impractical for audio, so I'll smoke‑test by sending a synthetic text turn into the agent and checking the task appears.

## Out of scope this round
- Multi‑language switching mid‑session (Burmese only).
- Voice biometric auth.
- Persistent conversation history UI (transient drawer only).

## Tech section
- LiveKit Agent worker is a separate Python process you deploy on LiveKit Cloud Agents (`lk agent create / deploy`). Lovable's Worker runtime can't host it (no long‑lived processes, no Python).
- Krisp filter runs in the browser via WASM (`@livekit/krisp-noise-filter`), so denoise happens before audio leaves the device.
- Burmese voice: Gemini Live's `Aoede` / `Charon` voices speak Burmese when `language="my-MM"` is set; if quality is poor we'll switch to Gemini STT → Lovable AI text → Gemini TTS.
- Auth on tool endpoints uses HMAC(secret, body+timestamp) — never expose `AGENT_SERVICE_TOKEN` to the browser.

Reply with the LiveKit + Gemini secrets (or "use STT/TTS fallback") and I'll implement.
