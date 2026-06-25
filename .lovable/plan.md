## Goal
1. Simplify the Pipeline (Candidates) UI — it's too dense right now.
2. Let candidates upload a CV through the Telegram bot under a chosen Position. The bot stores the file in Lovable Cloud Storage, extracts the text, scores it against the role with AI, and inserts the result into the existing Pipeline (Screening stage).

---

## Part 1 — Pipeline UI cleanup (`src/routes/_authenticated/pipeline.tsx`)

Keep all existing logic and server functions. Only trim the screen:

- Header: keep "Candidates" + 1-line subtitle. Remove the "Screening → Interview → Hired. Built for high-volume days." filler.
- Toolbar (one row, wraps on mobile):
  - Search input
  - Role filter
  - "Add candidate" primary button on the right
  - Move "Min match" slider into a small popover ("Filters") so it stops eating horizontal space.
- Tabs row: keep `Screening / Interview / On Hold / Trainee / Hired` with counts. Remove the rejected-tab clutter if shown.
- Candidate row: compress to 4 visual blocks
  - Left: avatar initials + name + email (1 line, truncated)
  - Middle: role + top 3 skills as small chips (others collapsed into `+N`)
  - AI match: single bar + number, no duplicate "10 Reject" text
  - Right: a single primary action ("→ Interview" or stage-appropriate verb) + a `⋯` overflow menu that holds Analyze (brain), Hold (pause), Delete. Stops the 4-icon strip the screenshot shows.
- Empty states: one short line + a CTA instead of the current verbose copy.

No data model or server-fn changes for this part.

---

## Part 2 — Telegram CV intake pipeline

### 2a. Storage bucket
Create a private bucket `candidate-cvs` via `supabase--storage_create_bucket`. Add RLS on `storage.objects` so only `service_role` and `authenticated` HR can read; the bot writes through the service role.

### 2b. DB additions (one migration)
- Add columns to `public.candidates`:
  - `cv_storage_path text` (path inside the bucket)
  - `source text default 'manual'` (`'manual' | 'telegram'`)
  - `telegram_chat_id bigint null`
- No new tables needed. Positions are taken from the existing `ROLE_PRESETS` list (shared constant promoted to `src/lib/roles.ts` so the webhook and UI use the same source of truth).

### 2c. Telegram bot flow (`src/routes/api/public/telegram/webhook.ts`)
Add a new branch that works **before** employee linking (a candidate is not an employee). New top-level command `/apply`:

1. `/apply` → bot replies with a `ReplyKeyboard` of positions from `ROLE_PRESETS` + "❌ Cancel".
2. User taps a role → session step becomes `apply_await_cv`, role stored in session.
3. User sends a document (PDF or DOCX). Webhook:
   - Calls Telegram `getFile` via the connector gateway, downloads the bytes through `/file/<path>`.
   - Uploads to `candidate-cvs/<chat_id>/<uuid>.<ext>` using the service-role Supabase client.
   - Inserts a `candidates` row: `status='screening'`, `role_applied=<picked>`, `source='telegram'`, `telegram_chat_id=<chat_id>`, `cv_storage_path=<path>`, `full_name='(pending)'`.
   - Fires the AI scoring job (next step) — awaited inline; row is then updated.
4. Bot replies: "✅ CV received for <role>. We'll review and contact you." On error: friendly message + clears session.

Non-PDF/DOCX files → reject with a short message. Files > 15 MB → reject.

### 2d. Text extraction + AI scoring (new `src/lib/cv-intake.server.ts` + thin wrapper in `cv-intake.functions.ts`)
Worker runtime can't run `pdf-parse` (Node-only). Use the existing approach that already works in `parseCv`: send the PDF directly to Gemini via the Lovable AI gateway as a `file` content block — Gemini does the extraction + scoring in one call, no `pdf-parse` dependency.

- New helper `scoreCvFromStorage({ candidate_id })`:
  1. Download the file from `candidate-cvs` via the service-role client.
  2. Base64-encode; build the same prompt as `parseCv` (full_name, email, skills, ai_match_score, summary, next_action).
  3. Call `google/gemini-3-flash-preview`. For DOCX (which Gemini rejects as a file), tell the user in the bot to send PDF — keep it simple, matches current `parseCv` contract.
  4. Update the `candidates` row with parsed fields.
- The Telegram webhook calls this helper directly (server-side, service-role) after upload. No extra round-trip.

### 2e. HR-side surfacing
- New candidates land in the existing Screening tab automatically (realtime subscription already in place).
- Add a small "Telegram" badge on rows where `source='telegram'`, and a "View CV" link that opens a signed URL (1-hour expiry) for the file in `candidate-cvs`. Generated via a new `getCvSignedUrl` server function gated by `requireSupabaseAuth`.

### 2f. Bot help
Update `/help` to mention `/apply` and the supported PDF format.

---

## Technical notes
- All Telegram + storage writes go through `process.env.SUPABASE_SERVICE_ROLE_KEY` inside the webhook route handler — already used in the file.
- File download from Telegram uses the connector gateway pattern from the telegram knowledge card (`getFile` → `/file/<path>`), reusing `LOVABLE_API_KEY` + `TELEGRAM_API_KEY`.
- The migration must include `GRANT`s on the new columns' table (already granted to `authenticated` + `service_role` on `candidates`; no new grants needed since we're only adding columns).
- No `pdf-parse` dependency added — Gemini handles PDF extraction natively, matching existing code and Worker-runtime constraints.
- RLS on `storage.objects` for `candidate-cvs`: HR (authenticated) `SELECT` only via signed URLs they generate; INSERT only by `service_role`.

## Out of scope
- Building a separate positions/jobs table with descriptions — using the existing `ROLE_PRESETS` keeps it lightweight as requested.
- Re-doing the candidate add modal (kept as-is).
