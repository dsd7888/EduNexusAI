# CP-Q3 — Student Assessment UX

*One-page reference for the whole checkpoint (Parts 1–5). Written at Part 5,
retroactively covering 1–4 because this doc has been referenced from code
comments across all of them and never actually existed until now.*

Branch `dev`. Parts 1–4 landed in `d01033b` (feature) and `21f320f`
(parallelization). Part 5 is this commit.

---

## Part 1 — the key-exposure fix

**Before:** `quiz_sessions.config.key` held the full answer key (correct
answers, explanations) for every session, including `exam_sim` — a
deferred-feedback mode where the student is not supposed to see the key until
they submit. `quiz_sessions` has a student-own SELECT policy (needed for
"Continue where you left off"), so anything in `config` was readable by the
owning student's browser client the moment the row existed — i.e. from the
first second of the exam.

**After:** the key moved to its own table, `quiz_session_keys`
(`session_id` PK, `key` jsonb), RLS enabled with **no SELECT policy for
authenticated users at all** — only `superadmin` and, implicitly, the service
role. Every read goes through `loadSessionKey(admin, sessionId)`
(`runner.ts`), server-side, admin client only. `quiz_sessions.config` keeps
everything else (the student-safe question projection, timing, mode config)
but never the key again — `session/[id]/route.ts` enumerates response fields
explicitly rather than spreading `config`, specifically so a future field
added to `config` can't leak by accident.

Policy state, before → after:

| | before | after |
|---|---|---|
| `quiz_sessions.config` | carried `key` | never carries `key` (enforced by a migration-end `RAISE EXCEPTION` if any row still does) |
| key readable by | owning student (via config) | nobody but service role / superadmin |
| verified by | — | `_cp_q3_verify/key_exposure.ts` — the four-assertion RLS template (below) |

**The four-assertion template**, now the house style for any "role X cannot
read table Y" claim (`key_exposure.ts`, and Part 5's
`results_view_privacy.ts`):

1. A **real client for the role under test** — anon key + a genuine student
   JWT (magic link minted with the service role, redeemed via `verifyOtp`),
   not a service-role client with a `.eq()` filter. The latter tests your
   WHERE clause, not the policy.
2. A **positive control** — assert the service role CAN read the row.
   Without it, "returns `[]`" passes identically against an empty table.
3. **Empty AND no error**, asserted separately. PostgREST returns `[]` with
   no error when RLS matches no policy; an *error* means something else broke
   (bad JWT, missing table) and must never be scored as "blocked".
4. A **canary string**, seeded into the secret at insert time, grepped for in
   `JSON.stringify(response)` — not just "is the field absent", because the
   value can survive inside a nested blob or a field you forgot to enumerate.

Plus the counterpart: prove the role still reads what it legitimately should
(`quiz_sessions_select_own` is still in force — the fix was "split the
table", not "lock the table").

---

## Part 2 — the shared subject picker

`SubjectSearchPicker` (multi-select mode) replaced three separate
subject-selection UIs. The one finding worth keeping:

**Parent-notified state via effect, not per-mutation callback, when the
initial state resolves asynchronously.** A child that owns a selection and
reports it upward through `onChange` calls placed inside its mutation
handlers is correct only if every state change *is* a mutation. It isn't,
whenever the child accepts an `initialSelected`-style prop resolved against
data that loads later: the initial state exists from the first render (a
`?subjectId=` deep link is in the URL immediately), the data does not, and no
mutation ever fires — so the child renders the selection while the parent
believes there is none. Symptom: a permanently disabled "Start" button on a
deep link only, reading as "sometimes doesn't work" for weeks. Fix: one
`useEffect` that notifies on the *resolved* value, held via a ref (callers
pass inline arrows — a fresh identity every render turns the effect into a
render loop) and de-duplicated on a signature of the state.

Part 5's landing changes (`?mode=`, `?modules=`) reuse the exact same
`initialSelected` prop the picker already exposed — no new picker code.

---

## Part 3 — landing signals + streaks

`GET /api/assessment/landing` is one round trip for everything the
`/student/quiz` landing renders about the current student: per-mode card
signal, the resume strip, the streak. One route, not four client queries,
because the "ready to level up" rule is a product decision that must match
the mastery hub (Part 5B) exactly — and now does, via the shared
`landingSignals.ts` constants both routes import.

**Streak logic** (`src/lib/assessment/streak.ts`):
- A practice week is **Monday 00:00 → Sunday 23:59:59, local time** (not
  UTC — a student practising at 11pm Sunday IST is having a Sunday).
- A week **qualifies** on ≥3 completed sessions of any mode.
- A week is a **half-week** on exactly 2.
- **Grace:** one half-week may be absorbed per rolling 4-week window without
  breaking the streak. A second half-week inside that window breaks it.
  ≤1 session breaks the streak outright — grace doesn't stretch that far.
- **The current week is PENDING, not FAILING.** Read literally, "≥3 sessions
  in each of N consecutive weeks including the current week" kills every
  streak at 00:00 Monday (0 sessions so far) and revives it Wednesday — the
  exact guilt mechanic ("you lost your streak") this design rejects. Fix:
  the current week can only *add* to the streak, never break it; a week is
  judged only once it's over; `currentWeekPending` tells the UI which state
  it's looking at so it can invite ("2 more this week counts it") without
  ever accusing.

**Banned copy, permanently** (`streakCopy()` is the only place streak
strings exist, specifically so this is auditable by reading one function):
"Don't break your streak", "You're about to lose…", "Last chance", any
countdown to a loss.

---

## Part 4 — session UI

**Reveal transition mechanics** (`RevealPanel.tsx`) — treated as
requirements, not polish:
1. No layout shift on the question — the reveal panel animates its own
   height in via a `grid-template-rows: 0fr → 1fr` transition (the one CSS
   technique that animates to `auto` height without measuring in JS).
2. The correctness indicator animates in (220ms scale+fade), never a hard
   swap — a hard swap at the moment of judgement reads as a verdict slamming
   down.
3. The explanation fades in **90ms after** the correctness indicator, not
   simultaneously — both arriving at once makes the eye choose, and it
   chooses the prose, the wrong order for learning.
4. `prefers-reduced-motion` collapses all of it to an instant show.

**Immediate-feedback route is separate from submit, on purpose.**
`POST /api/assessment/answer` grades one question and is meant to be called
constantly (per-question, sub-200ms budget); `POST /api/assessment/submit`
is once-per-session, closes the session, computes negative marking across
the whole paper, and moves mastery. One route with an `if (perQuestion)`
branch would tangle both invariant sets in one handler, and exam_sim's
30-second silent autosave (which calls `/answer` purely to persist,
discarding the response) would run through session-closing code.

**Server-side timer, 5s grace.** The clock lives on `quiz_sessions.started_at`
+ `config.time_limit_minutes`, checked in `/answer` on every call:
`elapsed > limit*60 + 5` → 409. The 5s absorbs one network hop on an answer
sent right at the buzzer.

**`/submit` does NOT enforce the timer — an intentional asymmetry, with a
stated cost.** A student past their time limit is blocked from *answering*
but can still *submit* whatever they already had. The alternative (rejecting
a late submit) destroys finished work on a slow last request, which is worse
than letting a marginal late submission through. `exam_sim_timing.ts` pins
this explicitly rather than leaving it to be rediscovered as a "bug".

**Peer stat privacy rules** (`peerStat.ts` / `peerStatCompute.ts`) — privacy
and honesty rules, not tuning knobs:
- **≥10 prior attempts floor.** Below it, the number is noise dressed as
  information, and in a 60-student class it's re-identifiable.
- **20–80% window, both directions.** Above 80% ("everyone but me got this")
  is the most discouraging framing of a single wrong answer; below 20%
  either excuses a correct answer or excuses a gap that needs closing.
  Neither tail carries usable information.
- **Computed before the attempt insert.** Folding the student's own answer
  into the stat before showing it to them would nudge a correct answer's
  "62%" upward by their own doing.
- **Scoped to subject** (not just question) — the same bank question can be
  offered from more than one subject, and mixing cohorts misreports the
  stat.
- No names, no ranks, ever — the payload is one integer; there's nowhere to
  put an identity.

**Chat handoff (`chatHandoff.ts`) via sessionStorage + token.** The payload
(stem, student's answer, correct answer, explanation) routinely runs 1–3 KB
with LaTeX — over the practical URL-length floor, and the wrong place for a
student's wrong answers to live in browser history / server access logs
anyway. So the payload goes in `sessionStorage` under a random 12-char
token; only the token travels in the query string. Read is **destructive**
(read-and-delete) — a surviving token would re-fire the same prefill on
every later chat visit, reading as a stuck tutor. Same pattern as CP4's
Visualize handoff (a `messageId`, not the message). Part 5A's "Ask AI why"
on the results page reuses this exact function, unmodified.

---

## Part 5A — results view

**Route:** `/student/quiz/results/[sessionId]`. Both mode runners already
`router.replace()` here on finish; this closes the 404 that's existed since
Part 4 shipped.

**Why a new `GET /api/assessment/results/[sessionId]` route, not a reuse of
`submit`'s response or `session/[id]`.** `submit`'s rich per-question payload
(`isCorrect`, `correctAnswer`, `explanation` per question, `masteryDeltas`)
is **transient** — never written back anywhere — and the results page is a
real route that must survive a refresh. `session/[id]/route.ts` is
*deliberately* forbidden from ever touching `quiz_session_keys` (Part 1's
invariant). So results reconstructs the graded view server-side from durable
state: `quiz_sessions` (score/marks), `quiz_session_keys` (server-only, same
discipline as the resume route — enumerate fields, never spread), and
`student_question_attempts` (what the student actually answered — matched
back to the key by `(subject_id, module_id, question_text)`, taking the
latest row per key since `/submit` re-writes a final attempt row for every
question even in immediate-feedback modes, layering on top of the
mid-session `/answer` row).

**Mastery deltas without a schema change.** `student_topic_mastery` only
ever holds the *current* state — by results-page time, `/submit`'s
write-back has already overwritten "before" with "after". Rather than a
migration, a **before-snapshot** is captured into
`quiz_sessions.config.masterySnapshot` (a jsonb key, not a column) at
session-creation time, mode='mastery' only, scoped to every module of the
requested subject(s) — not just modules the student has already touched, so
a module first practiced *in this session* correctly shows before=0/'easy'
rather than being silently absent. The results route then diffs snapshot
(before) against the **current** `student_topic_mastery` row (after) — exact
as long as no other mastery session for the same module completed in
between, the same assumption every "your last session" surface in this
product already makes. Legacy mastery sessions created before this shipped
have no snapshot; their results omit `masteryDeltas` and set
`warnings: ["no_snapshot"]` rather than showing a wrong or empty delta.
`masterySnapshot` is intentionally student-readable via `config` — student's
own before-state, not grading material (privacy check, CP-Q4 Part 0).

**Sectional breakdown groups by subject, not a real "section".** GATE mock
is one 180-minute clock for the whole 65-question paper — there is no
per-section time budget anywhere in `presets.ts`, and inventing one would be
UI making up structure the exam config doesn't have. `exam_sim`'s only
multi-part structure is multi-*subject*, so "section" = subject, and each
subject's time *target* is its mark-weighted share of the overall limit
(evenly distributed when subjects are equal-weight, which is what the
`GATE_PRESET`'s exact-count type distribution effectively produces). Stated
plainly in the doc comment and in this file so a future contributor doesn't
"fix" the flat time split into something that implies data that isn't there.

**Negative-marking impact is one line, not a chart.** `rawScore` (what the
student would score with no penalty) is recomputed from `perQuestionResults`
rather than trusted from any stored field — `negativeMarksApplied` isn't
persisted anywhere except `submit`'s transient response, so the results
route derives it fresh from the same `negativeMarksFor()` GATE-authentic
rule the grading path uses (MCQ → −1/3; MSQ/NAT → 0, by design, not
oversight — see `presets.ts`). The UI line is omitted entirely when
`delta === 0`.

**"Ask AI why" reuses Part 4's `chatHandoff.ts` unmodified** — same token
pattern, same destructive read on the chat side.

**CTAs feed back into the landing page's existing param absorption**, not
new UI:
- *Try another* → `/student/quiz?mode=<mode>&subjectId=<subjectId>` — the
  landing page already reads `?mode=` (Part 3, for the mode-card ring) and
  `?subjectId=` (Part 2's `initialSelected`); Part 5 added nothing to the
  page beyond reading the params.
- *Practice your weak areas* (shown only when any module scored <60% in
  *this* session) → `/student/quiz?mode=mastery&subjectId=<id>&modules=<ids>`.
  There is no module-picker UI on the landing page and Part 5 didn't build
  one for this — `?modules=` is passed straight through to
  `/student/quiz/start`'s existing `moduleIds` param (Part 2 already
  supported scoping a mastery session to specific modules), so the CTA's
  destination session is scoped to exactly the requested weak modules
  without a picker in between. Simpler and more precise than a picker the
  student would have to re-select from.

---

## Part 5B — mastery hub

**Route:** `/student/quiz/mastery`, linked from the landing footer since
Part 3 (a 404 until this shipped). `GET /api/assessment/mastery` (a `GET`
handler added alongside the existing mode-start `POST` on the same file —
same path, different verb, both idiomatic Next.js route exports).

**Aggregate mastery is attempt-weighted, not a mean of module percentages**
— `(Σcorrect)/(Σattempts)` per subject, same rule `landing/route.ts` already
used for the single rollup number. A 40-attempt module and a 3-attempt
module do not carry equal weight; a mean would let one lucky 3-question
module swing the headline number. Verified explicitly in
`mastery_hub.ts` (39% attempt-weighted vs. 50% naive mean, on seeded data
chosen so the two disagree).

**`promotionProgress`** — how close a module is to the next tier, shown only
inside the "ready to level up" window `landingSignals.ts` already defines
(accuracy≥70%, 8≤attempts<10, not already 'hard'): `attemptsAvailable =
10 - attemptsCount`; `correctNeeded = max(0, min(attemptsAvailable,
ceil(0.7×10) - correctCount))` — the minimum additional correct answers
needed among the remaining attempts to still clear 70% by the 10-attempt
evaluation point (`grading.ts`'s real promotion threshold). Null outside the
window: too early (attempts<8), already resolved (attempts≥10), already top
tier, or accuracy not yet at the bar. Sharing the threshold constants with
the landing card's counter means the two surfaces can never call a different
set of modules "ready".

**Expands inline, not a navigation** — tapping a subject card reveals its
module breakdown via a `Collapsible`, in place. A subject drilldown *page*
was considered and explicitly deferred (see below) — inline expansion covers
the pilot's module counts per subject without a second navigation layer.

**Design reuse, no new primitives:** `StreakBadge` (same component instance
pattern as the landing header — "so the two can't drift"), the shared
`scoreState`/`scoreBarClass` color system for per-module accuracy bars, and
`RichQuestionText` for subject/module names (rare but seeded — e.g.
"Mathematics III" — LaTeX in a title). The subject-level *aggregate* bar is
deliberately **always amber**, not colour-by-value like a per-module bar —
it's a practice-volume summary across a whole subject, not a pass/fail
signal, and doesn't earn emerald the way one module's accuracy does.

---

## Latency (`/api/assessment/answer`)

The route documents a <200ms handler budget. `latency_measurement.ts`
measures rather than asserts it, against two lines: flag above p95 200ms,
halt above p95 400ms — but only when the measuring environment can actually
resolve the question, which a laptop-to-hosted-Supabase run cannot: the
handler is round-trip-bound (≈5 sequential Supabase calls), so its floor is
`roundTrips × per-trip RTT`, and from a laptop that RTT alone (300–600ms) can
exceed the whole budget before a single line of handler code runs.

**Parallelization (`21f320f`):** the answer route's session-row read and the
`quiz_session_keys` PK lookup were independent (both keyed by `sessionId`
alone, neither reads the other's output) and were issued sequentially. Made
concurrent via `Promise.all`. The checkpoint's own before/after comparison:
**sequential p50 2693ms → parallel p50 1389ms**, a **1.6× normalized
improvement** once the removed round trip is accounted for against the
per-request RTT baseline — the raw ratio looks larger than 1.6× until the
network floor (which the parallelization can't touch) is backed out. What
*is* parallelizable was made so; what isn't (the peer stat, which is
data-dependent on the key's `bankQuestionId`, and must stay strictly after
the attempt insert for correctness — see Part 4) was deliberately left
sequential, documented at the call site so a future "finish the job" pass
doesn't break the ordering invariant for a latency win that isn't there.

This session's own fresh run (dev mode, indicative only) shows the same
environment-bound shape holding post-parallelization: p50 1771ms / p95
2575ms against a measured Supabase RTT p50 of 365ms, floor estimate
`5 × 365ms ≈ 1825ms` — already at or above the measured p50, meaning the
handler's own compute is in the noise and not separately resolvable from a
laptop. Verdict: **deferred, environment-bound**, not a regression and not a
clean pass — the number does not mean what it would mean from a
co-located server.

**Outstanding:** a Vercel-preview run (`npm run build && npm run start`,
`HARNESS_PROD=1 npx tsx _cp_q3_verify/latency_measurement.ts`, from a
deployment co-located with the Supabase region) is the only way to get a
verdict that actually binds against the 200ms/400ms lines. Not done in this
checkpoint — logged here rather than silently dropped.

---

## Explicit rejections (restated, all checkpoints)

The permanent no-list, so a future "let's make this more engaging" revision
has to argue against a stated principle rather than fill a silence:

- No points, no leaderboards (class or cohort), no ranks, no percentile-of-you.
- No push notifications, no email nags, no "don't break your streak!" or any
  countdown-to-a-loss copy anywhere.
- No red for a negative signal, ever — the semantic score system is
  slate (not started) / amber (in progress) / emerald (on target). A 10%
  first attempt is an invitation, not a failure grade.
- No mid-session running score in Quick Check or Module Mastery — a live
  tally reintroduces exactly the exam anxiety the immediate-feedback flashcard
  mechanic exists to remove. The score exists once, at the end.
- No peer stat above 80% or below 20%, in either direction.
- No peer stat without ≥10 prior attempts on that exact question.
- No names, no ranks, anywhere a peer stat appears — by construction, the
  payload is one integer.

---

## Deferred (not this checkpoint)

- **`/student/quiz/legacy` removal** — CP-Q5. The prior 1,766-line quiz page
  is kept as a one-week pilot fallback; its removal is scheduled, not forgotten.
- **Visualize on results** — CP-Q4 territory (Visualize is a chat-turn
  feature; wiring it onto a results question card is a distinct integration,
  not a Part 5 scope item).
- **Mastery hub subject drilldown pages** — only if inline expansion proves
  insufficient once a subject's module count grows past what a card can
  reasonably show. Logged to `Future_plans.MD` rather than built speculatively.
- **Vercel preview latency measurement** — see above; the harness and the
  budget lines exist, the co-located run does not.
- **`routeAI` outside request scope** — a pre-existing item (not new to
  Part 5) whose motivation has now surfaced twice independently: once from a
  chat-architecture discussion, once from this checkpoint's own harness
  design (`makeRunInScope`'s `workAsyncStorage` shim exists specifically to
  work around `after()` needing request scope in a non-request harness
  context). Two independent surfacings without either becoming the reason to
  fix it is itself a signal — logged to `Future_plans.MD`, not actioned here.

---

## Verification

Three harnesses, all real HTTP against a running dev server, real
authenticated students, real database — same infrastructure
(`src/lib/testing/httpHarness.ts`) as `session_flow.ts` and
`exam_sim_timing.ts`:

- **`results_view.ts`** (48 assertions) — a real mastery session
  (single-module-scoped, 10 questions, scripted 7/10 correct) verified
  end-to-end through `/submit` → `GET /results`, with every expected number
  (attemptsBefore/After, accuracyAfter, `nextDifficulty`'s own transition,
  non-promotion on one session) computed independently in the harness. Plus
  a fabricated 2-subject/6-question `exam_sim` session (seeded via service
  role — no AI spend, same precedent as `key_exposure.ts` — driven through
  the *real* `/submit` and `GET /results` routes) verifying
  `sectionalBreakdown` groups correctly and `negativeMarkingImpact.delta`
  matches an independent GATE-rule calculation.
- **`mastery_hub.ts`** (27 assertions) — seeded `student_topic_mastery`
  across 3 subjects / 4 modules chosen to each land in a different
  `promotionProgress` corner (in-window, past-accuracy, top-tier,
  below-floor), plus the attempt-weighted-vs-naive-mean distinction and the
  empty state for a second, mastery-row-free student.
- **`results_view_privacy.ts`** (9 assertions) — the Part 5 addition to the
  RLS/ownership verification pattern: an unrelated real student reading
  another student's completed session (403, canary-string-absent), the
  *owning* student reading their own session before it's completed (404, not
  a partial payload — the check most likely to regress silently since it's
  easy to write the ownership check and forget the status check beside it),
  no auth at all (401), and a nonexistent session id (404, not 500).

All three pass clean, with residue checks confirming full cleanup. Combined
with `npm run build` (clean) and `npm run lint` (zero new warnings/errors —
confirmed by diffing lint output against file paths touched by this
checkpoint), this is the verification basis for Part 5.

**Browser verification gap, stated rather than implied:** no headless
browser tool was available in this session's environment. Route-level
behaviour (grading, privacy, ownership, response shapes) is fully covered by
the three HTTP harnesses above, which drive the actual Next.js route
handlers over real HTTP with real cookies — not a client-side mock. What is
**not** covered: client-side rendering correctness, the reveal/expand
animations, and interactive flows (back-navigation mid-session, the
"Ask AI why" round-trip through the chat page and back). A same-origin
authenticated fetch of `/student/quiz/mastery`, a bogus
`/student/quiz/results/[id]`, and `/student/quiz?mode=mastery&modules=…`
confirmed all three routes server-render their shell with no Next.js error
boundary and the expected static copy present — a weaker signal than a real
click-through, and reported as such rather than folded into "verified".
