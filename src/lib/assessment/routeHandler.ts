/**
 * Shared request handling for the three assessment mode routes (CP-Q2).
 *
 * /api/assessment/{quick,mastery,exam-sim} are three lines each: they call
 * handleAssessmentRequest with their mode. Everything below — auth, validation,
 * rate limiting, preset expansion, the runner call, response shaping — is
 * identical across modes BY DESIGN (see presets.ts: modes are thin config over
 * one engine).
 */

import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { apiError, apiSuccess, requireRole } from "@/lib/api/helpers";
import { checkRateLimit, releaseRateLimit, RATE_LIMITS } from "@/lib/utils/rate-limit";
import { runAssessment, studentSafe, describeFailed } from "./runner";
import { buildMasterySnapshot } from "./masterySnapshot";
import {
  MODE_CONFIG,
  PRESETS,
  clampQuestionCount,
  isRequestedDifficulty,
} from "./presets";
import type {
  AssessmentMode,
  AssessmentQuestionType,
  RequestedDifficulty,
} from "./types";

const VALID_TYPES: AssessmentQuestionType[] = [
  "mcq",
  "msq",
  "nat",
  "true_false",
  "short",
  "multiple_correct",
  "match",
];

interface RequestBody {
  subjectIds?: unknown;
  moduleIds?: unknown;
  questionCount?: unknown;
  questionTypes?: unknown;
  difficulty?: unknown;
  preset?: unknown;
  timeLimit?: unknown;
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v)
    ? v.map((x) => String(x).trim()).filter(Boolean)
    : [];
}

export async function handleAssessmentRequest(
  request: NextRequest,
  mode: AssessmentMode
): Promise<Response> {
  // Hoisted above the try so the outer catch can release a reservation made
  // partway through — let/const declared inside `try {}` aren't visible in
  // its `catch` block.
  let releaseReservation: (() => Promise<void>) | null = null;
  try {
    const authResult = await requireRole(["student"]);
    if (authResult instanceof Response) return authResult;
    const { user, adminClient } = authResult;

    const body = (await request.json().catch(() => ({}))) as RequestBody;
    const cfg = MODE_CONFIG[mode];
    const warnings: string[] = [];

    // ── scope ──────────────────────────────────────────────────────────────
    const subjectIds = asStringArray(body.subjectIds);
    if (subjectIds.length === 0) {
      return apiError("subjectIds must contain at least one subject", 400);
    }
    if (!cfg.allowsMultiSubject && subjectIds.length > 1) {
      return apiError(
        `${mode} mode covers one subject at a time — use exam-sim for a multi-subject paper`,
        400
      );
    }
    const moduleIds = asStringArray(body.moduleIds);

    // ── preset (exam_sim only) ─────────────────────────────────────────────
    const presetKey =
      typeof body.preset === "string" && body.preset in PRESETS
        ? (body.preset as keyof typeof PRESETS)
        : undefined;
    if (presetKey && mode !== "exam_sim") {
      return apiError(
        `The ${presetKey} preset is an exam simulation — call /api/assessment/exam-sim`,
        400
      );
    }
    const preset = presetKey ? PRESETS[presetKey] : undefined;

    // ── count / types / difficulty ─────────────────────────────────────────
    let questionCount: number;
    if (preset) {
      questionCount = preset.questionCount;
    } else {
      const clamped = clampQuestionCount(mode, Number(body.questionCount));
      questionCount = clamped.count;
      if (clamped.warning) warnings.push(clamped.warning);
    }

    const requestedTypes = asStringArray(body.questionTypes).filter(
      (t): t is AssessmentQuestionType =>
        VALID_TYPES.includes(t as AssessmentQuestionType)
    );
    const questionTypes = preset
      ? preset.questionTypes
      : requestedTypes.length > 0
        ? requestedTypes
        : cfg.defaultQuestionTypes;

    const difficulty: RequestedDifficulty = preset
      ? preset.difficulty
      : isRequestedDifficulty(body.difficulty)
        ? body.difficulty
        : cfg.defaultDifficulty;

    const timeLimitMinutes = preset
      ? preset.timeLimit
      : Number.isFinite(Number(body.timeLimit))
        ? Number(body.timeLimit)
        : cfg.defaultTimeLimitMinutes;

    // ── rate limit ─────────────────────────────────────────────────────────
    // quick + mastery share the existing 20/day quiz allowance. exam_sim has
    // its own 3/day cap: a 100-question GATE mock with per-item NAT
    // verification is the most expensive thing a student can trigger, so the
    // low ceiling is a COST guard, not a UX opinion.
    const eventType = mode === "exam_sim" ? "examSim" : "quiz";
    const limit = mode === "exam_sim" ? RATE_LIMITS.examSim : RATE_LIMITS.quiz;
    // Multi-subject requests (exam_sim) anchor the reservation on the first
    // subject — checkRateLimit's cap is enforced globally per user/event/day
    // (it sums usage across ALL of a user's subject rows), so subjectId only
    // picks which row absorbs the CAS write, not which subject "counts."
    const rate = await checkRateLimit({
      userId: user.id,
      eventType,
      limit,
      subjectId: subjectIds[0],
    });
    if (!rate.allowed) {
      return apiError(
        `Daily limit reached (${limit} ${
          mode === "exam_sim" ? "exam simulations" : "quizzes"
        }/day). Resets ${new Date(rate.resetAt).toLocaleString("en-IN")}.`,
        429
      );
    }
    releaseReservation = () =>
      releaseRateLimit({ userId: user.id, eventType, subjectId: subjectIds[0] });

    // ── mastery snapshot (mastery mode only, CP-Q3 Part 5A) ──────────────────
    // Captured BEFORE runAssessment/planAssessment touch anything, so it is a
    // true "before" — see masterySnapshot.ts for why this can't be
    // reconstructed later from student_topic_mastery alone.
    const masterySnapshot =
      mode === "mastery"
        ? await buildMasterySnapshot(
            adminClient,
            user.id,
            subjectIds,
            moduleIds.length > 0 ? moduleIds : undefined
          )
        : null;

    // ── run ────────────────────────────────────────────────────────────────
    const result = await runAssessment(
      {
        studentId: user.id,
        subjectIds,
        moduleIds: moduleIds.length > 0 ? moduleIds : undefined,
        questionCount,
        difficulty,
        questionTypes,
        mode,
        preset: presetKey,
        typeDistribution: preset?.typeDistribution,
        marksRule: preset?.marksRule,
        timeLimitMinutes,
        negativeMarking: preset?.negativeMarking ?? false,
        negativeMarkingRule: preset?.negativeMarkingRule ?? null,
        masterySnapshot,
      },
      adminClient,
      {
        userId: user.id,
        userEmail: user.email ?? null,
        userRole: "student",
        subjectId: subjectIds[0],
        subjectCode: null,
        jobId: randomUUID(),
        relatedContentId: null,
        feature: `assessment_${mode}`,
        metadata: { mode, preset: presetKey ?? null },
      }
    );

    if (result.questions.length === 0) {
      if (releaseReservation) await releaseReservation();
      return apiError(
        "Could not produce any questions for this selection. Try a different module scope or question type.",
        502
      );
    }

    const shortfall = describeFailed(result.failed);
    if (shortfall) warnings.push(shortfall);

    return apiSuccess({
      sessionId: result.sessionId,
      mode,
      preset: presetKey ?? null,
      immediateFeedback: cfg.immediateFeedback,
      timeLimitMinutes,
      negativeMarking: preset?.negativeMarking ?? false,
      totalMarks: result.totalMarks,
      // Student-safe only: no correctAnswer, no explanation, until submit.
      questions: result.questions.map(studentSafe),
      sourcing: result.sourcing,
      failed: result.failed,
      warnings: [...warnings, ...result.warnings],
    });
  } catch (err) {
    console.error(`[assessment/${mode}]`, err);
    if (releaseReservation) {
      await releaseReservation().catch(() => {});
    }
    return apiError("Internal server error", 500);
  }
}
