## Goal
Single source of truth for Telegram link status (`employees.telegram_chat_id`), live-updating Feedbacks badge, simplified + responsive Operations leaderboard, KPI/Task% based on active work only.

## Changes

### 1. Realtime on `employees` (migration)
Add `employees` to the `supabase_realtime` publication so Telegram link updates push to clients instantly.

```sql
ALTER PUBLICATION supabase_realtime ADD TABLE public.employees;
```

No new tables, no new fields — `telegram_chat_id` already exists and is already written by the bot webhook on `/start` linking.

### 2. Feedbacks page — live badge (`src/routes/_authenticated/feedbacks.tsx`)
- Add a `useEffect` Realtime subscription on `public.employees` (UPDATE events) that calls `queryClient.invalidateQueries` for the employees list.
- Existing badge already reads `telegram_chat_id`; it will flip from "Not linked" → "Linked" without refresh.
- Channel torn down on unmount.

### 3. Operations Leaderboard (`src/routes/_authenticated/operations.tsx`)

**Query changes**
- `employees` select: add `telegram_chat_id`, drop `salary_grade` from the projection (unused in new columns; keep it on the profile sheet query).
- `tasks` query: only count **active** tasks (`status IN ('todo','in_progress')`) for the active/total used in Task %. Drop the `completed` counter from the row shape.
- Task % per employee = derived from `employee_kpis.task_completion` (already active-only per `recompute_employee_kpi`). No change needed there.

**Columns kept**: Rank · Employee (name/position/level) · Department · Team · KPI · Task % · Attendance % · Telegram Status.
**Removed**: Done, Active, Grade. Remove the matching sort option ("Completed Tasks") — keep KPI and Attendance sorts.

**Telegram badge cell**: green "Linked" pill when `telegram_chat_id` is set, muted "Not Linked" otherwise.

**Realtime**: same `employees` channel subscription as Feedbacks, invalidating the employees query.

### 4. Responsive layout
- Desktop (`md:` and up): keep the `<table>`.
- Mobile (`< md`): hide the table, render a stacked card list. Each card:
  - Header row: avatar + name + position + Telegram badge
  - 3-column metric grid: KPI · Task % · Attendance %
  - Tap card → opens existing `EmployeeProfileSheet`
- Implementation: one `rows` array, two render branches (`hidden md:block` for table wrapper, `md:hidden` for cards).

### 5. Performance
- Narrow selects (drop unused `salary_grade` from leaderboard query).
- Single tasks scan (already in place) — now smaller because we ignore `done`/`cancelled`.
- One Realtime channel per page (Feedbacks, Operations); both teardown on unmount.

## Out of scope
No schema additions, no new sync jobs, no changes to KPI formulas (the existing `recompute_employee_kpi` already excludes completed tasks from Task %).

## Files touched
- `supabase/migrations/...` (publication ADD TABLE)
- `src/routes/_authenticated/operations.tsx`
- `src/routes/_authenticated/feedbacks.tsx`
