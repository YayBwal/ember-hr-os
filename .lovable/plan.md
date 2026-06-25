## Current state

`src/routes/_authenticated/operations.tsx` already matches most of the spec:
- Desktop columns are exactly: Rank, Employee, Dept, Team, KPI, Task %, Att. %, Telegram.
- `DONE`, `ACTIVE`, `GRADE` columns/fields are gone from headers, cells, types, and queries.
- Telegram badge is driven by `employees.telegram_chat_id` (Linked / Not Linked).
- `task_counts_active` query only fetches `todo` + `in_progress` tasks.
- `useRealtimeInvalidate` listens to `employees` changes and invalidates `employees` + related leaderboard keys, so the badge flips when a user links Telegram in Feedbacks.
- Mobile card layout already exists under `md:hidden`.

The DB-side KPI / Task% already excludes done/archived: `recompute_employee_kpi` computes `task_completion` from `status IN ('todo','in_progress')` only.

## Gaps to close (small)

1. **Mobile card footer** — spec says footer shows only **KPI** and **Task %**. Today it also shows Attendance. Drop the Attendance tile and switch the grid from `grid-cols-3` to `grid-cols-2`. Keep the Telegram badge in the header (spec lists it there).
2. **Mobile card header** — add Department next to position (spec lists Name / Position / Department / Telegram badge in the header).
3. **Desktop header label** — rename `Dept` → `Department` and `Att. %` → `Attendance %` to match the spec's casing exactly. No data changes.
4. **Divider** — add a thin `<div className="my-3 border-t border-border" />` between header and footer in the mobile card, per spec.
5. **Sanity sweep** — confirm no leftover references to `done_tasks`, `active_tasks`, or `grade` anywhere in `operations.tsx` (already clean per grep, but verify after edits).

## Files touched

- `src/routes/_authenticated/operations.tsx` — only the `Leaderboard` component's JSX (desktop `<thead>` labels + mobile card markup). No query, type, or logic changes.

## Out of scope

- No DB migration (KPI function already excludes completed tasks).
- No changes to Feedbacks page (realtime already wired).
- No changes to `TeamDetailSheet` or `EmployeeProfileSheet`.
