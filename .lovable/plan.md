## KPI Calculation Module

A new **KPI Calculation** tab inside the Financial page, sitting beside Payroll and Promotions. It's a read-only HR performance-to-compensation dashboard, fully derived from existing operational data (no manual inputs).

### 1. Database (one migration)

- Add `employment_type` enum (`remote`, `on_site`) and column on `employees` (default `on_site`).
- Add Postgres function `compute_kpi_dashboard(_org_id uuid, _period_month date)` returning one row per employee with:
  - `employee_id`, `full_name`, `department`, `position`, `level`, `team_id`, `employment_type`
  - `base_salary_mmk` (from `employees.monthly_base_mmk`)
  - `task_completion_pct` — completed tasks / assigned tasks in the period (from `tasks` joined to Team Leader–reviewed status, falling back to `employee_kpis.task_completion`)
  - `attendance_pct` and `attendance_days_present/absent/late` (from `attendance` for the period)
  - `working_hours` — derived from attendance days × standard daily hours (8 on-site / configurable remote)
  - `kpi_score` (from `employee_kpis.kpi` for that period; recompute if missing)
  - `bonus_eligible` (boolean: kpi ≥ 70 and attendance ≥ 85 — different thresholds for `remote` vs `on_site`)
  - `bonus_amount_mmk` — projected bonus using the same formula as `recompute_payroll` so values match the Payroll tab exactly
- Function runs `SECURITY DEFINER`, scoped to caller's org via `has_role`/membership; grants to `authenticated`.
- No changes to existing payroll/promotion logic — only additive.

### 2. Server function

- `src/lib/kpi.functions.ts` → `getKpiDashboard({ periodMonth })` wraps the RPC, plus `setEmploymentType({ employeeId, type })`.
- Uses `requireSupabaseAuth`. All aggregation stays in Postgres for consistency.

### 3. UI: new tab in Financial

Add a third pill `KPI Calculation` next to Payroll / Promotions in `src/routes/_authenticated/financial.tsx`. Layout:

- **Filter bar** (top): period month picker, department select, team select, employment type select (All / Remote / On-Site), employee search.
- **Summary cards** (4): Avg KPI, Bonus-Eligible Count, Avg Attendance, Total Projected Bonus.
- **Table** with columns: Employee · Type (Remote/On-Site badge) · Base Salary · Task Completion · Attendance · Working Hours · KPI Score · Bonus Eligible · Bonus Amount. Rows expandable for breakdown (tasks done/assigned, days present/absent/late).
- **Employment type toggle** inline on each row (small select) — only edit affordance; everything else is derived.
- Responsive: cards stack on mobile, table becomes card list < md.
- Uses TanStack Query with `staleTime: 60s` to avoid recompute thrash; invalidates when payroll is recomputed.

### 4. Sync & edge cases

- New employee with no attendance/tasks → KPI shown as "—", bonus 0, not eligible.
- Missing `employee_kpis` row → server computes on the fly via existing `recompute_employee_kpi`.
- Remote vs on-site: working hours formula and bonus thresholds parametrized in the RPC; HR policies remain transparent in SQL.
- Recompute Payroll button continues to work unchanged; KPI dashboard reads same source-of-truth.

### Technical notes
- No new routes; just a tab → preserves existing routing, role guards, and Team Leader isolation.
- Zero breaking changes to Promotion, Payroll, Team Session, or HR workflows.
- All money formatting reuses existing `formatMMK` helper.

### Open question
Default working-hours rule: on-site = 8h × present days; remote = 8h × present days as well, or a different cadence (e.g. logged hours)? I'll default both to 8h × present days unless you specify otherwise.
