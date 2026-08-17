/**
 * POST /api/assessment/submit
 *
 * Grades a session, records every attempt, and — for the practice modes only —
 * folds the result into student_topic_mastery.
 *
 * Body: { sessionId, answers: [{ questionIndex, slotId?, studentAnswer,
 *         timeTakenSeconds }] }
 *
 * `is_correct` is ALWAYS computed here from the stored answer key. The client
 * sends what the student typed; it never sends whether that was right.
 */

import type { NextRequest } from "next/server";
import { apiError, apiSuccess, requireRole } from "@/lib/api/helpers";
import {
  gradeSubmission,
  updateMastery,
  recordBankUsage,
  type SubmittedAnswer,
} from "@/lib/assessment/grading";
import { MODE_CONFIG } from "@/lib/assessment/presets";
import { loadSessionKey } from "@/lib/assessment/runner";
import type { AssessmentMode } from "@/lib/assessment/types";
import type { NegativeMarkingRule } from "@/lib/assessment/presets";

interface SessionRow {
  id: string;
  student_id: string;
  mode: AssessmentMode;
  status: string;
  config: {
    // No `key` here — as of CP-Q3 Part 1 the answer key lives in
    // quiz_session_keys (no student SELECT policy). See loadSessionKey().
    questions?: Array<{ slotId: string; options?: string[] | null }>;
    negative_marking?: boolean;
    negative_marking_rule?: string | null;
    time_limit_minutes?: number | null;
  } | null;
  total_marks: number | null;
  started_at: string;
}

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireRole(["student"]);
    if (authResult instanceof Response) return authResult;
    const { user, adminClient } = authResult;

    const body = (await request.json().catch(() => ({}))) as {
      sessionId?: string;
      answers?: unknown;
    };
    const sessionId = String(body.sessionId ?? "").trim();
    if (!sessionId) return apiError("sessionId is required", 400);

    const answers: SubmittedAnswer[] = Array.isArray(body.answers)
      ? (body.answers as Array<Record<string, unknown>>).map((a, i) => ({
          questionIndex:
            typeof a.questionIndex === "number" ? a.questionIndex : i,
          slotId: typeof a.slotId === "string" ? a.slotId : undefined,
          studentAnswer:
            a.studentAnswer == null ? null : String(a.studentAnswer),
          timeTakenSeconds:
            typeof a.timeTakenSeconds === "number"
              ? Math.max(0, Math.trunc(a.timeTakenSeconds))
              : null,
        }))
      : [];
    if (answers.length === 0) {
      return apiError("answers must contain at least one entry", 400);
    }

    const { data: sessionData, error: sessionErr } = await adminClient
      .from("quiz_sessions")
      .select("id, student_id, mode, status, config, total_marks, started_at")
      .eq("id", sessionId)
      .maybeSingle();
    if (sessionErr) return apiError(sessionErr.message, 500);
    const session = sessionData as SessionRow | null;
    if (!session) return apiError("Session not found", 404);
    // Ownership is checked here even though the admin client bypasses RLS —
    // that bypass is exactly why the check has to be explicit.
    if (session.student_id !== user.id) return apiError("Forbidden", 403);
    if (session.status !== "in_progress") {
      return apiError(
        session.status === "completed"
          ? "This session has already been submitted"
          : "This session is no longer active",
        409
      );
    }

    // ── timer enforcement (server-side, authoritative) ─────────────────────
    // Mirrors /api/assessment/answer exactly (same limit source, same 5s
    // grace for in-flight request latency). A late payload — however
    // complete — does not get graded once the server's clock says time is
    // up; the client's local timer is not trusted.
    const limit = session.config?.time_limit_minutes ?? null;
    if (limit != null) {
      const elapsed = (Date.now() - new Date(session.started_at).getTime()) / 1000;
      if (elapsed > limit * 60 + 5) {
        return apiError("Time is up for this session", 409);
      }
    }

    // Server-side read with the admin client — quiz_session_keys has no
    // student-readable policy, which is the whole point of the table. Read
    // BEFORE the atomic claim below: it is read-only, so doing it first
    // means an unrelated key-load failure returns 500 without having
    // already flipped the session to 'completed' (which would strand it).
    const key = await loadSessionKey(adminClient, session.id);
    if (key.length === 0) {
      return apiError("Session has no answer key — cannot grade", 500);
    }

    // ── atomic claim ─────────────────────────────────────────────────────
    // Flip status → completed HERE, guarded by the status we just read, and
    // before any grading/insert work runs. This is the only gate that
    // matters: two concurrent /submit calls both pass the read-only checks
    // above (neither has written yet), so without a conditional write here
    // both would go on to grade and insert attempts, doubling
    // student_question_attempts. Only the request whose UPDATE actually
    // matches a row (status was still 'in_progress' at write time) proceeds;
    // the loser gets the same 409 an already-completed session would.
    const { data: claimedRows, error: claimErr } = await adminClient
      .from("quiz_sessions")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("id", session.id)
      .eq("status", "in_progress")
      .select("id");
    if (claimErr) return apiError(claimErr.message, 500);
    if (!claimedRows || claimedRows.length === 0) {
      return apiError("This session has already been submitted", 409);
    }

    const optionCounts: Record<string, number> = {};
    for (const q of session.config?.questions ?? []) {
      if (Array.isArray(q.options)) optionCounts[q.slotId] = q.options.length;
    }

    const scored = gradeSubmission(key, answers, {
      negativeMarking: session.config?.negative_marking ?? false,
      negativeMarkingRule:
        (session.config?.negative_marking_rule as NegativeMarkingRule | null) ??
        null,
      optionCounts,
    });

    // ── attempts ───────────────────────────────────────────────────────────
    // Written for EVERY mode, including exam_sim: attempt history feeds the
    // 30-day bank exclusion and is valuable data regardless of whether the
    // session moves the difficulty state.
    const attemptRows = scored.results.map((r) => ({
      student_id: user.id,
      question_id: r.bankQuestionId,
      subject_id: r.subjectId,
      module_id: r.moduleId,
      question_text: r.questionText,
      question_type: r.questionType,
      student_answer: r.studentAnswer,
      is_correct: r.isCorrect,
      time_taken_seconds: r.timeTakenSeconds,
      source: r.source,
      session_id: session.id,
    }));
    const { error: attemptErr } = await adminClient
      .from("student_question_attempts")
      .insert(attemptRows);
    if (attemptErr) {
      // Non-fatal: the student still gets their score. Losing history is bad,
      // losing the result they just earned is worse.
      console.warn(`[assessment/submit] attempt insert failed: ${attemptErr.message}`);
    }

    await recordBankUsage(
      adminClient,
      scored.results
        .map((r) => r.bankQuestionId)
        .filter((id): id is string => !!id)
    );

    // ── mastery (practice modes only) ──────────────────────────────────────
    const masteryDeltas = MODE_CONFIG[session.mode].updatesMastery
      ? await updateMastery(adminClient, user.id, scored.results)
      : null;

    // status/completed_at were already set atomically by the claim above;
    // this just fills in the score now that grading has run.
    const { error: closeErr } = await adminClient
      .from("quiz_sessions")
      .update({
        score: scored.score,
        total_marks: scored.totalMarks,
      })
      .eq("id", session.id);
    if (closeErr) {
      console.warn(`[assessment/submit] session score write failed: ${closeErr.message}`);
    }

    return apiSuccess({
      sessionId: session.id,
      mode: session.mode,
      score: scored.score,
      totalMarks: scored.totalMarks,
      correctCount: scored.correctCount,
      wrongCount: scored.wrongCount,
      unansweredCount: scored.unansweredCount,
      negativeMarksApplied: scored.negativeMarksApplied,
      perQuestionResults: scored.results.map((r) => ({
        slotId: r.slotId,
        questionIndex: r.questionIndex,
        isCorrect: r.isCorrect,
        marksAwarded: r.marksAwarded,
        studentAnswer: r.studentAnswer,
        correctAnswer: r.correctAnswer,
        explanation: r.explanation,
      })),
      // Present only for modes that actually moved mastery — an empty array
      // would read as "nothing changed" rather than "this mode doesn't".
      ...(masteryDeltas ? { masteryDeltas } : {}),
    });
  } catch (err) {
    console.error("[assessment/submit]", err);
    return apiError("Internal server error", 500);
  }
}
