# KPI Simplification Plan

## Objective

Simplify performance evaluation by:

- Removing Peer Reviews entirely.
- Removing Productivity metrics entirely.
- Removing Quality metrics entirely.
- Excluding completed tasks from KPI calculations.
- Merging Task Completion and Team Leader Feedback into a single workflow.
- Making KPI dependent only on Task Completion, Attendance, and Team Leader Rating.

---

# 1. Backend — KPI Recompute & Triggers

Rewrite:

```sql
public.recompute_employee_kpi(_employee_id, _period)

```

### Task Completion

Count only active tasks.

Exclude:

```sql
status = 'completed'
status = 'done'

```

Formula:

```sql
active_total = COUNT(tasks WHERE status IN ('todo','in_progress'))

in_progress = COUNT(tasks WHERE status='in_progress')

task_completion = (in_progress / active_total) * 100

```

Return `0` when `active_total = 0`.

### Attendance

Unchanged.

```sql
attendance =
((present + late * 0.5) / logged_days) * 100

```

Default:

```sql
100

```

when no attendance records exist.

### Remove Completely

Remove all KPI dependencies on:

- Productivity
- Quality
- Peer Reviews

Delete:

```sql
get_peer_avg()

```

and all related logic.

---

## KPI Formula

### Objective Score

```sql
objective =
(task_completion * 0.60) +
(attendance * 0.40)

```

Weight = 100%

### Final KPI

When Team Leader rating exists:

```sql
kpi =
(objective * 0.75) +
(clamped_tl_rating * 0.25)

```

Keep existing TL clamp logic:

```sql
LEAST(tl_avg, objective_avg + 15)

```

When no TL rating exists:

```sql
kpi = objective

```

No normalization required.

---

## Trigger Cleanup

Remove:

```sql
trg_peer_recompute

```

Remove:

```sql
public.get_peer_avg

```

Remove:

```sql
public.peer_reviews

```

including:

- policies
- grants
- indexes
- trigger chains

Keep:

- attendance triggers
- task triggers
- rating triggers
- payroll sync

---

## Recompute Existing Data

After deployment:

```sql
recompute_employee_kpi(...)

```

for the current period so all KPI records reflect the new formula.

---

# 2. Frontend — Remove Peer Reviews

Delete all Peer Review functionality.

### Remove Components

```txt
PeerReviewTab
PeerRow
PeerAggregates
PeerPendingBadge

```

### Remove Functions

```txt
submitPeerReview
peer review query helpers

```

### Remove From

```txt
operations.tsx
team-leader.tsx
assistant-dock.tsx
ai-copilot.tsx
ai-tools.ts

```

### Leaderboard

Remove:

```txt
Peer Review column
Peer Review badges
Pending review indicators

```

---

# 3. Frontend — Remove Productivity & Quality

Remove Productivity and Quality from:

### KPI Cards

Delete:

```txt
Productivity
Quality

```

### Dashboard Widgets

Delete:

```txt
Productivity charts
Productivity summaries
Quality summaries
Quality trend cards

```

### Leaderboard

Remove:

```txt
Productivity column
Quality column

```

Leaderboard should only show:

```txt
KPI
Attendance
Task Completion

```

### Data Fetching

Remove:

```txt
productivity queries
quality queries
productivity state
quality state

```

### AI Features

Remove:

```txt
productivity insights
quality recommendations
productivity scoring prompts
quality scoring prompts

```

---

# 4. Unified Task & Feedback Workflow

Replace:

```txt
Task Completion
Team Leader Suggestion

```

with a single tab:

```txt
Task & Feedback

```

Flow:

```txt
Active Tasks
      ↓
Mark Complete
      ↓
TL Feedback
      ↓
Submit

```

### Team Member View

Shows:

- Active tasks
- Latest TL feedback

Read-only.

### Team Leader View

Can:

- Review active tasks
- Leave feedback
- Submit rating

in one workflow.

---

# 5. Out of Scope

No changes to:

- Payroll formulas
- Promotion logic
- Attendance deduction rules
- Authentication
- Team report schema
- Member rating schema

---

# Technical Notes

Migration order:

```txt
Drop Peer Review triggers
↓
Drop Peer Review functions
↓
Drop Peer Review table
↓
Recreate KPI function
↓
Recompute KPI records

```

Regenerate Supabase types after migration.

No new environment variables.

---

# Files Touched

```txt
supabase/migrations/<new>.sql

src/lib/teams.functions.ts

src/components/team-detail-sheet.tsx

src/routes/_authenticated/operations.tsx

src/routes/_authenticated/team-leader.tsx

src/components/assistant-dock.tsx

src/components/ai-copilot.tsx

src/lib/ai-tools.ts

Leaderboard components
Dashboard KPI widgets
Analytics components

```

## Final User Journey

```txt
Active Tasks
      ↓
Task Completion
      ↓
Team Leader Feedback
      ↓
KPI Calculation
      ↓
Leaderboard

```

The system becomes simpler, easier to understand, and focused only on measurable work outcomes and leader evaluation.