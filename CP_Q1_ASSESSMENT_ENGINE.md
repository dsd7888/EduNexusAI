# CP-Q1 — Assessment Engine: architecture note

*One page. Read before CP-Q2 builds modes on top.*

## What this replaces, and why it had to be replaced

`/api/quiz/generate` asks Flash for the entire quiz in **one 8k-token call**, over
`combinedSyllabus.slice(0, 2000)`, then stores the result against the first module of
the primary subject with `"mixed"` difficulty flattened to `"medium"`. Every property
a student quiz is supposed to have — syllabus coverage, module weighting, difficulty
mix, multi-subject scope — is *asserted in a prompt* rather than *enforced in code*,
and all of them fail silently. It caps out around 20 questions and cannot span
subjects at all: the second subject's syllabus is deleted by the slice.

The engine's premise is the opposite: **decide everything in code before any model is
called, and let the AI only write prose for decisions already made.** That is not a
new idea in this codebase — it is the Q paper generator's founding principle (§12,
"Module assignment computed in code — AI never picks modules"). CP-Q1 carries it to
the student side.

## The two lineages, and what each contributed

The engine is the join of two systems that already work in production.

**From Q PAPER — deterministic allocation.** A request becomes a list of
`QuestionSlot`s before anything else happens. Question count is apportioned across
subjects, then across each subject's modules by `weightage_percent`, using
largest-remainder (Hamilton) apportionment — the same method as
`allocateSlotSources` (`qpaper/sourcing.ts`) and `distributeMcqsAcrossModules`
(`qpaper/moduleAssignment.ts`), re-exported here in general form as `apportion()`
because those two are private and keyed on qpaper's own template types. Difficulty
uses the same Hamilton-plus-greedy-spread as `apportionDifficulty`; `targetCo` uses
the under-served-CO ledger from `makePicker`'s `targetCoFor`. Every reuse site cites
its source file. Weightage compliance in a 100-question, 3-subject quiz is now
arithmetic, verifiable by reading the plan — see the verification output, where a
5/15/30 weightage produced exactly 3/9/18 slots.

**From PLACEMENT — bank-first serving with memory.** Before generation, every slot is
offered to `faculty_question_bank`, ordered `is_verified DESC, usage_count ASC,
RANDOM()`, with any question the student has attempted in the last 30 days excluded.
Whatever the AI does generate is written back to the same bank as
`source='ai_generated', is_verified=false`, so the second student to request that
module pays nothing and a faculty member can promote a good AI question by verifying
it. This is placement's bank-first-with-write-through loop (§16), pointed at the
faculty bank instead of a placement-only table.

**Where the two lineages genuinely differ, and why bankFill is a sibling file, not a
shared function:** a Q paper slot matches on type **and marks** — a 10-mark slot
cannot take a 2-mark question. A quiz slot's marks come from the *mode*, not from the
question, so marks are not a matching criterion at all; the key is
`(subject, module, type, difficulty)`. Same pattern, different matching key. Merging
them would produce a function whose parameters are mostly about which half you are.

## What the schema change actually is

`placement_question_attempts` and `placement_topic_mastery` proved their shape but are
keyed on a text `track`/`topic`. `student_question_attempts` and
`student_topic_mastery` are the same tables keyed on the real syllabus coordinate
`(subject_id, module_id)`, plus `quiz_sessions` to hold a run. **Nothing is dropped**
— placement keeps its tables and is not migrated onto these in this checkpoint.

Two decisions on the attempts table are load-bearing: `question_id` is nullable and
paired with `source`, so recording an attempt never depends on the bank write
succeeding; and `question_text`/`question_type` are denormalised onto the row, so a
student's history survives the owning faculty editing or deleting the bank question.
`faculty_question_bank` also gains `'msq'`/`'nat'` as legal types and nullable
`numeric_answer`/`numeric_tolerance` columns — a NAT question whose tolerance is lost
on write-through is not reusable, which would defeat the write-through.

## Generation: three properties, three fixed bugs

1. **Batches of 5, four in flight.** The proven Flash structured-output window (§11
   Q Bank, §19 PPT batches). Cost and latency now scale with question count instead
   of the request falling off a truncation cliff at ~20.
2. **Full syllabus, never truncated.** Each batch is scoped to one subject and
   receives that subject's complete syllabus text. Batching is what makes this
   affordable — no single call ever carries three syllabi.
3. **responseSchema narrowed per question type.** `options` exists in the schema only
   for MCQ/MSQ; `numeric_answer`/`numeric_tolerance` only for NAT (and required
   there). This is why batches group by `(subject, type)` and not by subject alone —
   §19: irrelevant optional fields remove the model's stopping pressure and cost real
   money. `thinkingBudget: 0` throughout, and `quiz_gen_v2` is in the
   `isStructuredTask` allowlist as defence in depth.

Failure is surfaced, never absorbed: a batch that fails to parse returns its slots in
`failed[]` with a reason. **The engine will not silently hand back a short quiz** —
whether to proceed with 27 of 30 is the caller's decision.

One tuning note earned during verification: a single-NAT batch blew its output budget
because the model narrated the arithmetic twice inside `explanation`. Schema
`maxLength` did not restrain it; a prompt-level "≤60 words, state the steps and stop"
did. Same shape as §19's `VIZ_SIZE_CONTRACT` — when constrained decoding has no
stopping pressure, the prompt is the only ceiling that binds.

## The two new question types

`'msq'` (2–3 correct of 4–5; `correctAnswer` is pipe-separated option **letters**,
because grading is an exact set comparison and matching on option text breaks the
moment an option is reworded) and `'nat'` (no options; `numericTolerance` is a
percentage, GATE convention). Both extend `QuizQuestion["type"]` by derivation rather
than by editing `quiz/generator.ts`, so the existing route is untouched and the two
unions cannot drift.

## What CP-Q2 layers on top

The engine deliberately stops at "here are the questions". CP-Q2 adds:

- **Mode routing** — `quick` / `mastery` / `exam_sim` become thin config over
  `planAssessment`: they choose scope (modules vs whole subject), count, marks and
  time limit. They should add no new allocation logic; if a mode needs some, that is
  a signal the engine is missing a parameter.
- **Session state** — create the `quiz_sessions` row, persist per-question attempts,
  drive the timer, handle resume/abandon. `student_question_attempts` is already
  shaped for it; the 30-day exclusion starts working the moment attempts are written.
- **The adaptive difficulty UPDATE half.** `planAssessment` already *reads*
  `student_topic_mastery.current_difficulty`; nothing writes it yet, so `'adaptive'`
  currently resolves to `'easy'` everywhere. CP-Q2 adds the post-submit recompute
  using placement's proven thresholds (§16: promote at ≥70% accuracy with ≥10
  attempts and ≥2 sessions; demote below 40% with ≥5 attempts). Until that lands,
  `'adaptive'` is wired but inert — by design, not by omission.
- **Attempt recording on served bank questions** (`usage_count` / `last_used_at`
  bump), which the engine returns `usedBankIds` for but does not perform.

CP-Q3 then swaps `/api/quiz/generate` onto the engine and retires the truncating
path. Until then the old route keeps serving the current UI, untouched.
