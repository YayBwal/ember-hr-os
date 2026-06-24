## Goal
Make hired candidates always surface in Operations, and add a real-world Trainee step to the pipeline with a per-org default trainee salary (overridable per candidate).

## Stage flow
```
Screening → Interview → ┬─ Trainee → Hired
                        └─ Hired (direct)
                Reject (any stage) → deleted
```
- Trainee is a **pipeline-only** stage. No employee row is created yet.
- Hired creates the employee row (existing `approve_candidate` RPC) and they appear in Operations.

## Changes

### 1. Database (migration)
- Extend enum: `ALTER TYPE candidate_status ADD VALUE 'trainee'` (before `hired`).
- Add `candidates.trainee_salary_mmk bigint NULL` (override).
- Add `organizations.default_trainee_salary_mmk bigint NOT NULL DEFAULT 500000`.
- Keep existing reject-delete trigger and `approve_candidate` RPC unchanged.

### 2. Pipeline UI (`src/routes/_authenticated/pipeline.tsx`)
- Add **Trainee** tab + count alongside Screening / Interview / Hired.
- Row actions by stage:
  - Screening → "Advance to Interview"
  - Interview → split button: **Move to Trainee** (opens small dialog: trainee salary prefilled from org default, editable) **or** **Hire** (opens existing ApproveDialog).
  - Trainee → **Promote to Hired** (opens ApproveDialog; monthly base prefilled from trainee salary so HR can bump it).
  - Hired → read-only (link to employee in Operations).
- Bulk actions respect the current stage's next step.
- Reject button still available on any non-hired stage.

### 3. Organization settings
- Add a "Default trainee salary (MMK)" field on `src/routes/_authenticated/organization.tsx` (admin only), wired through a new `set_org_default_trainee_salary` RPC.

### 4. Operations visibility (verify, fix if needed)
- Operations already reads from `employees`, which `approve_candidate` populates. Confirm the query is scoped to `current_org_id()` so cross-org users don't see empty lists, and surface a "Newly hired" badge for employees with `join_date = today` so the user sees the flow worked end-to-end.

## Out of scope
- Trainee performance tracking, probation timers, automatic promotion.
- Separate trainee payroll line (trainees are not employees yet, so no payroll is generated for them — by design of "Trainee only in Pipeline").

## Files touched
- `supabase/migrations/<new>.sql` — enum value, two columns, RPC for default salary.
- `src/routes/_authenticated/pipeline.tsx` — Trainee tab, dialog, actions.
- `src/routes/_authenticated/organization.tsx` — default salary setting.
- `src/routes/_authenticated/operations.tsx` — minor: "Newly hired" badge + org-scope check.
- `src/integrations/supabase/types.ts` — regenerated post-migration.
