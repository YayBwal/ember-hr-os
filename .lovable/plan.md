# Payroll & KPI Integration — Remaining Gaps

Most of this initiative is already shipped: overtime is dynamic (176h baseline, 1.5×), triggers no longer auto-recompute payroll, the KPI tab shows "Live · Operations sync" + OT hrs column, and Payroll has a period picker plus manual Recompute. What's still missing from the spec:

## 1. Payroll empty-state for unprocessed periods
In `PayrollTab` (`src/routes/_authenticated/financial.tsx`), when `run` is null for the selected month, render an info card:
> "Payroll has not been computed for this period. Click Recompute Payroll to generate results."
The employee table stays visible but shows base-only fallbacks (current behavior).

## 2. "Last Recomputed" timestamp
- Migration: add `last_recomputed_at timestamptz` to `public.payroll_runs`; update `recompute_payroll` to set `last_recomputed_at = now()` on every run (both insert and update branches at the end of the function).
- UI: select that column in the `payroll_runs` query; render `Last recomputed: <relative time>` next to the period selector when present.

## 3. KPI Bonus source tooltip
For each row's KPI Bonus cell, fetch `kpi_overrides` for the selected period (one query keyed on `period`, joined client-side by `employee_id`). Wrap the amount in a shadcn `Tooltip`:
- If `bonus_override_mmk` is set for that employee → "Manually adjusted by HR · {note}"
- Otherwise → "Auto-generated from KPI tier ({tier}%)"
Add a small icon (Info) beside the amount as the tooltip trigger so it's discoverable.

## 4. No other changes
- Operations leaderboard, KPI Calculation tab, overtime math, trigger removals — already in place; do not touch.
- No schema changes beyond the single `last_recomputed_at` column.

## Technical notes
- The migration must redefine `recompute_payroll` in full (Postgres requires CREATE OR REPLACE FUNCTION) — body is unchanged except for setting `last_recomputed_at` and selecting it.
- Tooltip uses existing `@/components/ui/tooltip` primitives already used elsewhere in the file.
- Query key for overrides: `["kpi_overrides", period]`, fetching `employee_id, bonus_override_mmk, note`.
