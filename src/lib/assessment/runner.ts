/**
 * Assessment runner (CP-Q2) — the one pipeline all three modes share.
 *
 *   planAssessment → fillFromBank → generateFreshQuestions → verify NAT
 *   → persist a quiz_sessions row → return the paper.
 *
 * The three routes (/api/assessment/quick|mastery|exam-sim) are thin wrappers
 * over this: they translate a request body into an AssessmentPlanInput using
 * MODE_CONFIG/presets, and format the response. No mode has its own pipeline —
 * if one ever needs a different pipeline, that is a design signal, not a
 * licence to fork this file.
 *
 * SERVER-ONLY (admin client, routeAI).
 */

import { randomUUID } from "node:crypto";
import type { createAdminClient } from "@/lib/db/supabase-server";
import type { AILogContext } from "@/lib/ai/providers/types";
import { planAssessment } from "./engine";
import { fillFromBank } from "./bankFill";
import {
  generateFreshQuestions,
  loadSubjectContexts,
  writeQuestionsToBank,
  type AssessmentSubjectContext,
} from "./generator";
import { verifyNatQuestions, type NatVerifyAgreementStats } from "./natVerify";
import { MODE_CONFIG } from "./presets";
import type {
  AssessmentPlanInput,
  AssessmentQuestion,
  QuestionSlot,
  SourcingSummary,
} from "./types";

type AdminClient = ReturnType<typeof createAdminClient>;

export interface RunAssessmentOptions extends AssessmentPlanInput {
  /** Session config persisted onto quiz_sessions.config. */
  timeLimitMinutes?: number | null;
  negativeMarking?: boolean;
  negativeMarkingRule?: string | null;
  /** Skip the DB session row (harness/dry-run use). */
  persistSession?: boolean;
}

export interface FailedSlot {
  slotId: string;
  questionType: string;
  moduleId: string | null;
  reason: "generation_failed" | "nat_verify_discard";
  detail?: string;
}

export interface RunAssessmentResult {
  sessionId: string | null;
  questions: AssessmentQuestion[];
  sourcing: SourcingSummary & {
    fromBank: number;
    fromAi: number;
    natVerified: number;
    natDiscarded: number;
    /** Boolean-vs-numeric verifier agreement (see natVerify.ts). */
    natAgreement: NatVerifyAgreementStats;
  };
  failed: FailedSlot[];
  warnings: string[];
  totalMarks: number;
}

/**
 * Build one assessment end to end.
 *
 * Failure policy is inherited from CP-Q1 and unchanged: nothing here silently
 * returns a short paper. Slots the bank could not fill and the AI could not
 * generate, plus NAT items gate 2 discarded, all surface in `failed` for the
 * caller to decide about.
 */
export async function runAssessment(
  options: RunAssessmentOptions,
  admin: AdminClient,
  logContext: AILogContext
): Promise<RunAssessmentResult> {
  const {
    timeLimitMinutes = null,
    negativeMarking = false,
    negativeMarkingRule = null,
    persistSession = true,
    ...planInput
  } = options;

  // ── 1. Plan ───────────────────────────────────────────────────────────────
  const plan = await planAssessment(planInput, admin);
  const warnings = [...plan.warnings];
  const failed: FailedSlot[] = [];

  // ── 2. Bank first ─────────────────────────────────────────────────────────
  const bankResult = await fillFromBank(plan.slots, planInput.studentId, admin);

  // ── 3. Fresh generation for the remainder ─────────────────────────────────
  const contexts = await loadSubjectContexts(
    Array.from(new Set(plan.slots.map((s) => s.subjectId))),
    admin
  );

  let generated: AssessmentQuestion[] = [];
  if (bankResult.unfilled.length > 0) {
    const genResult = await generateFreshQuestions(
      bankResult.unfilled,
      contexts,
      admin,
      logContext
    );
    generated = genResult.generated;
    for (const slot of genResult.failed) {
      failed.push({
        slotId: slot.slotId,
        questionType: slot.questionType,
        moduleId: slot.moduleId,
        reason: "generation_failed",
      });
    }
    warnings.push(...genResult.errors);
  }

  // ── 4. Gate 2 — verify every NAT item ─────────────────────────────────────
  // Bank NAT items are verified too. A NAT row can only be in the bank if it
  // passed verification when it was written OR if a faculty member authored it
  // by hand — but "was verified once, months ago, by a possibly different
  // model" is not the same claim as "is correct", and the cost of re-checking
  // is one Flash call against the cost of serving a wrong number.
  const candidate = [...bankResult.filled, ...generated];
  const verification = await verifyNatQuestions(candidate, contexts, logContext);

  for (const d of verification.discarded) {
    failed.push({
      slotId: d.question.slotId,
      questionType: d.question.type,
      moduleId: d.question.moduleId,
      reason: "nat_verify_discard",
      detail: `${d.outcome.discardReason}${
        d.outcome.computedAnswer !== undefined
          ? ` (verifier computed ${d.outcome.computedAnswer}, item claimed ${d.outcome.claimedAnswer})`
          : ""
      }`,
    });
  }
  if (verification.discarded.length > 0) {
    warnings.push(
      `${verification.discarded.length} numerical question(s) failed independent verification and were dropped.`
    );
  }

  // ── 5. Bank write-through for VERIFIED NAT only ───────────────────────────
  // Non-NAT items were already written by generateFreshQuestions. NAT items
  // were deliberately held back until now: a wrong NAT in the bank is served
  // free to every future student, forever.
  const freshVerifiedNat = verification.kept.filter(
    (q) => q.type === "nat" && q.source === "ai_fresh" && !q.bankQuestionId
  );
  if (freshVerifiedNat.length > 0) {
    await writeQuestionsToBank(freshVerifiedNat, contexts, admin);
  }

  // Restore plan order — bank fill and generation each return their own order.
  const questions = [...verification.kept].sort(
    (a, b) => slotIndex(a.slotId) - slotIndex(b.slotId)
  );
  failed.sort((a, b) => slotIndex(a.slotId) - slotIndex(b.slotId));

  const totalMarks = questions.reduce((s, q) => s + q.marks, 0);

  // ── 6. Session row ────────────────────────────────────────────────────────
  const sessionId = persistSession
    ? await createSession(
        admin,
        planInput,
        questions,
        {
          timeLimitMinutes,
          negativeMarking,
          negativeMarkingRule,
        },
        totalMarks
      )
    : null;

  const natKept = verification.kept.filter((q) => q.type === "nat").length;

  return {
    sessionId,
    questions,
    sourcing: {
      ...plan.sourcing,
      fromBank: questions.filter((q) => q.source === "bank").length,
      fromAi: questions.filter((q) => q.source === "ai_fresh").length,
      natVerified: natKept,
      natDiscarded: verification.discarded.length,
      natAgreement: verification.agreement,
    },
    failed,
    warnings,
    totalMarks,
  };
}

function slotIndex(slotId: string): number {
  const n = Number(String(slotId).replace(/^S/, ""));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Persist the session.
 *
 * ⚠ THE ANSWER KEY LIVES IN `config.key`, AND quiz_sessions HAS A STUDENT
 * SELECT POLICY. Every route reads this through the admin client and strips the
 * key before responding, so nothing leaks through the API — but a student who
 * queries `quiz_sessions` directly with the browser client can read their own
 * row, which for a deferred-feedback exam_sim is an integrity hole. CP-Q1's
 * spec forbade schema changes here, so the fix is deliberately deferred and
 * named: CP-Q3 should either move the key to a table with no student SELECT
 * policy, or drop the student SELECT policy on quiz_sessions in favour of
 * API-only access (the resume route already covers every legitimate read).
 * Do not build a student-facing feature that reads this table directly.
 */
async function createSession(
  admin: AdminClient,
  planInput: AssessmentPlanInput,
  questions: AssessmentQuestion[],
  sessionConfig: {
    timeLimitMinutes: number | null;
    negativeMarking: boolean;
    negativeMarkingRule: string | null;
  },
  totalMarks: number
): Promise<string | null> {
  const id = randomUUID();
  const { error } = await admin.from("quiz_sessions").insert({
    id,
    student_id: planInput.studentId,
    mode: planInput.mode,
    subject_ids: planInput.subjectIds,
    module_ids: planInput.moduleIds ?? null,
    config: {
      question_count: questions.length,
      difficulty: planInput.difficulty,
      question_types: planInput.questionTypes,
      time_limit_minutes: sessionConfig.timeLimitMinutes,
      negative_marking: sessionConfig.negativeMarking,
      negative_marking_rule: sessionConfig.negativeMarkingRule,
      preset: planInput.preset ?? null,
      immediate_feedback: MODE_CONFIG[planInput.mode].immediateFeedback,
      // Student-safe payload + the key, see the warning above.
      questions: questions.map(studentSafe),
      key: questions.map(answerKey),
    },
    status: "in_progress",
    total_marks: totalMarks,
  });
  if (error) {
    console.warn(`[runAssessment] session insert failed: ${error.message}`);
    return null;
  }
  return id;
}

/** The question as a student may see it — no answer, no explanation. */
export function studentSafe(q: AssessmentQuestion) {
  return {
    slotId: q.slotId,
    question: q.question,
    type: q.type,
    options: q.options ?? null,
    marks: q.marks,
    subjectId: q.subjectId,
    moduleId: q.moduleId,
    difficulty: q.difficulty,
    numericTolerance: q.type === "nat" ? (q.numericTolerance ?? 0) : undefined,
  };
}

/** Everything grading needs and a student must not have mid-session. */
export function answerKey(q: AssessmentQuestion) {
  return {
    slotId: q.slotId,
    type: q.type,
    correctAnswer: q.correctAnswer,
    numericAnswer: q.numericAnswer ?? null,
    numericTolerance: q.numericTolerance ?? 0,
    explanation: q.explanation,
    marks: q.marks,
    subjectId: q.subjectId,
    moduleId: q.moduleId,
    bankQuestionId: q.bankQuestionId ?? null,
    source: q.source,
    questionText: q.question,
  };
}

export type SessionAnswerKey = ReturnType<typeof answerKey>;
export type SessionQuestion = ReturnType<typeof studentSafe>;

/** Slots a caller still owes the student, for the response summary. */
export function describeFailed(failed: FailedSlot[]): string | null {
  if (failed.length === 0) return null;
  const discarded = failed.filter((f) => f.reason === "nat_verify_discard").length;
  const gen = failed.length - discarded;
  const parts: string[] = [];
  if (gen > 0) parts.push(`${gen} could not be generated`);
  if (discarded > 0) parts.push(`${discarded} failed answer verification`);
  return `${failed.length} question(s) short: ${parts.join(", ")}.`;
}

export type { AssessmentSubjectContext, QuestionSlot };
