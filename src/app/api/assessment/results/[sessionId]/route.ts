/**
 * GET /api/assessment/results/[sessionId] (CP-Q3 Part 5A)
 *
 * The graded, persisted view of a FINISHED session — what
 * /student/quiz/results/[sessionId] reads, including across a page refresh.
 * `submit`'s rich per-question payload is transient (never written back
 * anywhere), so this route reconstructs the same shape server-side from
 * durable state: quiz_sessions (score/marks), quiz_session_keys (the answer
 * key — server-only, same discipline as session/[id]/route.ts), and
 * student_question_attempts (what the student actually answered).
 *
 * Only serves completed sessions. An in_progress session has no final grade
 * yet and this route must not become a second way to peek at the key mid-quiz
 * — that door is closed by requiring status='completed' before touching
 * quiz_session_keys at all.
 */

import { apiError, apiSuccess, requireRole } from "@/lib/api/helpers";
import { loadSessionKey } from "@/lib/assessment/runner";
import { computePeerStat } from "@/lib/assessment/peerStatCompute";
import { negativeMarksFor, type NegativeMarkingRule } from "@/lib/assessment/presets";
import type { AssessmentDifficulty, AssessmentMode, AssessmentQuestionType } from "@/lib/assessment/types";
import type { MasterySnapshotEntry } from "@/lib/assessment/masterySnapshot";

interface SessionRow {
  id: string;
  student_id: string;
  mode: AssessmentMode;
  subject_ids: string[];
  status: string;
  started_at: string;
  completed_at: string | null;
  score: number | null;
  total_marks: number | null;
  config: {
    questions?: Array<{ slotId: string; options?: string[] | null }>;
    time_limit_minutes?: number | null;
    negative_marking?: boolean;
    negative_marking_rule?: string | null;
    preset?: string | null;
    masterySnapshot?: MasterySnapshotEntry[];
  } | null;
}

interface AttemptRow {
  subject_id: string;
  module_id: string | null;
  question_text: string;
  question_type: string;
  student_answer: string | null;
  is_correct: boolean | null;
  time_taken_seconds: number | null;
  created_at: string;
}

interface MasteryRow {
  subject_id: string;
  module_id: string;
  attempts_count: number;
  correct_count: number;
  accuracy: number | null;
  current_difficulty: string;
}

const LADDER: AssessmentDifficulty[] = ["easy", "medium", "hard"];

export async function GET(
  _request: Request,
  context: { params: Promise<{ sessionId: string }> }
) {
  try {
    const authResult = await requireRole(["student"]);
    if (authResult instanceof Response) return authResult;
    const { user, adminClient } = authResult;

    const { sessionId } = await context.params;
    if (!sessionId) return apiError("sessionId is required", 400);

    const { data, error } = await adminClient
      .from("quiz_sessions")
      .select(
        "id, student_id, mode, subject_ids, status, started_at, completed_at, score, total_marks, config"
      )
      .eq("id", sessionId)
      .maybeSingle();
    if (error) return apiError(error.message, 500);
    const session = data as SessionRow | null;
    if (!session) return apiError("Session not found", 404);
    if (session.student_id !== user.id) return apiError("Forbidden", 403);
    if (session.status !== "completed") {
      return apiError("This session has not been submitted yet", 404);
    }

    const [key, attemptsRes, subjectsRes] = await Promise.all([
      loadSessionKey(adminClient, session.id),
      adminClient
        .from("student_question_attempts")
        .select(
          "subject_id, module_id, question_text, question_type, student_answer, is_correct, time_taken_seconds, created_at"
        )
        .eq("session_id", session.id)
        .order("created_at", { ascending: true }),
      adminClient.from("subjects").select("id, name, code").in("id", session.subject_ids ?? []),
    ]);
    if (key.length === 0) {
      return apiError("This session has no recoverable answer key", 500);
    }

    const subjectNames = new Map(
      ((subjectsRes.data ?? []) as Array<{ id: string; name: string; code: string }>).map(
        (s) => [s.id, s]
      )
    );

    // Last attempt per (subject, module, question_text) wins — for practice
    // modes /submit re-writes a final row for every question over the
    // /answer-time row; ascending order means the later (submit-time) write is
    // the one that survives the overwrite.
    const attemptByText = new Map<string, AttemptRow>();
    for (const row of (attemptsRes.data ?? []) as AttemptRow[]) {
      attemptByText.set(`${row.subject_id}:${row.module_id ?? ""}:${row.question_text}`, row);
    }

    const configQuestions = session.config?.questions ?? [];
    const optionsBySlot = new Map(
      configQuestions.map((q) => [q.slotId, q.options ?? null])
    );

    const perQuestionResults = await Promise.all(
      key.map(async (k, questionIndex) => {
        const attempt = attemptByText.get(`${k.subjectId}:${k.moduleId ?? ""}:${k.questionText}`);
        const { pct: peerStat } = await computePeerStat(adminClient, k.bankQuestionId, k.subjectId);
        return {
          questionIndex,
          subjectId: k.subjectId,
          moduleId: k.moduleId,
          stem: k.questionText,
          questionType: k.type as AssessmentQuestionType,
          options: optionsBySlot.get(k.slotId) ?? null,
          studentAnswer: attempt?.student_answer ?? null,
          correctAnswer: k.correctAnswer,
          explanation: k.explanation,
          isCorrect: attempt?.is_correct ?? false,
          marks: k.marks,
          ...(peerStat != null ? { peerStat } : {}),
        };
      })
    );

    const score = session.score ?? 0;
    const totalMarks = session.total_marks ?? key.reduce((s, k) => s + k.marks, 0);
    const warnings: string[] = [];

    // ── mastery deltas (mastery mode only) ──────────────────────────────────
    let masteryDeltas:
      | Array<{
          subjectId: string;
          moduleId: string;
          moduleName?: string;
          attemptsBefore: number;
          attemptsAfter: number;
          accuracyBefore: number | null;
          accuracyAfter: number;
          difficultyBefore: AssessmentDifficulty;
          difficultyAfter: AssessmentDifficulty;
          promoted: boolean;
          demoted: boolean;
        }>
      | undefined;

    if (session.mode === "mastery") {
      const snapshot = session.config?.masterySnapshot ?? [];
      if (snapshot.length === 0) {
        warnings.push("no_snapshot");
      } else {
        // The modules actually PRACTICED this session — from the answer key's
        // moduleId, not the broader snapshot scope.
        const practicedModuleIds = Array.from(
          new Set(key.map((k) => k.moduleId).filter((id): id is string => !!id))
        );

        const { data: currentRows } = await adminClient
          .from("student_topic_mastery")
          .select("subject_id, module_id, attempts_count, correct_count, accuracy, current_difficulty")
          .eq("student_id", user.id)
          .in("module_id", practicedModuleIds);
        const currentByModule = new Map(
          ((currentRows ?? []) as MasteryRow[]).map((r) => [r.module_id, r])
        );
        const snapshotByModule = new Map(snapshot.map((s) => [s.moduleId, s]));

        masteryDeltas = practicedModuleIds
          .map((moduleId) => {
            const before = snapshotByModule.get(moduleId);
            const after = currentByModule.get(moduleId);
            if (!before || !after) return null;
            const difficultyAfter = (LADDER.includes(after.current_difficulty as AssessmentDifficulty)
              ? (after.current_difficulty as AssessmentDifficulty)
              : "easy") as AssessmentDifficulty;
            const accuracyAfter =
              after.accuracy ??
              (after.attempts_count > 0 ? after.correct_count / after.attempts_count : 0);
            return {
              subjectId: before.subjectId,
              moduleId,
              moduleName: before.moduleName,
              attemptsBefore: before.attemptsBefore,
              attemptsAfter: after.attempts_count,
              accuracyBefore: before.accuracyBefore,
              accuracyAfter,
              difficultyBefore: before.difficultyBefore,
              difficultyAfter,
              promoted: LADDER.indexOf(difficultyAfter) > LADDER.indexOf(before.difficultyBefore),
              demoted: LADDER.indexOf(difficultyAfter) < LADDER.indexOf(before.difficultyBefore),
            };
          })
          .filter((d): d is NonNullable<typeof d> => d !== null);
      }
    }

    // ── sectional breakdown + negative-marking impact (exam_sim only) ───────
    let sectionalBreakdown:
      | Array<{
          subjectId: string;
          subjectName: string;
          correctCount: number;
          questionCount: number;
          marksAwarded: number;
          totalMarks: number;
          timeActualSeconds: number;
          timeTargetSeconds: number;
        }>
      | undefined;
    let negativeMarkingImpact:
      | {
          rawScore: number;
          actualScore: number;
          delta: number;
          perTypeBreakdown: Record<
            "mcq" | "msq" | "nat",
            { wrong: number; penaltyPer: number; totalPenalty: number }
          >;
        }
      | undefined;

    if (session.mode === "exam_sim") {
      const timeLimitMinutes = session.config?.time_limit_minutes ?? 0;
      const bySubject = new Map<
        string,
        { correctCount: number; questionCount: number; marksAwarded: number; totalMarks: number; timeActualSeconds: number }
      >();
      for (let i = 0; i < key.length; i += 1) {
        const k = key[i];
        const r = perQuestionResults[i];
        const attempt = attemptByText.get(`${k.subjectId}:${k.moduleId ?? ""}:${k.questionText}`);
        const entry =
          bySubject.get(k.subjectId) ??
          { correctCount: 0, questionCount: 0, marksAwarded: 0, totalMarks: 0, timeActualSeconds: 0 };
        entry.questionCount += 1;
        entry.totalMarks += k.marks;
        entry.timeActualSeconds += attempt?.time_taken_seconds ?? 0;
        if (r.isCorrect) {
          entry.correctCount += 1;
          entry.marksAwarded += k.marks;
        }
        bySubject.set(k.subjectId, entry);
      }
      sectionalBreakdown = Array.from(bySubject.entries()).map(([subjectId, e]) => ({
        subjectId,
        subjectName: subjectNames.get(subjectId)?.name ?? subjectNames.get(subjectId)?.code ?? "Subject",
        ...e,
        // No per-section time budget exists (a GATE mock is one 180-minute
        // clock — see presets.ts); evenly (mark-weighted) distributed target
        // is the only defensible number to show without inventing structure
        // the exam config doesn't have.
        timeTargetSeconds:
          totalMarks > 0 ? Math.round((e.totalMarks / totalMarks) * timeLimitMinutes * 60) : 0,
      }));

      if (session.config?.negative_marking) {
        const rule = (session.config?.negative_marking_rule ?? null) as NegativeMarkingRule | null;
        const rawScore = perQuestionResults.reduce(
          (s, r) => s + (r.isCorrect ? r.marks : 0),
          0
        );
        const perType: Record<"mcq" | "msq" | "nat", { wrong: number; penaltyPer: number; totalPenalty: number }> = {
          mcq: { wrong: 0, penaltyPer: 0, totalPenalty: 0 },
          msq: { wrong: 0, penaltyPer: 0, totalPenalty: 0 },
          nat: { wrong: 0, penaltyPer: 0, totalPenalty: 0 },
        };
        if (rule) {
          for (let i = 0; i < key.length; i += 1) {
            const k = key[i];
            const r = perQuestionResults[i];
            const t = k.type as "mcq" | "msq" | "nat";
            if (!(t in perType)) continue;
            const answered = r.studentAnswer != null && r.studentAnswer.trim().length > 0;
            if (!answered || r.isCorrect) continue;
            const penalty = negativeMarksFor(rule, k.type as AssessmentQuestionType, k.marks);
            perType[t].wrong += 1;
            perType[t].penaltyPer = penalty !== 0 ? penalty : perType[t].penaltyPer;
            perType[t].totalPenalty += penalty;
          }
        }
        negativeMarkingImpact = {
          rawScore: Math.round(rawScore * 100) / 100,
          actualScore: score,
          delta: Math.round((rawScore - score) * 100) / 100,
          perTypeBreakdown: perType,
        };
      }
    }

    return apiSuccess({
      sessionId: session.id,
      mode: session.mode,
      preset: session.config?.preset ?? null,
      subjectIds: session.subject_ids,
      subjectNames: Object.fromEntries(
        (session.subject_ids ?? []).map((id) => [id, subjectNames.get(id)?.name ?? subjectNames.get(id)?.code ?? "Subject"])
      ),
      startedAt: session.started_at,
      completedAt: session.completed_at,
      timeLimitMinutes: session.config?.time_limit_minutes ?? null,
      score,
      totalMarks,
      perQuestionResults,
      ...(masteryDeltas && masteryDeltas.length > 0 ? { masteryDeltas } : {}),
      ...(sectionalBreakdown ? { sectionalBreakdown } : {}),
      ...(negativeMarkingImpact ? { negativeMarkingImpact } : {}),
      ...(warnings.length > 0 ? { warnings } : {}),
    });
  } catch (err) {
    console.error("[assessment/results]", err);
    return apiError("Internal server error", 500);
  }
}
