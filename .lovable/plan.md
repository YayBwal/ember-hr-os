# Financial: Payroll + Promotions

Restructure the Financial page into two tabs and connect promotions to Pipeline/Operations so a "Junior → Senior" change updates salary, keeps history, and flows into payroll automatically.

## Tab 1 — Payroll (existing)
Keep current payroll table, KPI bonus tiers, extra bonus/deduction dialogs, and Recompute button. No behavior change.

## Tab 2 — Promotions (new)
For every active employee, show:
- Current position + level (Junior / Mid / Senior / Lead)
- Current base salary
- Last promotion date
- **Promote** button → dialog: new level, new position, new base salary (prefilled from a level-default), effective date, optional note
- **Promotion history** expandable row: every past change with old → new salary, who approved, date

A small KPI strip at the top: avg tenure, # promoted this quarter, total salary delta from promotions this month.

### Cool extras (small, high‑value)
1. **Suggested promotions** — surface employees with 3-month rolling KPI ≥ 90 who haven't been promoted in 6+ months. One-click "Review" opens the promote dialog.
2. **Salary band guardrail** — each level has a min/max band (org setting). Dialog warns if new salary is outside the band; admin can override with a reason logged in history.
3. **Auto-recompute** — saving a promotion bumps `employees.monthly_base_mmk` and re-runs payroll for the effective month so the Payroll tab reflects it instantly.

## Pipeline ↔ Financial link
- When a candidate is hired (existing `approve_candidate` RPC), the first row in `employee_promotions` is auto-inserted as the "Hired at <level>" baseline. So every employee's salary history starts at hire.
- Operations row gets a tiny "Lvl: Senior" chip next to the name, sourced from the latest promotion.

## Technical details

### Schema (one migration)
- `public.employee_level` enum: `junior | mid | senior | lead`
- `employees.level employee_level NOT NULL DEFAULT 'junior'`
- `organizations.salary_bands jsonb` — `{ junior:{min,max}, mid:{...}, ... }` with sensible MMK defaults
- `public.employee_promotions`:
  - `id, employee_id, org_id, from_level, to_level, from_base_mmk, to_base_mmk, from_position, to_position, effective_date, note, created_by, created_at`
  - GRANT to authenticated + service_role; RLS scoped to `current_org_id()`
- RPC `promote_employee(_employee_id, _to_level, _to_position, _to_base_mmk, _effective_date, _note)` — SECURITY DEFINER, admin-only, inserts history row, updates `employees.level/position/monthly_base_mmk`, calls `recompute_payroll` for the effective month
- Extend `approve_candidate` to insert the baseline promotion row (from_* = NULL)

### Frontend
- `src/routes/_authenticated/financial.tsx` → wrap content in shadcn `Tabs` (Payroll | Promotions); move current body into `<PayrollTab />`, add `<PromotionsTab />`
- New components: `src/components/financial/payroll-tab.tsx`, `promotions-tab.tsx`, `promote-dialog.tsx`
- New server fn `promoteEmployee` in `src/lib/financial.functions.ts` calling the RPC
- `operations.tsx`: add level badge from `employees.level`

## Out of scope
- Demotions UI (the table supports it via history, but no dedicated button this round)
- Multi-currency, retroactive back-pay calculations beyond the effective month
- Department/team transfers (separate concern)

Want me to build this as specced, or adjust any part (e.g. different level names, skip salary bands, skip the suggestions panel)?
