/**
 * The aggregate compute lib for faculty analytics (CP-Q4 Part 2).
 *
 * Every number a faculty member, HOD or Dean sees on an analytics surface is
 * produced here. Five pure functions plus one persistence wrapper:
 *
 *   computeAggregateAccuracy · computePerModule · computePerQuestion
 *   computeCOAttainment      · computeEngagement · refreshSnapshot
 *
 * The five compute functions are PURE — a data pull and constants in, a value
 * out. No Supabase, no clock except an injectable `now`, no writes. That is
 * what makes `_cp_q4_verify/aggregate_correctness.ts` able to assert them
 * against hand-calculated values to four decimal places, and what keeps the
 * persistence decision (upsert, staleness, cron) in exactly one place:
 * `refreshSnapshot`.
 *
 * ZERO AI CALLS. This entire checkpoint is DB aggregation — no `routeAI`, no
 * token budget, no `ai_call_logs` rows. If a future revision wants an
 * AI-written summary of a cohort, that is a new task through the router, not
 * an addition to this module.
 *
 * WHAT THIS MODULE DOES NOT DO, collectively:
 *   · It does not read chat, placement, or faculty-generated content. Analytics
 *     is scoped to assessment. Cross-feature aggregation is an explicit
 *     non-goal (Future_plans.MD), not a gap.
 *   · It does not enforce access. Callers must have already passed
 *     `assertAnalyticsAccess`. These functions will happily aggregate any
 *     subject id handed to them.
 *   · It does not apply the cohort privacy floor. `MIN_COHORT_FOR_AGGREGATE`
 *     is enforced at the response layer so the stored snapshot stays truthful
 *     for cron and debugging, and a cohort that grows past the floor does not
 *     need a recompute to become visible.
 */

import type { createAdminClient } from "@/lib/db/supabase-server";
import {
  attemptWeightedAccuracy,
  tallyAttempts,
} from "@/lib/assessment/aggregation";
import { computeStreak, weekStart, weeksBetween } from "@/lib/assessment/streak";
import { mappingWeight } from "./coWeighting";
import { MIN_ATTEMPTS_FOR_DISCRIMINATION } from "./privacy";

type AdminClient = ReturnType<typeof createAdminClient>;

// ─── Input row shapes ────────────────────────────────────────────────────────

export interface AttemptRow {
  student_id: string;
  question_id: string | null;
  module_id: string | null;
  question_text: string;
  question_type: string;
  is_correct: boolean | null;
  time_taken_seconds: number | null;
  session_id: string | null;
  created_at: string;
}

export interface ModuleRow {
  id: string;
  name: string;
  module_number: number;
  weightage_percent: number | null;
}

export interface SessionRow {
  id: string;
  student_id: string;
  status: string;
  mode: string;
  score: number | null;
  total_marks: number | null;
  started_at: string;
  completed_at: string | null;
}

export interface BankQuestionRow {
  id: string;
  question_text: string;
  question_type: string;
  module_id: string | null;
  co_code: string | null;
}

export interface ModuleCoRow {
  module_id: string;
  co_code: string;
  confidence: string | null;
  source: string | null;
}

// ─── Output shapes (mirror the snapshot's jsonb columns) ─────────────────────

export interface PerModuleEntry {
  module_id: string;
  module_name: string;
  module_number: number;
  weightage_percent: number | null;
  accuracy: number | null;
  attempts: number;
  students_count: number;
}

export interface PerQuestionEntry {
  question_id: string;
  question_text: string;
  question_type: string;
  module_id: string | null;
  times_served: number;
  times_correct: number;
  accuracy: number | null;
  avg_time_seconds: number | null;
  discrimination: number | null;
}

export interface COAttainmentEntry {
  co_code: string;
  weighted_accuracy: number | null;
  attempts: number;
  contributing_modules: string[];
}

export interface EngagementSummary {
  /** Distinct active students per week, OLDEST FIRST; index 7 = current week. */
  weekly_active_students: number[];
  streak_distribution: Record<"0" | "1-2" | "3-4" | "5+", number>;
  practice_frequency_median: number | null;
}

export interface SnapshotAggregates {
  student_count: number;
  session_count: number;
  attempt_count: number;
  aggregate_accuracy: number | null;
  per_module: PerModuleEntry[];
  per_question: PerQuestionEntry[];
  co_attainment: COAttainmentEntry[];
  engagement: EngagementSummary;
}

/** Weeks of history the engagement panel shows. */
export const ENGAGEMENT_WEEKS = 8;

/** A snapshot older than this is refreshed inline on the next faculty read. */
export const SNAPSHOT_STALE_AFTER_MS = 2 * 60 * 60 * 1000;

// ─── 1. Aggregate accuracy ───────────────────────────────────────────────────

/**
 * Attempt-weighted accuracy across the whole cohort, as a ratio in [0, 1].
 *
 * COMPUTES: one number — every graded attempt on this subject by every
 * student, pooled. Attempt-weighted, so a student who practised 200 questions
 * influences it more than one who practised 5. That is intended: this is
 * "how did the cohort do on the work it did", not "what is the average
 * student's score", which would be a different (and more easily skewed)
 * statistic.
 *
 * DOES NOT: exclude any student, weight students equally, drop outliers, or
 * separate modes — a GATE mock attempt and a quick-quiz attempt count the same
 * because both are the student answering a question about this subject.
 *
 * Delegates to the shared `aggregation.ts` so the cohort number and the
 * student's own mastery number on `/student/quiz` are the same arithmetic.
 * Returns null (never 0) when there are no attempts.
 */
export function computeAggregateAccuracy(
  attempts: readonly AttemptRow[]
): number | null {
  return attemptWeightedAccuracy([tallyAttempts(attempts)]);
}

// ─── 2. Per-module ───────────────────────────────────────────────────────────

/**
 * Accuracy, attempt count and distinct-student count per module.
 *
 * COMPUTES: one row per module OF THE SUBJECT, including modules with zero
 * attempts (accuracy null, counts 0). Ordered by `module_number` — syllabus
 * order, which is the order faculty think in. The dashboard re-sorts by
 * weightage for its own panel; the stored order stays canonical.
 *
 * DOES NOT: infer a module for attempts that have none. `module_id` is
 * nullable on `student_question_attempts` (an exam_sim item may legitimately
 * span modules), and those attempts are counted in the subject aggregate but
 * belong to no module row. Guessing a module for them would put fabricated
 * data into the panel faculty use to decide what to re-teach.
 */
export function computePerModule(
  attempts: readonly AttemptRow[],
  modules: readonly ModuleRow[]
): PerModuleEntry[] {
  const byModule = new Map<string, AttemptRow[]>();
  for (const a of attempts) {
    if (!a.module_id) continue;
    const list = byModule.get(a.module_id);
    if (list) list.push(a);
    else byModule.set(a.module_id, [a]);
  }

  return [...modules]
    .sort((a, b) => a.module_number - b.module_number)
    .map((m) => {
      const rows = byModule.get(m.id) ?? [];
      const students = new Set(rows.map((r) => r.student_id));
      return {
        module_id: m.id,
        module_name: m.name,
        module_number: m.module_number,
        weightage_percent: m.weightage_percent,
        accuracy: attemptWeightedAccuracy([tallyAttempts(rows)]),
        attempts: rows.length,
        students_count: students.size,
      };
    });
}

// ─── 3. Per-question (item analysis) ─────────────────────────────────────────

/**
 * Population standard deviation. Population, not sample: these are all the
 * attempts on the item, not a sample drawn from a larger pool, and the
 * point-biserial formula below is defined against the population SD.
 */
function populationStdDev(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance =
    values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * Point-biserial correlation between getting ONE item right and overall
 * performance.
 *
 *   r_pb = ((M1 − M0) / σ) · √(p · q)
 *
 * where M1/M0 are the mean overall scores of the students who got the item
 * right/wrong, σ is the population SD of those overall scores, and p/q are the
 * proportions right/wrong. This is the standard item-analysis statistic, and
 * the reason faculty care: r_pb < 0 means the students who did WELL overall
 * got this item wrong more often than the students who did badly — which is
 * almost always a miskeyed answer or an ambiguous stem, not a hard question.
 *
 * Returns null (never 0) when it cannot be computed:
 *   · fewer than MIN_ATTEMPTS_FOR_DISCRIMINATION pairs — noise with a decimal
 *     point;
 *   · every attempt correct or every attempt wrong (p or q = 0) — no variance
 *     in the item to correlate with anything;
 *   · zero variance in the overall scores (σ = 0) — every student scored
 *     identically, so nothing can discriminate between them.
 *
 * Null and 0 must stay distinct: 0 is a real finding ("this item tells you
 * nothing"), null means "not measurable yet". Collapsing them sorts unanswered
 * questions to the top of the broken-question list.
 */
export function pointBiserial(
  pairs: readonly { correct: boolean; overallScore: number }[]
): number | null {
  if (pairs.length < MIN_ATTEMPTS_FOR_DISCRIMINATION) return null;

  const right = pairs.filter((p) => p.correct);
  const wrong = pairs.filter((p) => !p.correct);
  if (right.length === 0 || wrong.length === 0) return null;

  const all = pairs.map((p) => p.overallScore);
  const sigma = populationStdDev(all);
  if (sigma === 0) return null;

  const mean = (xs: readonly number[]) =>
    xs.reduce((s, v) => s + v, 0) / xs.length;
  const m1 = mean(right.map((p) => p.overallScore));
  const m0 = mean(wrong.map((p) => p.overallScore));
  const p = right.length / pairs.length;
  const q = 1 - p;

  return ((m1 - m0) / sigma) * Math.sqrt(p * q);
}

/**
 * Item analysis for BANK questions only.
 *
 * COMPUTES: times served, times correct, accuracy, mean time, and
 * discrimination (point-biserial vs. the student's overall score in the
 * session that attempt belongs to) for every question in `questions` that has
 * at least one attempt.
 *
 * DOES NOT cover AI-generated (`source='ai_fresh'`) questions. Those carry
 * `question_id = null` because they have no persistent identity — the "same"
 * generated question is a fresh string each time, so pooling attempts across
 * them would be averaging statistics for different questions together and
 * presenting the result as one item's difficulty. Bank questions have a stable
 * id, which is exactly what makes item analysis meaningful for them.
 *
 * DOES NOT compute discrimination below MIN_ATTEMPTS_FOR_DISCRIMINATION
 * attempts (returns null for that field, while still reporting the counts).
 * DOES NOT judge, rank or auto-flag questions — it produces the statistic and
 * the UI states what it means; no question is ever hidden or disabled on the
 * strength of a number computed here.
 *
 * `sessionScores` maps session_id → that session's score as a fraction of its
 * total marks. Attempts whose session has no score (in-progress, or a session
 * row that never got graded) are excluded from the discrimination pairs but
 * still counted in times_served/times_correct — the item WAS served, and
 * dropping it from the counts would understate exposure.
 */
export function computePerQuestion(
  attempts: readonly AttemptRow[],
  questions: readonly BankQuestionRow[],
  sessionScores: ReadonlyMap<string, number>
): PerQuestionEntry[] {
  const byQuestion = new Map<string, AttemptRow[]>();
  for (const a of attempts) {
    if (!a.question_id) continue;
    const list = byQuestion.get(a.question_id);
    if (list) list.push(a);
    else byQuestion.set(a.question_id, [a]);
  }

  const questionById = new Map(questions.map((q) => [q.id, q]));

  const out: PerQuestionEntry[] = [];
  for (const [questionId, rows] of byQuestion) {
    const meta = questionById.get(questionId);
    // A question deleted from the bank leaves its attempts behind
    // (ON DELETE SET NULL only nulls question_id on the attempt going forward),
    // so a missing meta row is possible. Skip rather than render a blank card.
    if (!meta) continue;

    const timesCorrect = rows.filter((r) => r.is_correct === true).length;
    const timed = rows
      .map((r) => r.time_taken_seconds)
      .filter((t): t is number => typeof t === "number" && t >= 0);

    const pairs = rows
      .map((r) => {
        const score = r.session_id ? sessionScores.get(r.session_id) : undefined;
        return score === undefined
          ? null
          : { correct: r.is_correct === true, overallScore: score };
      })
      .filter((p): p is { correct: boolean; overallScore: number } => p !== null);

    out.push({
      question_id: questionId,
      question_text: meta.question_text,
      question_type: meta.question_type,
      module_id: meta.module_id,
      times_served: rows.length,
      times_correct: timesCorrect,
      accuracy: rows.length > 0 ? timesCorrect / rows.length : null,
      avg_time_seconds:
        timed.length > 0
          ? timed.reduce((s, t) => s + t, 0) / timed.length
          : null,
      discrimination: pointBiserial(pairs),
    });
  }

  // Worst discriminators first — the actionable end. Nulls (unmeasurable) sort
  // last so they never occupy the top of the faculty's review queue.
  return out.sort((a, b) => {
    if (a.discrimination == null && b.discrimination == null) return 0;
    if (a.discrimination == null) return 1;
    if (b.discrimination == null) return -1;
    return a.discrimination - b.discrimination;
  });
}

// ─── 4. CO attainment ────────────────────────────────────────────────────────

/**
 * Per-CO weighted accuracy — the NAAC-facing metric.
 *
 * COMPUTES: for each CO, the confidence-weighted accuracy of every attempt
 * whose module maps to that CO.
 *
 *   weighted_accuracy = Σ(w_i · correct_i) / Σ(w_i)
 *
 * where w_i is the trust weight of the module→CO mapping that pulled attempt i
 * into this CO (see `coWeighting.ts` — faculty-verified mappings weigh 1.0
 * regardless of the AI's original confidence; AI-origin mappings weigh by
 * their confidence band). An attempt whose module maps to three COs
 * contributes to all three, each at that mapping's own weight — a module
 * genuinely teaches toward several outcomes and splitting the attempt between
 * them would understate every one of them.
 *
 * `attempts` in the result is the RAW count of contributing attempts, not the
 * weighted sum. Faculty reading "CO 3: 61% over 240 attempts" need the real
 * exposure figure; a weighted 187.2 would look like a bug.
 *
 * WHAT THIS IS NOT — the distinction the whole metric rests on:
 *   This is CO attainment from ACTUAL STUDENT PERFORMANCE. It is NOT question-
 *   paper CO coverage, which is what the Q-paper generator already reports and
 *   what most accreditation tooling means by "CO mapping". Coverage answers
 *   "did we ASK about this outcome?"; this answers "did students DEMONSTRATE
 *   it?". A subject can have flawless coverage and 40% attainment, and that
 *   gap is the entire reason this panel exists.
 *
 * DOES NOT: apply an attainment threshold, assign an attainment LEVEL (the
 * 1/2/3 scale some rubrics use), or map CO→PO. Those are institution-specific
 * policy on top of this number, and baking one institution's rubric into the
 * computation would make the figure unusable elsewhere. The 60% callout in the
 * UI is a display threshold over this raw value, not part of it.
 */
export function computeCOAttainment(
  attempts: readonly AttemptRow[],
  moduleToCOs: readonly ModuleCoRow[]
): COAttainmentEntry[] {
  const byModule = new Map<string, ModuleCoRow[]>();
  for (const m of moduleToCOs) {
    const list = byModule.get(m.module_id);
    if (list) list.push(m);
    else byModule.set(m.module_id, [m]);
  }

  interface Acc {
    weightedCorrect: number;
    weightSum: number;
    attempts: number;
    modules: Set<string>;
  }
  const byCO = new Map<string, Acc>();

  for (const a of attempts) {
    if (!a.module_id) continue;
    const mappings = byModule.get(a.module_id);
    if (!mappings) continue;

    for (const mapping of mappings) {
      const w = mappingWeight(mapping);
      let acc = byCO.get(mapping.co_code);
      if (!acc) {
        acc = {
          weightedCorrect: 0,
          weightSum: 0,
          attempts: 0,
          modules: new Set(),
        };
        byCO.set(mapping.co_code, acc);
      }
      acc.weightSum += w;
      if (a.is_correct === true) acc.weightedCorrect += w;
      acc.attempts += 1;
      acc.modules.add(a.module_id);
    }
  }

  return [...byCO.entries()]
    .map(([co_code, acc]) => ({
      co_code,
      weighted_accuracy:
        acc.weightSum > 0 ? acc.weightedCorrect / acc.weightSum : null,
      attempts: acc.attempts,
      contributing_modules: [...acc.modules].sort(),
    }))
    .sort((a, b) =>
      a.co_code.localeCompare(b.co_code, undefined, { numeric: true })
    );
}

// ─── 5. Engagement ───────────────────────────────────────────────────────────

/**
 * Cohort engagement over the last ENGAGEMENT_WEEKS weeks.
 *
 * COMPUTES three things:
 *   · weekly_active_students — distinct students with ≥1 COMPLETED session,
 *     per Mon–Sun week, OLDEST FIRST (index 7 = the current, still-running
 *     week). Ordering is stated because a reversed array renders a plausible
 *     but wrong trend, and nothing about the numbers would look off.
 *   · streak_distribution — every student bucketed by their streak in this
 *     subject, using CP-Q3's `computeStreak` UNMODIFIED.
 *   · practice_frequency_median — median sessions per week among active
 *     students, measured over each student's OWN active span (their first
 *     session in the window through the current week), not a flat 8. A student
 *     who joined three weeks ago and practised 9 times is at 3/week, not
 *     1.1/week; dividing by the full window would report the cohort as less
 *     engaged than it is purely because some of it is new.
 *
 * DOES NOT count abandoned or in-progress sessions as practice — the same rule
 * the student's own streak uses (`status='completed'` only). Counting an
 * opened-and-closed tab would make engagement gameable and, worse, make the
 * faculty-facing number disagree with the number the student sees.
 *
 * STREAK SEMANTICS ARE NOT RELAXED AT COHORT SCALE. CP-Q3's rule that the
 * current week is PENDING, not failing, applies unchanged here. It would be
 * easy to argue that faculty want the "true" current state and should see a
 * student's streak as broken the moment Monday starts — that argument is
 * rejected. A streak means one thing in this product, and a faculty member
 * acting on a number that reads differently from the one the student sees
 * would be intervening on an artefact of whose screen it was rendered on.
 * `computeStreak` is imported, never reimplemented.
 */
export function computeEngagement(
  sessions: readonly SessionRow[],
  now: Date = new Date()
): EngagementSummary {
  const completed = sessions.filter(
    (s) => s.status === "completed" && (s.completed_at ?? s.started_at)
  );

  const currentWeek = weekStart(now);

  // ── weekly active students ──
  // Index 0 = (ENGAGEMENT_WEEKS - 1) weeks ago … index 7 = current week.
  const weeklyStudents: Array<Set<string>> = Array.from(
    { length: ENGAGEMENT_WEEKS },
    () => new Set<string>()
  );
  for (const s of completed) {
    const at = new Date(s.completed_at ?? s.started_at);
    if (Number.isNaN(at.getTime())) continue;
    const ago = weeksBetween(at, currentWeek);
    if (ago < 0 || ago >= ENGAGEMENT_WEEKS) continue;
    weeklyStudents[ENGAGEMENT_WEEKS - 1 - ago].add(s.student_id);
  }

  // ── per-student grouping ──
  const byStudent = new Map<string, SessionRow[]>();
  for (const s of completed) {
    const list = byStudent.get(s.student_id);
    if (list) list.push(s);
    else byStudent.set(s.student_id, [s]);
  }

  // ── streak distribution ──
  const distribution: EngagementSummary["streak_distribution"] = {
    "0": 0,
    "1-2": 0,
    "3-4": 0,
    "5+": 0,
  };
  for (const [, rows] of byStudent) {
    const { weeks } = computeStreak(
      rows.map((r) => r.completed_at ?? r.started_at),
      now
    );
    if (weeks === 0) distribution["0"] += 1;
    else if (weeks <= 2) distribution["1-2"] += 1;
    else if (weeks <= 4) distribution["3-4"] += 1;
    else distribution["5+"] += 1;
  }

  // ── practice frequency median ──
  const rates: number[] = [];
  for (const [, rows] of byStudent) {
    const inWindow = rows.filter((r) => {
      const ago = weeksBetween(new Date(r.completed_at ?? r.started_at), currentWeek);
      return ago >= 0 && ago < ENGAGEMENT_WEEKS;
    });
    if (inWindow.length === 0) continue;
    const oldestAgo = Math.max(
      ...inWindow.map((r) =>
        weeksBetween(new Date(r.completed_at ?? r.started_at), currentWeek)
      )
    );
    // +1 so a student whose first session is this week spans one week, not zero.
    rates.push(inWindow.length / (oldestAgo + 1));
  }
  rates.sort((a, b) => a - b);
  const median =
    rates.length === 0
      ? null
      : rates.length % 2 === 1
        ? rates[(rates.length - 1) / 2]
        : (rates[rates.length / 2 - 1] + rates[rates.length / 2]) / 2;

  return {
    weekly_active_students: weeklyStudents.map((s) => s.size),
    streak_distribution: distribution,
    practice_frequency_median: median,
  };
}

// ─── 6. refreshSnapshot (the only impure function here) ──────────────────────

/**
 * Pull one subject's data, run all five computations, upsert the snapshot.
 *
 * The ONLY function in this module that touches the database. Everything above
 * it is pure and independently testable; everything about persistence —
 * which tables, the upsert target, `computed_at` — is decided here and nowhere
 * else.
 *
 * Reads are issued in parallel where independent (§CP-Q3's parallelisation
 * pass): sessions, attempts, modules and CO mappings do not depend on each
 * other. The bank-question lookup does depend on the attempts, so it follows.
 *
 * Upserts on the NAMED constraint `faculty_analytics_snapshots_subject_id_key`
 * — one row per subject, forever. Two faculty on the same subject read the
 * same row by construction.
 *
 * DOES NOT check access. The caller must have passed `assertAnalyticsAccess`
 * first; the cron route bypasses that check legitimately because it runs under
 * the service role on behalf of no user.
 */
export async function refreshSnapshot(
  admin: AdminClient,
  subjectId: string,
  now: Date = new Date()
): Promise<SnapshotAggregates> {
  const [sessionsRes, attemptsRes, modulesRes] = await Promise.all([
    admin
      .from("quiz_sessions")
      .select("id, student_id, status, mode, score, total_marks, started_at, completed_at")
      .contains("subject_ids", [subjectId]),
    admin
      .from("student_question_attempts")
      .select(
        "student_id, question_id, module_id, question_text, question_type, is_correct, time_taken_seconds, session_id, created_at"
      )
      .eq("subject_id", subjectId),
    admin
      .from("modules")
      .select("id, name, module_number, weightage_percent")
      .eq("subject_id", subjectId),
  ]);

  const sessions = (sessionsRes.data ?? []) as SessionRow[];
  const attempts = (attemptsRes.data ?? []) as AttemptRow[];
  const modules = (modulesRes.data ?? []) as ModuleRow[];

  const moduleIds = modules.map((m) => m.id);
  const questionIds = [
    ...new Set(
      attempts.map((a) => a.question_id).filter((q): q is string => q !== null)
    ),
  ];

  const [coRes, questionsRes] = await Promise.all([
    moduleIds.length > 0
      ? admin
          .from("module_co_mapping")
          .select("module_id, co_code, confidence, source")
          .in("module_id", moduleIds)
      : Promise.resolve({ data: [] as ModuleCoRow[] }),
    questionIds.length > 0
      ? admin
          .from("faculty_question_bank")
          .select("id, question_text, question_type, module_id, co_code")
          .in("id", questionIds)
      : Promise.resolve({ data: [] as BankQuestionRow[] }),
  ]);

  const coMappings = (coRes.data ?? []) as ModuleCoRow[];
  const bankQuestions = (questionsRes.data ?? []) as BankQuestionRow[];

  // Session score as a fraction of total marks — the "overall performance"
  // term in the point-biserial. Sessions with no score or no total_marks
  // contribute no pair (see computePerQuestion).
  const sessionScores = new Map<string, number>();
  for (const s of sessions) {
    if (s.score != null && s.total_marks != null && s.total_marks > 0) {
      sessionScores.set(s.id, s.score / s.total_marks);
    }
  }

  const completedSessions = sessions.filter((s) => s.status === "completed");

  const aggregates: SnapshotAggregates = {
    // Students who have taken ≥1 session on this subject — not every enrolled
    // student. Analytics can only speak about students who generated data.
    student_count: new Set(completedSessions.map((s) => s.student_id)).size,
    session_count: completedSessions.length,
    attempt_count: attempts.length,
    aggregate_accuracy: computeAggregateAccuracy(attempts),
    per_module: computePerModule(attempts, modules),
    per_question: computePerQuestion(attempts, bankQuestions, sessionScores),
    co_attainment: computeCOAttainment(attempts, coMappings),
    engagement: computeEngagement(sessions, now),
  };

  const { error } = await admin.from("faculty_analytics_snapshots").upsert(
    {
      subject_id: subjectId,
      computed_at: now.toISOString(),
      ...aggregates,
    },
    { onConflict: "subject_id" }
  );

  if (error) {
    // A failed write is not a failed computation. The caller still gets real
    // numbers to render; the next read simply recomputes because computed_at
    // did not advance. Throwing here would turn a caching problem into a
    // blank dashboard.
    console.warn(
      `[refreshSnapshot] upsert failed for subject ${subjectId}: ${error.message}`
    );
  }

  return aggregates;
}
