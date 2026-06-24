## Goal

Make the Pipeline page survive a realistic recruiter day (50–100 CVs), fix the "no organisation found" error on Add Candidate, and collapse the hiring funnel from 10 stages to 4.

## 1. Simplify stages to 4 (DB + UI)

New `candidate_status` enum:

```text
screening  →  interview  →  hired
                           ↘ rejected (auto-deleted)
```

**Migration:**
- Add new enum values `screening`, `interview` if missing; map existing rows:
  - `sourcing`, `screening` → `screening`
  - `hr_interview`, `technical_interview`, `assessment`, `final_interview`, `offer`, `approved` → `interview`
  - `hired` → `hired`
  - `rejected` → delete row
- Drop old enum values (recreate enum: rename old, create new, alter column, drop old).
- Trigger: `AFTER UPDATE ON candidates WHEN status = 'rejected' → DELETE`. This makes "Reject" a one-click destructive action that wipes the candidate per your spec.

**UI stage flow:**
- `screening → interview`: one-click advance.
- `interview → hired`: opens the existing Approve dialog (department / position / salary / team) which already creates the `employees` row via `approve_candidate` RPC.
- Reject button visible at every stage (red, with confirm) → sets `status='rejected'`, trigger deletes.

## 2. Fix "No organisation found" on Add Candidate

Current code (`pipeline.tsx` line 307):

```ts
supabase.from("profiles").select("org_id").maybeSingle()
```

`.maybeSingle()` without `.eq("id", auth.uid())` returns null when RLS exposes 0 rows or >1 rows (e.g., admin who can see all profiles). Replace with the existing `current_org_id()` SECURITY DEFINER function:

```ts
const { data, error } = await supabase.rpc("current_org_id");
if (error || !data) throw new Error("No organisation found");
return data as string;
```

Same fix applied in both `handleFiles` and `submitManual`.

## 3. Redesign Pipeline UI for 100 CVs/day

Replace the single flat table with a workflow that scales:

**Top bar (sticky):**
- Bulk CV drop zone always visible (not hidden behind a dialog). Drop 20 PDFs → background queue with progress toasts.
- Search by name/email/skill (debounced, server-side `ilike`).
- Filters: role, stage, min AI score (slider), date range.
- Sort: AI score / newest / name.
- Counts per stage shown as pill tabs: `Screening 47 · Interview 12 · Hired 3`.

**Main view — tabbed list per stage (not kanban):**
Kanban with 100 cards/column is unusable; tabs + dense table scales better. Each tab shows only that stage's candidates, paginated 25/page, sorted by AI score desc by default.

Row layout (denser, action-first):
```text
[ ✓ ] Name · email          Role        ████░ 82%   Skills(3)   [Advance] [Reject] [⋯]
```

- Checkbox column for bulk actions: bulk advance, bulk reject, bulk assign role.
- Row click → side drawer with full notes/skills/CV summary; no full page nav.
- Reject = red ghost button with `confirm()` ("Delete candidate permanently?").

**Add candidate dialog:**
- Default tab = Upload (current manual is the exception).
- Allow multi-file drop with per-file progress + retry on failure.
- Role picker stays; add "apply to all" toggle for bulk uploads.

## 4. Out of scope (this turn)

- Email/calendar integration for interview scheduling.
- Candidate-facing portal.
- Resume re-scoring on role change.

## Technical summary

- **Migration**: rebuild `candidate_status` enum to 4 values, remap rows, add `delete_rejected_candidate()` trigger.
- **`pipeline.tsx`**: rewrite stage constants, replace single table with stage tabs + filter bar + bulk actions, switch `getOrgId` to `rpc('current_org_id')`, add Reject button, drop Approve dialog gate on `interview → hired` (it stays — needed for employee creation).
- **`operations.functions.ts`**: no change; `approve_candidate` already handles `interview → hired`.
- Keep realtime subscription as-is.

## Files touched

- `supabase/migrations/<new>.sql` — enum collapse + reject trigger
- `src/routes/_authenticated/pipeline.tsx` — full rewrite of list/filter UI, getOrgId fix, reject action
- `src/integrations/supabase/types.ts` — regenerated after migration
