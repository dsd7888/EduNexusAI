# CP-Q2 — Modes, grading, and the NAT verifier

*Acceptance record. The probe numbers in §5 are the evidence this checkpoint
stands on.*

---

## 1. Gate 2 — the verifier

Every NAT item is verified before it reaches a student. No sampling, no
best-effort, no pass-through on error. This is not defensive over-engineering:
CP-Q1.5 established that gate 1 classifies the Vigenère module as *quantitative
at high confidence*, so the module-level gate never sees the item that started
this work. Gate 2 is the only thing between a student and a confidently wrong
number.

### Two anti-anchoring mechanisms

A model shown a claimed answer agrees with it. Both defences are structural, not
exhortative:

1. **Schema field order.** Constrained decoding emits fields in declaration
   order, so the schema is `working → computed_answer → reason → verified`. The
   verdict is produced with the verifier's own number already in context. Put
   `verified` first and the model opens with a judgement and backfills a
   rationale for it. **Reordering `NAT_VERIFY_SCHEMA` silently disables half the
   design** — the file says so at the definition.
2. **Prompt position.** The claimed answer is the last thing in the prompt, after
   the task instructions, with an explicit "do not read it until `working` and
   `computed_answer` are written, and do not revise afterwards — if they
   disagree, that disagreement is the finding."

### `verified` is advisory; the number is authoritative

An item is discarded if `verified === false` **or** the relative difference
exceeds 0.1%. Trusting the boolean alone would reintroduce, at the very last
field, the exact anchoring failure the rest of the design prevents.

Every verdict emits a structured agreement line:

```json
{"task":"nat_verify","bool_says":true,"numeric_says":true,"agreed":true,"slot_id":"S12","relative_difference":0.0}
```

`NatVerifyResult.agreement` aggregates it. This is the longitudinal signal for
whether the boolean is stably advisory (→ a future checkpoint could drop the
numeric check for cheaper calls) or drifting (→ escalate persistent
disagreements to Pro). **Observed so far: 35 comparisons, 35 agreements, 0
disagreements in either direction.** One clean run is not a trend; the counter
exists so this can be re-read in a month.

### Tolerance

```
|computed − claimed| / max(|claimed|, |computed|, 1e-9) > 0.001  → discard
```

Symmetric in both magnitudes, so the zero-answer hole is closed in both
directions (a verifier computing 0 against a claim of 1e-15 fails the same way a
claim of 0 does). The bias is toward discard, deliberately: a NAT whose answer is
zero is unusual and usually a trick framing, and losing it is cheaper than
serving it wrong.

**This is not the same quantity as `AssessmentQuestion.numericTolerance`**, and
both constants now carry a comment pointing at the other. The question-facing
tolerance is *pedagogical* — how much rounding a student may do. This one is
*numerical* — whether two machines computed the same thing at all. A question can
legitimately allow a student ±2% while a 2% generator/verifier gap means they
solved different problems.

### Never repair

The system prompt forbids improving, rewriting, or replacing the question. **A
verifier that corrects answers is a second unaudited generator wearing the
authority of a check it never received.** This generalises past NAT to any
AI-judge pattern in the product: verifiers verify, they never repair.

### Discard semantics

| condition | outcome |
|---|---|
| call errored / timed out / unparseable | `verifier_error` → discard |
| `verified === false` | `verifier_rejected` → discard |
| numbers differ > 0.1% | `answer_mismatch` → discard |
| item had no finite numeric answer | `malformed_item` → discard |

Discards surface in `failed[]` with `reason: 'nat_verify_discard'` and the detail
line (`verifier computed X, item claimed Y`). **Discarded NAT items are never
written to `faculty_question_bank`** — `generateFreshQuestions` deliberately
excludes NAT from its write-through, and only verified items are written
afterwards by the runner. A wrong NAT in the bank is served free to every future
student, forever; the write-through that makes the bank valuable is exactly what
makes a bad row expensive.

---

## 2. Mode-specific mastery semantics

| | quick | mastery | exam_sim |
|---|---|---|---|
| default / range | 10 (5–20) | 20 (10–30) | 50 (10–100) |
| difficulty | mixed | **adaptive** | mixed |
| feedback | immediate | immediate | deferred |
| multi-subject | no | no | yes |
| rate limit | 20/day (shared with mastery) | 20/day (shared) | **3/day** |
| records attempts | yes | yes | **yes** |
| **updates mastery** | **yes** | **yes** | **no** |

`exam_sim` records every attempt — that history is real and feeds the 30-day bank
exclusion — but does not move `student_topic_mastery`. It is a **benchmark
instrument, not a practice loop**: letting one bad afternoon on a timed,
negatively-marked 100-question mock swing per-module difficulty would make the
adaptive signal noisier than the thing it measures.

The 3/day exam-sim cap is a **cost guard**, not a UX choice: a full GATE mock is
the most expensive action a student can trigger (measured below).

Difficulty transitions mirror placement §16 exactly — promote at ≥70% accuracy
with ≥10 attempts and ≥2 sessions, demote below 40% with ≥5 attempts, one rung at
a time. Verified by an exhaustive threshold table plus a live promotion (§5).

---

## 3. GATE preset, as implemented

```
label            GATE Mock
questionCount    65          timeLimit  180 min
typeDistribution mcq 35 / msq 15 / nat 15   ← EXACT, not Hamilton
difficulty       mixed
marksRule        gate_standard  → Q1–25 = 1 mark, Q26–65 = 2 marks (105 total)
negativeMarking  gate_standard  → −1/3 of the question's marks on MCQ/MSQ, 0 on NAT
mode             exam_sim
```

`planAssessment` gained a `typeDistribution` path that assigns exact per-type
counts; custom presets still fall through to the index cycle. Marks are applied
**after** the NAT gate and by **position**, not type — a slot degraded from NAT
to MCQ must be re-priced, and GATE prices by question number regardless of type.

Difficulty still deals round-robin across the *assigned* type groups, so §17's
resonance rule holds on the exact-distribution path too, not just the cycling one.

When a subject cannot sustain 15 NAT slots the plan returns
`"This subject has limited quantitative coverage; only N NAT items generated…
Consider a different subject for full GATE mock."` — actionable, not a silent
degrade.

**⚠ One deliberate deviation from real GATE:** actual GATE applies **no** negative
marking to MSQ (that is why MSQ exists — the all-or-nothing key is the penalty).
The CP-Q2 spec called for −1/3 on MCQ *and* MSQ, so that is what ships. If
GATE-authentic scoring was the intent, `negativeMarksFor` in `presets.ts` is a
one-line change (MSQ returns 0) and nothing else moves.

---

## 4. Session state

`quiz_sessions` is written at plan time with `status='in_progress'` and the full
paper in `config`. Submit grades from the stored key, writes one
`student_question_attempts` row per answer with **`is_correct` computed
server-side** (the client sends only what the student typed), bumps bank usage
counters, updates mastery for the practice modes, and closes the session.

`GET /api/assessment/session/[id]` resumes: a student who refreshes rejoins the
same questions instead of triggering a regeneration that would cost money *and*
burn bank questions the 30-day exclusion exists to protect. There is no partial
submit in CP-Q2 — a session is finished or abandoned.

`/api/cron/abandon-stale-assessments` (every 6h) marks `in_progress` sessions
older than 4h `abandoned`. **Attempts are left intact** — abandoning a session
discards the session, never the evidence.

**⚠ KNOWN ISSUE, deferred deliberately: the answer key lives in
`quiz_sessions.config.key`, and `quiz_sessions` has a student SELECT policy.**
Every route reads through the admin client and strips the key, so nothing leaks
through the API — but a student querying the table directly with the browser
client can read their own row, which for a deferred-feedback exam_sim is an
integrity hole. CP-Q2's spec forbade schema changes, hence the deferral. CP-Q3
should either move the key to a table with no student SELECT policy, or drop that
policy in favour of API-only access (the resume route covers every legitimate
read). The warning is repeated at `createSession` in `runner.ts`.

---

## 5. Acceptance evidence

Full harness: `_cp_q2_verify/verify.ts`. Self-cleaning — verified afterwards that
`quiz_sessions`, `student_topic_mastery`, `student_question_attempts` are all 0
rows, `faculty_question_bank` back to its 15-row baseline, 0 modules carrying
quant state.

### The probe — does gate 2 catch what gate 1 misses?

10 iterations each, both modules forced NAT-eligible so the probe tests gate 2 in
isolation:

| target | discard rate |
|---|---|
| **Vigenère** — SECE3260 M2, Classical Cryptography Techniques | **10.0%** (1/10) |
| **Borderline** — SOEEC1010 M4, Semiconductor Devices and Analog Electronics | **30.0%** (3/10) |

**Gate 2 works, and the failure it catches is not Vigenère-specific — it is worse
on marginally-quantitative content.** That is the opposite of the comfortable
result. Two probe points were the minimum to distinguish those hypotheses and
they came back distinguishable.

The three borderline discards are qualitatively different from each other, and
this matters more than the headline number:

1. `claimed 9.3, verifier 10 — "the forward voltage drop is irrelevant for PIV"`
   — **a genuine physics error** in the generated answer. Exactly the target.
2. `claimed 10, verifier 9.3 — "assuming a center-tapped full-wave rectifier"`
   — **an ambiguous question**: two competent readings give two numbers. Caught by
   the ambiguity clause, correctly, since an examinable question has one answer.
3. `claimed 2.95, verifier 2.96 — "very close… slight difference is due to
   rounding"` — **over-strict**. 0.34% exceeds the 0.1% floor, and the verifier
   said in words that it agreed. This is the tolerance being conservative, not a
   wrong answer.

So 30% is **not** 30% wrong answers: roughly one genuine error, one bad question,
one over-strict rounding call. All three are defensible discards for a
correctness gate — losing a good question is cheap, serving a wrong one is not —
but case 3 is the one to watch. If the over-strict share grows, the lever is the
tolerance floor, not the verifier prompt.

The 10% Vigenère discard was also a real catch: `claimed 10, verifier 9 — "the
keyword has 9 unique letters"`.

### Full GATE mock (65Q, live)

```
PLAN      slots=65  byType={"mcq":35,"msq":15,"nat":15}
          marks Q1=1M Q25=1M Q26=2M Q65=2M  total=105M
          natDegraded {"requested":15,"delivered":15,"reason":null}
DELIVERED 63/65  byType={"mcq":35,"msq":15,"nat":13}  totalMarks=102
          fromBank=18  fromAi=45
NAT       verified=13  discarded=2  agreement 15/15 agreed
FAILED    S3  nat  nat_verify_discard — verifier_rejected (verifier 0, claimed 100)
          S55 nat  nat_verify_discard — verifier_rejected (verifier 0, claimed 26.67)
```

NAT discard rate on the live mock: **13.3%** (2/15) — between the two probe
figures, as expected for a whole-subject spread. The paper comes back 63/65 with
the shortfall named rather than hidden.

### Modes

- **(a) quick** — 10Q, all fresh, 7/10 scripted → 5 mastery deltas written.
  `updatesMastery` honoured.
- **(b) mastery** — 20Q adaptive, `adaptiveApplied=true`, 5 from bank / 15 fresh,
  scripted 80% → 6 mastery rows. **0 promotions, correctly**: no single module
  reached 10 attempts.
- **(b2) promotion** — exhaustive `nextDifficulty()` table (9 cases: each
  threshold, both ceilings, both floors) plus a live single-module session:
  `attempts 9→19, accuracy 100%, difficulty easy→medium ⬆ PROMOTED`.
- **(e) abandonment** — session backdated 5h, cron marked it `abandoned`, its
  attempt row survived.

### Cost, measured

| task | calls | ₹ | per call |
|---|---|---|---|
| `quiz_gen_v2` | 35 | 8.41 | ₹0.24 |
| `nat_verify` | 35 | 1.45 | **₹0.041** |

Only those two tasks appeared in `ai_call_logs` for the run — no lazy
`module_quant_classify` leaked into the request path, which is the intended
behaviour (classification is a pre-run backfill, never on-demand).

Verifier cost came in at **₹0.041 per NAT item** against the ₹0.03 estimate in
`CP_Q2_NAT_INTEGRITY.md` — 37% over, still ~17% of what generating the item cost,
and ~₹0.6 on a full 15-NAT GATE mock. The estimate was close enough that no
budget decision changes.
