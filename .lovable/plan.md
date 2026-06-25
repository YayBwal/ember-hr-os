## Plan: Fix Recompute Payroll bonus/overtime outputs

### What I found
- The frontend button is already calling `runPayroll` with the selected month correctly.
- `runPayroll` already calls `recompute_employee_kpi` before `recompute_payroll` for each employee.
- The database function currently does not apply promotion KPI adjustments inside payroll, even though the KPI dashboard does. This explains mismatches like a dashboard KPI of `51.2` while payroll uses another snapshot.
- For June 2026, the database only has one attendance row and it is `absent`, so the current formula correctly produces `0` overtime for that period. The function should still be hardened so empty attendance defaults cleanly to `0`.
- The payroll table currently has no lines for a few employees, likely because older recompute runs skipped employees with missing/zero data or because the UI is reading only generated lines.

### Backend fix
1. Replace `public.recompute_payroll` with a safer version that:
   - Loads the employee base salary, organization, employment type, and stored attendance safely.
   - Recomputes raw KPI from `employee_kpis` for the month.
   - Applies any monthly KPI adjustment from `employee_promotions.kpi_adjustment` before calculating the payroll snapshot.
   - Calculates attendance with explicit `COALESCE` defaults:
     - `present_days = 0` if none
     - `late_days = 0` if none
     - `logged_days = 0` if none
   - Calculates overtime exactly as requested:
     - `worked_hours = (present_days + late_days * 0.5) * 8`
     - `overtime_hours = GREATEST(0, worked_hours - 176)`
     - `hourly_rate = monthly_base_mmk / 176`
     - `v_overtime = ROUND(hourly_rate * overtime_hours * 1.5)`
   - Keeps missing attendance from breaking payroll rows.
   - Writes/upserts every employee into `payroll_lines` for the selected run.

2. Fix KPI bonus tier mapping in the same function:
   - Use the effective KPI snapshot after adjustment.
   - Check eligibility using the same effective KPI and attendance rules as KPI Calculation.
   - Use tier percentages:
     - `>= 95` → `20%`
     - `>= 90` → `15%`
     - `>= 85` → `10%`
     - `>= 80` → `5%`
     - else `0%`
   - Respect `kpi_overrides.eligible_override` and `kpi_overrides.bonus_override_mmk`.
   - Write the final KPI bonus directly into `payroll_lines.performance_bonus_mmk`.

3. Align `public.compute_kpi_dashboard` if needed so the dashboard and payroll use the same effective KPI for eligibility and tier checks.

### Frontend fix
1. Update `src/routes/_authenticated/financial.tsx` Payroll row display:
   - Replace the confusing/static KPI indicator with a clear computed tier indicator.
   - Show KPI score on the first line, and a stable second line like `Tier 5%`, `Tier 20%`, or `No bonus tier`.
   - Avoid rendering broken text like `- 0%`.

2. Keep the existing tooltip behavior for KPI bonus:
   - If manual override exists, show manual override note.
   - Otherwise show the auto-generated tier explanation.

### Validation
- Recompute payroll for the selected month.
- Verify `payroll_lines` updates with:
  - `kpi_snapshot`
  - `performance_bonus_mmk`
  - `overtime_mmk`
  - `total_mmk`
- Confirm zero overtime is shown only when attendance days do not exceed 176 hours.
- Confirm employees with qualifying KPI/eligibility receive the correct KPI bonus, and manual overrides still win.