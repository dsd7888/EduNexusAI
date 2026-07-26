/**
 * GET /api/assessment/landing
 *
 * Everything the /student/quiz landing renders about THIS student, in one
 * round trip: the per-mode signal on each card, the resumable sessions strip,
 * and the streak.
 *
 * WHY ONE ROUTE RATHER THAN FOUR CLIENT QUERIES
 * `quiz_sessions` and `student_topic_mastery` both carry student-own SELECT
 * policies, so the browser could read all of this directly. It shouldn't:
 * that is four round trips on a page students open constantly, the mastery
 * aggregation is real logic that would then live in a component, and the
 * "ready to level up" rule is a product decision that must match the mastery
 * hub (Part 5) exactly. One server read, one shape, one place to change it.
 *
 * Read-only. No AI, no writes, no rate limit — this is a page load.
 */

import { apiError, apiSuccess, requireRole } from "@/lib/api/helpers";
import { computeStreak } from "@/lib/assessment/streak";
import {
  LEVEL_UP_MIN_ACCURACY,
  LEVEL_UP_MIN_ATTEMPTS,
  QUICK_TREND_WINDOW,
} from "@/lib/assessment/landingSignals";

interface SessionRow {
  id: string;
  mode: "quick" | "mastery" | "exam_sim";
  status: string;
  started_at: string;
  completed_at: string | null;
  score: number | null;
  total_marks: number | null;
  subject_ids: string[] | null;
  config: {
    preset?: string | null;
    question_count?: number | null;
    time_limit_minutes?: number | null;
  } | null;
}

interface MasteryRow {
  subject_id: string;
  module_id: string;
  attempts_count: number;
  correct_count: number;
  accuracy: number | null;
  current_difficulty: string;
}

/** Percentage, or null when the session recorded no usable denominator. */
function pct(score: number | null, total: number | null): number | null {
  if (score == null || total == null || total <= 0) return null;
  return Math.round((score / total) * 100);
}

export async function GET() {
  try {
    const authResult = await requireRole(["student"]);
    if (authResult instanceof Response) return authResult;
    const { user, adminClient } = authResult;

    const [sessionsRes, masteryRes] = await Promise.all([
      adminClient
        .from("quiz_sessions")
        .select(
          "id, mode, status, started_at, completed_at, score, total_marks, subject_ids, config"
        )
        .eq("student_id", user.id)
        .order("started_at", { ascending: false })
        .limit(200),
      adminClient
        .from("student_topic_mastery")
        .select(
          "subject_id, module_id, attempts_count, correct_count, accuracy, current_difficulty"
        )
        .eq("student_id", user.id),
    ]);

    if (sessionsRes.error) return apiError(sessionsRes.error.message, 500);
    if (masteryRes.error) return apiError(masteryRes.error.message, 500);

    const sessions = (sessionsRes.data ?? []) as SessionRow[];
    const mastery = (masteryRes.data ?? []) as MasteryRow[];

    const completed = sessions.filter((s) => s.status === "completed");

    // ── Quick: score trend over the last N quick sessions ──────────────────
    // Oldest-first so the sparkline reads left→right as time. Sessions with no
    // usable score are dropped rather than plotted as 0 — a 0 they never
    // scored is a lie about their trend, and §16's whole premise is not
    // showing students failure they didn't earn.
    const quickTrend = completed
      .filter((s) => s.mode === "quick")
      .slice(0, QUICK_TREND_WINDOW)
      .map((s) => ({
        sessionId: s.id,
        at: s.completed_at ?? s.started_at,
        score: pct(s.score, s.total_marks),
      }))
      .filter((p): p is { sessionId: string; at: string; score: number } =>
        p.score != null
      )
      .reverse();

    // ── Mastery: aggregate % and the level-up counter ──────────────────────
    // Aggregate is attempt-weighted, not a mean of per-module percentages: a
    // module with 40 attempts should not carry the same weight as one with 3,
    // or a single lucky 3-question module inflates the headline number.
    const totalAttempts = mastery.reduce((n, m) => n + (m.attempts_count ?? 0), 0);
    const totalCorrect = mastery.reduce((n, m) => n + (m.correct_count ?? 0), 0);
    const masteryPct =
      totalAttempts > 0 ? Math.round((totalCorrect / totalAttempts) * 100) : null;

    // "Ready to level up": meets the accuracy bar and is one short of the
    // attempt threshold that would promote it (§16 promotes at ≥70% with ≥10
    // attempts). Surfacing it at 8 makes the next session feel consequential
    // rather than arbitrary. Modules already at 'hard' are excluded — there is
    // nothing above hard to level up to, and counting them would make the
    // number never go down.
    const readyToLevelUp = mastery.filter((m) => {
      const acc =
        m.accuracy != null
          ? m.accuracy
          : m.attempts_count > 0
            ? m.correct_count / m.attempts_count
            : 0;
      return (
        m.current_difficulty !== "hard" &&
        acc >= LEVEL_UP_MIN_ACCURACY &&
        m.attempts_count >= LEVEL_UP_MIN_ATTEMPTS &&
        m.attempts_count < 10
      );
    }).length;

    // ── Exam sim: the most recent GATE mock, if any ────────────────────────
    const lastGate = completed.find(
      (s) => s.mode === "exam_sim" && s.config?.preset === "gate"
    );
    const lastExamSim = lastGate ?? completed.find((s) => s.mode === "exam_sim");

    // ── Resume strip ───────────────────────────────────────────────────────
    // Newest first. The cron marks anything older than 4h abandoned, so an
    // in_progress row here is genuinely resumable.
    const inProgress = sessions
      .filter((s) => s.status === "in_progress")
      .map((s) => ({
        sessionId: s.id,
        mode: s.mode,
        preset: s.config?.preset ?? null,
        startedAt: s.started_at,
        questionCount: s.config?.question_count ?? null,
        timeLimitMinutes: s.config?.time_limit_minutes ?? null,
        subjectIds: s.subject_ids ?? [],
      }));

    // ── Streak ─────────────────────────────────────────────────────────────
    // Completed sessions only, every mode. An abandoned session is not
    // practice, and counting it would make the streak gameable by opening
    // three quizzes and closing the tab.
    const streak = computeStreak(
      completed.map((s) => s.completed_at ?? s.started_at)
    );

    return apiSuccess({
      quick: {
        trend: quickTrend,
        window: QUICK_TREND_WINDOW,
      },
      mastery: {
        aggregatePct: masteryPct,
        modulesPractised: mastery.length,
        readyToLevelUp,
      },
      examSim: lastExamSim
        ? {
            sessionId: lastExamSim.id,
            preset: lastExamSim.config?.preset ?? null,
            at: lastExamSim.completed_at ?? lastExamSim.started_at,
            scorePct: pct(lastExamSim.score, lastExamSim.total_marks),
            score: lastExamSim.score,
            totalMarks: lastExamSim.total_marks,
          }
        : null,
      inProgress,
      streak,
    });
  } catch (err) {
    console.error("[assessment/landing]", err);
    return apiError("Internal server error", 500);
  }
}
