## Goal

Fold the Delivery (tasks) page into Operations under each Team, introduce a **Team Leader** role with their own report-upload interface, and recompute KPI using TL ratings + peer reviews (bias-resistant).

## 1. Roles & assignment model

- Extend `app_role` enum: add `team_leader`.
- HR/Admin only assigns members. Admin appoints a TL via **Assign Team Leader** dialog → sets `teams.team_lead_employee_id` AND grants the `team_leader` role to that employee's auth user via new RPC `appoint_team_leader(_team_id, _employee_id)` (admin-only). Revoking removes the role if they lead no other team.
- New RPCs `add_team_member` / `remove_team_member` (admin-only). TL cannot self-edit roster.

## 2. New tables

`**team_reports**` — one per (team, period_start)

- team_id, org_id, period_start, period_end, summary, file_url (storage `team-reports`), submitted_by, status (`draft|submitted`)

`**member_ratings**` — TL's per-member rating inside a report

- report_id, employee_id, productivity (0–100), quality (0–100), note. Unique (report_id, employee_id).

`**peer_reviews**` — anonymous peer review

- org_id, team_id, period_month, reviewer_employee_id, reviewee_employee_id, score (0–100), note. Unique (period_month, reviewer, reviewee). Reviewer hidden in admin views — admins read aggregates via SECURITY DEFINER `get_peer_avg(employee, period)`.

All tables get RLS scoped to org + role checks, plus GRANTs per project rules.

## 3. KPI formula update

also make HR can aslo see TL's Kpi cuz TL is  also an employee

`recompute_employee_kpi` rewritten weights:

- task completion 35% (objective)
- attendance 20% (objective)
- TL productivity rating 15%
- TL quality rating 10%
- peer review average 10%
- baseline productivity 10%

Bias guards:

- If peer count < 2 → fall back to objective 90% / TL 10%.
- If TL rating exceeds team objective avg by >1.5σ → clamp to objective+15.
- Triggers on `member_ratings` and `peer_reviews` insert/update recompute KPI for that period.

## 4. UI changes

**Delete** `src/routes/_authenticated/delivery.tsx` + sidebar entry; move task queries from `delivery.functions.ts` into `operations.functions.ts` with team_id filter.

`**operations.tsx**` — per-team tabs:

- Header: team name, TL avatar, member count, period KPI avg
- Tabs: **Members**, **Tasks** (the moved board, scoped to `tasks.team_id`), **Reports**, **Peer Reviews** (admin: aggregates; employee: submit form)
- Admin-only: Assign TL, Add/Remove member dialogs

**New `src/routes/_authenticated/team-leader.tsx**` — landing for `team_leader`:

- My Teams list
- Submit weekly/monthly report: period picker, summary textarea, file upload, per-member productivity/quality sliders + note, autosave draft, submit locks period
- Read-only team task board (update status only)

**Peer review prompt** in Operations > Peer Reviews tab for regular employees: list teammates, 0–100 slider, one submit per teammate per month.

**Sidebar**: role-aware — admin sees Operations, TL also sees Team Leader Hub, employees see Operations (read-only members + their peer-review CTA).

## 5. Server functions

- `appointTeamLeader`, `removeTeamLeader`, `addTeamMember`, `removeTeamMember` (admin)
- `submitTeamReport`, `saveTeamReportDraft`, `rateMember` (TL guard)
- `submitPeerReview`, `listMyPeerTargets`, `getTeamReports`, `getMemberRatings`

## 6. Storage

Private bucket `team-reports`. RLS on `storage.objects`: TL uploads to `team_<id>/...`; admin reads all; members read own team's submitted files.

## Out of scope

Meetings integration, mobile-only TL app, auto reminders, TL demotion automation.

## Open follow-ups (decide during build)

- Peer-review window: auto-open on 25th each month (default yes).
- Does TL also get a KPI? Default yes: team avg KPI × 0.7 + own task KPI × 0.3.