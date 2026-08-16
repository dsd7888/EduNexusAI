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
- **Dark mode unreachable app-wide** — AU-CHAT. No `next-themes`/`ThemeProvider`/any `.dark`-class
  toggle exists anywhere in `src/app`/`src/components`; Tailwind's dark variant is class-based, not
  `prefers-color-scheme`-based, so there is no automatic fallback either. DESIGN.md's dark-mode spec
  (night bg, `ring-paper` focus states, CP-D0 layering rules) currently reaches zero sessions. Verify
  against AU-SHELL and AU-FLASH (CP-D0 dark-surface work) — if true there too, this is a single
  platform-wide gap, not a per-feature one.
- **Touch targets under 44px** — AU-CHAT (every composer/header control: 26–36px measured). DESIGN.md
  states this platform-wide, "not just mobile Notes surfaces (extend the existing CP-N4 rule
  platform-wide)" — check AU-QUIZ/AU-PLACE-*/AU-SHELL controls too; likely a shared `Button`/pill
  sizing issue rather than N separate per-feature bugs.
- **Rate-limit check-then-increment race (`src/lib/utils/rate-limit.ts`)** — AU-CHAT. `checkRateLimit`
  reads today's usage then a later, separate write increments it — no atomicity. This helper is shared
  by every rate-limited feature (`chat`, `research`, `hint`, `quiz`, `examSim`, `notes_view`,
  `notes_export`), so the same race almost certainly reproduces in AU-QUIZ, AU-NOTES, and
  AU-PLACE-TOOLS wherever they call `checkRateLimit` — worth a single shared fix rather than N patches.
- **Shared test harness (`src/lib/testing/httpHarness.ts`) duplicates slow POST requests** — AU-CHAT
  (methodology note, not a product finding). Its wrapped `fetch` produced two real server-side
  executions per single call to a multi-second AI route in ~most cases observed; a raw `curl` to the
  same routes never duplicated. Any later `AU-*`/`_cp_*_verify` session driving a slow AI route through
  this harness should corroborate concurrency/duplication findings with raw `curl` before trusting them,
  until this is fixed.

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
13. A SQL-injection-shaped `subjectIds` value causes an unhandled upstream failure that dumps a raw
    HTML error page into server logs (client response stays a safe generic 500 — no data exposure,
    just missing UUID-shape input validation). [AU-QUIZ]
