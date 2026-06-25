
## Goal

Turn the Financial → Promotions tab into a unified **Promotions & Demotions** workspace. Direction is inferred from the chosen level (higher = Promotion, lower = Demotion). KPI editing is fully removed. No backend, payroll, bonus, or KPI-calculation changes.

## Scope

Only `src/routes/_authenticated/financial.tsx` (PromotionsTab + PromoteDialog). The existing `promoteEmployee` server fn and `promote_employee` RPC already accept any target level, so no migration is needed.

## Changes

### 1. Tab rename & header
- Rename trigger label from "Promotions" to "Promotions & Demotions" (route value stays `promotions`).
- Section title updated inside `PromotionsTab`.

### 2. Dashboard simplification
Replace the 3-card KPI strip with two sections:

**A. Promotion / Demotion tracking**
- Promotions this quarter (count where `to_level` index > `from_level` index)
- Demotions this quarter (count where `to_level` index < `from_level` index)

**B. Financial Impact tracking**
- Net salary delta this month (sum of `to_base_mmk - from_base_mmk`)
- Promotion uplift this month (positive deltas only)
- Demotion savings this month (negative deltas only, shown as absolute)

Remove the **Avg tenure** card entirely.

### 3. Employee row actions
- Replace the single "Promote" button with an "Adjust Level" button (disabled only when there are no other levels available — i.e. never, since 4 levels exist).
- "History" entries label each row as **Promotion**, **Demotion**, or **Lateral** based on level index comparison.

### 4. Dialog: rename + direction-aware behavior
Rename `PromoteDialog` UI title to **Adjust Level — {name}**. Direction is computed from `LEVELS.indexOf(targetLevel) vs LEVELS.indexOf(currentLevel)`:
- `> 0` → Promotion
- `< 0` → Demotion
- `= 0` → disabled save (must pick different level)

Show a direction badge (Promotion / Demotion) in the dialog header.

### 5. Form fields (only these, in order)
1. **Target Level** — segmented control (existing 4 levels). On change, recompute auto-salary unless user manually edited.
2. **Target Position** — required text input.
3. **Target Salary (MMK)** — number input. Auto-populate:
   - Promotion → `bands[level].min`
   - Demotion → `bands[level].max`
   - Lateral (same level) → keep current base
   - Once the user edits the field, set `manuallyEdited.current = true` so further level changes do **not** overwrite it. Reset flag only when the dialog reopens for a new employee.
4. **Reason / Justification** — required textarea.

Removed entirely: any KPI slider, KPI adjustment field, KPI override, KPI preview, suggested-promotion banner (already gone), and "above max" warning for promotions / "below min" warning for demotions are repurposed as hard validation.

### 6. Validation (client-side, save disabled until all pass)
- `position.trim().length > 0`
- `reason.trim().length > 0`
- `level !== emp.level`
- Salary numeric and within band:
  - Promotion: `salary >= band.min && salary <= band.max`
  - Demotion: `salary <= band.max && salary >= band.min`
- Inline error text under the salary field naming which bound was violated.

Server validation already enforces non-empty reason; the salary-band guard stays client-side (no schema change requested).

### 7. Save behavior
Continue calling existing `promoteEmployee` server fn with the same payload shape. Toast message becomes "Promotion saved" or "Demotion saved" based on direction. No changes to optimistic update logic, invalidations, or payroll/bonus/KPI queries.

## Non-Goals
- No migration.
- No edits to `promote_employee` RPC, `recompute_payroll`, KPI Calculation tab, Bonus tab, Payroll tab, or `employee_promotions` rows already stored.
- No changes outside `financial.tsx`.

## Technical Notes
- `LEVELS` constant order in the file is `["trainee","junior","senior","lead"]` (assumed; will verify on first read during build). Direction comparison uses that index.
- `bands` is `Record<EmployeeLevel, { min, max }>` from `organizations.salary_bands`. If a band is missing for the chosen level, fall back to current salary and show a muted "No band configured" hint, with save still gated on a positive number.
- `manuallyEdited` ref is reset in the existing `useEffect(..., [emp, ...])` so reopening the dialog for a different employee re-enables auto-fill.
