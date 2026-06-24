
## Goal

Make the Recruitment Pipeline → Operations handoff fully automated and live-synced, while keeping every unrelated module untouched. The candidate row stays the single source of truth (employees already link via `employees.candidate_id`).

## 1. Database migration — expand stages + auto-onboard

Extend the `candidate_status` enum and migrate existing rows:

```text
old enum:  new | screening | interview | offer | onboarded | rejected
new enum:  sourcing | screening | hr_interview | technical_interview
         | assessment | final_interview | offer | approved | hired | rejected
```

Mapping for existing data:
- `new` → `sourcing`
- `interview` → `hr_interview`
- `onboarded` → `hired`
- others unchanged

Update `approve_candidate(...)` RPC: instead of hard-coding `status = 'onboarded'`, set it to `'hired'`. Behavior otherwise identical (still creates employee, triggers cascade KPI/payroll/attendance).

No new tables. No changes to `employees`, `attendance`, `payroll_*`, `employee_kpis`, `tasks`, `profiles`, `organizations`, RLS, or grants.

## 2. Pipeline UI — `src/routes/_authenticated/pipeline.tsx`

Only file edited on the frontend.

- Replace `STAGES` const and `Stage` type with the 10-value list.
- Replace `nextStage()` order: `sourcing → screening → hr_interview → technical_interview → assessment → final_interview → offer → approved → hired` (rejected is a terminal side-branch, reached only via explicit reject).
- `StageBadge`: extend tone map to color `approved` (primary), `hired` (success), interview stages (accent).
- **Auto-onboarding hook**: when the user clicks "→ approved" (the advance button), do NOT call the plain status mutation. Instead open the existing `ApproveDialog` pre-filled with that candidate; on confirm, `approveCandidate` server fn runs (sets status to `hired` via the updated RPC and creates the employee atomically). The current standalone "UserCheck" button is removed — advancing into Approved IS the approval.
- Advancing from `approved → hired` (rare; usually skipped since approve jumps straight to hired): show as no-op confirmation toast since employee already exists.
- All other transitions remain the simple `update({ status })` mutation with optimistic refetch.
- Reject action: keep current behavior (no change required; if there is no reject button today, leave it).

## 3. Realtime subscriptions

Enable Postgres changes broadcasting:

```sql
ALTER PUBLICATION supabase_realtime ADD TABLE public.candidates;
ALTER PUBLICATION supabase_realtime ADD TABLE public.employees;
```

In `pipeline.tsx`, add one `useEffect` that subscribes to `postgres_changes` on `public.candidates` and calls `qc.invalidateQueries({ queryKey: ["candidates"] })` on any event. Cleanup on unmount with `supabase.removeChannel`.

In the operations / directory page that already lists employees (`src/routes/_authenticated/operations.tsx` — read-only check, no other edits), add the same shape of subscription for `public.employees` so a newly-onboarded employee appears without refresh. This is the only touch outside the pipeline file, and it is additive (one `useEffect`), required to satisfy "Employee instantly appears in Employee Directory".

## 4. Out of scope (explicitly deferred per your answers)

- No `person` table — `employees.candidate_id` remains the link.
- No LinkedIn import.
- No extended resume fields (experience/education/certs/languages).
- No Recruiter / Evaluation / Recommendation columns.
- No changes to `parseCv`, `scoreManual`, Add Candidate dialog, attendance/payroll/KPI logic, RLS, or grants.

## Technical details

**Migration SQL outline** (single migration, runs in one transaction):

```sql
-- 1. Extend enum (Postgres requires ADD VALUE outside txn for some versions;
--    use ALTER TYPE ... ADD VALUE IF NOT EXISTS per value, then a second
--    migration step renames old values via a temp enum swap).
CREATE TYPE candidate_status_new AS ENUM
  ('sourcing','screening','hr_interview','technical_interview',
   'assessment','final_interview','offer','approved','hired','rejected');

ALTER TABLE public.candidates
  ALTER COLUMN status TYPE candidate_status_new
  USING (CASE status::text
    WHEN 'new' THEN 'sourcing'
    WHEN 'interview' THEN 'hr_interview'
    WHEN 'onboarded' THEN 'hired'
    ELSE status::text
  END)::candidate_status_new;

DROP TYPE candidate_status;
ALTER TYPE candidate_status_new RENAME TO candidate_status;

-- 2. Patch approve_candidate to mark candidate as 'hired'
CREATE OR REPLACE FUNCTION public.approve_candidate(...) ...
  -- identical body, but final UPDATE sets status = 'hired'

-- 3. Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.candidates;
ALTER PUBLICATION supabase_realtime ADD TABLE public.employees;
```

**Files changed:**
- `supabase/migrations/<new>.sql` (created)
- `src/routes/_authenticated/pipeline.tsx` (edited — stages, advance handler, realtime)
- `src/routes/_authenticated/operations.tsx` (edited — add employees realtime subscription only)

**Files unchanged:** `operations.functions.ts`, `pipeline.functions.ts`, all other routes, auth, RLS, types (regenerated automatically after migration).

## Acceptance

- Clicking "→ approved" on any candidate opens the salary/department dialog; confirming creates the employee in one server call, candidate row flips to `hired`, the employee directory updates without a refresh, KPI/payroll/attendance rows are created by existing triggers.
- All 10 stages render with badges; existing candidates are visible under their migrated stages.
- No regressions in attendance logging, payroll, team management, auth, or other routes.
