"""Mandai Burmese Voice Agent.

Run locally for dev:
    pip install -r requirements.txt
    python agent.py dev

Deploy to LiveKit Cloud:
    lk agent create
    lk agent deploy

Required env vars (set in LiveKit Cloud agent settings):
    LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET
    GEMINI_API_KEY                    -- Google AI Studio key with Gemini Live access
    MANDAI_TOOLS_URL                  -- https://<your-app>.lovable.app/api/public/agent/tools
    AGENT_SERVICE_TOKEN               -- shared HMAC secret (same value as Lovable secret)
"""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
import time
from typing import Any

import httpx
from livekit.agents import Agent, AgentSession, JobContext, RunContext, WorkerOptions, cli, function_tool
from livekit.plugins import google, noise_cancellation

logger = logging.getLogger("mandai-voice")
logging.basicConfig(level=logging.INFO)

TOOLS_URL = os.environ["MANDAI_TOOLS_URL"]
AGENT_SECRET = os.environ["AGENT_SERVICE_TOKEN"]

INSTRUCTIONS = (
    "You are Mandai, an enterprise HR operations assistant. "
    "The user speaks Burmese (Myanmar). ALWAYS reply in Burmese unless the user clearly switches language. "
    "Be concise and professional. Use the provided tools for ANY data action: "
    "creating tasks, moving tasks across the Kanban (todo, in_progress, review, done), "
    "looking up KPIs, payroll summaries, employees, or recalculating payroll. "
    "Confirm destructive actions briefly before executing. Money is always in MMK (Myanmar Kyat)."
)


async def _call_tool(org_id: str, tool: str, args: dict[str, Any]) -> dict[str, Any]:
    body = json.dumps({"tool": tool, "orgId": org_id, "args": args}, separators=(",", ":"))
    ts = str(int(time.time()))
    sig = hmac.new(AGENT_SECRET.encode(), f"{ts}.{body}".encode(), hashlib.sha256).hexdigest()
    async with httpx.AsyncClient(timeout=20) as c:
        r = await c.post(
            TOOLS_URL,
            content=body,
            headers={
                "content-type": "application/json",
                "x-agent-signature": sig,
                "x-agent-timestamp": ts,
            },
        )
    if r.status_code >= 400:
        logger.warning("tool %s failed %s %s", tool, r.status_code, r.text)
        return {"ok": False, "error": r.text}
    return r.json()


class MandaiAgent(Agent):
    def __init__(self, org_id: str) -> None:
        super().__init__(instructions=INSTRUCTIONS)
        self.org_id = org_id

    @function_tool
    async def create_task(
        self,
        _ctx: RunContext,
        title: str,
        description: str | None = None,
        effort_points: int = 3,
        due_date: str | None = None,
    ) -> str:
        """Create a Kanban task in the Delivery board."""
        res = await _call_tool(self.org_id, "create_task", {
            "title": title,
            "description": description,
            "effort_points": effort_points,
            "due_date": due_date,
        })
        return json.dumps(res, ensure_ascii=False)

    @function_tool
    async def move_task(self, _ctx: RunContext, task_id: str, status: str) -> str:
        """Move a task. status must be one of: todo, in_progress, review, done."""
        res = await _call_tool(self.org_id, "move_task", {"task_id": task_id, "status": status})
        return json.dumps(res, ensure_ascii=False)

    @function_tool
    async def list_tasks(self, _ctx: RunContext, status: str | None = None, limit: int = 10) -> str:
        """List recent tasks, optionally filtered by status."""
        res = await _call_tool(self.org_id, "list_tasks", {"status": status, "limit": limit})
        return json.dumps(res, ensure_ascii=False)

    @function_tool
    async def list_employees(self, _ctx: RunContext) -> str:
        """List the organization's employees with role and department."""
        res = await _call_tool(self.org_id, "list_employees", {})
        return json.dumps(res, ensure_ascii=False)

    @function_tool
    async def get_kpis(self, _ctx: RunContext) -> str:
        """Get organization KPIs: employee count, candidates, tasks by status."""
        res = await _call_tool(self.org_id, "get_kpis", {})
        return json.dumps(res, ensure_ascii=False)

    @function_tool
    async def get_payroll_summary(self, _ctx: RunContext) -> str:
        """Get the most recent payroll runs in MMK."""
        res = await _call_tool(self.org_id, "get_payroll_summary", {})
        return json.dumps(res, ensure_ascii=False)

    @function_tool
    async def recalc_payroll(self, _ctx: RunContext) -> str:
        """Recalculate payroll for the organization."""
        res = await _call_tool(self.org_id, "recalc_payroll", {})
        return json.dumps(res, ensure_ascii=False)


async def entrypoint(ctx: JobContext) -> None:
    await ctx.connect()
    # Wait for the human participant and read org metadata from their JWT.
    participant = await ctx.wait_for_participant()
    try:
        meta = json.loads(participant.metadata or "{}")
    except Exception:
        meta = {}
    org_id = meta.get("orgId")
    if not org_id:
        logger.error("No orgId in participant metadata, leaving room")
        return

    session = AgentSession(
        llm=google.beta.realtime.RealtimeModel(
            model="gemini-2.5-flash-native-audio-preview-09-2025",
            voice="Aoede",
            temperature=0.7,
            language="my-MM",
        ),
    )
    await session.start(
        agent=MandaiAgent(org_id=org_id),
        room=ctx.room,
        room_input_options={"noise_cancellation": noise_cancellation.BVC()},
    )
    await session.generate_reply(
        instructions="မင်္ဂလာပါ။ ကျွန်တော် Mandai AI ပါ။ ဘယ်လိုကူညီပေးရမလဲ?"
    )


if __name__ == "__main__":
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint))
