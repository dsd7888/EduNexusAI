/**
 * POST /api/assessment/answer — grade ONE question, mid-session.
 *
 * WHY THIS IS ITS OWN ROUTE AND NOT A MODE ON /api/assessment/submit
 * Two different semantics deserve two routes. This one is per-question,
 * idempotent-ish, and returns feedback the student sees immediately; submit is
 * once-per-session, closes the session, computes negative marking across the
 * whole paper, and moves mastery. One route with an `if (perQuestion)` branch
 * would have both sets of invariants tangled in one handler, and the exam_sim
 * autosave path (which calls THIS route purely to persist, discarding the
 * response) would be running through session-closing code.
 *
 * Body: { sessionId, slotId, studentAnswer, timeTakenSeconds?, silent? }
 *   silent: true  → persist only, return nothing gradeable. This is what the
 *                   exam_sim 30-second autosave uses. A deferred-feedback mode
 *                   MUST NOT be able to obtain correctness mid-exam, so the
 *                   feedback fields are withheld by the MODE, not by the
 *                   client's honesty (see `immediateFeedback` below).
 *
 * Returns: { isCorrect, correctAnswer, explanation, peerStat? } for the
 * immediate-feedback modes; { recorded: true } otherwise.
 *
 * LATENCY BUDGET: < 200ms. Three costs: one PK lookup on quiz_session_keys
 * (session_id IS the primary key — the cheapest shape available, a deliberate
 * downstream of CP-Q3 Part 1), an in-process correctness compute, and a peer
 * stat that is served from an in-memory cache on all but the first request per
 * question per 5 minutes. Timing is logged per request (see `t0`) so this is
 * measured rather than asserted.
 */

import type { NextRequest } from "next/server";
import { apiError, apiSuccess, requireRole } from "@/lib/api/helpers";
import { isAnswerCorrect } from "@/lib/assessment/grading";
import { MODE_CONFIG } from "@/lib/assessment/presets";
import { loadSessionKey } from "@/lib/assessment/runner";
import type { AssessmentMode } from "@/lib/assessment/types";
import { computePeerStat } from "@/lib/assessment/peerStatCompute";

interface SessionRow {
  id: string;
  student_id: string;
  mode: AssessmentMode;
  status: string;
  config: {
    questions?: Array<{ slotId: string; options?: string[] | null }>;
    time_limit_minutes?: number | null;
  } | null;
  started_at: string;
}

export async function POST(request: NextRequest) {
  const t0 = Date.now();
  try {
    const authResult = await requireRole(["student"]);
    if (authResult instanceof Response) return authResult;
    const { user, adminClient } = authResult;

    const body = (await request.json().catch(() => ({}))) as {
      sessionId?: string;
      slotId?: string;
      studentAnswer?: unknown;
      timeTakenSeconds?: unknown;
      silent?: unknown;
    };

    const sessionId = String(body.sessionId ?? "").trim();
    const slotId = String(body.slotId ?? "").trim();
    if (!sessionId || !slotId) {
      return apiError("sessionId and slotId are required", 400);
    }
    const studentAnswer =
      body.studentAnswer == null ? null : String(body.studentAnswer);
    const timeTakenSeconds =
      typeof body.timeTakenSeconds === "number"
        ? Math.max(0, Math.trunc(body.timeTakenSeconds))
        : null;
    const silent = body.silent === true;

    const { data: sessionData, error: sessionErr } = await adminClient
      .from("quiz_sessions")
      .select("id, student_id, mode, status, config, started_at")
      .eq("id", sessionId)
      .maybeSingle();
    if (sessionErr) return apiError(sessionErr.message, 500);
    const session = sessionData as SessionRow | null;
    if (!session) return apiError("Session not found", 404);
    // The admin client bypasses RLS, which is exactly why ownership is checked
    // explicitly here.
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
    // A timed session's clock lives on the server. A client whose tab was
    // suspended, whose system clock is wrong, or which has been tampered with
    // does not get to answer after time is up.
    const limit = session.config?.time_limit_minutes ?? null;
    if (limit != null) {
      const elapsed = (Date.now() - new Date(session.started_at).getTime()) / 1000;
      if (elapsed > limit * 60 + 5) {
        // 5s grace absorbs request latency on an answer sent right at the
        // buzzer — a network hop should not cost a student a question.
        return apiError("Time is up for this session", 409);
      }
    }

    const key = await loadSessionKey(adminClient, sessionId);
    const entry = key.find((k) => k.slotId === slotId);
    if (!entry) return apiError("Unknown slotId for this session", 400);

    const optionCount = session.config?.questions?.find((q) => q.slotId === slotId)
      ?.options?.length;

    const isCorrect = isAnswerCorrect(entry, studentAnswer, optionCount);

    // ── peer stat, BEFORE writing this attempt ─────────────────────────────
    // Order matters: computing after the insert would fold the student's own
    // answer into the stat they are shown, so a correct answer would nudge
    // "62% got this right" upward by their own doing.
    const peerStat =
      !silent && MODE_CONFIG[session.mode].immediateFeedback
        ? (await computePeerStat(adminClient, entry.bankQuestionId, entry.subjectId))
            .pct
        : null;

    // ── persist the attempt ────────────────────────────────────────────────
    // One row per answer submission. Re-answering a question in exam_sim
    // (autosave, or a student changing their mind) writes another row; the
    // final grade comes from /submit reading the session key against the last
    // submitted answers, so duplicates here are history, not double-counting.
    const { error: insertErr } = await adminClient
      .from("student_question_attempts")
      .insert({
        student_id: user.id,
        question_id: entry.bankQuestionId,
        subject_id: entry.subjectId,
        module_id: entry.moduleId,
        question_text: entry.questionText,
        question_type: entry.type,
        student_answer: studentAnswer,
        is_correct: isCorrect,
        time_taken_seconds: timeTakenSeconds,
        source: entry.source,
        session_id: sessionId,
      });
    if (insertErr) {
      // Non-fatal, same policy as /submit: losing a history row is bad, losing
      // the feedback the student is waiting on is worse.
      console.warn(`[assessment/answer] attempt insert failed: ${insertErr.message}`);
    }

    const ms = Date.now() - t0;
    if (ms > 400) {
      // Logged, not thrown. The budget is 200ms; 400 is the "look at this"
      // line so a regression shows up in logs before a student feels it.
      console.warn(`[assessment/answer] slow response: ${ms}ms (session ${sessionId})`);
    }

    // ── response ───────────────────────────────────────────────────────────
    // Feedback is gated on the MODE, never on the request. An exam_sim client
    // asking nicely for the answer key still gets nothing.
    if (silent || !MODE_CONFIG[session.mode].immediateFeedback) {
      return apiSuccess({ recorded: true, slotId, ms });
    }

    return apiSuccess({
      slotId,
      isCorrect,
      correctAnswer: entry.correctAnswer,
      explanation: entry.explanation,
      ...(peerStat != null ? { peerStat } : {}),
      ms,
    });
  } catch (err) {
    console.error("[assessment/answer]", err);
    return apiError("Internal server error", 500);
  }
}
