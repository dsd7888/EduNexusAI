# STUDENT-FACING FEATURE AUDIT — MASTER LEDGER

The running punch-list across all audited features. Each feature session appends its
severity roll-up here as its last act. This is the input to a later FIX pass.
Append only. Trust the per-feature findings files for detail; this is the index.

Severity: S1 = blocker (pilot cannot ship) · S2 = major · S3 = minor.
Evidence tags: [RUNTIME] [EXPORT] [UI] [STATIC].

---

## Cross-cutting issues (seen in more than one feature — promote here)

- **Desktop sidebar not collapsible** — AU-CHAT. No toggle/rail state on `<aside>` in
  `src/app/(student)/layout.tsx`; only the mobile overlay has open/close. Check AU-SHELL against the
  same layout file (it's shared shell code, not chat-specific) — likely reproduces everywhere.
  **Confirmed by AU-SHELL** on all four of its pages (dashboard/subjects/profile/history) — and the
  fix already exists in the codebase: `NavLink.tsx` already has `icon`/`collapsed` props built for
  this, and `FacultyShell.tsx` is a complete working reference implementation never ported to the
  student shell.
- **Dark mode unreachable app-wide** — AU-CHAT. No `next-themes`/`ThemeProvider`/any `.dark`-class
  toggle exists anywhere in `src/app`/`src/components`; Tailwind's dark variant is class-based, not
  `prefers-color-scheme`-based, so there is no automatic fallback either. DESIGN.md's dark-mode spec
  (night bg, `ring-paper` focus states, CP-D0 layering rules) currently reaches zero sessions.
  **Confirmed by AU-SHELL** (byte-similar light/dark screenshots on all four pages). Verify
  against AU-SHELL and AU-FLASH (CP-D0 dark-surface work) — if true there too, this is a single
  platform-wide gap, not a per-feature one.
- **Touch targets under 44px** — AU-CHAT (every composer/header control: 26–36px measured). DESIGN.md
  states this platform-wide, "not just mobile Notes surfaces (extend the existing CP-N4 rule
  platform-wide)" — check AU-QUIZ/AU-PLACE-*/AU-SHELL controls too; likely a shared `Button`/pill
  sizing issue rather than N separate per-feature bugs.
- **Rate-limit check-then-increment race (`src/lib/utils/rate-limit.ts`)** — AU-CHAT. `checkRateLimit`
  reads today's usage then a later, separate write increments it — no atomicity. This helper is shared
  by every rate-limited feature (`chat`, `research`, `hint`, `quiz`, `examSim`, `notes_view`,
  `notes_export`), so the same race almost certainly reproduces in AU-QUIZ and AU-NOTES wherever they
  call `checkRateLimit` — worth a single shared fix rather than N patches. **Correction from
  AU-PLACE-TOOLS:** `placement` is not in `DAILY_LIMITS` at all and no placement route calls
  `checkRateLimit` — this predicted reproduction did not apply. Instead AU-PLACE-TOOLS found a
  *worse*, independent instance of the same check-then-act race shape in its own bespoke
  `interview/mock/follow-up` cap (100% bypass under an 8-way concurrent burst, vs. `checkRateLimit`'s
  ~2% overrun), plus confirmed 4 of its 5 AI-calling routes have no cap of any kind, not even a racy
  one. The underlying disease (check-then-act without atomicity) keeps recurring per-feature; a
  shared, atomic primitive is worth building once rather than re-finding N times.
- **Missing safety/distress-handling clause in AI prompts** — AU-CHAT (`buildTutorSystemPrompt`).
  Reproduced independently by AU-PLACE-TOOLS in `interview/evaluate` (no `systemPrompt` at all): a
  distress-adjacent answer ("I feel like giving up on everything lately") got scored as a bare
  professionalism failure with zero safety acknowledgment. Two independent confirmations now —
  likely reaches every placement/chat-adjacent AI prompt that doesn't explicitly add one. Worth a
  single shared clause/instruction rather than a per-route patch.
- **Shared test harness (`src/lib/testing/httpHarness.ts`) duplicates slow POST requests** — AU-CHAT
  (methodology note, not a product finding). Its wrapped `fetch` produced two real server-side
  executions per single call to a multi-second AI route in ~most cases observed; a raw `curl` to the
  same routes never duplicated. Any later `AU-*`/`_cp_*_verify` session driving a slow AI route through
  this harness should corroborate concurrency/duplication findings with raw `curl` before trusting them,
  until this is fixed. **Not re-confirmed as a confound by AU-PLACE-TOOLS** — that run's 8-way
  concurrent burst used `Promise.all` directly against `s.json()`, not a duplicated-call pattern, and
  the DB-row count (8) matched the HTTP-response count (8) exactly, so the finding there is clean of
  this artifact.

---

## Per-feature roll-up

### AU-CHAT — Student AI chat (+visualize/export/suggestions) — 2026-08-16 — findings file: .claude/findings/AU-CHAT.md
- S1: 0
- S2: 5 — (1) rate-limit check-then-increment race lets concurrent requests exceed the daily cap
  (`src/lib/utils/rate-limit.ts`), confirmed clean with raw concurrent curl (49/50 → 51/50 with 2
  parallel calls); (2) known bug #1 confirmed — chat composer sits ~149px above the true viewport
  bottom on desktop (dead space below it), from a hardcoded `h-[calc(100vh-7rem)]` that doesn't match
  the shell's real padding; (3) known bug #2 confirmed — desktop sidebar has zero collapse control;
  (4) every interactive control in the chat composer/header measures 26–36px, under DESIGN.md's
  44px floor, on both mobile and desktop; (5) tutor system prompt has no safety/distress-handling
  clause at all — a distress-adjacent message was handled gently this run on base-model instinct alone,
  with no product-level guardrail behind it.
- S3: 3 — chat PDF export renders markdown tables as raw garbled pipe-syntax instead of a real table
  (diagrams DO export correctly, tables don't); dark mode is unreachable app-wide (cross-cutting, see
  above); no server-side double-submit/idempotency guard on `/api/chat` (client-lock-only, lower
  severity than the rate-limit race but same root cause).
- AI spend this run: ₹30.01 (~$0.36), 46 real provider calls (inflated ~2× by the harness artifact
  noted above; the one severity-bearing concurrency finding was re-verified clean of that confound via
  raw curl).
- Most important single thing: the rate-limit race — every daily-cap feature sharing
  `checkRateLimit` (chat, research, hint, quiz, examSim, notes) is very likely exploitable the same way,
  and `examSim`/`research`/reasoning are the expensive tiers, so this is a real, currently-unbounded
  cost leak, not just a chat nuisance.

---

### AU-NOTES — Notes v2 generation + web math/diagrams + PDF export — 2026-08-16 — findings file: .claude/findings/AU-NOTES.md
- S1: 1 — **the feature has no reachable path to ever generate its own content.** The student reading
  page only ever calls `GET /api/notes/subject/:id`, which by design assembles from *already-fresh*
  module rows and never generates missing ones; the only code that actually generates
  (`generateModuleNotes`) is reachable solely via `GET /api/notes/module/:id` (called by no UI
  anywhere) and two faculty-only `*/regenerate` routes (also called by no UI anywhere — grepped
  student/faculty/superadmin trees, zero hits). Confirmed live: 7 of 9 real CSE-offered subjects had
  zero `study_notes` rows; loading one in a real browser session shows the empty-state's "Generate
  notes" button, and clicking it — confirmed via direct DB query immediately after — creates **zero**
  rows and loops back to the identical error. The 2 subjects that do have notes were seeded by a
  developer harness, not the product. Pilot cannot ship Notes v2 in this state.
- S2: 1 — concurrent requests for the same not-yet-generated module (double-click, two tabs) both
  fire real, separately-billed Gemini calls (confirmed in `ai_call_logs`, both `status=success`);
  the DB's unique index blocks the loser's insert, but that failure surfaces a raw Postgres
  constraint-name string straight to the client instead of plain-language copy, and the loser's paid
  generation is simply discarded rather than falling back to the winner's row.
- S3: 3 — (1) the shared PDF export engine (`src/lib/pdf/builder.ts`, backs every export route per
  CLAUDE.md, not notes-specific) renders in generic Tailwind-blue/Helvetica, not DESIGN.md's
  ink/ochre/Plex system — likely reproduces in every PDF the platform produces, worth one shared fix;
  (2) one real generation put a full descriptive phrase in a formula's `symbol` column instead of a
  short symbol — prompt-adherence drift the validator's length bound doesn't catch; (3) non-ASCII
  characters outside recognized math spans are silently dropped (not substituted/logged) by the PDF
  text sanitizer — plausible but not reproduced with real content this run, flagged lower-confidence.
- Cross-cutting confirmations (not re-counted above): dark mode unreachable and desktop sidebar has no
  collapse control both reproduce on this page too (shared `(student)/layout.tsx`). Notably, every
  notes-page-*specific* control DOES meet the 44px touch-target floor — this feature is not
  contributing a new instance of that bug, only inheriting the shared hamburger button's. The
  cross-cutting `checkRateLimit` race was **not** independently re-verified for `notes_view`/
  `notes_export` this run (only a sequential boundary test was run, not a concurrent one) — still open.
- AI spend this run: ₹1.3663 (~$0.016), 3 real `notes_gen_module` Gemini calls, all correctly logged
  `feature=notes` (never the v1 `chat` mislabelling CLAUDE.md warns about). Well under the ≤25-call cap.
- Most important single thing: the S1 — this is not a rough edge, the feature as shipped cannot
  produce its own content for any subject a real faculty/student hasn't had a developer manually seed
  via direct API/DB access first.

---

### AU-FLASH — Flashcards generation + dark-surface layering + reveal — 2026-08-16 — findings file: .claude/findings/AU-FLASH.md
- S1: 0 — no flashcard-specific generation exists to be broken (the page reuses the reading view's
  `GET /api/notes/subject/:id` verbatim, zero new API surface); the pre-existing AU-NOTES S1 (no
  reachable path to first-time-generate a subject's notes) applies here too by inheritance, not
  re-counted as a second S1.
- S2: 1 — two `go()` calls (Next/Previous button clicks, or ArrowRight keydowns) landing in the same
  React render batch collapse into a single card advance, silently dropping input. Reproduced 3 ways
  (2 clicks → 1 advance; 3 clicks → still only 1 advance; 2 synchronous ArrowRight keydowns from an
  already-revealed card → 1 advance). Root cause: `go()` reads `safeIndex` from the render closure
  instead of using React's functional `setState` updater form, so concurrent calls all compute the
  same stale target index. Realistic trigger is key-repeat or a fast double-tap under render jank, not
  a leisurely double-click — stated with that caveat in the findings file.
- S3: 0 counted (two noted but not scored): screen-reader announcement of card-position changes has no
  `aria-live` region (flagged STATIC/unverified, no assistive-tech tooling available this run); the
  already-logged AU-NOTES S3-2 (formula `symbol` field holding a full phrase) reproduces on this
  surface's back face too, same root cause, not re-counted.
- AI spend this run: ₹0.00, 0 real Gemini calls — this feature is a pure client-side re-render of
  already-generated notes content and makes no AI calls by design; confirmed via `ai_call_logs` (the
  only rows in the lookback window predate this session).
- Most important single thing: the S2 double-advance bug is a real, cleanly-reproduced defect in the
  core reveal/advance loop of the one surface DESIGN.md itself calls out as used "tired, in bed,
  one-handed" — silent, uncorrected input loss on the primary interaction of a cramming tool actively
  misleads a student about how much of the deck they've actually reviewed. Everything else audited
  (dark-surface layering under CP-D0, authorization, error/empty states, touch targets, focus rings,
  reduced-motion, cost) held up cleanly on direct verification.

---

### AU-QUIZ — Quiz/Assessment sessions, timer, mastery rules, NAT, export — 2026-08-16 — findings file: .claude/findings/AU-QUIZ.md
- S1: 1 — **quiz has no working export path anywhere.** No UI call site exists for the only route
  that builds a quiz PDF (`api/quiz/export`, grepped zero hits across `src/app`/`src/components`),
  and even called directly it can never succeed for any real session: it queries the v1
  `quiz_attempts`/`quizzes` tables, which are 100% empty platform-wide (confirmed live) because the
  current engine writes exclusively to `quiz_sessions`/`student_question_attempts`. Same shape of
  bug as AU-NOTES's S1 — a spec-promised feature with zero reachable path, not a rough edge.
- S2: 5 — (1) same v1/v2 schema split as the S1 above: student AND faculty dashboards, plus
  `/api/analytics`, read quiz history from the dead `quiz_attempts`/`quizzes` tables, so a real
  quiz taken today will never appear on the taker's own dashboard (confirmed: 0 rows in
  `quiz_attempts` platform-wide vs. real completed `quiz_sessions` from this run) — primarily an
  AU-SHELL-surface symptom, flagged here because the cause is entirely on the AU-QUIZ side;
  (2) **`/api/assessment/submit` does not enforce the session timer** — `/answer` correctly 409s
  after expiry (verified with a real 1-minute exam-sim session left to actually expire), but a
  direct `/submit` call with a full late payload was accepted and graded (200, scored 8/20) with
  zero rejection — defeats exam-sim's entire timed-benchmark premise, no special tooling needed to
  exploit; (3) `/api/assessment/submit` is not safe under concurrent double-submission — two
  simultaneous real calls both returned 200 and duplicated `student_question_attempts` (10 rows
  for a 5-question session) via the same check-then-act shape as the ledgered rate-limit race, now
  confirmed on session completion too; (4) the `true_false` question type renders with **zero**
  answer controls — confirmed via live screenshot (`optionButtons=0` in all four
  desktop/mobile × light/dark combinations) — because `typeHasOptions()` excludes it but
  `AnswerInput.tsx` has no other render path for it; currently reachable only via an explicit
  `questionTypes` request (not any mode's default), so latent rather than hit by default traffic
  today; (5) the assessment engine has **no subject-enrollment/scope check at all** — a CSE-sem3
  student successfully generated and could grade a real quiz for a subject offered to a different
  branch/semester; `src/lib/notes/access.ts` shows this exact check was deliberately added for
  Notes and explicitly flagged chat's lack of it as a known gap — the (newer) assessment engine has
  the same gap, undocumented.
- S3: 1 — a SQL-injection-shaped `subjectIds` string causes an unhandled upstream failure that
  dumps a raw HTML error page into server logs (client response stays a safe generic 500 — no data
  exposure, just log noise from missing UUID-shape validation on the input).
- Notable positives (ran clean, verified live, not just read): cross-student authorization (403) on
  every quiz route tested; the CP-Q3 resume-lands-on-the-right-question fix genuinely works; NAT
  dual-gate grading correct on both right and wrong numeric input; exam-sim correctly never mutates
  mastery; mode-gated feedback withholding correct; boundary clamping on `questionCount` correct;
  every real AI call this run was correctly cost-logged via `routeAI`.
- AI spend this run: $0.0445 (~₹3.7), 17 real Gemini calls (`assessment_quick`/`quiz_gen_v2` +
  `nat_verify`), all correctly tagged in `ai_call_logs`. Well under the ≤25-call cap.
- Most important single thing: the exam-sim timer bypass at `/submit` (S2-2) — it is a clean,
  reproducible, no-special-tooling integrity hole in the one mode explicitly designed as a
  time-bounded benchmark instrument (GATE mock), and it sits right next to a sibling route
  (`/answer`) that already does this correctly, so the fix is small and the omission is exactly the
  kind of thing that erodes trust the first time a student who timed themselves notices the mock
  let them keep going.

---

### AU-PLACE-CORE — Placement spine + prep + practice (fill_code, Next-Move) — 2026-08-16 — findings file: .claude/findings/AU-PLACE-CORE.md
- S1: 3 — (1) `POST /api/placement/prep/submit` performs zero server-side re-grading: it trusts
  the client's own `is_correct` boolean verbatim and writes it straight into
  `placement_topic_mastery` and the platform's canonical `readiness_domain`/`readiness_overall`
  scores — confirmed live by answering all 8 questions of a real session **wrong** while forging
  `is_correct: true`; `recent_accuracy` landed at 100% and `readiness_domain` rose from 0 to 100.
  These scores drive company-fit ranking, Next-Move recommendations, and (per CLAUDE_CONTEXT §16)
  the faculty TPO batch-readiness dashboard — no special tooling needed beyond editing one request;
  (2) compounding (1): `POST /api/placement/prep/generate` ships the plaintext `correct_answer`
  (and `explanation`) for every question — MCQ and fill_code alike — in the same payload that
  renders the un-answered question, confirmed live (8/8 questions leaked their answer key before
  being answered); (3) a whole parallel legacy company-mock-test + practice-module subsystem
  (`/placement/test/[companyId]`, `/placement/practice/[moduleId]`, and their six backing API
  routes) has zero reachable UI entry point anywhere (exhaustive grep of every `Link`/href in
  `src/app` — the company detail page's only CTA routes into the *new* prep flow, not this one) —
  same shape as AU-NOTES's/AU-QUIZ's ledgered S1s — AND is additionally broken where still directly
  reachable: `api/placement/submit` 500s unconditionally because its target table
  `placement_attempts` does not exist in the live schema (`PGRST205`), confirmed live; the table is
  referenced by a tracked migration that ALTERs it but never CREATEs it, i.e. untracked legacy-DB
  state left behind by the placement agentic rebuild.
- S2: 5 — (1) `api/placement/practice/submit` (and its unreachable twin `api/placement/submit`)
  score entirely client-fabricated `questions[]`/`answers` against each other — confirmed live by
  POSTing 2 made-up questions with a self-chosen answer key, with no prior `generate` call, and
  getting a real 100%-scored `practice_attempts` row back; same "client grades itself" bug as S1-1,
  scoped lower only because these specific routes are currently unlinked from navigation;
  (2) concurrent double-submit of one practice session is accepted twice by `prep/submit` but
  produces a **lost update**, not a duplicate, on `placement_topic_mastery` — confirmed live,
  `sessions_count` advanced by only 1 despite two accepted 200s (the underlying
  `placement_question_attempts` audit trail DID get both inserts, so the aggregate now
  under-represents the log) — same check-then-act race shape as the already-ledgered
  `checkRateLimit` race, found in a second independent location; (3) a SQL-injection-shaped `topic`
  string on `prep/submit` (still under the 100-char cap) produces an unhandled 500 whose log entry
  contains a raw, unbounded upstream HTML error body — same bug class as the ledgered AU-QUIZ
  `subjectIds` finding; (4) `POST /api/placement/profile` accepts `setup_complete: true`
  independent of `cgpa`/`primary_target` ever being set, and every downstream consumer
  (`isDriveEligible`) silently coalesces the missing CGPA to `0`, filtering the student out of
  every CGPA-gated drive with no signal that their profile — not their qualification — is the
  cause; (5) `computeNextMoves` returns an **empty** move queue for a fully-prepared student
  (all 5 dimensions ≥95) with an imminent eligible drive — confirmed via direct exercise of the
  pure function across 11 edge-case states — because the maintenance/mock-interview fallback is
  gated on "no eligible drive" and the drive-sprint rule has no positive "you're ready" branch,
  leaving the dashboard's one always-tell-the-student-what's-next surface with nothing to show in
  exactly the moment it matters most.
- S3: 2 — the fill_code+MCQ "mixed" prep session always presents all 4 MCQs before any fill_code
  question (block-concatenated, never interleaved), confirmed live; the dashboard's stage strip is
  horizontally scrollable but has zero scroll affordance, so later stages (Drive Sprint, Interview,
  Post-Outcome) are silently clipped off-screen on mobile with nothing indicating more exists.
- Notable positives (verified live, not just read): `prep/mastery` and `profile` GET both correctly
  scope to the session's own user — no cross-student IDOR; all `prep/submit` boundary/malformed
  cases (>20 attempts, invalid track, empty/huge topic) correctly 400; an injection-flavored topic
  string produced a clean on-topic question with no system-prompt leak; `computeNextMoves` boundary
  logic is internally consistent at the exact 70/60 thresholds from both directions, with no
  off-by-one; fill_code UI (dark code block, highlighted blank, monospace options) renders correctly
  on desktop and mobile with no layout breakage; every real AI call this run was correctly
  cost-logged via `routeAI` with `feature="placement"`.
- AI spend this run: ₹1.1848 (~$0.014), 3 real `placement_prep` Gemini calls. Well under the ≤25
  soft cap.
- Most important single thing: S1-1/S1-2 together — the platform ships every question's answer key
  to the client and then trusts the client's own claim about whether it got the answer right, for
  the exact readiness/mastery scores that drive company-fit ranking, Next-Move recommendations, and
  (per CLAUDE_CONTEXT) the faculty-facing TPO dashboard. This is not a theoretical exploit; it
  requires nothing beyond a browser's own devtools "Edit and Resend," and it silently defeats the
  entire adaptive-difficulty and readiness-scoring system the placement module is built around.

---

### AU-PLACE-TOOLS — Resume/JD/interview/skill-map/projects + resume exports + follow-up cap — 2026-08-17 — findings file: .claude/findings/AU-PLACE-TOOLS.md
- S1: 2 — (1) resume autosave silently discards ALL data with a false "Saved" UI confirmation
  for any student who reaches the Resume tab before completing placement setup — `POST
  /api/placement/resume` uses `.update()` (not `.upsert()`) against `student_placement_profiles`,
  which is a silent no-op (200, no error) when the row doesn't exist yet; confirmed live (POST a
  full resume → 200/completeness:90 → immediate GET → `full_name: ""`). Fully reachable via
  ordinary navigation: the placement layout's tab bar renders "Resume" as clickable on every
  placement page including the pre-setup empty state, and unlike Skill Map/Mock Interview, the
  Resume page never redirects to `/setup` when the profile is missing. The working `.upsert()`
  pattern already exists one file over in `api/placement/profile`. Downstream: ATS, PDF/DOCX
  export, and interview follow-up context all silently read the empty result with zero error
  surfaced anywhere; (2) `POST /api/placement/resume` has zero schema validation — a malformed
  payload (e.g. missing `education`/`technical_skills`/`projects`) 500s via an uncaught exception
  in `computeCompleteness` instead of returning 400, confirmed live — same root cause as (1) and
  the enabler of the S2 export crash below once (1)'s fix lands.
- S2: 4 — (1) resume PDF and DOCX export both crash (500) on a resume missing `technical_skills`
  — no null-guard, unlike `resume/ats` which explicitly does `?? {...}`, confirmed live on both
  export routes; (2) `interview/mock/follow-up`'s per-student cost cap (5 calls/3h) gives ZERO
  protection under concurrent load — an 8-way concurrent burst from a fresh student let all 8
  through (0 rejected), confirmed both via HTTP responses and a direct `ai_call_logs` query
  showing 8 real, separately-billed Gemini calls landed against a cap of 5 — same check-then-act
  race shape as the ledgered `checkRateLimit` race, but a 100% bypass on first burst rather than a
  marginal overrun, and this is the exact abuse case the audit brief asked to verify; (3) the
  other 4 AI-calling routes in this feature (`resume/ats`, `resume/rewrite-bullet`, `jd-analyze`,
  `interview/evaluate`) have NO rate limit or cost ceiling at all — `placement` is not a key in
  `src/lib/utils/rate-limit.ts`'s `DAILY_LIMITS` map (unlike chat/quiz/research/hint/notes, all of
  which have explicit daily caps) and none of the 4 routes call `checkRateLimit`; confirmed live
  by firing 3 rapid sequential real `interview/evaluate` calls, all 200, zero throttling;
  (4) a distress-adjacent interview answer ("I feel like giving up on everything lately") got zero
  safety acknowledgment from `interview/evaluate` — scored purely as "an immediate disqualifier"
  for unprofessionalism with a career-coaching tip; `interview/evaluate` passes no `systemPrompt`
  at all, reproducing AU-CHAT's already-ledgered missing-distress-clause gap in a second,
  independently-tested feature.
- S3: 3 — resume save accepts unbounded array sizes (200 oversized projects saved successfully in
  5.5s, far past the client's own `MAX_PROJECTS=4` cap) with no server-side size validation
  (AI-cost exposure is mitigated by downstream truncation, so this is a storage/latency concern,
  not a cost leak); Resume, JD Analyzer, Interview Prep Bank, and Mini-Project Guides are visually
  un-migrated from DESIGN.md (generic `bg-blue-600`/`rounded-2xl`/plain-sans Tailwind) while Skill
  Map and Mock Interview (built in the same rebuild) fully conform (Plex Serif, MonoTag,
  ink/ochre) — measured as a real consequence, not just cosmetic: every primary button on the
  un-migrated pages is 34-36px tall (under DESIGN.md's 44px floor) while the conforming pages'
  equivalent buttons measure exactly 44px, because they build on the shared `h-11` pattern and the
  un-migrated ones use ad hoc classes instead — a second, independent touch-target regression
  beyond the already-ledgered shared-sidebar one; `src/types/placement.ts` declares
  `ResumeProject`/`ResumeCertification`/`ResumeData` twice each, TS-merging into an unsound wider
  type the codebase already defensively casts around in two places (self-flagged as "CP-E1" in a
  code comment, never fixed).
- Notable positives (verified live, not just read): prompt injection across all three text-input
  AI surfaces (ATS's JD field, rewrite-bullet's bullet text, jd-analyze's JD field) did not leak a
  system prompt or produce fabricated scores; an off-syllabus/absurd JD ("Necromancer" role,
  embedded vulgar-content request) was correctly scored as poor fit with no exam-answer leak and
  no vulgar content generated; the empty-resume ATS guard correctly short-circuits with zero
  wasted AI spend; authorization is structurally sound everywhere in scope (every route derives
  the acting student from session, no id parameter exists to tamper with); all boundary/malformed
  string-length checks tested returned clean 400s; every one of 21 real AI calls this run was
  correctly logged `feature=placement`; PDF/DOCX exports for a well-formed resume produce correct,
  inspected byte content with no garbling.
- AI spend this run: $0.0092, 21 real `placement_prep` Gemini calls, all correctly tagged
  `feature=placement`. Well under the ≤25-call cap.
- Most important single thing: the S1 resume-save silent-discard bug. No adversarial input or
  special tooling required — just clicking "Resume" before finishing setup, which the product's
  own navigation actively permits — and the UI actively tells the student their work was "Saved"
  while quietly discarding it, with every downstream feature (ATS, exports, interview follow-up)
  then silently operating on the void that leaves behind.

---

### AU-EXPORTS — Cross-engine export pass: 5 math/render engines + PPT diagrams/SVG — 2026-08-17 — findings file: .claude/findings/AU-EXPORTS.md
- S1: 2 — (1) PPT "svg" diagram slides (the DEFAULT render type when a diagram slide has no
  explicit renderHint, `src/lib/ppt/generator.ts:471-475`) embed a broken compatibility fallback:
  `svgToBase64()` hands pptxgenjs a raw SVG data URI, and pptxgenjs's own SVG handling writes the
  SAME SVG bytes into the media part it labels `image/png` for the primary/fallback blip instead
  of a real rasterisation — confirmed live by unzipping a real generated `.pptx` and finding
  `image-4-1.png` is detected as `SVG Scalable Vector Graphics image` by `file`/PIL, not PNG. Any
  viewer without Microsoft's 2016+ SVG-extension support (older PowerPoint, Keynote, Google Slides,
  LibreOffice Impress, many classroom/lab machines — plausible population for an institutional
  pilot) renders a blank/broken image with zero on-slide indication anything failed; (2) Notes PDF
  export (`sanitizeForPDF` in `src/lib/pdf/builder.ts`, backs every text draw in the shared
  `PDFBuilder`) silently DELETES any Unicode character outside a ~40-symbol curated allowlist — no
  placeholder, no log, no visual trace — confirmed live with a real stress string containing
  Devanagari, an emoji, and four math/logic symbols: all vanished, leaving only double-spaces and
  one silently-mangled word (`café`→`caf`). This upgrades/confirms the AU-NOTES-run S3 finding
  ("Non-ASCII characters... silently dropped... plausible, not reproduced with real content") to a
  confirmed [EXPORT] finding — and elevates it because the sibling Q Paper PDF engine, tested in
  the same run on the identical input, at least substitutes a visible `?` (still degraded, but
  detectable) rather than deleting with no trace.
- S2: 2 — (1) Notes PDF's worked-example text (`drawWorkedExample` in
  `src/lib/notes/pdf/formulaRenderer.ts`) does not parse markdown — a markdown table embedded in a
  worked-example problem renders as raw, unreadable pipe-syntax, while the identical table renders
  as a real bordered table THREE LINES ABOVE IT in the same PDF (the block's own symbols table) and
  again in the qpaper PDF/DOCX on the same content — a second, independent confirmation of the
  AU-CHAT-ledgered "PDF export garbles markdown tables" defect (S3-7 above), but in a different
  engine (Notes PDF, not chat PDF export) and narrower in scope than that finding implied (qpaper's
  own table rendering is fine — the gap is specifically Notes' `textOrMath` call not being
  table-aware, not a platform-wide markdown-parser bug); (2) Q Paper PDF: a question's marks/CO/
  BTL/PO tag-row header can print with empty values at the bottom of one page while the actual
  sub-part content — and the tag VALUES that belong to that empty header — print at the top of the
  next page, disconnected with no repeated column context; confirmed live via two-page screenshot
  comparison, no page-break/keep-together guard exists between a question header and its first
  sub-part in `src/lib/qpaper/builder.ts`.
- S3: 0 counted this run (none met the bar independently of the S1/S2 findings above).
- Notable positives (verified live, not just read): the single shared `katexRender.ts`
  (MathJax→sharp) rasteriser produces excellent, visually consistent math across all four artifact
  types (Notes PDF, Q Paper PDF, Q Paper DOCX, PPT) — every drift found is in each builder's
  surrounding text handling, never in the math renderer itself; malformed LaTeX (unclosed braces,
  undefined commands, empty spans, a ~9KB single math blob) never crashed either PDF engine —
  clean literal-source fallback every time; the live Mermaid diagram path (real `mermaid.ink`
  network call, not mocked) produced a correct embedded PNG; raster-image sizing is
  pixel-consistent between Q Paper PDF and DOCX; all four export routes tested are reachable from
  real UI call sites (this feature does NOT reproduce the "generated but nothing calls it" pattern
  ledgered against AU-NOTES/AU-QUIZ/AU-PLACE-CORE); the answer-key DOCX correctly isolates
  confidential content in the document header part with model answers in green.
- AI spend this run: $0.00, 0 real Gemini calls — all five engines are deterministic by design
  (no `routeAI`/Gemini call anywhere in the render path); confirmed by reading every engine file,
  not just by absence of `ai_call_logs` rows. Comfortably under the ≤25-call cap; no DB/Storage
  cleanup needed since no admin client was used anywhere in the harness.
- Most important single thing: the PPT SVG-fallback bug (S1-1) — SVG is the *default* diagram
  render type for any under-specified diagram slide, so this is not an edge case; it silently
  breaks the platform's own signature "AI-generated technical diagram" feature the moment a deck is
  opened on any machine without the newest Office SVG extension, with nothing on the slide to
  signal the failure to whoever is presenting.

---

### AU-SHELL — Dashboard/subjects/profile/history + global nav + auth edges + mobile — 2026-08-17 — findings file: .claude/findings/AU-SHELL.md
- S1: 2 — (1) **any authenticated student can self-promote to `superadmin`** via an ordinary,
  sanctioned `createBrowserClient()` call (`profiles` RLS's "own profile" UPDATE policy restricts
  which row, not which columns) — confirmed live: a real `.update({role:'superadmin'})` from the
  student's own RLS-scoped client succeeded with no error, and the SAME session then read 5 other
  real users' profiles (including real seeded emails) and successfully WROTE another student's
  role/branch, all with the one already-issued JWT and zero new login. Because `proxy.ts`/
  `requireRole()` trust the same `profiles.role` column, this also unlocks real `/superadmin/*`
  server-side access on the next page load — a full authorization-model bypass, not just a DB
  quirk; (2) the dashboard's "Placement Readiness"/"Best Placement Score" cards
  (`usePlacementHistory`, `src/hooks/useSupabaseData.ts:263-285`) query `placement_attempts`, which
  does not exist in the live schema (same root cause as the already-ledgered AU-PLACE-CORE S1 #15)
  — confirmed live (`PGRST205`) — and the hook never checks `.error`, so every student's dashboard
  permanently and silently shows "Not started" regardless of real placement activity, with no trace
  in the browser console or anywhere a developer would look.
- S2: 3 — (1) desktop sidebar collapse control confirmed missing on all 4 AU-SHELL pages (cross-cutting,
  not re-counted below — see cross-cutting section); (2) DESIGN.md's color/typography system (ink/
  paper/ochre tokens, IBM Plex fonts) is entirely absent from the shared student shell chrome
  (`(student)/layout.tsx`) and all four core pages, even though Notes/Flashcards/Placement DO opt
  into `font-plex-*` elsewhere — the one piece of UI present on every screen a student ever sees is
  unstyled per the design system; (3) mobile nav touch targets measured and confirmed under the
  44px floor with new numbers (hamburger 36×36px, drawer nav links 36px tall) — cross-cutting,
  new measurements.
- S3: 1 — no `prefers-reduced-motion` handling anywhere in `globals.css` (global gap, not
  AU-SHELL-specific, but not previously logged by name).
- Notable positives (verified live, not just read): `chat_sessions`/`chat_messages` RLS correctly
  blocks cross-student reads (canary-string test, unfiltered-select test) — making the `profiles`
  finding an isolated gap, not a systemic RLS failure; `/api/chat/export` re-verifies session
  ownership server-side; the History page's session-switch staleness guard holds even under
  adversarial network ordering (verified with a real 2.5s artificial delay via Playwright request
  interception); empty/error-state copy meets DESIGN.md's plain-language bar everywhere checked.
- AI spend this run: $0.00, 0 real Gemini calls (this feature's surfaces have no AI-calling path;
  confirmed via `ai_call_logs`).
- Most important single thing: the `profiles.role` self-escalation (S1-1) — every other finding
  across the whole AU-* series assumes the role/authorization model itself is trustworthy even
  where individual features have gaps. This shows the column every layer of the app (RLS, `proxy.ts`,
  `requireRole()`) trusts to decide student-vs-superadmin can be rewritten by any student today from
  their own browser console, with the app's own public anon key and their own ordinary session — no
  exploit chain beyond one `.update()` call. Fix before shipping anything else in this punch-list.

---

## Master punch-list (ranked, filled as features complete)

_(S1 first, then S2, then S3 — this is what the FIX pass consumes)_

**S1**
1. Notes v2 has no product-reachable path to first-time-generate a subject's module notes — the
   student page only assembles existing fresh rows, and the routes that actually generate
   (`GET /api/notes/module/:id`, both `*/regenerate` routes) are called by zero UI anywhere
   (student, faculty, or superadmin). The empty-state's "Generate notes" button re-fetches the same
   doomed assembly call and loops forever. [AU-NOTES]
2. Quiz export has no working path anywhere: zero UI call site for `api/quiz/export`, and even
   called directly it can never succeed because it queries the dead v1 `quiz_attempts`/`quizzes`
   tables (0 rows platform-wide) while the current engine writes only to
   `quiz_sessions`/`student_question_attempts`. [AU-QUIZ]

**S2**
1. Rate-limit check-then-increment race in `src/lib/utils/rate-limit.ts` — likely affects every
   rate-limited feature, not just chat. [AU-CHAT; still unverified for notes_view/notes_export — see AU-NOTES]
2. Chat composer floats ~149px above the viewport bottom on desktop (bad height calc in
   `student/chat/[subjectId]/page.tsx` vs. the shell's real padding). [AU-CHAT]
3. Desktop sidebar has no collapse control (`(student)/layout.tsx`). [AU-CHAT, AU-NOTES; check AU-SHELL]
4. Composer/header touch targets measure 26–36px, under DESIGN.md's 44px floor. [AU-CHAT; check
   other features for the same shared-component root cause — AU-NOTES's own controls are clean, only
   inherits the shared 36px hamburger button]
5. Tutor system prompt (`buildTutorSystemPrompt`) has no safety/distress-handling clause. [AU-CHAT]
6. Concurrent generation requests for the same module double real AI spend and leak a raw Postgres
   constraint-name error to the client instead of failing gracefully or reusing the winner's row.
   [AU-NOTES]
7. Flashcard deck's `go()` navigation reads the render-closure `safeIndex` instead of using a functional
   `setState` updater, so two Next/Previous/ArrowRight inputs landing in the same React batch (key-repeat,
   a fast double-tap, or a rapid double-swipe) collapse into a single card advance with no error or visual
   indication — silently misleads a student about how much of the deck they've reviewed.
   [AU-FLASH]
8. Student and faculty dashboards + `/api/analytics` read quiz history from the dead v1
   `quiz_attempts`/`quizzes` tables — same root cause as S1-2 above — so a real quiz taken today
   never appears on the taker's own dashboard. [AU-QUIZ; cross-ref AU-SHELL for the dashboard
   surface itself]
9. `/api/assessment/submit` does not enforce the session timer (unlike its sibling `/answer`,
   which does) — a student can submit an exam-sim paper an unbounded time after it visibly
   expired, defeating the timed-benchmark premise. [AU-QUIZ]
10. `/api/assessment/submit` is not safe under concurrent double-submission — two simultaneous
    calls both succeed and duplicate `student_question_attempts` rows (same check-then-act shape
    as the rate-limit race above, applied to session completion). [AU-QUIZ]
11. The `true_false` assessment question type renders with zero answer controls (confirmed via
    screenshot) — `typeHasOptions()` excludes it but `AnswerInput.tsx` has no other render path;
    latent today (not in any mode's default types) but live the moment it's requested. [AU-QUIZ]
12. The assessment engine has no subject-enrollment/scope check — any student can generate and
    grade a real quiz for a subject outside their branch/semester offering; Notes already closed
    this exact gap (`src/lib/notes/access.ts`) and flagged chat as having the same one — the
    (newer) assessment engine has it too. [AU-QUIZ]
13. `POST /api/placement/prep/submit` trusts the client's own `is_correct` claim with zero
    server-side re-grading, and writes it straight into `placement_topic_mastery` and the
    platform's canonical `readiness_domain`/`readiness_overall` — confirmed live by forging 100%
    correctness on a real session where every answer was actually wrong. [AU-PLACE-CORE]
14. `POST /api/placement/prep/generate` ships every question's plaintext `correct_answer` (and
    explanation) in the same payload that renders the un-answered question — compounds #13 by
    making the forgery trivial (the answer is visible in the Network tab before answering) even
    without editing any request. [AU-PLACE-CORE]
15. A whole parallel legacy company-mock-test + practice-module subsystem
    (`/placement/test/[companyId]`, `/placement/practice/[moduleId]`, and 6 backing API routes)
    has zero reachable UI entry point anywhere — same shape as #1/#2 above — and where still
    directly reachable, `api/placement/submit` 500s unconditionally because its target table
    `placement_attempts` does not exist in the live schema (confirmed live, `PGRST205`); a tracked
    migration ALTERs the table but no tracked migration ever CREATEs it — untracked legacy-DB
    drift left behind by the placement rebuild. [AU-PLACE-CORE]
16. Resume autosave silently discards all data with a false "Saved" UI confirmation for any
    student who reaches the Resume tab before completing placement setup — `POST
    /api/placement/resume` uses `.update()` (not `.upsert()`), a silent no-op (200, no error) when
    the student's `student_placement_profiles` row doesn't exist yet; confirmed live. Fully
    reachable via ordinary navigation (the placement tab bar renders "Resume" as clickable even on
    the pre-setup empty state; the Resume page never redirects to `/setup` when the profile is
    missing, unlike Skill Map/Mock Interview). Every downstream feature (ATS, PDF/DOCX export,
    interview follow-up context) then silently operates on the resulting void. [AU-PLACE-TOOLS]
17. `POST /api/placement/resume` has zero schema validation — a malformed payload (e.g. missing
    `education`/`technical_skills`/`projects`) 500s via an uncaught exception in
    `computeCompleteness` instead of returning 400; same root cause as #16 and the enabler of the
    S2 export-crash finding below. [AU-PLACE-TOOLS]
18. PPT "svg" diagram slides (the DEFAULT render type for any diagram slide with no explicit
    renderHint) embed a broken compatibility fallback: pptxgenjs writes the raw SVG source into the
    media part it labels as the PNG fallback, instead of a real rasterisation — confirmed live by
    unzipping a real generated `.pptx` and finding the "PNG" fallback is detected as SVG by
    `file`/PIL, not PNG. Any viewer without Microsoft's 2016+ SVG-extension support (older
    PowerPoint, Keynote, Google Slides, LibreOffice Impress) renders a blank/broken image with no
    on-slide indication of failure. [AU-EXPORTS]
19. Notes PDF export silently DELETES any Unicode character outside a ~40-symbol curated allowlist
    (`sanitizeForPDF` in `src/lib/pdf/builder.ts`) — no placeholder, no log, no visual trace;
    confirmed live with real Devanagari/emoji/math-symbol content all vanishing, leaving only
    double-spaces. The sibling Q Paper PDF engine at least substitutes a visible `?` for the same
    input class (still degraded, but detectable) — confirms and elevates the AU-NOTES-run S3-12
    entry below from "plausible, not reproduced" to confirmed [EXPORT]. [AU-EXPORTS]
20. Any authenticated student can rewrite their own `profiles.role` to `superadmin` (or any other
    column, e.g. `department`) via a direct, ordinary `createBrowserClient().from('profiles')
    .update(...)` call — the "own profile" RLS UPDATE policy restricts the row, not the columns.
    Confirmed live: the call succeeds with no error, the same already-issued session then reads
    every other user's real profile data and successfully overwrites another student's role/branch,
    and because `proxy.ts`/`requireRole()` read the same column, this is a full bypass of the app's
    server-side authorization model, not just a database anomaly. [AU-SHELL]
21. The dashboard's "Placement Readiness"/"Best Placement Score" widgets query `placement_attempts`
    (`usePlacementHistory`, `src/hooks/useSupabaseData.ts:263-285`), which does not exist in the
    live schema (same root cause as #15 above) — confirmed live (`PGRST205`); the hook drops the
    resulting `.error` unchecked, so the widget permanently and silently renders "Not started" for
    every student regardless of real placement activity. [AU-SHELL]

**S2**
13. `api/placement/practice/submit` (and its unreachable twin `api/placement/submit`) score
    entirely client-fabricated `questions[]`/`answers` against each other with no server-side
    lookup of a real answer key — confirmed live by fabricating a request that never called
    `generate` and getting a real 100%-scored DB row back. Same "client grades itself" bug as
    S1-13, scoped lower only because these specific routes are currently unlinked from navigation.
    [AU-PLACE-CORE]
14. Concurrent double-submit of one `prep/submit` session produces a lost update (not a duplicate)
    on `placement_topic_mastery` — same check-then-act race shape as the ledgered `checkRateLimit`
    race, found in a second independent location; the `placement_question_attempts` audit trail
    gets both inserts but the aggregate mastery counter silently drops one submission's
    contribution. [AU-PLACE-CORE]
15. A SQL-injection-shaped `topic` string on `prep/submit` (still under the 100-char cap) produces
    an unhandled 500 whose log entry contains a raw, unbounded upstream HTML error body — same bug
    class as #12-shape AU-QUIZ `subjectIds` finding. [AU-PLACE-CORE]
16. `POST /api/placement/profile` accepts `setup_complete: true` independent of `cgpa`/
    `primary_target` ever being set; every downstream consumer (`isDriveEligible`) silently
    coalesces the missing CGPA to `0`, filtering the student out of every CGPA-gated drive with no
    signal that their profile — not their qualification — is the cause. [AU-PLACE-CORE]
17. `computeNextMoves` returns an empty move queue for a fully-prepared student with an imminent
    eligible drive — confirmed via direct exercise of the pure function; the dashboard's one
    always-tell-the-student-what's-next surface has nothing to show in exactly the moment it
    matters most. [AU-PLACE-CORE]
18. Resume PDF and DOCX export both crash (500) on a resume missing `technical_skills` — no
    null-guard, unlike `resume/ats` which explicitly defaults it; confirmed live on both export
    routes. [AU-PLACE-TOOLS]
19. `interview/mock/follow-up`'s per-student cost cap (5 calls/3h) gives zero protection under
    concurrent load — an 8-way concurrent burst from a fresh student let all 8 through (0
    rejected), confirmed both via HTTP responses and a direct `ai_call_logs` query showing 8 real,
    separately-billed Gemini calls landed against a cap of 5 — same check-then-act race shape as
    the ledgered `checkRateLimit` race, but a 100% bypass on first burst. This is the exact abuse
    case the audit brief asked to verify. [AU-PLACE-TOOLS]
20. `resume/ats`, `resume/rewrite-bullet`, `jd-analyze`, and `interview/evaluate` have no rate
    limit or cost ceiling at all — `placement` is not a key in `DAILY_LIMITS`
    (`src/lib/utils/rate-limit.ts`), unlike chat/quiz/research/hint/notes; confirmed live by
    firing 3 rapid sequential real `interview/evaluate` calls, all 200, zero throttling.
    [AU-PLACE-TOOLS]
21. A distress-adjacent interview answer ("I feel like giving up on everything lately") got zero
    safety acknowledgment from `interview/evaluate` — scored purely as "an immediate disqualifier"
    for unprofessionalism; the route passes no `systemPrompt` at all, reproducing AU-CHAT's
    already-ledgered missing-distress-clause gap (S2-5 above) in a second, independently-tested
    feature. [AU-PLACE-TOOLS]
22. Notes PDF's worked-example text does not parse markdown — a markdown table embedded in a
    worked-example problem renders as raw pipe-syntax, while the identical table renders as a real
    bordered table three lines above it in the same PDF (the block's own symbols table) and again
    in qpaper PDF/DOCX on the same content — a second, independent, narrower confirmation of the
    AU-CHAT-ledgered "PDF export garbles markdown tables" defect (S3-7 below), in a different
    engine. [AU-EXPORTS]
23. Q Paper PDF: a question's marks/CO/BTL/PO tag-row header can print with empty values at the
    bottom of one page while the sub-part content — and the tag values that belong to that empty
    header — print at the top of the next page, disconnected with no repeated column context; no
    page-break/keep-together guard exists between a question header and its first sub-part.
    [AU-EXPORTS]
24. DESIGN.md's color/typography system (ink/paper/ochre tokens, IBM Plex fonts, mono-tag) is
    entirely absent from the shared student shell chrome (`(student)/layout.tsx`) and the
    dashboard/subjects/profile/history pages — confirmed via `font-plex` grep (present in Notes/
    Flashcards/Placement, absent here) and screenshots; distinct from the already-ledgered #17
    below because this is the nav chrome rendered on every single student screen, not individual
    un-migrated sub-pages. [AU-SHELL]
25. Mobile nav touch targets confirmed under the 44px floor with new measurements: the top-bar
    hamburger button is 36×36px and the open-drawer nav links are 36px tall on all four AU-SHELL
    pages — cross-cutting instance, additional evidence for a shared component fix.
    [AU-SHELL]

**S3**
7. Chat PDF export garbles markdown tables into raw pipe-syntax text (diagrams export fine). [AU-CHAT]
8. Dark mode is unreachable anywhere in the app — no theme toggle exists. [AU-CHAT, AU-NOTES; cross-cutting]
9. No server-side double-submit guard on `/api/chat` (client-lock-only). [AU-CHAT]
10. Shared PDF export engine (`src/lib/pdf/builder.ts`) renders generic Tailwind-blue/Helvetica
    instead of DESIGN.md's ink/ochre/Plex system — affects every PDF export, not just notes. [AU-NOTES]
11. A formula block's `symbol` field sometimes holds a full descriptive phrase instead of a short
    symbol — prompt-adherence drift the length-only validator doesn't catch. [AU-NOTES]
12. Non-ASCII characters outside recognized math spans are silently dropped (not logged) by the PDF
    text sanitizer — plausible, not reproduced with real content this run. [AU-NOTES]
    **Confirmed and promoted to S1-19 above by AU-EXPORTS** with a real generated artifact
    (Devanagari/emoji/math-symbol content fully vanishing, no trace) — not re-counted here.
13. A SQL-injection-shaped `subjectIds` value causes an unhandled upstream failure that dumps a raw
    HTML error page into server logs (client response stays a safe generic 500 — no data exposure,
    just missing UUID-shape input validation). [AU-QUIZ]
14. The fill_code+MCQ "mixed" prep session always presents all 4 MCQs before any fill_code
    question (block-concatenated, never interleaved). [AU-PLACE-CORE]
15. The dashboard's stage strip is horizontally scrollable but has zero scroll affordance, so later
    stages are silently clipped off-screen on mobile with nothing indicating more exists.
    [AU-PLACE-CORE]
16. Resume save accepts unbounded array sizes (200 oversized projects saved successfully in 5.5s,
    far past the client's own `MAX_PROJECTS=4` cap) with no server-side size validation.
    [AU-PLACE-TOOLS]
17. Resume, JD Analyzer, Interview Prep Bank, and Mini-Project Guides are visually un-migrated
    from DESIGN.md (generic `bg-blue-600`/`rounded-2xl`/plain-sans Tailwind) while Skill Map and
    Mock Interview (same rebuild) fully conform — measured consequence: every primary button on
    the un-migrated pages is 34–36px tall (under the 44px floor) vs. exactly 44px on the
    conforming pages, because the latter build on the shared `h-11` button pattern. A second,
    independent touch-target regression beyond the already-ledgered shared-sidebar one.
    [AU-PLACE-TOOLS]
18. `src/types/placement.ts` declares `ResumeProject`/`ResumeCertification`/`ResumeData` twice
    each; TS interface-merging combines them into an unsound wider type the codebase already
    defensively casts around in two places (self-flagged "CP-E1" in a code comment, never fixed).
    [AU-PLACE-TOOLS]
19. No `prefers-reduced-motion` handling anywhere in `src/app/globals.css` — a global gap noticed
    while reading the stylesheet for AU-SHELL; low severity there specifically (that feature has
    almost no motion) but applies app-wide. [AU-SHELL]
