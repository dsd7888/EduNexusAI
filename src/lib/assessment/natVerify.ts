/**
 * Gate 2 — per-item NAT verification (CP-Q2).
 *
 * WHY THIS IS THE PRIMARY CORRECTNESS SIGNAL, not a long-stop. CP-Q1.5's
 * harness settled this empirically: gate 1 classified SECE3260 M2 ("Classical
 * Cryptography Techniques") as quantitative at HIGH confidence — and that is
 * precisely the module that produced the wrong Vigenère NAT item which started
 * this whole line of work. Gate 1 catches the CATEGORY error (a numeric question
 * posed over a protocols/architecture module); it cannot catch the INSTANCE
 * error (a numeric question posed over a legitimately quantitative module, whose
 * stated answer is simply wrong). Nothing else does. So:
 *
 *   · EVERY NAT item is verified. No sampling.
 *   · A verifier that errors, times out, or returns unparseable output DISCARDS
 *     the item. There is no pass-through on error — "we couldn't check it" and
 *     "it's correct" must never collapse into the same outcome.
 *   · A discarded item is NEVER written to faculty_question_bank. A wrong NAT
 *     in the bank is served to every future student for free, forever; the
 *     write-through that makes the bank valuable is exactly what makes a bad
 *     row expensive.
 *
 * TWO ANTI-ANCHORING MECHANISMS, both load-bearing (a model shown a claimed
 * answer agrees with it):
 *
 *   1. SCHEMA FIELD ORDER. Constrained decoding emits fields in schema order,
 *      so `working` and `computed_answer` are generated BEFORE `reason` and
 *      `verified`. The verdict is produced with the verifier's own number
 *      already in its context — it judges after solving, rather than opening
 *      with a verdict and backfilling a justification for it.
 *   2. PROMPT POSITION. The claimed answer appears at the very END of the
 *      prompt, after the task instructions, and the instructions explicitly say
 *      not to read it until the first two fields are written. Ordering the
 *      prompt this way reduces anchoring before the schema mechanism even
 *      applies.
 *
 * The verifier never CORRECTS an answer. A verifier that rewrites keys is just
 * a second unverified generator, and its output would carry the authority of a
 * check it never received.
 */

import { routeAI } from "@/lib/ai/router";
import {
  MATH_CHEM_NOTATION_GUIDE,
  hasLatex,
  repairGeminiJsonEscapes,
} from "@/lib/text/latexSegments";
import { classifySubjectFamily } from "@/lib/qpaper/archetypes";
import type { AILogContext } from "@/lib/ai/providers/types";
import type { AssessmentQuestion } from "./types";
import type { AssessmentSubjectContext } from "./generator";

/**
 * Floating-point noise tolerance for the verifier↔generator comparison.
 *
 * DELIBERATELY INDEPENDENT of the question's student-facing
 * `numericTolerance`. That one is pedagogical — it decides how much rounding a
 * STUDENT is allowed. This one is numerical — it decides whether two machines
 * computing the same quantity agree. A question may legitimately allow a
 * student ±2%, but if the verifier and the generator differ by 2% they have
 * computed different things and the item is not trustworthy.
 */
export const NAT_FP_TOLERANCE = 0.001; // 0.1%
// ⚠ NOT the same thing as AssessmentQuestion.numericTolerance (see types.ts,
// which carries the mirror of this note). They look like duplicate constants
// and are not: a "consolidate duplicate constants" refactor that merges them
// breaks both jobs at once.

/** Longest module-context excerpt fed to the verifier. */
const MODULE_CONTEXT_CHARS = 300;

/** Verifier calls in flight at once. */
const CONCURRENCY = 4;

// ─── Schema — FIELD ORDER IS THE MECHANISM, DO NOT REORDER ─────────────────

/**
 * `working` → `computed_answer` → `reason` → `verified`.
 *
 * Reordering this object silently removes half of the anti-anchoring design:
 * put `verified` first and the model emits a verdict before it has computed
 * anything, then rationalises. Both `required` and `properties` are kept in the
 * same order (Gemini follows the property declaration order).
 */
export const NAT_VERIFY_SCHEMA = {
  type: "object",
  properties: {
    working: {
      type: "string",
      maxLength: 500,
      description:
        "Your OWN step-by-step solution, at most 60 words. Write this first, before looking at any claimed answer.",
    },
    computed_answer: {
      type: "number",
      description: "The number YOUR working arrives at.",
    },
    reason: {
      type: "string",
      maxLength: 200,
      description:
        "At most 25 words: why your answer agrees or disagrees with the claimed one.",
    },
    verified: {
      type: "boolean",
      description:
        "True only if the claimed answer matches your computed answer.",
    },
  },
  required: ["working", "computed_answer", "reason", "verified"],
};

export const NAT_VERIFY_SYSTEM_PROMPT =
  "You are grading a numerical answer. First solve the problem independently, " +
  "then compare.\n\n" +
  "You are a subject expert checking one Numerical Answer Type (NAT) question " +
  "written for an Indian engineering university exam. Your job is NOT to " +
  "improve the question, rewrite it, or suggest a better one. Your only job is " +
  "to establish whether its stated answer is the correct one.\n\n" +
  "Solve the problem yourself, from the question text alone. Then — and only " +
  "then — compare your result with the answer that was claimed.\n\n" +
  "Judge the NUMBER, not the presentation. A different unit, a different " +
  "rounding, or different wording is only a mismatch if the underlying quantity " +
  "differs. If the question is ambiguous enough that two competent readings give " +
  "two different numbers, that is NOT verified: an examinable question has one " +
  "answer.\n\n" +
  "Never adjust your own computed answer to agree with the claim. If you cannot " +
  "solve the question from the information given, say so in `reason` and set " +
  "verified to false.";

export interface NatVerifyInput {
  /** The question as a student would see it. */
  questionText: string;
  /** The generator's stated answer (the thing under test). */
  claimedAnswer: number;
  subjectName: string;
  moduleName: string | null;
  /** Module-scoped syllabus excerpt — NOT the full syllabus (cost bound). */
  moduleContext: string;
  /** Include the notation guide (math/chem subjects only). */
  mathChem: boolean;
}

/**
 * Build the verifier prompt.
 *
 * Structure is deliberate, top to bottom:
 *   context → the question → your task (with the "don't look yet" instruction)
 *   → the claimed answer, LAST.
 */
export function buildNatVerifyPrompt(input: NatVerifyInput): string {
  const {
    questionText,
    claimedAnswer,
    subjectName,
    moduleName,
    moduleContext,
    mathChem,
  } = input;

  const notation = mathChem
    ? `\n<notation>
${MATH_CHEM_NOTATION_GUIDE}
</notation>\n`
    : "";

  return `<context>
Subject: ${subjectName}
Module: ${moduleName ?? "(not specified)"}
Module covers: ${moduleContext || "(no topic detail recorded)"}
</context>
${notation}
<question>
${questionText}
</question>

<your_task>
1. Solve the question above yourself, using only the question text and the
   context. Write your steps in "working" — at most 60 WORDS. State the
   arithmetic, not the reasoning about the arithmetic.
2. Put the number your working arrives at in "computed_answer".
3. ONLY AFTER those two fields are written, read the claimed answer at the
   bottom of this prompt and compare it with your own.
4. In "reason", say in at most 25 WORDS why the two agree or disagree.
5. Set "verified" true only if the claimed answer is the same quantity as your
   computed answer.

Do NOT read the claimed answer until you have written your own working and
computed_answer. Do NOT revise your computed_answer after reading it — if they
disagree, that disagreement is the finding.
</your_task>

<claimed_answer>
${claimedAnswer}
</claimed_answer>`;
}

// ─── Verification ──────────────────────────────────────────────────────────

export type NatDiscardReason =
  /** Call failed, timed out, or returned output that would not parse. */
  | "verifier_error"
  /** The verifier solved it and disagreed. */
  | "verifier_rejected"
  /** The verifier said "verified" but its own number disagrees past 0.1%. */
  | "answer_mismatch"
  /** The item was malformed before verification (no numeric answer at all). */
  | "malformed_item";

export interface NatVerifyOutcome {
  slotId: string;
  passed: boolean;
  /** The verifier's own `verified` boolean, kept even when the numeric check
   *  overrules it — this is what the agreement counter is computed from. */
  boolSays?: boolean;
  /** Whether the 0.1% numeric check passed. */
  numericSays?: boolean;
  discardReason?: NatDiscardReason;
  /** The verifier's own answer, when it produced one. */
  computedAnswer?: number;
  claimedAnswer?: number;
  /** Relative difference actually observed, for the discard-rate report. */
  relativeDifference?: number;
  working?: string;
  reason?: string;
}

/**
 * Boolean-vs-numeric agreement counters over one verification batch. See the
 * structured log line in verifyNatQuestion for why this is tracked.
 */
export interface NatVerifyAgreementStats {
  /** Verdicts where both signals were available. */
  compared: number;
  agreed: number;
  /** verified=true but the numbers differ past 0.1% — the anchoring failure. */
  boolTrueNumericFalse: number;
  /** verified=false but the numbers agree — over-strict or a bad-question call. */
  boolFalseNumericTrue: number;
}

export interface NatVerifyResult {
  kept: AssessmentQuestion[];
  discarded: Array<{ question: AssessmentQuestion; outcome: NatVerifyOutcome }>;
  outcomes: NatVerifyOutcome[];
  agreement: NatVerifyAgreementStats;
}

interface RawVerdict {
  working?: unknown;
  computed_answer?: unknown;
  reason?: unknown;
  verified?: unknown;
}

/** Module-scoped excerpt: the module's own topic list, capped. */
function moduleContextFor(
  ctx: AssessmentSubjectContext,
  moduleId: string | null
): string {
  const mod = moduleId ? ctx.modules.find((m) => m.id === moduleId) : undefined;
  const text = (mod?.description ?? "").replace(/\s+/g, " ").trim();
  return text.length > MODULE_CONTEXT_CHARS
    ? `${text.slice(0, MODULE_CONTEXT_CHARS)}…`
    : text;
}

/** Verify ONE NAT question. Never throws — a thrown verifier is a discard. */
export async function verifyNatQuestion(
  question: AssessmentQuestion,
  ctx: AssessmentSubjectContext,
  logContext: AILogContext
): Promise<NatVerifyOutcome> {
  const claimed =
    typeof question.numericAnswer === "number" &&
    Number.isFinite(question.numericAnswer)
      ? question.numericAnswer
      : Number(question.correctAnswer);

  if (!Number.isFinite(claimed)) {
    return {
      slotId: question.slotId,
      passed: false,
      discardReason: "malformed_item",
      reason: "item carried no finite numeric answer to check",
    };
  }

  const mod = question.moduleId
    ? ctx.modules.find((m) => m.id === question.moduleId)
    : undefined;

  const prompt = buildNatVerifyPrompt({
    questionText: question.question,
    claimedAnswer: claimed,
    subjectName: ctx.subjectName,
    moduleName: mod?.name ?? null,
    moduleContext: moduleContextFor(ctx, question.moduleId),
    mathChem:
      ctx.mathChem ||
      classifySubjectFamily(ctx.subjectName, ctx.subjectCode ?? undefined) !==
        null ||
      hasLatex(mod?.description ?? ""),
  });

  let raw: RawVerdict;
  try {
    const res = await routeAI("nat_verify", {
      model: "flash",
      messages: [{ role: "user", content: prompt }],
      systemPrompt: NAT_VERIFY_SYSTEM_PROMPT,
      // The verifier must be as deterministic as the check it performs.
      temperature: 0,
      responseSchema: NAT_VERIFY_SCHEMA,
      thinkingBudget: 0,
      maxTokens: 1024,
      logContext: {
        ...logContext,
        subjectId: ctx.subjectId,
        subjectCode: ctx.subjectCode,
        metadata: {
          ...(logContext.metadata ?? {}),
          slotId: question.slotId,
          moduleId: question.moduleId,
        },
      },
    });
    // §13: repair the Gemini escape collision before parsing — the verifier
    // echoes the question's own LaTeX back in its reasoning field.
    const parsed = JSON.parse(
      repairGeminiJsonEscapes(String(res.content ?? "")),
    ) as unknown;
    if (!parsed || typeof parsed !== "object") {
      throw new Error("verdict was not an object");
    }
    raw = parsed as RawVerdict;
  } catch (err) {
    // Call failure, timeout, or unparseable output. "Could not check" is NOT
    // "correct" — discard.
    console.warn(
      `[natVerify] ${question.slotId}: verifier unavailable — discarding. ${
        err instanceof Error ? err.message : "unknown error"
      }`
    );
    return {
      slotId: question.slotId,
      passed: false,
      discardReason: "verifier_error",
      claimedAnswer: claimed,
      reason: err instanceof Error ? err.message : "verifier error",
    };
  }

  const computed = Number(raw.computed_answer);
  const working = typeof raw.working === "string" ? raw.working : undefined;
  const reason = typeof raw.reason === "string" ? raw.reason : undefined;
  const verified = raw.verified === true;

  if (!Number.isFinite(computed)) {
    return {
      slotId: question.slotId,
      passed: false,
      discardReason: "verifier_error",
      claimedAnswer: claimed,
      working,
      reason: reason ?? "verifier returned no usable number",
    };
  }

  // Symmetric denominator. Anchoring on |claimed| alone leaves the mirror-image
  // hole open: verifier computes 0, generator claims 1e-15, and the relative
  // difference comes out as 1.0 against a claim that is numerically zero — or
  // worse, tiny against a denominator that happens to be large. max() of both
  // magnitudes keeps the bias toward discard in BOTH directions, which is the
  // safe bias for a correctness gate.
  const relativeDifference =
    Math.abs(computed - claimed) /
    Math.max(Math.abs(claimed), Math.abs(computed), 1e-9);

  // Boolean-vs-numeric agreement telemetry. The item's fate is decided by the
  // numeric check either way — this is NOT a blocker, it is the longitudinal
  // signal for whether `verified` is stably advisory or actually informative.
  // If the two agree indefinitely, a future checkpoint can consider dropping
  // one; if a subset disagrees persistently, those are the items to escalate
  // to Pro. Emitted as one structured line so it is greppable now and
  // queryable from ai_call_logs once the metadata carries it.
  const numericSays = relativeDifference <= NAT_FP_TOLERANCE;
  console.log(
    JSON.stringify({
      task: "nat_verify",
      bool_says: verified,
      numeric_says: numericSays,
      agreed: verified === numericSays,
      slot_id: question.slotId,
      relative_difference: Number(relativeDifference.toFixed(6)),
    })
  );

  // Both conditions must hold. The boolean alone is not enough — a model that
  // computes 6 and is shown 7 still sometimes returns verified:true, which is
  // the anchoring failure this whole design is built around. The numeric
  // comparison is the one that cannot be talked out of.
  if (!verified) {
    return {
      slotId: question.slotId,
      passed: false,
      discardReason: "verifier_rejected",
      boolSays: false,
      numericSays,
      computedAnswer: computed,
      claimedAnswer: claimed,
      relativeDifference,
      working,
      reason,
    };
  }
  if (relativeDifference > NAT_FP_TOLERANCE) {
    return {
      slotId: question.slotId,
      passed: false,
      discardReason: "answer_mismatch",
      boolSays: true,
      numericSays: false,
      computedAnswer: computed,
      claimedAnswer: claimed,
      relativeDifference,
      working,
      reason:
        reason ??
        `verifier said verified but its own answer differs by ${(relativeDifference * 100).toFixed(2)}%`,
    };
  }

  return {
    slotId: question.slotId,
    passed: true,
    boolSays: true,
    numericSays: true,
    computedAnswer: computed,
    claimedAnswer: claimed,
    relativeDifference,
    working,
    reason,
  };
}

/**
 * Verify every NAT item in `questions`. Non-NAT items pass through untouched
 * and are never charged a verifier call.
 */
export async function verifyNatQuestions(
  questions: AssessmentQuestion[],
  subjectContexts: Map<string, AssessmentSubjectContext>,
  logContext: AILogContext
): Promise<NatVerifyResult> {
  const kept: AssessmentQuestion[] = [];
  const discarded: NatVerifyResult["discarded"] = [];
  const outcomes: NatVerifyOutcome[] = [];

  const natItems = questions.filter((q) => q.type === "nat");
  for (const q of questions) {
    if (q.type !== "nat") kept.push(q);
  }

  for (let i = 0; i < natItems.length; i += CONCURRENCY) {
    const window = natItems.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      window.map(async (q) => {
        const ctx = subjectContexts.get(q.subjectId);
        if (!ctx) {
          const outcome: NatVerifyOutcome = {
            slotId: q.slotId,
            passed: false,
            discardReason: "malformed_item",
            reason: "no subject context available to verify against",
          };
          return { q, outcome };
        }
        return { q, outcome: await verifyNatQuestion(q, ctx, logContext) };
      })
    );
    for (const { q, outcome } of results) {
      outcomes.push(outcome);
      if (outcome.passed) kept.push(q);
      else discarded.push({ question: q, outcome });
    }
  }

  const agreement: NatVerifyAgreementStats = {
    compared: 0,
    agreed: 0,
    boolTrueNumericFalse: 0,
    boolFalseNumericTrue: 0,
  };
  for (const o of outcomes) {
    if (o.boolSays === undefined || o.numericSays === undefined) continue;
    agreement.compared += 1;
    if (o.boolSays === o.numericSays) agreement.agreed += 1;
    else if (o.boolSays) agreement.boolTrueNumericFalse += 1;
    else agreement.boolFalseNumericTrue += 1;
  }

  if (natItems.length > 0) {
    console.log(
      `[natVerify] ${natItems.length} NAT item(s): ${
        natItems.length - discarded.length
      } passed, ${discarded.length} discarded ` +
        `(${discarded.map((d) => d.outcome.discardReason).join(", ") || "—"})`
    );
  }

  return { kept, discarded, outcomes, agreement };
}
