## Goal

Make Operations the single source of truth for live KPI / Task % / Attendance %. KPI Calculation reflects those values per period instantly. Payroll only updates when HR clicks **Recompute payroll**, pulling KPI score, eligibility, approved bonus and overtime (from hours worked beyond the monthly baseline) for that period.

## Current state (confirmed)

- `recompute_employee_kpi` already recomputes per employee/period and updates `employees.performance_score`, `employees.attendance_pct` — Operations leaderboard reads these live (Realtime on `employees` is on).
- `compute_kpi_dashboard(period)` already returns Task %, Attendance %, KPI, working hours `(present + late*0.5)*8`, system + override bonus, eligibility.
- `recompute_payroll` already maps `kpi_overrides.bonus_override_mmk` (approved bonus) → `payroll_lines.performance_bonus_mmk`. **But** `v_overtime` is hardcoded to 0.
- Triggers (`trg_task_recompute`, `trg_attendance_recompute`, `trg_rating_recompute`, `trg_bd_recompute`, `trg_kpi_payroll`) all auto-run `recompute_payroll`, so payroll silently churns. KPI tab's period selector exists; Payroll tab is locked to current month.

## Changes

### 1. Database migration

- **Overtime in `recompute_payroll`**
  - Compute `worked_hours = (present + late*0.5) * 8` for the period.
  - `baseline_hours = 176` (22 days × 8h).
  - `overtime_hours = GREATEST(0, worked_hours - 176)`.
  - `hourly_rate = monthly_base_mmk / 176`.
  - `v_overtime = ROUND(hourly_rate * overtime_hours * 1.5)` (1.5× standard rate).
- **Make payroll manual-only**: remove the `PERFORM public.recompute_payroll(...)` calls from `trg_task_recompute`, `trg_attendance_recompute`, `trg_rating_recompute`, `trg_bd_recompute`, `trg_kpi_payroll`. Keep the `recompute_employee_kpi` calls so Operations + KPI tab stay live. Bonuses/deductions inserts still write rows; they just don't immediately update `payroll_lines`.
- **Expose overtime hours in `compute_kpi_dashboard`** so the KPI tab can show the same hours that will feed payroll (add `overtime_hours` column).

### 2. Server function

- `runPayroll` (already loops all employees for a given `periodMonth`) — no shape change, but it is now the only path that writes `payroll_lines`. Confirm it calls `recompute_employee_kpi` then `recompute_payroll` for every employee.

### 3. Financial → Payroll tab UI (`src/routes/_authenticated/financial.tsx`)

- Add a **period (month) selector** at the top of `PayrollTab`, identical to the one in the KPI Calculation tab. Default = current month, format `YYYY-MM`, value passed as `${period}-01` to all queries and to `runPayroll`.
- Period banner: `Period {YYYY-MM} · Total {MMK}` + "Last recomputed {timestamp}" pulled from `payroll_runs.created_at` (already present).
- Inline note under the Recompute button: "Payroll is finalized only when you click Recompute. Live KPI and attendance changes flow into KPI Calculation immediately."
- Each row's `KPI`, `KPI Bonus`, `Overtime` columns continue to read from `payroll_lines`. Add a tooltip on KPI Bonus showing whether it came from system tier or override.

### 4. KPI Calculation tab UI

- Show a small badge on the period selector: "Live — Operations sync". No backend change needed; the existing query already invalidates on KPI/attendance writes.
- Add `Overtime hrs` column next to `Working hours` using the new field from `compute_kpi_dashboard`.

### 5. Operations leaderboard

- No data change. Already live via Realtime + `recompute_employee_kpi` triggers. Add a subtle label in the header: "Source of truth for KPI sync".

## Out of scope

- No change to bonus override workflow (already wired).
- No change to promotions, pipeline, feedbacks.
- No new tables.

## Technical notes

- All period-keyed queries continue to use `YYYY-MM-01` (`date_trunc('month')`) — already consistent across `employee_kpis`, `payroll_runs`, `kpi_overrides`, `bonuses`, `deductions`.
- After removing payroll calls from triggers, the first time HR opens a fresh month they will see "Total 0" until they hit Recompute — that's the intended UX.
- Overtime multiplier `1.5` is a constant in `recompute_payroll`; can be exposed via `organizations` later if needed.

## Files touched

- `supabase` migration: edit `recompute_payroll`, edit `compute_kpi_dashboard`, edit five trigger functions.
- `src/routes/_authenticated/financial.tsx`: add period selector + helper text in PayrollTab; add Overtime hrs column in KPI tab.
- `src/routes/_authenticated/operations.tsx`: small "source of truth" label only.
