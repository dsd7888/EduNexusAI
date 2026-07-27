/**
 * CP-Q3 Part 5A — GET /api/assessment/results/[sessionId], over real HTTP.
 *
 * Two scenarios, matching the checkpoint brief exactly:
 *
 *   (A) MASTERY — a real mastery session (real /api/assessment/mastery →
 *       real generation, real AI spend, same acceptance as session_flow.ts),
 *       scoped to ONE module so the before/after arithmetic is exact: a fresh
 *       ephemeral student has attemptsBefore=0 for every module, so scripting
 *       7/10 correct (70%) on a 10-question single-module session produces a
 *       clean, independently-computable accuracyAfter=0.70. Promotion needs
 *       sessions_count≥2 (grading.ts), so this ALSO verifies the (easy to get
 *       wrong) invariant that one session — however good — cannot promote a
 *       module on its own.
 *
 *   (B) EXAM_SIM — a FABRICATED session (seeded via the service role, same
 *       precedent as key_exposure.ts: "written with the service role rather
 *       than by driving the real route, so this costs no AI spend and tests
 *       the storage shape in isolation"). GATE-authentic negative marking
 *       (preset='gate') is a config flag on quiz_sessions, not something only
 *       the real GATE preset (65 questions, ~minutes of generation) can set —
 *       so this seeds a small, deterministic 2-subject/6-question paper with
 *       config.negative_marking=true directly, and drives the REAL
 *       /api/assessment/submit and /api/assessment/results routes against it.
 *       That exercises exactly the two routes under test (grading +
 *       reconstruction) without paying for exam generation that a different
 *       harness (exam_sim_timing.ts) already covers.
 *
 * Every "expected" value below is computed independently in this file from
 * the scripted correctness, not read back from the route's own output —
 * otherwise the check would be comparing the route to itself.
 *
 *   npx tsx _cp_q3_verify/results_view.ts > out.txt 2>&1
 */

import {
  signInAsStudent,
  waitForServer,
  onSignals,
  makeChecker,
  hr,
  sub,
  type StudentSession,
} from "@/lib/testing/httpHarness";
import { randomUUID } from "node:crypto";
import { negativeMarksFor } from "@/lib/assessment/presets";
import { nextDifficulty } from "@/lib/assessment/grading";

const SUBJECT_ID = process.env.HARNESS_SUBJECT_ID ?? "74e25bc8-d2bc-4a11-8242-e0fefae8f3af";

interface MasteryCreateResponse {
  sessionId: string;
  mode: string;
  questions: Array<{ slotId: string; options?: string[] | null; moduleId: string | null }>;
}

interface ResultsResponse {
  sessionId: string;
  mode: string;
  score: number;
  totalMarks: number;
  perQuestionResults: Array<{
    questionIndex: number;
    subjectId: string;
    moduleId: string | null;
    isCorrect: boolean;
    marks: number;
    studentAnswer: string | null;
    correctAnswer: string;
  }>;
  masteryDeltas?: Array<{
    subjectId: string;
    moduleId: string;
    attemptsBefore: number;
    attemptsAfter: number;
    accuracyBefore: number | null;
    accuracyAfter: number;
    difficultyBefore: string;
    difficultyAfter: string;
    promoted: boolean;
    demoted: boolean;
  }>;
  sectionalBreakdown?: Array<{
    subjectId: string;
    subjectName: string;
    correctCount: number;
    questionCount: number;
    marksAwarded: number;
    totalMarks: number;
    timeActualSeconds: number;
    timeTargetSeconds: number;
  }>;
  negativeMarkingImpact?: {
    rawScore: number;
    actualScore: number;
    delta: number;
    perTypeBreakdown: Record<"mcq" | "msq" | "nat", { wrong: number; penaltyPer: number; totalPenalty: number }>;
  };
  warnings?: string[];
}

interface KeyEntry {
  slotId: string;
  correctAnswer: string;
  moduleId: string | null;
}

async function main() {
  const c = makeChecker();
  await waitForServer();

  const s: StudentSession = await signInAsStudent(undefined, undefined, {
    templateEmail: "teststudent@gmail.com",
  });
  onSignals(s.cleanup);
  const fabricatedSessionIds: string[] = [];

  try {
    hr("CP-Q3 Part 5A — RESULTS VIEW (mastery + exam_sim, real HTTP)");
    console.log(`student ${s.email} (${s.userId})`);

    // ═══════════════════════════════════════════════════════════════════════
    // (A) MASTERY — real session, scripted 70% correct, single module
    // ═══════════════════════════════════════════════════════════════════════
    sub("A1. pick one module of the harness subject");
    const { data: moduleRow } = await s.admin
      .from("modules")
      .select("id, name")
      .eq("subject_id", SUBJECT_ID)
      .limit(1)
      .maybeSingle();
    if (!moduleRow) throw new Error(`no modules for subject ${SUBJECT_ID} — cannot scope the mastery test`);
    const moduleId = (moduleRow as { id: string }).id;
    console.log(`  module ${(moduleRow as { name: string }).name} (${moduleId})`);

    sub("A2. POST /api/assessment/mastery — 10 questions, scoped to this module");
    const masteryCreated = await s.json<MasteryCreateResponse>("/api/assessment/mastery", {
      method: "POST",
      body: JSON.stringify({
        subjectIds: [SUBJECT_ID],
        moduleIds: [moduleId],
        questionCount: 10,
        questionTypes: ["mcq"],
      }),
    });
    c.eq("status 200", masteryCreated.status, 200);
    if (masteryCreated.status !== 200) {
      console.log("  body:", JSON.stringify(masteryCreated.body).slice(0, 800));
      throw new Error("mastery session creation failed");
    }
    const masterySession = masteryCreated.body;
    fabricatedSessionIds.push(masterySession.sessionId);
    c.eq("all 10 questions scoped to the requested module", masterySession.questions.filter((q) => q.moduleId === moduleId).length, 10);

    sub("A3. positive control — read the key with the service role");
    const { data: masteryKeyRow } = await s.admin
      .from("quiz_session_keys")
      .select("key")
      .eq("session_id", masterySession.sessionId)
      .maybeSingle();
    const masteryKey = ((masteryKeyRow as { key?: KeyEntry[] } | null)?.key ?? []) as KeyEntry[];
    c.eq("key covers all 10 questions", masteryKey.length, 10);

    sub("A4. POST /api/assessment/submit — scripted 7/10 correct (70%)");
    const CORRECT_COUNT = 7;
    const masteryAnswers = masterySession.questions.map((q, i) => {
      const k = masteryKey.find((e) => e.slotId === q.slotId)!;
      const isCorrect = i < CORRECT_COUNT;
      const wrongLetter = (q.options ?? []).map((_, oi) => String.fromCharCode(65 + oi)).find((l) => l !== k.correctAnswer) ?? "Z";
      return {
        questionIndex: i,
        slotId: q.slotId,
        studentAnswer: isCorrect ? k.correctAnswer : wrongLetter,
        timeTakenSeconds: 20,
      };
    });
    const masterySubmitted = await s.json<{ score: number; masteryDeltas?: unknown[] }>("/api/assessment/submit", {
      method: "POST",
      body: JSON.stringify({ sessionId: masterySession.sessionId, answers: masteryAnswers }),
    });
    c.eq("status 200", masterySubmitted.status, 200);
    c.check(
      "submit's own masteryDeltas is present (mastery mode updates mastery)",
      Array.isArray(masterySubmitted.body.masteryDeltas),
      `${(masterySubmitted.body.masteryDeltas ?? []).length} delta(s)`
    );

    sub("A5. GET /api/assessment/results/[sessionId] — the durable, refresh-safe view");
    const masteryResults = await s.json<ResultsResponse>(`/api/assessment/results/${masterySession.sessionId}`);
    c.eq("status 200", masteryResults.status, 200);
    const mr = masteryResults.body;
    c.eq("mode is mastery", mr.mode, "mastery");
    c.eq("perQuestionResults covers all 10", mr.perQuestionResults.length, 10);
    c.eq(
      "correctCount matches the script (7 of 10)",
      mr.perQuestionResults.filter((p) => p.isCorrect).length,
      CORRECT_COUNT
    );

    c.check("masteryDeltas present", Array.isArray(mr.masteryDeltas) && mr.masteryDeltas.length > 0, `${(mr.masteryDeltas ?? []).length} delta(s)`);
    const delta = (mr.masteryDeltas ?? []).find((d) => d.moduleId === moduleId);
    c.check("the delta is for the scoped module", !!delta);
    if (delta) {
      // Independently computed expectation — a fresh ephemeral student has
      // never touched this module, so before=0/'easy' by construction.
      c.eq("attemptsBefore = 0 (fresh student)", delta.attemptsBefore, 0);
      c.eq("accuracyBefore = null (no prior attempts)", delta.accuracyBefore, null);
      c.eq("difficultyBefore = 'easy'", delta.difficultyBefore, "easy");
      c.eq("attemptsAfter = 10", delta.attemptsAfter, 10);
      c.check(
        "accuracyAfter = 0.70 (7/10)",
        Math.abs(delta.accuracyAfter - 0.7) < 1e-9,
        String(delta.accuracyAfter)
      );
      const expectedAfter = nextDifficulty("easy", 0.7, 10, 1); // sessionsAfter=1 for a first session
      c.eq(
        "difficultyAfter matches nextDifficulty('easy', 0.70, attempts=10, sessions=1)",
        delta.difficultyAfter,
        expectedAfter
      );
      c.eq(
        "NOT promoted — one session cannot promote regardless of accuracy (PROMOTE_MIN_SESSIONS=2)",
        delta.promoted,
        false
      );
    }
    c.check("no 'no_snapshot' warning — this session has a masterySnapshot", !(mr.warnings ?? []).includes("no_snapshot"));

    // ═══════════════════════════════════════════════════════════════════════
    // (B) EXAM_SIM — fabricated 2-subject / 6-question GATE-rule session
    // ═══════════════════════════════════════════════════════════════════════
    sub("B1. a second subject to prove sectionalBreakdown actually groups by subject");
    const { data: otherSubjectRow } = await s.admin
      .from("subjects")
      .select("id, name")
      .neq("id", SUBJECT_ID)
      .limit(1)
      .maybeSingle();
    if (!otherSubjectRow) throw new Error("need a second subject seeded to test multi-subject sectional breakdown");
    const subjectA = SUBJECT_ID;
    const subjectB = (otherSubjectRow as { id: string }).id;
    console.log(`  subjectA=${subjectA} subjectB=${subjectB}`);

    sub("B2. seed a fabricated exam_sim session (service role — no AI spend, see header)");
    const MARKS = 2;
    const TIME_LIMIT_MIN = 60;
    const makeQ = (slotId: string, subjectId: string) => ({
      slotId,
      question: `Fabricated question ${slotId}`,
      type: "mcq" as const,
      options: ["A", "B", "C", "D"],
      marks: MARKS,
      subjectId,
      moduleId: null as string | null,
      difficulty: "medium" as const,
    });
    const makeKey = (slotId: string, subjectId: string) => ({
      slotId,
      type: "mcq",
      correctAnswer: "B",
      numericAnswer: null,
      numericTolerance: 0,
      explanation: `Explanation for ${slotId}.`,
      marks: MARKS,
      subjectId,
      moduleId: null,
      bankQuestionId: null,
      source: "ai_fresh",
      questionText: `Fabricated question ${slotId}`,
    });
    // 3 questions per subject; 2 correct + 1 wrong per subject — a real,
    // asymmetric-but-simple split so the per-subject scores actually differ
    // from a trivial 0 or 100.
    const slots = [
      { slotId: "S1", subjectId: subjectA, correct: true },
      { slotId: "S2", subjectId: subjectA, correct: true },
      { slotId: "S3", subjectId: subjectA, correct: false },
      { slotId: "S4", subjectId: subjectB, correct: true },
      { slotId: "S5", subjectId: subjectB, correct: true },
      { slotId: "S6", subjectId: subjectB, correct: false },
    ];
    const examSessionId = randomUUID();
    fabricatedSessionIds.push(examSessionId);
    const { error: examInsertErr } = await s.admin.from("quiz_sessions").insert({
      id: examSessionId,
      student_id: s.userId,
      mode: "exam_sim",
      subject_ids: [subjectA, subjectB],
      module_ids: null,
      config: {
        question_count: slots.length,
        difficulty: "mixed",
        question_types: ["mcq"],
        time_limit_minutes: TIME_LIMIT_MIN,
        negative_marking: true,
        negative_marking_rule: "gate_standard",
        preset: null,
        immediate_feedback: false,
        questions: slots.map((sl) => makeQ(sl.slotId, sl.subjectId)),
      },
      status: "in_progress",
      total_marks: slots.length * MARKS,
    });
    if (examInsertErr) throw new Error(`exam_sim session insert failed: ${examInsertErr.message}`);
    const { error: examKeyErr } = await s.admin.from("quiz_session_keys").insert({
      session_id: examSessionId,
      key: slots.map((sl) => makeKey(sl.slotId, sl.subjectId)),
    });
    if (examKeyErr) throw new Error(`exam_sim key insert failed: ${examKeyErr.message}`);
    c.check("fabricated session + key created", true, examSessionId.slice(0, 8));

    sub("B3. POST /api/assessment/submit — the REAL grading route, scripted answers");
    const examAnswers = slots.map((sl, i) => ({
      questionIndex: i,
      slotId: sl.slotId,
      // correctAnswer is always "B" above; a deliberately different letter is
      // "wrong" for every question type here (single-select MCQ).
      studentAnswer: sl.correct ? "B" : "C",
      timeTakenSeconds: 60,
    }));
    const examSubmitted = await s.json<{ score: number }>("/api/assessment/submit", {
      method: "POST",
      body: JSON.stringify({ sessionId: examSessionId, answers: examAnswers }),
    });
    c.eq("status 200", examSubmitted.status, 200);

    // Independent manual calculation — GATE-authentic MCQ penalty is -marks/3.
    const penalty = negativeMarksFor("gate_standard", "mcq", MARKS);
    const wrongCount = slots.filter((sl) => !sl.correct).length;
    const correctCount = slots.filter((sl) => sl.correct).length;
    // gradeSubmission rounds to 2dp (grading.ts) — round the expectation the
    // same way, or a repeating fraction like 2/3 fails on floating-point noise
    // that has nothing to do with correctness.
    const round2 = (n: number) => Math.round(n * 100) / 100;
    const expectedRawScore = round2(correctCount * MARKS);
    const expectedActualScore = round2(correctCount * MARKS + wrongCount * penalty);
    const expectedDelta = round2(expectedRawScore - expectedActualScore);

    const { data: examSessRow } = await s.admin
      .from("quiz_sessions")
      .select("score, status")
      .eq("id", examSessionId)
      .maybeSingle();
    c.eq("session closed (status=completed)", (examSessRow as { status: string })?.status, "completed");
    c.check(
      "persisted score matches the independent manual calculation",
      Math.abs(((examSessRow as { score: number })?.score ?? NaN) - expectedActualScore) < 1e-6,
      `persisted=${(examSessRow as { score: number })?.score} expected=${expectedActualScore}`
    );

    sub("B4. GET /api/assessment/results/[sessionId] — sectional + negative marking");
    const examResults = await s.json<ResultsResponse>(`/api/assessment/results/${examSessionId}`);
    c.eq("status 200", examResults.status, 200);
    const er = examResults.body;
    c.eq("mode is exam_sim", er.mode, "exam_sim");

    c.check("sectionalBreakdown present", Array.isArray(er.sectionalBreakdown), `${(er.sectionalBreakdown ?? []).length} section(s)`);
    c.eq("2 sections (one per subject)", (er.sectionalBreakdown ?? []).length, 2);
    for (const subjectId of [subjectA, subjectB]) {
      const section = (er.sectionalBreakdown ?? []).find((sec) => sec.subjectId === subjectId);
      c.check(`section exists for ${subjectId.slice(0, 8)}`, !!section);
      if (!section) continue;
      c.eq("questionCount = 3", section.questionCount, 3);
      c.eq("correctCount = 2", section.correctCount, 2);
      c.eq("totalMarks = 6", section.totalMarks, 3 * MARKS);
      c.eq("marksAwarded = 4 (2 correct * 2 marks, no penalty applied to marksAwarded itself)", section.marksAwarded, 2 * MARKS);
      c.eq("timeActualSeconds = 180 (3 * 60s)", section.timeActualSeconds, 180);
      // Mark-weighted even split across two equal-weight subjects = half the limit each.
      c.eq("timeTargetSeconds = half the session limit (equal-weight subjects)", section.timeTargetSeconds, (TIME_LIMIT_MIN * 60) / 2);
    }

    c.check("negativeMarkingImpact present", !!er.negativeMarkingImpact);
    if (er.negativeMarkingImpact) {
      c.check(
        "rawScore matches the independent calculation",
        Math.abs(er.negativeMarkingImpact.rawScore - expectedRawScore) < 1e-6,
        `${er.negativeMarkingImpact.rawScore} vs ${expectedRawScore}`
      );
      c.check(
        "actualScore matches the persisted session score",
        Math.abs(er.negativeMarkingImpact.actualScore - expectedActualScore) < 1e-6,
        `${er.negativeMarkingImpact.actualScore} vs ${expectedActualScore}`
      );
      c.check(
        "delta matches the independent calculation",
        Math.abs(er.negativeMarkingImpact.delta - expectedDelta) < 1e-6,
        `${er.negativeMarkingImpact.delta} vs ${expectedDelta}`
      );
      c.eq("perTypeBreakdown.mcq.wrong = 2", er.negativeMarkingImpact.perTypeBreakdown.mcq.wrong, wrongCount);
      c.check(
        "perTypeBreakdown.mcq.totalPenalty matches wrongCount * negativeMarksFor(...)",
        Math.abs(er.negativeMarkingImpact.perTypeBreakdown.mcq.totalPenalty - wrongCount * penalty) < 1e-6
      );
      c.eq("msq/nat untouched (wrong=0)", er.negativeMarkingImpact.perTypeBreakdown.msq.wrong, 0);
    }

    // ── summary ────────────────────────────────────────────────────────────
    const { passed, failed } = c.summary();
    hr(`RESULTS VIEW: ${passed} passed, ${failed} failed`);
    process.exitCode = failed === 0 ? 0 : 1;
  } finally {
    // Explicit residue check for the fabricated exam_sim session, in addition
    // to httpHarness's own per-student sweep (CLAUDE.md: verify cleanup, don't
    // assume it).
    for (const id of fabricatedSessionIds) {
      const { data: residue } = await s.admin.from("quiz_sessions").select("id").eq("id", id);
      if ((residue ?? []).length > 0) {
        console.log(`  pre-cleanup residue check: ${id} still present (will be swept by cleanup())`);
      }
    }
    const notes = await s.cleanup();
    console.log(`\ncleanup: ${notes}`);
  }
}

main().catch((err) => {
  console.error("\nFATAL:", err);
  process.exit(1);
});
