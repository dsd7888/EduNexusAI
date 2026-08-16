# AU-QUIZ — Quiz / Assessment sessions, timer, mastery rules, NAT, export

Run date: 2026-08-16. HEAD at start: `acd341b85c47e203928ed1c9b555dd64b324c1c8` (clean tree
except the pre-existing untracked audit scaffolding noted in the ledger's prior runs).

**Scope note discovered during grounding:** the codebase carries TWO quiz implementations.
`src/app/api/quiz/{generate,submit,export,hint}` is a v1 system over `quizzes`/`quiz_attempts`.
`src/app/api/assessment/{quick,mastery,exam-sim,answer,submit,session,results}` (backed by
`src/lib/assessment/*`, ~6,300 lines, the CP-Q1–Q3 engine) is the CURRENT system, over
`quiz_sessions`/`quiz_session_keys`/`student_question_attempts`. Grepping every file under
`src/app` and `src/components` for `/api/quiz/` turns up zero call sites — the v1 routes are
dead code, reachable only by hand-crafting a request. This shaped the whole audit: "AU-QUIZ" in
practice means the `assessment` engine, and the v1 export route is examined as its own finding
(§S1-1) rather than as "the" export feature.

## Method

Real HTTP against a live `npm run dev` server, authenticated as real students via
`src/lib/testing/httpHarness.ts` (magic-link → `verifyOtp`, real cookies, real `proxy.ts`/
`requireRole` on every call — not a direct library call). Two ephemeral CSE-sem3 students for
the main flow + a cross-student authorization pair; the shared `teststudent@gmail.com` (also
CSE sem3) for one Playwright UI screenshot pass. Target subject: **SECE2250 "Computer
Organization & Architecture"** (CSE sem3, 8 modules, 37-question MCQ bank) — chosen for a real
bank pool so the happy path is cost-free; NAT/true_false cases intentionally forced fresh AI
generation to exercise those paths for real.

Scripts live in `_audit_quiz/` (git-ignored): `main_flow.ts`, `stage2.ts`, `stage3.ts`,
`stage4.ts`, `ui_truefalse.mts`, plus one-off DB probes. All test-created sessions/students were
deleted at the end of each run; verified via `verify_cleanup.ts` (zero leftover `cp-harness-*`
auth users from this run, zero leftover `quiz_sessions` rows for the adopted `teststudent`
account — its 8 pre-existing `student_topic_mastery` rows predate this run and were not touched).

**AI spend:** $0.0445 (~₹3.7), 17 real Gemini calls, all correctly logged to `ai_call_logs`
under `feature=assessment_quick` / `task=quiz_gen_v2` and `task=nat_verify` (routeAI + cost
logging confirmed working, per CLAUDE.md's requirement). Well under the ≤25-call soft cap.

## Universal checklist results

- **A. Happy path** — [RUNTIME] PASS. `quick` mode (bank-sourced, 5 MCQ) generated → answered
  (immediate feedback correct) → resumed mid-flight → submitted → mastery mutated → re-submit
  correctly 409'd. Full loop works end to end.
- **B. Adversarial input** — quiz has no open-text/chat-style surface, so most of this checklist
  item (off-syllabus, vulgar, injection, "give me the answers") doesn't apply the way it does to
  AU-CHAT. The one applicable adversarial case — a SQL-injection-shaped `subjectIds` value — is
  §S3-1 below: handled safely (generic 500, no data exposure) but not cleanly (raw HTML dumped to
  server logs, no input-shape validation).
- **C. Malformed / boundary** — [RUNTIME] mostly clean: empty `subjectIds` → 400; huge
  `questionCount` (999999) → clamped to the mode's max (20), not a crash/hang; negative count →
  handled; malformed JSON body → 400 not 500; empty `slotId` → 400. One failure: §S3-1.
- **D. State / concurrency** — [RUNTIME] mixed. Resume mid-session is correct (§ Notable positive
  below). Two real bugs found here: §S2-2 (submit doesn't re-check the timer) and §S2-3
  (concurrent submit is not idempotent).
- **E. Authorization** — [RUNTIME] mostly clean (cross-student 403 on GET session / POST answer /
  POST submit, all verified with a real second student). One real gap: §S2-5 (no subject-scope
  check at all).
- **F. Errors & logs** — mostly clean; generic client-facing errors, no secrets observed in
  responses. §S3-1 is the one logging-hygiene issue found.
- **G. Cost** — [RUNTIME] clean. Every generation call in this run landed in `ai_call_logs` with
  the right feature/task tags; bank-sourced questions correctly cost $0; NAT verification correctly
  fires one `nat_verify` call per NAT item, never skipped.
- **H. UI/UX** — [UI] one confirmed severe defect (§S2-4, true/false renders unusable). Dark mode:
  confirmed unreachable on the quiz session page too (byte-identical light/dark screenshots) — not
  counted as a new finding, corroborates the existing cross-cutting ledger entry.

## Feature-specific cases (§5 AU-QUIZ)

- **Resume-from-session lands on the right question** — [RUNTIME] CONFIRMED FIXED AND WORKING.
  The code comments in `session/[id]/route.ts` describe a real historical bug (resume silently
  discarded progress, landing back at question 1) fixed by reading `answeredSlots` from
  `student_question_attempts`. Verified live: answered 2 of 5, refetched the session, got back
  exactly those 2 slots with their feedback; the client's `firstUnansweredIndex` would correctly
  reopen on question 3.
- **Timer expiry rejects late answers** — [RUNTIME] HALF TRUE. `/api/assessment/answer` does this
  correctly (409 after expiry, verified with a real 1-minute exam-sim session left to expire for
  real). `/api/assessment/submit` does **not** — see §S2-2, the most important finding in this run.
- **exam-sim does NOT write mastery** — [RUNTIME] CONFIRMED. `student_topic_mastery` row count
  identical before/after a real exam-sim submission; the submit response correctly omits
  `masteryDeltas` entirely (not even an empty array) for this mode.
- **NAT dual-gate grading correct on right AND wrong numeric input** — [RUNTIME] CONFIRMED. Forced
  fresh AI generation of 5 NAT items (all 5 passed the generation-time verifier, 0 discarded).
  Answered one with a clearly wrong number → `isCorrect:false`; re-answered the same slot with the
  exact value the server had just revealed as correct → `isCorrect:true`.
- **Feedback withheld per mode** — [RUNTIME] CONFIRMED. `quick`/`mastery` return full feedback
  per-answer; exam-sim's `/answer` (called with `silent:true`, matching the real client) returns
  only `{recorded:true}`, and resume for an in-progress exam-sim session carries `studentAnswer`
  only, never `isCorrect`/`correctAnswer` (verified by reading the route; not independently
  re-derived at runtime this pass, but the code path is the same one that gates the immediate-
  feedback modes, which WAS exercised live).
- **Export content matches the session** — [RUNTIME/EXPORT] FAILS, because there is no reachable
  export to match against. See §S1-1.

## Findings

**[S1-1] [STATIC+RUNTIME] Quiz has no working export path anywhere in the product.**
Two independent facts, both verified:
1. Zero UI call sites. Grepped every `.tsx`/`.ts` under `src/app` and `src/components` for
   `/api/quiz/` (the only route that builds a quiz PDF) — no hits. `ResultCtas.tsx` (the results
   page's action row) offers exactly two buttons, "Try another" and "Practice your weak areas" —
   no export/download control exists anywhere in the quiz UI.
2. Even called directly, the route can never succeed for a real session.
   `src/app/api/quiz/export/route.ts` queries `quiz_attempts` joined to `quizzes` — the **v1**
   schema. The current engine (the only reachable one) writes exclusively to `quiz_sessions` /
   `student_question_attempts`. Confirmed live: `SELECT count(*) FROM quiz_attempts` = **0** and
   `quizzes` = **0**, platform-wide, while `quiz_sessions` has real completed rows from this very
   run. Calling the export route with any real session's data is structurally impossible; it was
   probed with a random id and correctly 404'd ("Not found"), which is the *best* case it can ever
   return for a session created by the current product.
Where: `src/app/api/quiz/export/route.ts` (dead), `src/app/(student)/student/quiz/results/[sessionId]/_components/ResultCtas.tsx` (no export affordance).
Recommendation: build export against `quiz_sessions` + `student_question_attempts` +
`quiz_session_keys` (server-side only, mirroring `/submit`'s grading read), wire it into
`ResultCtas.tsx`, and delete the v1 `api/quiz/*` routes so this class of drift can't recur.

**[S2-1] [RUNTIME] Same root cause as S1-1: student and faculty dashboards, and `/api/analytics`,
read quiz history from the dead v1 tables and will never show anything for a real quiz taken
today.** `src/app/(student)/student/dashboard/page.tsx:122-123` selects
`quiz_attempts` → `quizzes(title)` for the "recent quizzes" / "average score" widget;
`src/app/(faculty)/faculty/dashboard/page.tsx` and `src/app/api/analytics/route.ts:104-114,258-260`
do the same. Since `quiz_attempts`/`quizzes` are permanently empty (§S1-1), every student who
completes a quiz through the only reachable flow will see "No quizzes taken yet" on their own
dashboard forever, regardless of how many real, graded quiz sessions they've completed. This is
primarily a dashboard/AU-SHELL-surface bug (the dashboard code is out of AU-QUIZ's file scope),
flagged here because the cause is entirely on the AU-QUIZ side: the v2 engine migration never
updated its downstream readers. Recommend AU-SHELL corroborate against the live dashboard and
this finding be fixed as one unit with S1-1 (point every v1-table reader at `quiz_sessions`).

**[S2-2] [RUNTIME] `/api/assessment/submit` does not enforce the session's timer — a student can
submit an exam-sim paper an unbounded amount of time after it visibly expired.**
`src/app/api/assessment/answer/route.ts:126-134` has explicit, commented, server-side timer
enforcement ("A timed session's clock lives on the server..."). `src/app/api/assessment/submit/route.ts`
has no equivalent check anywhere in the file. Reproduced live: created a real exam-sim session
with `timeLimit: 1` (minute), waited the real 70 seconds for it to expire, confirmed `/answer`
correctly rejects a write at that point (`409 "Time is up for this session"`) — then called
`/submit` directly with a full 10-question answer payload and got **200**, a normal graded score
(8/20), no rejection at all. The client (`ExamRunner.tsx`) auto-submits on its own countdown via
`onExpire`, but that is enforcement by the client's goodwill only; per CLAUDE.md's own stated
philosophy ("never trust the client") and the sibling route's own design comment, this is exactly
the case server-side enforcement exists to close, and it is open on the route that actually
finalizes the grade. Exploit path requires no special tooling — pause/intercept the tab past the
visible deadline (a suspended laptop, a devtools breakpoint on the timer's callback, or simply a
slow network causing the client's own auto-submit to arrive late while the student keeps typing in
the meantime) and call submit whenever ready; the server will grade it as if on time. This defeats
the entire stated premise of exam-sim ("a BENCHMARK INSTRUMENT... timed... should not swing the
difficulty state" — presetes.ts's own comment), since the "timed" half is unenforced at the one
route that actually matters.
Where: `src/app/api/assessment/submit/route.ts` (missing check), pattern to copy from
`src/app/api/assessment/answer/route.ts:122-134`.
Recommendation: apply the identical `elapsed > limit*60 + grace` check in `/submit` before
grading, using the same session row already fetched. A late submit should either be rejected (409,
forcing the same "already answered, nothing further" UX as a completed session) or graded using
only the answers that were persisted via `/answer` before the deadline — never the client-supplied
late payload verbatim.

**[S2-3] [RUNTIME] `/api/assessment/submit` is not safe under concurrent double-submission —
two simultaneous calls both succeed and duplicate `student_question_attempts`.**
Fired two real, simultaneous `/submit` calls (`Promise.all`) at the same freshly-generated
session. Both returned **200** with identical scores; `student_question_attempts` ended up with
**10** rows for a 5-question session (should be 5 — one per question). The
`.eq("status","completed")`-guarded read-then-write in `submit/route.ts:82-85` has the same
check-then-act shape already flagged cross-cutting for `checkRateLimit` in the ledger, applied
here to session completion instead of a rate counter: both concurrent requests read
`status: "in_progress"` before either commits its own `status: "completed"` update, so neither is
turned away. Mastery did **not** visibly double-count in this specific run — but that is because
both concurrent calls happened to compute the identical delta from the same stale "before" state
(a classic lost-update race that happened to converge on the right number here, not a race that
was actually handled). A student's genuine double-tap on "Finish" or a slow-network retry after a
timeout (the client already anticipates a 409 for this and treats it as "already submitted" —
`PracticeRunner.tsx:191`) is exactly the trigger; the client-side `finishingRef.current` guard
covers the single-tab case, but not two tabs, or a retry racing the original request.
Where: `src/app/api/assessment/submit/route.ts:72-85` (status check) through `:124-153` (writes).
Recommendation: make the completion transition atomic — a conditional update
(`.update({status:"completed",...}).eq("id", session.id).eq("status","in_progress")`) checked for
`0` rows affected, treated the same as the existing "already completed" 409, before any grading or
attempt-insert work runs.

**[S2-4] [RUNTIME/UI] The `true_false` question type is completely unusable when it appears — zero
answer controls render, confirmed with a live screenshot.**
`typeHasOptions()` (`src/lib/assessment/types.ts:224-226`) deliberately excludes `true_false`
("No options" is even in the generator's own prompt instruction at `generator.ts:290`), so a
generated true_false question ships to the client with `options: null`
(confirmed in the real generate response: `{"type":"true_false","options":null,...}`).
`AnswerInput.tsx` has exactly one render path for a non-multi, non-numeric type — the
MCQ/MSQ/true_false branch at line 175 — and it does `options.map(...)`, i.e. it renders one button
per option letter. With zero options there is nothing to map, so **zero buttons render**.
Screenshotted live (`_audit_quiz/truefalse-desktop-light.png`): the question card shows the
"True / False" tag and the question text, then nothing — no way to select an answer, and "Check
answer" stays permanently disabled because `current.value` can never become non-null. (The
underlying grading logic itself is fine in isolation — a direct API call answering the literal
word `"True"` graded correctly — the bug is entirely that the UI has no way to produce that input.)
This type is not in any mode's *default* `questionTypes` (`MODE_CONFIG` in `presets.ts` never lists
it), so it is currently reachable only by a caller explicitly passing
`questionTypes: ["true_false"]` in the request body — which the routes accept without restriction
(`VALID_TYPES` in `routeHandler.ts` includes it). It becomes live-and-broken the moment anyone
(faculty tooling, a future preset, a curious student poking the API) requests it.
Where: `src/lib/assessment/types.ts:224-226` (`typeHasOptions`), `src/app/(student)/student/quiz/session/[sessionId]/_components/AnswerInput.tsx:174-244`.
Screenshots: `_audit_quiz/truefalse-{desktop,mobile}-{light,dark}.png` (all four confirm 0 option
buttons, 0 NAT input — `ui_truefalse.mts` log: `optionButtons=0 natInputs=0` on every combination).
Recommendation: either give `AnswerInput` a dedicated True/False branch (two buttons, no letters
needed), or stop generating this type until one exists — right now `typeHasOptions` and
`AnswerInput` disagree about who owns rendering it, and neither side handles it.

**[S2-5] [RUNTIME] The assessment engine has no subject-enrollment/scope check — a student can
generate and take a full graded quiz for a subject outside their branch/semester offering.**
Reproduced live: a CSE-sem3 student's `POST /api/assessment/quick` with
`subjectIds: ["43003036-…"]` (IDSH2020, "Mathematics III" — offered to a *different* branch/
semester per `subject_offerings`, not this student's) returned **200** with 5 real, freshly
AI-generated, gradeable MCQ questions. Grepped `src/lib/assessment/**` and
`src/app/api/assessment/**` for any reference to `subject_offerings` or the student's `branch` —
zero hits; no scope check exists anywhere in the engine. This is a known *class* of gap, not a
novel pattern: `src/lib/notes/access.ts`'s own doc comment explains it added exactly this check
(subject_offerings + branch) for Notes, and explicitly calls out that `/api/chat` has "no
subject-access check... a pre-existing gap, not a pattern worth copying into a new surface" — the
assessment engine, built after both of those, has the same gap as chat, silently. For a platform
whose stated positioning is "syllabus-locked" per subject, this lets any student pull graded
practice content (and burn the shared question bank / trigger real AI spend) for any subject on
the platform, department boundaries included.
Where: `src/lib/assessment/routeHandler.ts` (no scope check before `runAssessment`),
`src/lib/assessment/engine.ts` (`planAssessment` takes `subjectIds` on faith).
Recommendation: port `assertNotesSubjectAccess`'s pattern (or extract it to a shared helper) into
`handleAssessmentRequest`, checked once per requested `subjectId` before any bank/AI work happens.

**[S3-1] [RUNTIME] A SQL-injection-shaped `subjectIds` value causes an unhandled upstream failure
that dumps a raw HTML error page into server logs instead of a clean 400.**
`POST /api/assessment/quick` with `subjectIds: ["'; DROP TABLE quiz_sessions; --"]` returns a safe
generic `500 {"error":"Internal server error"}` to the client (no data exposure — this is not a SQL
injection risk, Supabase's query builder parameterizes correctly) — but the server log shows:
`[assessment/quick] Error: planAssessment: module lookup failed — <!DOCTYPE html>...` — the
`modules` query's error path (`engine.ts:220-228`) received an HTML error page (from PostgREST or
an edge gateway rejecting the malformed filter value) instead of a JSON error, and threw the raw
HTML body as its message. No secret was in the blob, but it is unbounded log noise on any
adversarial or simply malformed `subjectId`, and it means a real upstream failure here is
indistinguishable in the logs from "someone tried a SQL-ish string."
Where: `src/lib/assessment/engine.ts:220-228`.
Recommendation: validate `subjectIds` look like UUIDs before querying (a cheap regex is enough),
returning a clean 400 for anything else — the same defensive shape the route already applies to
`questionCount`/`questionTypes`.

## Notable positive confirmations (ran clean, no finding)

- Cross-student authorization: GET session / POST answer / POST submit against another real
  student's session all correctly return 403 (verified with two real harness students, not
  inferred from code).
- Resume mid-session: the CP-Q3 fix for "resume lands on the wrong question" genuinely works —
  answered slots and their feedback come back intact and complete on refetch.
- NAT grading (right and wrong), exam-sim's non-mutation of mastery, mode-gated feedback
  withholding, negative-marking config (`updatesMastery:false`, `immediateFeedback:false` for
  exam_sim) — all verified live, matching the code's documented invariants.
- `questionCount` boundary clamping (999999 → 20, the mode's real max) works without a crash/hang.
- Every real AI call this run was correctly cost-logged via `routeAI` with the right feature/task
  tags — no un-logged provider calls found.
