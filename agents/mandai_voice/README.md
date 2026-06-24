# Mandai Burmese Voice Agent

LiveKit Agent worker that powers the global mic in the Mandai web app. Uses **Gemini 2.5 Native Audio (Live)** for true speech-to-speech in Burmese (`my-MM`), with **Krisp** noise cancellation on the client and **LiveKit BVC** as a server-side backup.

## What it does

The browser publishes mic audio (already denoised by Krisp) into a LiveKit room. This worker joins the same room as `agent-…`, streams audio bidirectionally with Gemini Live, and calls back into your Lovable app's HMAC-protected tool endpoint `/api/public/agent/tools` to:

- create / move / list Kanban tasks
- read KPIs and payroll summaries
- recalculate payroll
- list employees

Mutations the agent makes appear in the UI instantly via Supabase Realtime + React Query invalidation.

## Run locally (dev)

```bash
cd agents/mandai_voice
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

export LIVEKIT_URL="wss://YOUR-PROJECT.livekit.cloud"
export LIVEKIT_API_KEY="..."
export LIVEKIT_API_SECRET="..."
export GEMINI_API_KEY="..."
export MANDAI_TOOLS_URL="https://YOUR-APP.lovable.app/api/public/agent/tools"
export AGENT_SERVICE_TOKEN="...(same value as the Lovable secret)..."

python agent.py dev
```

Then open the app, sign in, and click the red mic FAB. Speak Burmese.

## Deploy to LiveKit Cloud Agents

```bash
lk agent create        # first time, in this directory
lk agent deploy
```

Set the same env vars in the LiveKit Cloud agent settings page. The agent will auto-dispatch into any room created by `/api/livekit-token`.

## Notes

- Burmese voice: Gemini Live's native audio voices (`Aoede`, `Charon`, `Puck`, …) speak Burmese fluently when `language="my-MM"`.
- The `AGENT_SERVICE_TOKEN` HMAC is the only thing protecting your tool endpoint — keep it secret and never expose it to the browser.
- The agent reads the `orgId` from the LiveKit participant metadata that `/api/livekit-token` mints, so each session is automatically scoped to the signed-in user's organisation.
