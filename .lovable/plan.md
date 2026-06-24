
# Mandai — AI HR Operations Layer

A real-time AI HR platform unifying recruitment (Pipeline), workforce (Operations), meeting-to-task (Delivery), and MMK payroll (Financial). Red + white SaaS UI, real backend via Lovable Cloud.

## Phase 0 — Design directions (first turn after approval)
Generate 3 rendered design directions covering BOTH the landing page and the dashboard view in each. Locked constraints across all three:
- Red (#E5283C-ish) + white, charcoal dark mode, light gray neutrals
- Linear/Stripe-inspired restraint, red reserved for primary action / active AI / live states
- Each direction varies composition, density, and emphasis (e.g. editorial bold vs. dense operator vs. minimal precision)

You pick one, then I build everything below against it.

## Phase 1 — Foundation
- Enable Lovable Cloud (Supabase: auth, DB, storage, AI Gateway)
- Tailwind v4 tokens in `src/styles.css`: red primary, neutrals, dark-mode variants, semantic tokens (`--background`, `--primary`, `--ai-active`, `--ring`)
- Theme toggle with CSS variable swap (no layout shift)
- Type pair + base components (shadcn buttons, cards, dialog, dropdown, kanban primitives)

## Phase 2 — Landing page (`/`)
Public route, SSR-friendly, own `head()` metadata.
- Hero: "AI Operations Layer for Enterprise HR" + red **Enter Workspace** CTA → `/auth` (or `/dashboard` if signed in)
- 4 feature blocks: Pipeline / Operations / Delivery / Financial
- Timeline section: HR inefficiency → AI automation → unified system
- Footer

## Phase 3 — Auth (`/auth`)
- Email/password + Google sign-in (via Lovable broker, `supabase--configure_social_auth`)
- Sign-in / sign-up modal card; sign-up fields: org, name, email, password
- DB:
  - `organizations` (id, name)
  - `profiles` (id ↔ auth.users, org_id, name, avatar, preferences) + trigger on signup
  - `user_roles` (separate table, `app_role` enum: admin | recruiter | hr | finance) + `has_role()` security-definer
- RLS on every table; explicit GRANTs per public-schema rules
- Profile settings page (avatar, role display, preferences, security)

## Phase 4 — Dashboard shell (`/_authenticated/*`)
Managed `_authenticated/route.tsx` gate (integration-owned).
- Sidebar: Pipeline, Operations, Delivery, Financial (collapsible)
- Top bar: role switcher (Recruiter/HR/Finance/Admin — filters views), theme toggle, profile dropdown
- KPI grid: employees, open tasks, monthly payroll (MMK), avg performance, attendance %
- Live AI activity indicator (red pulse when a job is running)

## Phase 5 — Mock enterprise data + modules
Seeded via migration (~10 employees across HR/Ops/Finance/Admin, MMK salaries, baseline KPIs).
- **Pipeline**: candidates list, AI match score, status flow (new → screening → interview → offer → onboarded)
- **Operations**: employee directory, workload, attendance, productivity charts
- **Delivery**: Kanban (To Do / In Progress / Review / Done), drag-and-drop with optimistic updates, task ↔ employee ↔ meeting linkage
- **Financial**: MMK payroll table, per-employee breakdown tied to completed Delivery tasks + performance score, recalculation log

All data via TanStack Query + `createServerFn` (RLS-scoped). No hardcoded UI data.

## Phase 6 — AI core loop (Delivery)
1. Upload meeting audio → Supabase Storage (private bucket, signed URL)
2. Server fn calls Lovable AI Gateway STT (`openai/gpt-4o-mini-transcribe`, streaming)
3. Second AI call (Gemini Flash) extracts action items → structured JSON (title, assignee guess, due, effort)
4. Auto-insert tasks into Kanban (To Do)
5. Drag → optimistic status update; on "Done", trigger payroll recalculation server fn
6. Payroll + KPI cards refresh via query invalidation (real-time feel)

Realtime channel on `tasks` + `payroll_runs` so other tabs/users update without reload.

## Phase 7 — Polish
- Loading skeletons everywhere, error boundaries on every route, `notFoundComponent`
- Toasts for async actions
- Empty states
- SEO metadata per route
- Security pass (RLS audit, role checks on privileged server fns)

## Technical notes
- TanStack Start + TanStack Query (`ensureQueryData` + `useSuspenseQuery`)
- All mutations through `createServerFn` with `requireSupabaseAuth`
- Service-role admin client only for payroll recalculation triggered by verified server-side events
- MMK formatting via `Intl.NumberFormat('my-MM', { style: 'currency', currency: 'MMK', maximumFractionDigits: 0 })`
- Realtime via supabase channels on browser client only

## Out of scope (flag now)
- Real candidate sourcing integrations
- Multi-tenant billing
- Mobile app

Approve to start Phase 0 (design directions).
