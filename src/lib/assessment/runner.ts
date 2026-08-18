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
import type { MasterySnapshotEntry } from "./masterySnapshot";
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
  /**
   * Mode='mastery' only (CP-Q3 Part 5A) — the pre-session mastery state for
   * every module in scope, written to config.masterySnapshot so the results
   * page can show before→after movement without a schema change. See
   * masterySnapshot.ts for why this can't just be read back from
   * student_topic_mastery at results time.
   */
  masterySnapshot?: MasterySnapshotEntry[] | null;
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
    masterySnapshot = null,
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
          masterySnapshot,
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
 * THE ANSWER KEY DOES NOT LIVE IN `config` (CP-Q3 Part 1,
 * 20260727000000_quiz_session_keys.sql). It goes to `quiz_session_keys`, a
 * table with RLS on and NO SELECT policy for authenticated users — because
 * `quiz_sessions` DOES have a student SELECT policy, so anything stored in
 * `config` is readable by the owning student with the browser client. That was
 * an integrity hole for deferred-feedback exam_sim once CP-Q3's UI shipped.
 *
 * Two consequences to keep in mind when editing this file:
 *   1. Never put grading data back into `config`. `config.questions` is the
 *      studentSafe() projection and must stay that way.
 *   2. Reads of the key are server-side ONLY, via loadSessionKey() below with
 *      the admin client. There is no client path, and there should not be one.
 *
 * The two writes are ordered session-then-key (the FK requires it) and the key
 * write is treated as fatal: a session row with no key row is ungradeable, so
 * it is rolled back rather than handed to a student who would lose their work
 * at submit time.
 */
async function createSession(
  admin: AdminClient,
  planInput: AssessmentPlanInput,
  questions: AssessmentQuestion[],
  sessionConfig: {
    timeLimitMinutes: number | null;
    negativeMarking: boolean;
    negativeMarkingRule: string | null;
    masterySnapshot?: MasterySnapshotEntry[] | null;
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
      // Student-safe projection ONLY. The key goes to quiz_session_keys.
      questions: questions.map(studentSafe),
      // Mode='mastery' only. See masterySnapshot.ts.
      ...(sessionConfig.masterySnapshot && sessionConfig.masterySnapshot.length > 0
        ? { masterySnapshot: sessionConfig.masterySnapshot }
        : {}),
    },
    status: "in_progress",
    total_marks: totalMarks,
  });
  if (error) {
    console.warn(`[runAssessment] session insert failed: ${error.message}`);
    return null;
  }

  const { error: keyError } = await admin.from("quiz_session_keys").insert({
    session_id: id,
    key: questions.map(answerKey),
  });
  if (keyError) {
    // A session with no key cannot be graded. Failing here and rolling back is
    // strictly better than serving a quiz that will 500 at submit after the
    // student has spent twenty minutes on it.
    console.warn(
      `[runAssessment] answer key insert failed, rolling back session: ${keyError.message}`
    );
    await admin.from("quiz_sessions").delete().eq("id", id);
    return null;
  }
  return id;
}

/**
 * Read a session's answer key. SERVER-ONLY — pass the admin client.
 *
 * `quiz_session_keys` has no SELECT policy for authenticated users, so this
 * returns [] rather than an error if it is ever called with a non-service-role
 * client. Callers must treat an empty key as "cannot grade", never as "nothing
 * to grade" — the two are indistinguishable at the row level and only one of
 * them is safe to proceed on.
 */
export async function loadSessionKey(
  admin: AdminClient,
  sessionId: string
): Promise<SessionAnswerKey[]> {
  const { data, error } = await admin
    .from("quiz_session_keys")
    .select("key")
    .eq("session_id", sessionId)
    .maybeSingle();
  if (error) {
    console.warn(`[loadSessionKey] ${sessionId}: ${error.message}`);
    return [];
  }
  const key = (data as { key?: unknown } | null)?.key;
  return Array.isArray(key) ? (key as SessionAnswerKey[]) : [];
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
