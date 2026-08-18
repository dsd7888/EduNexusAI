import type { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/db/supabase-server";
import { requireRole, apiError, apiSuccess, logCappedError } from "@/lib/api/helpers";
import { recomputeOverall } from "@/lib/placement/readiness";
import { TRACK_SECTIONS, type Track } from "@/lib/placement/tracks";
import type { DrillAttempt, PlacementTarget } from "@/types/placement";

export const maxDuration = 30;

type Difficulty = "easy" | "medium" | "hard";

const VALID_TRACKS = new Set<string>([
  "aptitude",
  "verbal",
  "domain",
  "communication",
]);

const UUID_RE = /^[0-9a-f-]{36}$/i;

// Client `is_correct` is NEVER trusted — parsed here only to satisfy the
// DrillAttempt shape; it is overwritten below from a server-side bank lookup
// before any grading, stats, or mastery calculation happens.
function parseValidAttempts(raw: unknown[]): DrillAttempt[] {
  const valid: DrillAttempt[] = [];

  for (const item of raw) {
    if (!item || typeof item !== "object") continue;

    const att = item as Record<string, unknown>;
    const questionId = att.question_id;
    if (typeof questionId !== "string" || !UUID_RE.test(questionId)) continue;

    valid.push({
      question_id: questionId,
      selected_answer:
        typeof att.selected_answer === "string" ? att.selected_answer : null,
      is_correct: false,
      is_skipped: att.is_skipped === true,
      time_spent_seconds:
        typeof att.time_spent_seconds === "number" ? att.time_spent_seconds : 0,
    });
  }

  return valid;
}

function normalizeAnswerKey(v: string | null | undefined): string {
  return (v ?? "").trim().toUpperCase();
}

function resolveSessionDuration(raw: unknown): number {
  if (typeof raw !== "number" || Number.isNaN(raw)) return 0;
  return Math.min(3600, Math.max(1, raw));
}

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireRole(["student"]);
    if (authResult instanceof Response) return authResult;

    const { user } = authResult;

    const body = (await request.json()) as {
      attempts?: unknown;
      track?: unknown;
      topic?: unknown;
      company_context?: unknown;
      session_duration_seconds?: unknown;
    };

    const { attempts, track, topic, company_context, session_duration_seconds } =
      body;

    if (!Array.isArray(attempts) || attempts.length === 0 || attempts.length > 20) {
      return apiError(
        "attempts must be a non-empty array with at most 20 items",
        400
      );
    }

    if (typeof track !== "string" || !VALID_TRACKS.has(track)) {
      return apiError(
        "track must be one of: aptitude, verbal, domain, communication",
        400
      );
    }

    if (typeof topic !== "string") {
      return apiError("topic is required", 400);
    }

    const topicTrimmed = topic.trim();
    if (!topicTrimmed || topicTrimmed.length > 100) {
      return apiError("topic must be a non-empty string up to 100 characters", 400);
    }
    // topic is meant to be one of TRACK_SECTIONS' fixed labels for this track,
    // never arbitrary client text — reject anything else before it reaches a
    // query (same bug class as the assessment engine's subjectIds finding).
    const knownTopicsForTrack = new Set(
      TRACK_SECTIONS[track as Track].flatMap((section) => section.topics)
    );
    if (!knownTopicsForTrack.has(topicTrimmed)) {
      return apiError("topic is not a recognized topic for this track", 400);
    }

    const validAttempts = parseValidAttempts(attempts);
    const companyCtx =
      company_context && typeof company_context === "string"
        ? company_context
        : null;
    const durationSecs = resolveSessionDuration(session_duration_seconds);
    const warnings: string[] = [];

    const adminClient = createAdminClient();

    // ── Step 0: Server-side re-grading (never trust client `is_correct`) ──────
    // A forged `is_correct: true` on an all-wrong session must not reach the
    // mastery/readiness writes below — look up the canonical answer for every
    // submitted question_id and recompute correctness from that.
    const distinctQuestionIds = [
      ...new Set(validAttempts.map((a) => a.question_id)),
    ];

    // Per-question answer key + explanation, keyed by question_id — this is
    // the ONLY place the client is allowed to learn correct_answer/explanation
    // (CP-08: /prep/generate never ships it pre-answer).
    const grading: Record<
      string,
      { correct_answer: string; explanation: string; is_correct: boolean }
    > = {};

    if (distinctQuestionIds.length > 0) {
      const { data: answerRows, error: answerFetchError } = await adminClient
        .from("placement_question_bank")
        .select("id, correct_answer, explanation")
        .in("id", distinctQuestionIds);

      if (answerFetchError) {
        console.error(
          "[placement-submit] Answer-key fetch error:",
          answerFetchError
        );
        return apiError("Failed to load question data", 500);
      }

      const answerMap = new Map(
        (answerRows ?? []).map((r) => [
          r.id as string,
          { correct_answer: r.correct_answer as string, explanation: r.explanation as string },
        ])
      );

      let unknownQuestionCount = 0;
      for (const att of validAttempts) {
        const answerKey = answerMap.get(att.question_id);
        if (answerKey === undefined) {
          // Unknown/forged question_id — can't be graded; exclude from
          // scoring entirely rather than trusting anything the client sent.
          unknownQuestionCount += 1;
          att.is_skipped = true;
          att.is_correct = false;
          continue;
        }
        att.is_correct =
          !att.is_skipped &&
          att.selected_answer !== null &&
          normalizeAnswerKey(att.selected_answer) ===
            normalizeAnswerKey(answerKey.correct_answer);
        grading[att.question_id] = {
          correct_answer: answerKey.correct_answer,
          explanation: answerKey.explanation,
          is_correct: att.is_correct,
        };
      }

      if (unknownQuestionCount > 0) {
        warnings.push(
          `${unknownQuestionCount} attempt${unknownQuestionCount === 1 ? "" : "s"} referenced an unknown question and were excluded from grading`
        );
      }
    }

    // ── Step 1: Insert attempts (best-effort, parallel) ───────────────────────
    const insertResults = await Promise.allSettled(
      validAttempts.map((a) =>
        adminClient.from("placement_question_attempts").insert({
          student_id: user.id,
          question_id: a.question_id,
          selected_answer: a.selected_answer,
          is_correct: a.is_correct,
          is_skipped: a.is_skipped,
          time_spent_seconds: a.time_spent_seconds,
          track,
          topic: topicTrimmed,
          company_context: companyCtx,
        })
      )
    );

    let failedInserts = 0;
    for (const result of insertResults) {
      if (result.status === "rejected") {
        failedInserts += 1;
        console.error("[placement-submit] Attempt insert rejected:", result.reason);
        continue;
      }
      if (result.value.error) {
        failedInserts += 1;
        console.error("[placement-submit] Attempt insert error:", result.value.error);
      }
    }
    if (failedInserts > 0) {
      warnings.push(
        `${failedInserts} attempt insert${failedInserts === 1 ? "" : "s"} failed`
      );
    }

    // ── Step 2: Update bank stats (best-effort, parallel) ─────────────────────
    const answeredAttempts = validAttempts.filter((a) => !a.is_skipped);

    if (answeredAttempts.length > 0) {
      const questionIds = answeredAttempts.map((a) => a.question_id);

      const { data: bankRows } = await adminClient
        .from("placement_question_bank")
        .select("id, times_served, times_correct, avg_time_seconds")
        .in("id", questionIds);

      const bankMap = new Map(
        (bankRows ?? []).map((r) => [
          r.id as string,
          r as {
            id: string;
            times_served: number;
            times_correct: number;
            avg_time_seconds: number | null;
          },
        ])
      );

      const bankResults = await Promise.allSettled(
        answeredAttempts.map(async (attempt) => {
          try {
            const row = bankMap.get(attempt.question_id);
            if (!row) return;

            const prevServed = row.times_served ?? 0;
            const prevCorrect = row.times_correct ?? 0;
            const newTimesServed = prevServed + 1;
            const newTimesCorrect = prevCorrect + (attempt.is_correct ? 1 : 0);
            const qualityScore = newTimesCorrect / Math.max(newTimesServed, 1);
            const prevAvg = row.avg_time_seconds ?? 0;
            const newAvgTime =
              (prevAvg * Math.max(newTimesServed - 1, 0) +
                attempt.time_spent_seconds) /
              Math.max(newTimesServed, 1);

            const { error } = await adminClient
              .from("placement_question_bank")
              .update({
                times_served: newTimesServed,
                times_correct: newTimesCorrect,
                quality_score: qualityScore,
                avg_time_seconds: newAvgTime,
              })
              .eq("id", attempt.question_id);

            if (error) {
              throw error;
            }
          } catch (err) {
            console.error(
              `[placement-submit] Bank stat update failed for ${attempt.question_id}:`,
              err
            );
            throw err;
          }
        })
      );

      const failedBankUpdates = bankResults.filter(
        (r) => r.status === "rejected"
      ).length;
      if (failedBankUpdates > 0) {
        warnings.push(
          `${failedBankUpdates} bank stat update${failedBankUpdates === 1 ? "" : "s"} failed`
        );
      }
    }

    // ── Step 3: Upsert placement_topic_mastery (critical path) ─────────────────
    // CP-05: delegated to an atomic RPC (advisory-lock-guarded upsert) instead
    // of a JS read-then-write — two concurrent submits for the same
    // (student_id, track, topic) previously raced on a stale read and lost one
    // submission's contribution to the accumulator (sessions_count, etc.).
    const sessionAttempted = answeredAttempts.length;
    const sessionCorrect = validAttempts.filter((a) => a.is_correct).length;
    const sessionAccuracy =
      sessionAttempted > 0
        ? (sessionCorrect / Math.max(sessionAttempted, 1)) * 100
        : 0;

    if (sessionAttempted === 0) {
      const { data: existingMastery, error: masteryFetchError } = await adminClient
        .from("placement_topic_mastery")
        .select("*")
        .eq("student_id", user.id)
        .eq("track", track)
        .eq("topic", topicTrimmed)
        .maybeSingle();

      if (masteryFetchError) {
        console.error("[placement-submit] Mastery fetch error:", masteryFetchError);
        return apiError("Failed to load mastery record", 500);
      }

      return apiSuccess({
        mastery: existingMastery ?? null,
        difficulty_changed: false,
        new_difficulty:
          (existingMastery?.current_difficulty as Difficulty | undefined) ??
          "easy",
        readiness_updated: false,
        warnings,
        grading,
      });
    }

    const { data: masteryRpcData, error: masteryRpcError } = await adminClient.rpc(
      "upsert_placement_topic_mastery",
      {
        p_student_id: user.id,
        p_track: track,
        p_topic: topicTrimmed,
        p_session_attempted: sessionAttempted,
        p_session_correct: sessionCorrect,
        p_session_accuracy: sessionAccuracy,
      }
    );

    if (masteryRpcError || !masteryRpcData) {
      console.error("[placement-submit] Mastery upsert RPC error:", masteryRpcError);
      return apiError("Failed to update mastery", 500);
    }

    const { mastery: masteryData, prev_difficulty: prevDifficulty } =
      masteryRpcData as {
        mastery: { current_difficulty: Difficulty } & Record<string, unknown>;
        prev_difficulty: Difficulty | null;
      };
    const newDifficulty: Difficulty = masteryData.current_difficulty ?? "easy";
    const difficultyChanged =
      prevDifficulty !== null && prevDifficulty !== newDifficulty;

    // ── Step 4: Recompute readiness scores from mastery (non-fatal) ────────────
    let readinessUpdated = false;
    try {
      const { data: allMastery } = await adminClient
        .from("placement_topic_mastery")
        .select("track, recent_accuracy, attempts_count")
        .eq("student_id", user.id);

      const masteryRows = (allMastery ?? []) as Array<{
        track: string;
        recent_accuracy: number;
        attempts_count: number;
      }>;

      const { data: existingProfile, error: profileFetchError } = await adminClient
        .from("student_placement_profiles")
        .select(
          "readiness_aptitude, readiness_verbal, readiness_domain, readiness_coding, readiness_communication, primary_target"
        )
        .eq("student_id", user.id)
        .maybeSingle();

      if (profileFetchError || !existingProfile) {
        throw profileFetchError ?? new Error("No placement profile found");
      }

      // Weighted average of recent_accuracy across a track's topics.
      const weightedScore = (trackName: string, existingScore: number): number => {
        const rows = masteryRows.filter((r) => r.track === trackName);
        if (rows.length === 0) return existingScore;
        const totalAttempts = rows.reduce((s, r) => s + (r.attempts_count ?? 0), 0);
        if (totalAttempts === 0) return existingScore;
        const weighted = rows.reduce(
          (s, r) => s + (r.recent_accuracy ?? 0) * (r.attempts_count ?? 0),
          0
        );
        return Math.round(weighted / Math.max(totalAttempts, 1));
      };

      const newAptitude = weightedScore("aptitude", existingProfile.readiness_aptitude ?? 0);
      const newVerbal = weightedScore("verbal", existingProfile.readiness_verbal ?? 0);
      const newDomain = weightedScore("domain", existingProfile.readiness_domain ?? 0);
      const newCommunication = weightedScore(
        "communication",
        existingProfile.readiness_communication ?? 0
      );

      // coding has no track yet — keep existing score.
      const newOverall = recomputeOverall({
        readiness_aptitude: newAptitude,
        readiness_verbal: newVerbal,
        readiness_domain: newDomain,
        readiness_coding: existingProfile.readiness_coding ?? 0,
        readiness_communication: newCommunication,
        primary_target: existingProfile.primary_target as PlacementTarget,
      });

      const { error: profileUpdateError } = await adminClient
        .from("student_placement_profiles")
        .update({
          readiness_aptitude: newAptitude,
          readiness_verbal: newVerbal,
          readiness_domain: newDomain,
          readiness_communication: newCommunication,
          readiness_overall: newOverall,
          last_active_date: new Date().toISOString().slice(0, 10),
        })
        .eq("student_id", user.id);

      if (profileUpdateError) throw profileUpdateError;
      readinessUpdated = true;
    } catch (readinessError) {
      console.error("[placement-submit] Readiness recompute failed:", readinessError);
      readinessUpdated = false;
    }

    return apiSuccess({
      mastery: masteryData,
      difficulty_changed: difficultyChanged,
      new_difficulty: newDifficulty,
      readiness_updated: readinessUpdated,
      warnings,
      grading,
    });
  } catch (error) {
    logCappedError("[placement-submit] Error:", error);
    return apiError("Internal server error", 500);
  }
}
