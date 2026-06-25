## Promotion & Compensation workflow

### 1. Schema (one migration)

- Add `trainee` to `employee_level` enum (keep legacy `mid` to avoid breaking existing rows).
- Add columns to `public.employee_promotions`:
  - `kpi_adjustment numeric NOT NULL DEFAULT 0` (clamped −50..+50 at write time)
  - `period_month date` (auto-set from `effective_date` via trigger so each promotion is linked to a payroll cycle)
- Update `promote_employee(_employee_id, _to_level, _to_position, _to_base_mmk, _effective_date, _note, _kpi_adjustment)`:
  - Require `_note` not null/empty (reason is mandatory).
  - Clamp `_kpi_adjustment` to [−50, 50].
  - Insert row with `period_month = date_trunc('month', _effective_date)`.
- Update `recompute_payroll`:
  - Compute `v_adjust := SUM(kpi_adjustment) from employee_promotions WHERE employee_id=_emp AND period_month=v_period_start`.
  - `effective_kpi := clamp(v_kpi + v_adjust, 0, 100)`; bonus tier and `kpi_snapshot` use `effective_kpi`.

### 2. Server functions (`src/lib/financial.functions.ts`)

- Extend `promoteEmployee` input with `kpiAdjustment: number` and required `reason: string` (alias of `note`, validated non-empty).
- Keep return type the same.

### 3. UI — Promotion & Compensation modal (`financial.tsx` → `PromoteDialog`)

Compact single modal opened from each row's **Promote** button:

```text
[Header] Promote {full_name}
[Read-only] Current: {LEVEL_LABEL} · {position} · {formatMMK(current_salary)}

Level     [ Trainee | Junior | Senior | Lead ]   (segmented control)
Salary    [ number input, prefilled with current_salary ]
KPI adj.  [ slider −50 … +50 ]  current value badge
Reason*   [ textarea, required ]

[Cancel]                                [ Save ] (disabled until reason.trim() && salary>0)
```

- Drop `position`, `effective date` inputs from the modal (use current position + today). Levels shown: Trainee, Junior, Senior, Lead only (legacy `mid` rows display "Junior" tier badge but aren't selectable).
- Save button disabled while `reason.trim().length === 0`.

### 4. Optimistic update

`useMutation({ mutationFn: promoteFn, onMutate })`:
- Snapshot `["employees-fin"]` and `["promotions"]` caches.
- Optimistically patch the employee row (`level`, `monthly_base_mmk`) and prepend a synthetic promotion record (with `kpi_adjustment`).
- `onError`: rollback. `onSettled`: invalidate `employees-fin`, `promotions`, `payroll_lines`, `payroll_runs`, `employee_kpis`.
- Modal closes immediately on click; table reflects new level/salary before the round-trip completes.

### 5. Payroll tab integration

- `Recompute payroll` button already calls `runPayroll`. After the migration its underlying `recompute_payroll` automatically applies the per-period KPI adjustment sum, so no UI logic change is needed beyond invalidating the relevant queries (already wired).
- KPI Bonus column in the payroll table will reflect the adjusted bonus on next render.

### Out of scope

- No new pages, no new tables, no peer-review or report touches.
- Effective date is always "today"; multi-cycle scheduling is not handled.
- Salary band warning stays as-is.

### Files touched

- `supabase/migrations/<new>.sql`
- `src/lib/financial.functions.ts` (extend `promoteEmployee` validator)
- `src/routes/_authenticated/financial.tsx` (`PromoteDialog` rewrite + `useMutation` optimistic wiring in `PromotionsTab`)
