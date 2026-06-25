## Promotions tab simplification

Focus the Promote dialog on level, position, salary, and reason. Remove every KPI-manipulation path end to end. Auto-fill salary from the org's `salary_bands` whenever the level changes, and reject salaries below the band minimum.

### Frontend — `src/routes/_authenticated/financial.tsx`

1. **Remove the "Suggested promotions" banner**
   - Delete the `suggestions` `useMemo` (lines 271–284) and the JSX block at lines 304–321.
   - Drop the now-unused `Sparkles` import if nothing else uses it.

2. **Rework `PromoteDialog`**
   - Remove `kpiAdj` state, the KPI Adjustment label/badge/`Slider`/scale block (lines 523–541), and the `kpiAdjustment` field from the mutation payload.
   - Drop the `Slider` import.
   - Add salary auto-fill: when `level` changes (and on dialog open), set `salary` to `bands?.[level]?.min` if a band exists; otherwise keep the current employee salary as fallback. Track whether the value came from auto-fill so subsequent manual edits aren't overwritten on re-renders.
   - Strengthen validation: `outOfBand` becomes a hard block when `salaryNum < band.min` (below-band → disable Save and show inline error). Above-band stays as an advisory message (no block) since the spec only forbids dropping below the minimum.
   - `canSave` requires: trimmed reason, trimmed position, `salaryNum >= band.min` (if band known), and not pending.

3. **Field order in dialog**: Level → Position → Salary (with band hint + min-violation error) → Reason. Keep the read-only "current level / position / salary" summary at top.

### Backend

4. **`src/lib/financial.functions.ts`** — drop `kpiAdjustment` from `promoteEmployee`'s input validator, the clamp logic, and the `_kpi_adjustment` RPC argument.

5. **Migration** — new migration that:
   - Redefines `public.promote_employee` without the `_kpi_adjustment` parameter (so the old 7-arg overload is gone; uses `DROP FUNCTION ... (uuid, employee_level, text, bigint, date, text, numeric)` first, then `CREATE OR REPLACE` with the 6-arg signature). New body skips the `v_adj` clamp and inserts `kpi_adjustment = 0` into `employee_promotions` to preserve the audit column and historical rows.
   - Redefines `public.recompute_payroll` to ignore `employee_promotions.kpi_adjustment` (i.e. `v_effective_kpi := LEAST(100, GREATEST(0, v_kpi))`), so future payroll runs no longer apply slider adjustments. Historical `payroll_lines.kpi_snapshot` rows are left untouched.
   - Keeps the `kpi_adjustment` column on `employee_promotions` so existing audit records remain readable; the column simply stops being written with non-zero values.

### Audit / history

6. Promotion rows continue to capture `from_level`, `to_level`, `from_position`, `to_position`, `from_base_mmk`, `to_base_mmk`, `note`, `effective_date`, `created_by` — nothing about that changes. The Promotion History expandable row in the table keeps rendering as-is.

### Validation & UX details

- Auto-fill triggers in a `useEffect` keyed on `level` and dialog open. A `manuallyEdited` ref flips to `true` on the first `onChange` of the salary input so the auto-fill effect only overrides when the user actively changed the level.
- When the org has no `salary_bands` configured, fall back to the employee's existing salary on open and skip the min-check (no false blocks).
- Inline error under the salary input when below band: "Below {Level} minimum ({formatMMKCompact(min)})". Save button disabled in that state.
- Dialog stays responsive: existing `sm:max-w-md` + stacked fields already handle mobile.

### Out of scope

- No changes to `Bonus`, `Eligibility`, or KPI Calculation tabs.
- No changes to `recompute_employee_kpi`.
- No data backfill of `employee_promotions.kpi_adjustment` — historical values stay for audit transparency.
