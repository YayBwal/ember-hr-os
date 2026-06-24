# Foundation Build — Operations / Delivery / Financial

Scope chosen: **Foundation first**. KPI inputs are **manual entry by HR/Admin**. Realtime via **Supabase postgres_changes**. Meeting AI accepts **audio only** in v1.

Deferred to a later round: video/PDF/DOCX meetings, AI Analytics file uploads, PDF/Excel/CSV report export, advanced report charts (quarterly/yearly), team transfer history, file attachments on tasks.

---

## 1. Database (single migration)

New enums:
- `task_priority` (`low`, `medium`, `high`, `urgent`)
- extends `task_status` with `blocked`, `cancelled`

New columns on `employees`:
- `team_id uuid`, `join_date date`, `phone text`, `avatar_url text`, `salary_grade text`, `candidate_id uuid` (link back)

New tables (all `org_id`-scoped, RLS = same org, GRANTs to authenticated + service_role):

- `teams` — name, department, team_lead_employee_id
- `team_members` — team_id, employee_id (also kept in sync with `employees.team_id` for the primary team)
- `attendance` — employee_id, date, status (`present|late|absent|leave`), minutes_late, note. Unique (employee, date).
- `employee_kpis` — employee_id, period_month, task_completion, productivity, quality, attendance, kpi (all 0–100). Unique (employee, period_month). Stored snapshot; recomputed by trigger.
- `bonuses` — employee_id, period_month, amount_mmk, reason, source (`kpi|manual`)
- `deductions` — employee_id, period_month, amount_mmk, reason, source (`late|absent|low_productivity|missed_deadline|manual`)
- `task_comments` — task_id, author_user_id, body
- `meeting_summaries` — meeting_id, summary, key_points jsonb, decisions jsonb, risks jsonb, participants jsonb, deadlines jsonb, action_items jsonb

Add columns on `tasks`: `priority task_priority`, `team_id uuid`, `progress int (0-100)`.

Add columns on `payroll_lines`: `bonus_mmk`, `deduction_mmk`, `overtime_mmk`, `kpi_snapshot numeric`.

### Triggers / functions

- `recompute_employee_kpi(employee_id, period_month)` — security definer, writes to `employee_kpis`.
  - `task_completion` = % of tasks due in the month that are `done` on time
  - `productivity` = manual (from form) — defaults to last entered or 80
  - `quality` = manual (from form)
  - `attendance` = (present + 0.5×late) / working_days × 100 (from `attendance` table)
  - `kpi` = task_completion×0.40 + productivity×0.25 + attendance×0.20 + quality×0.15
- `recompute_payroll(employee_id, period_month)` — writes `payroll_lines` row using KPI bonus tiers (≥95→20%, 90→15%, 85→10%, 80→5%, else 0%) plus stored bonuses/deductions/overtime.
- Triggers on `tasks`, `attendance`, `bonuses`, `deductions`, `employee_kpis` → call recompute for the affected (employee, current month).
- `approve_candidate(candidate_id, department, position, monthly_base_mmk, team_id?)` RPC — creates employee, links `candidate_id`, sets candidate.status='onboarded'.

### Realtime

`ALTER PUBLICATION supabase_realtime ADD TABLE` for: `employees`, `tasks`, `attendance`, `employee_kpis`, `payroll_lines`, `bonuses`, `deductions`, `task_comments`, `meetings`, `meeting_summaries`, `teams`, `team_members`.

---

## 2. Server functions (`src/lib/*.functions.ts`)

All `requireSupabaseAuth`.

- `operations.functions.ts`
  - `approveCandidate({ candidateId, department, position, monthlyBase, teamId? })` → RPC
  - `listLeaderboard({ sortBy, dept?, team? })` → joined view
  - `getEmployeeProfile({ id })` → employee + latest kpi + tasks + payroll history + bonuses/deductions + attendance trend
  - `logAttendance({ employeeId, date, status, minutesLate? })`
  - `setProductivityQuality({ employeeId, periodMonth, productivity, quality })`
  - `createTeam`, `renameTeam`, `deleteTeam`, `assignMember`, `removeMember`, `transferMember`
- `delivery.functions.ts`
  - `createTask`, `updateTask` (status/priority/progress/assignee/due/effort), `addComment`, `listTasks`
- `financial.functions.ts`
  - `addBonus`, `addDeduction`, `runPayroll({ periodMonth })`, `listPayroll({ periodMonth })`
- `meeting.functions.ts`
  - `transcribeAndSummarize({ meetingId })` — pulls audio (base64 already uploaded via storage), sends to Lovable AI Gateway `google/gemini-2.5-flash` with `input_audio`, returns summary JSON, persists to `meeting_summaries`, **auto-creates tasks** from `action_items` (matching assignee by employee name `ilike`).

Storage bucket `meetings` (private) for audio uploads.

---

## 3. UI

### `/operations` — three tabs
1. **Leaderboard** — sortable table (KPI / Productivity / Attendance / Completed Tasks). Row click → profile drawer.
2. **Teams** — team cards with members, lead, active tasks, completion rate, team KPI. Admin CRUD modal.
3. **Meetings** — list, upload audio button, click row → summary view with action items (each shows the auto-created task link).

**Employee Profile drawer** (full-height side sheet): Profile / Performance / Tasks / Financial tabs. All sections subscribe to realtime.

**Attendance & Quality entry**: small panel on Performance tab with date picker + status, and a monthly Productivity/Quality slider.

### `/delivery` — Kanban
Columns: Pending → In Progress → Review → Completed (plus collapsible Blocked / Cancelled). Drag to change status. Card shows assignee avatar, priority chip, deadline, progress bar. Click → task detail dialog with comments.

### `/financial` — Payroll
- Period selector (month)
- "Run payroll" button (regenerates lines for period)
- Table per employee: base, bonus (with KPI tier badge), overtime, deductions, final
- Bonus/Deduction quick-add dialogs

### Pipeline addition
"Approve" action on candidate row → opens dialog (Department / Position / Monthly base / Team) → calls `approveCandidate`. Candidate moves to `onboarded` and disappears from active board; employee appears in Operations instantly via realtime.

### Realtime hook
`useRealtimeInvalidate(tables[])` subscribes once per page, invalidates the matching React Query keys on any change. Used by Leaderboard, Kanban, Payroll, Employee Profile.

---

## 4. Out of scope for this round

- Video / PDF / DOCX meeting uploads (only audio in v1)
- AI Analytics file uploads (Excel/CSV/PDF/DOCX) and prediction charts
- PDF/Excel/CSV export buttons on reports
- Quarterly / yearly chart aggregations
- Task file attachments
- Team transfer audit log
- Role-based UI restrictions beyond the existing `_authenticated` gate

---

## 5. Verification

- Build passes (`tsgo` via auto build).
- Approve a candidate → employee appears in Leaderboard without refresh (second browser tab).
- Drag a task to Done → KPI cell and Payroll line update live.
- Add a `late` attendance → Attendance % drops, KPI recomputes, deduction line appears.
- Upload a short audio meeting → summary + auto-created tasks appear, KPI/leaderboard reflect new assignments.
