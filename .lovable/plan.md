## Root cause

The Recompute button itself wires up correctly (`runMut.mutate()` → `runFn({ data: { periodMonth: "2026-06-01" } })` → loops employees, calls `recompute_employee_kpi` + `recompute_payroll`). The real failure is in the data layer:

- `public.payroll_runs` has **no unique constraint on `(org_id, period_month)`**. For June 2026 the table currently holds **4 duplicate runs** for the same org/period (with lines split across two of them).
- The Payroll tab reads the run with `.maybeSingle()`, which errors out whenever more than one row matches → `run` is `undefined` → the empty-state card renders ("Payroll has not been computed for this period") and the `payroll_lines` query is keyed on `run?.id`, so it returns nothing either.
- The `recompute_payroll` SQL function does `SELECT id INTO v_run_id ... WHERE org_id=? AND period_month=?` with no `LIMIT`/order. With duplicates present it non-deterministically updates one of them, so clicking Recompute appears to do nothing in the UI even though KPIs/lines are being recomputed against a different run row.

KPI percentages reading 0/0% are a secondary symptom: tasks for June 2026 are mostly empty, so `task_completion` legitimately computes to 0 for most employees — but the user can't see the recomputed numbers at all because of the duplicate-run bug above.

## Fix plan

### 1. Database migration — dedupe + enforce uniqueness

- For every `(org_id, period_month)` group in `payroll_runs` with >1 row:
  - Pick the canonical run (`MIN(id)` or most recent `last_recomputed_at`).
  - Re-point all `payroll_lines.run_id` from duplicates to the canonical run, resolving collisions (`(run_id, employee_id)` unique) by keeping the row with the newest `total_mmk > 0` and deleting the rest.
  - Delete the now-orphan duplicate `payroll_runs`.
  - Refresh `payroll_runs.total_mmk = SUM(payroll_lines.total_mmk)` for the canonical row.
- Add `ALTER TABLE public.payroll_runs ADD CONSTRAINT payroll_runs_org_period_unique UNIQUE (org_id, period_month);`
- Harden `public.recompute_payroll`: replace the bare `SELECT ... INTO v_run_id` + `IF NULL THEN INSERT` block with an `INSERT ... ON CONFLICT (org_id, period_month) DO UPDATE SET last_recomputed_at = now() RETURNING id INTO v_run_id;` so concurrent clicks can never create another duplicate. Keep the rest of the function (overtime, KPI snapshot, override handling) unchanged.

### 2. Frontend — `src/routes/_authenticated/financial.tsx`

- Replace the `payroll_runs` read with an order + limit pattern that tolerates pre-existing duplicates and never throws:
  ```ts
  .select("id,period_month,total_mmk,last_recomputed_at")
  .eq("period_month", period)
  .order("last_recomputed_at", { ascending: false, nullsFirst: false })
  .limit(1)
  .maybeSingle()
  ```
- In `runMut.onSuccess`, also invalidate `["kpi_dashboard"]` and explicitly refetch `["payroll_runs", period]` before `["payroll_lines"]` so the lines query gets a real `run.id`. Add `onError` toast already exists — surface the underlying message (currently does).
- Empty-state card: only show when `!isLoading && !run` (avoid flashing during refetch).

### 3. Server function — `src/lib/financial.functions.ts`

- `runPayroll` already sequences `recompute_employee_kpi` then `recompute_payroll` per employee. Two small hardening changes:
  - Scope the employees query to `org_id = current_org_id()` via an explicit `.eq("org_id", ...)` using a lightweight `profiles` lookup, **or** simpler: change to `context.supabase.rpc("recompute_payroll_for_org", { _period: period })` — but to stay minimal, keep the loop and just surface errors: collect per-employee `rpc` errors and throw the first one instead of swallowing (right now nothing checks the `.rpc` return).
  - Normalize the incoming period through the existing `periodMonth()` helper (already done) — no change needed; the date parsing is safe because the client always sends `YYYY-MM-01`.

### 4. Verification

- After migration: `SELECT count(*) FROM payroll_runs WHERE period_month='2026-06-01'` must equal 1; the surviving run should aggregate the 14 lines and `total_mmk` should match `SUM(payroll_lines.total_mmk)`.
- In the UI: open Financial → Payroll for June 2026, confirm the table renders the existing 14 lines immediately (no empty state), click **Recompute payroll**, confirm the toast fires, the "Last recomputed" badge updates, and KPI Calculation tab numbers refresh.

### Out of scope

- KPI formula itself (already audited last turn — values of 40% for employees with zero June tasks are correct given the 60% task / 40% attendance weighting).
- Trigger removal from `trg_task_recompute` / `trg_attendance_recompute` — that decoupling is intentional and remains.

summary: Dedupe `payroll_runs`, add a `(org_id, period_month)` unique constraint, switch `recompute_payroll` to `ON CONFLICT`, and update the Payroll tab to read the canonical run with `order().limit(1)` so the recomputed numbers actually appear in the UI.