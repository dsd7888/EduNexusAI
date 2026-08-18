/**
 * Server-side grading and mastery write-back (CP-Q2).
 *
 * Two rules govern this file:
 *
 *  1. NEVER TRUST THE CLIENT. `is_correct` is computed here from the stored
 *     answer key, never read from the request body. The client sends what the
 *     student typed and nothing else.
 *  2. MASTERY IS A PRACTICE SIGNAL, NOT A SCORE. quick and mastery update
 *     student_topic_mastery; exam_sim does not (MODE_CONFIG.updatesMastery) —
 *     a 3/day timed benchmark should not swing the difficulty state the
 *     practice loop depends on.
 *
 * Difficulty transitions mirror placement (§16) EXACTLY: promote at ≥70%
 * accuracy with ≥10 attempts and ≥2 sessions; demote below 40% with ≥5
 * attempts; easy ↔ medium ↔ hard with no level skipping.
 */

import type { createAdminClient } from "@/lib/db/supabase-server";
import { negativeMarksFor, type NegativeMarkingRule } from "./presets";
import type { AssessmentDifficulty, AssessmentQuestionType } from "./types";
import type { SessionAnswerKey } from "./runner";

type AdminClient = ReturnType<typeof createAdminClient>;

// ─── Answer checking ───────────────────────────────────────────────────────

const LETTERS = "ABCDEFGHIJ".split("");

function normaliseText(v: string): string {
  return v.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Parse an MSQ selection into a canonical sorted letter set. */
function letterSet(raw: string, optionCount?: number): string[] {
  const valid = optionCount
    ? new Set(LETTERS.slice(0, optionCount))
    : new Set(LETTERS);
  const out = new Set<string>();
  for (const piece of String(raw).split(/[|,;\s]+/)) {
    const p = piece.replace(/[()\.]/g, "").trim().toUpperCase();
    if (p.length === 1 && valid.has(p)) out.add(p);
  }
  return Array.from(out).sort();
}

/**
 * Is this answer correct? Type-aware, and deliberately strict:
 *  - MSQ is an EXACT SET match. Partial credit is not a thing in GATE MSQ, and
 *    silently awarding it would misreport readiness.
 *  - NAT uses the question's own student-facing tolerance (a PERCENTAGE), which
 *    is a different quantity from the verifier's 0.1% agreement threshold
 *    (see natVerify.ts).
 */
export function isAnswerCorrect(
  key: SessionAnswerKey,
  studentAnswer: string | null | undefined,
  optionCount?: number
): boolean {
  const given = (studentAnswer ?? "").trim();
  if (!given) return false;

  const type = key.type as AssessmentQuestionType;

  if (type === "nat") {
    const expected =
      typeof key.numericAnswer === "number"
        ? key.numericAnswer
        : Number(key.correctAnswer);
    const actual = Number(given.replace(/,/g, ""));
    if (!Number.isFinite(expected) || !Number.isFinite(actual)) return false;
    const tolerancePct = Number(key.numericTolerance ?? 0);
    const allowed = Math.abs(expected) * (tolerancePct / 100);
    return Math.abs(actual - expected) <= allowed;
  }

  if (type === "msq" || type === "multiple_correct") {
    const expected = letterSet(key.correctAnswer, optionCount);
    const actual = letterSet(given, optionCount);
    return (
      expected.length > 0 &&
      expected.length === actual.length &&
      expected.every((l, i) => l === actual[i])
    );
  }

  if (type === "mcq" || type === "match") {
    const expected = letterSet(key.correctAnswer, optionCount);
    const actual = letterSet(given, optionCount);
    if (expected.length === 1 && actual.length === 1) {
      return expected[0] === actual[0];
    }
    // Fall through to text comparison when the answer wasn't letter-shaped.
    return normaliseText(key.correctAnswer) === normaliseText(given);
  }

  if (type === "true_false") {
    return (
      normaliseText(key.correctAnswer).startsWith(
        normaliseText(given).startsWith("t") ? "t" : "f"
      ) && normaliseText(key.correctAnswer)[0] === normaliseText(given)[0]
    );
  }

  // short / descriptive: exact-ish match only. Anything cleverer needs an AI
  // judge, which is out of scope here — CP-Q3 can decide whether short-answer
  // items belong in an auto-graded mode at all.
  return normaliseText(key.correctAnswer) === normaliseText(given);
}

// ─── Scoring ───────────────────────────────────────────────────────────────

export interface GradedAnswer {
  slotId: string;
  questionIndex: number;
  studentAnswer: string | null;
  isCorrect: boolean;
  marksAwarded: number;
  correctAnswer: string;
  explanation: string;
  subjectId: string;
  moduleId: string | null;
  questionType: string;
  bankQuestionId: string | null;
  source: "bank" | "ai_fresh";
  questionText: string;
  timeTakenSeconds: number | null;
}

export interface ScoreResult {
  results: GradedAnswer[];
  score: number;
  totalMarks: number;
  correctCount: number;
  wrongCount: number;
  unansweredCount: number;
  negativeMarksApplied: number;
}

export interface SubmittedAnswer {
  questionIndex: number;
  slotId?: string;
  studentAnswer?: string | null;
  timeTakenSeconds?: number | null;
}

/**
 * Grade a whole submission against the stored key.
 *
 * Unanswered questions are never negatively marked — that is the GATE rule and
 * also the only defensible one: a student who skips has not guessed.
 */
export function gradeSubmission(
  key: SessionAnswerKey[],
  answers: SubmittedAnswer[],
  options: {
    negativeMarking: boolean;
    negativeMarkingRule: NegativeMarkingRule | null;
    optionCounts?: Record<string, number>;
  }
): ScoreResult {
  const bySlot = new Map(key.map((k) => [k.slotId, k]));
  const byIndex = key;

  const results: GradedAnswer[] = [];
  let score = 0;
  let negativeMarksApplied = 0;
  let correctCount = 0;
  let wrongCount = 0;
  let unansweredCount = 0;

  for (const answer of answers) {
    const k =
      (answer.slotId ? bySlot.get(answer.slotId) : undefined) ??
      byIndex[answer.questionIndex];
    if (!k) continue;

    const given = answer.studentAnswer ?? null;
    const answered = !!given && given.trim().length > 0;
    const correct = answered
      ? isAnswerCorrect(k, given, options.optionCounts?.[k.slotId])
      : false;

    let marksAwarded = 0;
    if (correct) {
      marksAwarded = k.marks;
      correctCount += 1;
    } else if (answered) {
      wrongCount += 1;
      if (options.negativeMarking && options.negativeMarkingRule) {
        const penalty = negativeMarksFor(
          options.negativeMarkingRule,
          k.type as AssessmentQuestionType,
          k.marks
        );
        marksAwarded = penalty;
        negativeMarksApplied += penalty;
      }
    } else {
      unansweredCount += 1;
    }

    score += marksAwarded;
    results.push({
      slotId: k.slotId,
      questionIndex: answer.questionIndex,
      studentAnswer: given,
      isCorrect: correct,
      marksAwarded,
      correctAnswer: k.correctAnswer,
      explanation: k.explanation,
      subjectId: k.subjectId,
      moduleId: k.moduleId,
      questionType: k.type,
      bankQuestionId: k.bankQuestionId,
      source: k.source,
      questionText: k.questionText,
      timeTakenSeconds: answer.timeTakenSeconds ?? null,
    });
  }

  return {
    results,
    score: Math.round(score * 100) / 100,
    totalMarks: key.reduce((s, k) => s + k.marks, 0),
    correctCount,
    wrongCount,
    unansweredCount,
    negativeMarksApplied: Math.round(negativeMarksApplied * 100) / 100,
  };
}

// ─── Mastery write-back ────────────────────────────────────────────────────

/** §16 thresholds, verbatim. */
const PROMOTE_ACCURACY = 0.7;
const PROMOTE_MIN_ATTEMPTS = 10;
const PROMOTE_MIN_SESSIONS = 2;
const DEMOTE_ACCURACY = 0.4;
const DEMOTE_MIN_ATTEMPTS = 5;

const LADDER: AssessmentDifficulty[] = ["easy", "medium", "hard"];

/** One step up or down — never a skipped level (§16). */
export function nextDifficulty(
  current: AssessmentDifficulty,
  accuracy: number,
  attempts: number,
  sessions: number
): AssessmentDifficulty {
  const i = LADDER.indexOf(current);
  if (
    accuracy >= PROMOTE_ACCURACY &&
    attempts >= PROMOTE_MIN_ATTEMPTS &&
    sessions >= PROMOTE_MIN_SESSIONS
  ) {
    return LADDER[Math.min(i + 1, LADDER.length - 1)];
  }
  if (accuracy < DEMOTE_ACCURACY && attempts >= DEMOTE_MIN_ATTEMPTS) {
    return LADDER[Math.max(i - 1, 0)];
  }
  return current;
}

export interface MasteryDelta {
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
}

/**
 * Fold one session's results into student_topic_mastery.
 *
 * Only called for modes whose MODE_CONFIG.updatesMastery is true. Items with no
 * module (moduleId null) contribute to no mastery row — a question that spans
 * modules has no single topic to credit.
 */
export async function updateMastery(
  admin: AdminClient,
  studentId: string,
  results: GradedAnswer[]
): Promise<MasteryDelta[]> {
  const byModule = new Map<
    string,
    { subjectId: string; moduleId: string; attempts: number; correct: number }
  >();
  for (const r of results) {
    if (!r.moduleId) continue;
    const key = `${r.subjectId}:${r.moduleId}`;
    const entry =
      byModule.get(key) ??
      { subjectId: r.subjectId, moduleId: r.moduleId, attempts: 0, correct: 0 };
    entry.attempts += 1;
    if (r.isCorrect) entry.correct += 1;
    byModule.set(key, entry);
  }
  if (byModule.size === 0) return [];

  const moduleIds = Array.from(byModule.values()).map((e) => e.moduleId);
  const { data: existingRows } = await admin
    .from("student_topic_mastery")
    .select(
      "id, subject_id, module_id, attempts_count, correct_count, sessions_count, accuracy, current_difficulty"
    )
    .eq("student_id", studentId)
    .in("module_id", moduleIds);
  const existing = new Map(
    ((existingRows ?? []) as Array<{
      id: string;
      subject_id: string;
      module_id: string;
      attempts_count: number;
      correct_count: number;
      sessions_count: number;
      accuracy: number | null;
      current_difficulty: string;
    }>).map((r) => [`${r.subject_id}:${r.module_id}`, r])
  );

  const deltas: MasteryDelta[] = [];
  const now = new Date().toISOString();

  for (const [key, entry] of byModule) {
    const prev = existing.get(key);
    const attemptsBefore = prev?.attempts_count ?? 0;
    const correctBefore = prev?.correct_count ?? 0;
    const sessionsBefore = prev?.sessions_count ?? 0;
    const difficultyBefore = (LADDER.includes(
      prev?.current_difficulty as AssessmentDifficulty
    )
      ? prev!.current_difficulty
      : "easy") as AssessmentDifficulty;

    const attemptsAfter = attemptsBefore + entry.attempts;
    const correctAfter = correctBefore + entry.correct;
    const sessionsAfter = sessionsBefore + 1;
    const accuracyAfter = attemptsAfter > 0 ? correctAfter / attemptsAfter : 0;
    const difficultyAfter = nextDifficulty(
      difficultyBefore,
      accuracyAfter,
      attemptsAfter,
      sessionsAfter
    );

    const row = {
      student_id: studentId,
      subject_id: entry.subjectId,
      module_id: entry.moduleId,
      attempts_count: attemptsAfter,
      correct_count: correctAfter,
      sessions_count: sessionsAfter,
      accuracy: Math.round(accuracyAfter * 10000) / 10000,
      current_difficulty: difficultyAfter,
      last_practiced_at: now,
      updated_at: now,
    };

    const { error } = await admin
      .from("student_topic_mastery")
      .upsert(row, { onConflict: "student_id,subject_id,module_id" });
    if (error) {
      console.warn(
        `[grading] mastery upsert failed for module ${entry.moduleId}: ${error.message}`
      );
      continue;
    }

    deltas.push({
      subjectId: entry.subjectId,
      moduleId: entry.moduleId,
      attemptsBefore,
      attemptsAfter,
      accuracyBefore:
        attemptsBefore > 0 ? correctBefore / attemptsBefore : null,
      accuracyAfter,
      difficultyBefore,
      difficultyAfter,
      promoted: LADDER.indexOf(difficultyAfter) > LADDER.indexOf(difficultyBefore),
      demoted: LADDER.indexOf(difficultyAfter) < LADDER.indexOf(difficultyBefore),
    });
  }

  return deltas;
}

/** Bump usage counters for bank questions actually served. */
export async function recordBankUsage(
  admin: AdminClient,
  bankIds: string[]
): Promise<void> {
  const ids = Array.from(new Set(bankIds.filter(Boolean)));
  if (ids.length === 0) return;
  const { data } = await admin
    .from("faculty_question_bank")
    .select("id, usage_count")
    .in("id", ids);
  const now = new Date().toISOString();
  await Promise.all(
    ((data ?? []) as Array<{ id: string; usage_count: number }>).map((row) =>
      admin
        .from("faculty_question_bank")
        .update({
          usage_count: (row.usage_count ?? 0) + 1,
          last_used_at: now,
        })
        .eq("id", row.id)
    )
  );
}
