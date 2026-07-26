# NAT integrity — the two gates

*Decision record. Gate 1 landed in CP-Q1.5; gate 2 is binding on CP-Q2.*

## The failure this exists to prevent

CP-Q1 verification produced a NAT (numerical answer type) item on Cryptography's
classical-ciphers module. It asked how many unique letters appear in the ciphertext
of `ATTACKATDAWN` under the Vigenère key `CRYPTO`, gave the ciphertext as
`CTTCKWCTWCVN`, and answered 6 — correctly counting the unique letters of its own
**wrong** ciphertext (T+R is K, not T).

Wrong-but-confident is worse than a failed generation. A failed slot is visible and
recoverable; a plausible wrong answer is indistinguishable from a right one to
exactly the student who cannot check it, and GATE mode routes hardest through this
type. One publicly wrong answer to a real student costs more trust than the demo
recovers.

Two layered gates, because neither alone is sufficient: gating prevents the
pathology at its source but cannot judge an individual question; verification
catches individual errors but cannot stop a module that should never have hosted a
NAT question from producing contrived ones.

---

## Gate 1 — module quantitative profile *(landed: CP-Q1.5)*

### The keyword heuristic was tested and rejected

The first proposal was to infer quantitativeness from `modules.description` —
verbs like solve/derive/calculate/compute plus numeric operators. Probed over 20
real seeded modules across three subjects:

| module | verdict |
|---|---|
| SOEEC1010 M1 — Ohm's Law, KCL/KVL, mesh analysis | not quantitative |
| SOEEC1010 M2 — RMS values, phasors, impedance | not quantitative |
| SOEEC1010 M5 — number systems, binary arithmetic, K-maps | not quantitative |
| IDSH2020 M5 — Mathematical Logic and Proofs | **quantitative** (off the word "Proof") |
| SECE3260 M2 — Vigenère, Playfair | not quantitative |

One of 20 classified quantitative, and that one wrongly. The cause is structural,
not tunable: **`modules.description` is a topic list, not a task list.** A syllabus
states what is covered, never what a student does with it, so "Impedance and Power
Factor" contains no verb and never will. A heuristic over that text would degrade
essentially every NAT slot to MCQ — silently disabling GATE mode, a worse failure
than the one being fixed.

### What was built instead

A persisted per-module judgement on `modules`: `quant_profile`
(`quantitative` | `conceptual` | NULL), `quant_confidence`, `quant_source`
(`ai_classified` | `faculty_verified`), `quant_classified_at`
(`20260726000000_module_quant_profile.sql`).

Populated by `src/lib/assessment/quantClassifier.ts` — dual-pass Flash, the §17
rule for high-stakes AI judgement, structurally mirroring
`qpaper/moduleCoClassifier.ts`. One extra input that classifier does not have:
**up to 5 real bank questions per module**, because questions reveal task shape
exactly where topic lists hide it.

Dual-pass resolution: agreement keeps the label at the *lower* of the two
confidences; disagreement resolves to `quantitative` at confidence `low`. That is
the binary analogue of the CO classifier's union-with-force-low — union means the
more inclusive answer — and it fails in the recoverable direction, since gate 2
re-checks every numeric answer while a wrongly-conceptual call silently deletes a
question type with no signal.

`faculty_verified` rows are never touched by a re-run, matching
`module_co_mapping` semantics. The faculty edit surface is CP-Q4; the column
contract exists now so the skip is enforceable rather than retrofitted.

### Refusal semantics in `planAssessment`

1. **Relocate first.** A NAT slot on a conceptual module swaps *types* with a
   non-NAT slot on an eligible module. The two slots trade types, never modules —
   module assignment came from syllabus weightage and must not move (§12), so
   weightage compliance is untouched and the student still gets the NAT count
   they asked for.
2. **Degrade only the remainder.** When eligible modules cannot absorb the demand,
   the excess becomes MCQ.

Reported on `SourcingSummary.natDegraded` as
`{ requested, delivered, reason, affectedModules }`, where reason is
`conceptual_module_refusal` (relocated, count preserved) or
`insufficient_quantitative_modules` (count reduced). Under the GATE preset a
shortfall also raises a plan-level warning: a GATE paper under-weighted on NAT is
not representative, and the caller must be told rather than quietly served one.

**Unclassified (NULL) allows NAT.** Blocking it would disable GATE for every
subject until a backfill completed. Gate 2 is the backstop.

---

## Gate 2 — per-item verification *(binding on CP-Q2, not built)*

Every generated NAT item gets a second, cheap Flash call before it is served.

- **Task** `nat_verify` — add to `router.ts` → `flash`, to the `isStructuredTask`
  allowlist in `gemini.ts`, `thinkingBudget: 0`, narrow responseSchema, and an
  explicit prompt-level word ceiling on the free-text field (the §19 rule, which
  the NAT explanation runaway itself produced).
- **Schema field order is load-bearing.** A model shown a claimed answer agrees
  with it. Constrained decoding generates fields in schema order, so the verifier's
  own working and `actual_answer` must be emitted **before** `verified` — it
  solves, then judges, rather than judging and backfilling a justification.
- **Failure semantics:** mismatch → discard the question, return its slot in
  `failed[]`. Never "correct" the answer in place; a verifier that rewrites keys is
  a second unverified generator.
- **Cost, measured not estimated.** CP-Q1's `quiz_gen_v2` calls ran ₹0.11–0.13
  each, but carry the full syllabus (~1.9k input tokens). A verifier call carries
  none: ~350 in / ~90 out ≈ **₹0.03 per NAT item**, ~₹0.19 on a 6-NAT GATE quiz.
  For comparison, one truncated batch during CP-Q1 cost ₹0.55 on its own.

**Do not ship Mastery or Exam-Sim with the GATE preset before gate 2 exists.**
Gate 1 stops NAT being posed where it makes no sense; only gate 2 catches a
plausible-looking wrong number on a module where NAT genuinely belongs.
