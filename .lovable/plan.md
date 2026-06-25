# AI Assistant Upgrade Plan

Targeted upgrade in 4 small, isolated PRs. Voice assistant stays as-is; we extend its tool catalog and add a new text Copilot panel that shares the same tool layer.

## PR 1 — Shared AI tools layer (data access)

Create `src/lib/ai-tools.functions.ts` exposing one `createServerFn` per tool (auth-protected via `requireSupabaseAuth`, scoped by `current_org_id`). Each tool returns compact JSON.

Tools:
- `kpi_ranking` — lowest/highest KPI this month. Reads `employee_kpis` joined with `employees`. Args: `{ direction: "lowest"|"highest", limit?: number, period?: YYYY-MM }`.
- `bonus_totals` — total bonuses paid. Reads `bonuses` + `payroll_lines.performance_bonus_mmk`. Args: `{ period?, employee_id? }`.
- `payroll_summary` — monthly payroll breakdown per employee. Reads `payroll_runs` + `payroll_lines`. Args: `{ period?: YYYY-MM }`. Returns total, per-employee rows (base, perf bonus, bonus, deduction, total, KPI).
- `attendance_summary` — present/late/absent counts. Args: `{ period?, employee_id? }`.
- `team_overview` — teams + member counts + avg KPI.
- `candidate_lookup` — already exists in voice; reuse same query.

All tools return `{ ok, period, rows, totals }` JSON shape and are designed to be small enough to inline in a chat answer.

## PR 2 — Refactor voice + add Text Copilot panel

- Extract the chat loop in `voice.functions.ts` into a shared `runAiChat({ messages, mode })` helper that dispatches the full tool set above plus `navigate`.
- `voice.functions.ts` calls it with `mode: "voice"` (system prompt: 1–2 sentences, no markdown).
- New `copilot.functions.ts` calls it with `mode: "text"` (system prompt: full answers with markdown, tables OK, charts described as JSON block the UI can render).
- New `src/components/ai-copilot.tsx` — slide-in side panel (right edge, toggle button next to voice mic):
  - Message list with markdown rendering (react-markdown — already used elsewhere? add if not).
  - Tool-call results rendered as compact tables (payroll, KPI ranking).
  - Optional chart rendering: when tool returns `chart: { type, data }`, render a recharts bar/line chart inline (recharts already in stack).
  - Input + send. Keeps full conversation in component state (one conversation, no persistence — matches current voice pattern).
- Mounted globally in `app-shell.tsx` alongside `<VoiceAssistant />`.

## PR 3 — CV deep analyzer + comparison

- Extend `pipeline.functions.ts`:
  - New `analyzeCandidate(candidate_id)` — LLM call returning structured JSON: `{ strengths[], gaps[], red_flags[], role_fit_reasoning, interview_questions[], recommended_decision }`. Stored in `candidates.notes` JSON sidecar (or new column `ai_analysis jsonb` via migration if approved).
  - New `compareCandidates(ids: string[])` — LLM call comparing 2–3 candidates side by side for a role. Returns `{ summary, rows: [{candidate, strengths, gaps, verdict}], winner }`.
- UI: add "AI Analysis" tab to candidate detail in `pipeline.tsx` showing structured sections; add a "Compare" action when 2–3 candidates are selected, opening a modal with side-by-side cards.

(Migration only if user approves adding `ai_analysis jsonb` to `candidates`; otherwise reuse `notes`.)

## PR 4 — Analytics surface

- `payroll_summary` and `kpi_ranking` tools become reachable from the Copilot as both inline tables and a small chart block (bar chart of total payroll by month, top/bottom KPI bars).
- No CSV/Excel/PDF export yet (still deferred per roadmap).

## Out of scope
- LiveKit data-channel migration (current voice runs on Web Speech API; switching transport is a separate, larger PR).
- Schema redesign, multi-org changes, payroll computation logic.
- Realtime streaming of assistant tokens — text Copilot uses request/response, matching the voice loop. Streaming can come in a later PR.

## Technical notes
- All new server fns use `createServerFn` + `requireSupabaseAuth`; RLS already scopes data to the user's org.
- Model: `google/gemini-2.5-flash` (same as voice) for tool-calling; analyzer/compare use `google/gemini-2.5-pro` for quality.
- Tool results are clipped to ≤50 rows per call to stay under token limits.
- Text Copilot reuses the existing voice `runAiChat` loop, so a bug-fix in one fixes both.

Approve and I'll ship PR 1 first, then verify with `tsgo` before moving on.
