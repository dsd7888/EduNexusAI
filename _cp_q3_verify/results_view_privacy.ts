/**
 * CP-Q3 Part 5A — GET /api/assessment/results/[sessionId] cannot be read by
 * anyone but the owning student, and cannot be read before the session is
 * actually finished.
 *
 * The natural Part 5 addition to this codebase's RLS/ownership verification
 * pattern (CLAUDE.md's four-assertion template, as applied by
 * key_exposure.ts): this route bypasses RLS entirely (adminClient), so its
 * ownership check is pure application code — `session.student_id !== user.id`
 * in route.ts — and that is exactly the kind of check that silently regresses
 * when a route is refactored. There is no policy to fall back on here.
 *
 * FOUR THINGS PROVEN, each a distinct failure mode a single test would miss:
 *   1. an unrelated, real, authenticated student (student B) is refused
 *      student A's completed session — 403, not a redacted 200.
 *   2. the OWNING student reading a session that is NOT YET completed also
 *      gets refused — 404, not a partial/leaking payload. This is the one
 *      most likely to regress silently: it is easy to write the ownership
 *      check and forget the status check next to it.
 *   3. a request with no session at all — 401, proving the route is behind
 *      requireRole and not reachable by an anonymous fetch.
 *   4. a nonexistent sessionId — 404, not a 500 (the route must not assume
 *      the row exists before checking it).
 *
 *   npx tsx _cp_q3_verify/results_view_privacy.ts > out.txt 2>&1
 */

import { randomUUID } from "node:crypto";
import {
  signInAsStudent,
  waitForServer,
  onSignals,
  makeChecker,
  hr,
  sub,
  BASE_URL,
  type StudentSession,
} from "@/lib/testing/httpHarness";

const SUBJECT_ID = process.env.HARNESS_SUBJECT_ID ?? "74e25bc8-d2bc-4a11-8242-e0fefae8f3af";

async function main() {
  const c = makeChecker();
  await waitForServer();

  const studentA: StudentSession = await signInAsStudent(undefined, undefined, {
    templateEmail: "teststudent@gmail.com",
  });
  onSignals(studentA.cleanup);
  let studentB: StudentSession | null = null;
  let completedSessionId: string | null = null;
  let inProgressSessionId: string | null = null;

  try {
    hr("CP-Q3 Part 5A — RESULTS VIEW PRIVACY (real HTTP, two real students)");
    console.log(`student A (owner) ${studentA.email} (${studentA.userId})`);

    sub("1. seed a COMPLETED session for student A (service role — grading already covered by results_view.ts)");
    completedSessionId = randomUUID();
    const canary = "CANARY — if student B can read this, ownership is broken.";
    const seedQuestion = (slotId: string) => ({
      slotId,
      question: "Fabricated privacy-check question",
      type: "mcq" as const,
      options: ["A", "B", "C", "D"],
      marks: 1,
      subjectId: SUBJECT_ID,
      moduleId: null,
      difficulty: "easy" as const,
    });
    const { error: insErr } = await studentA.admin.from("quiz_sessions").insert({
      id: completedSessionId,
      student_id: studentA.userId,
      mode: "quick",
      subject_ids: [SUBJECT_ID],
      module_ids: null,
      config: {
        question_count: 1,
        difficulty: "mixed",
        question_types: ["mcq"],
        time_limit_minutes: null,
        negative_marking: false,
        preset: null,
        immediate_feedback: true,
        questions: [seedQuestion("S1")],
      },
      status: "completed",
      completed_at: new Date().toISOString(),
      score: 1,
      total_marks: 1,
    });
    if (insErr) throw new Error(`session insert failed: ${insErr.message}`);
    const { error: keyErr } = await studentA.admin.from("quiz_session_keys").insert({
      session_id: completedSessionId,
      key: [
        {
          slotId: "S1",
          type: "mcq",
          correctAnswer: "B",
          numericAnswer: null,
          numericTolerance: 0,
          explanation: canary,
          marks: 1,
          subjectId: SUBJECT_ID,
          moduleId: null,
          bankQuestionId: null,
          source: "ai_fresh",
          questionText: "Fabricated privacy-check question",
        },
      ],
    });
    if (keyErr) throw new Error(`key insert failed: ${keyErr.message}`);
    await studentA.admin.from("student_question_attempts").insert({
      student_id: studentA.userId,
      question_id: null,
      subject_id: SUBJECT_ID,
      module_id: null,
      question_text: "Fabricated privacy-check question",
      question_type: "mcq",
      student_answer: "B",
      is_correct: true,
      time_taken_seconds: 5,
      source: "ai_fresh",
      session_id: completedSessionId,
    });
    c.check("completed session + key + attempt seeded", true, completedSessionId.slice(0, 8));

    sub("2. positive control — student A (the owner) CAN read it");
    const ownRead = await studentA.json<{ sessionId: string }>(`/api/assessment/results/${completedSessionId}`);
    c.eq("status 200", ownRead.status, 200);
    c.eq("sessionId echoes back", ownRead.body.sessionId, completedSessionId);

    sub("3. a second, unrelated, real authenticated student — 403");
    studentB = await signInAsStudent();
    const asB = await studentB.json(`/api/assessment/results/${completedSessionId}`);
    c.eq("status 403 (not a redacted 200, not a 404 that leaks existence ambiguously)", asB.status, 403);
    const bodyBlob = JSON.stringify(asB.body);
    c.check("the canary string appears nowhere in student B's response", !bodyBlob.includes("CANARY"));
    c.check("no correctAnswer/explanation leaked to student B", !bodyBlob.includes("correctAnswer") && !bodyBlob.includes("explanation"));

    sub("4. the OWNING student, but the session is NOT completed yet — 404");
    inProgressSessionId = randomUUID();
    const { error: ipErr } = await studentA.admin.from("quiz_sessions").insert({
      id: inProgressSessionId,
      student_id: studentA.userId,
      mode: "quick",
      subject_ids: [SUBJECT_ID],
      module_ids: null,
      config: {
        question_count: 1,
        difficulty: "mixed",
        question_types: ["mcq"],
        questions: [seedQuestion("S1")],
      },
      status: "in_progress",
      total_marks: 1,
    });
    if (ipErr) throw new Error(`in_progress session insert failed: ${ipErr.message}`);
    const midSession = await studentA.json(`/api/assessment/results/${inProgressSessionId}`);
    c.eq(
      "status 404 for the OWNER reading an in_progress session (not a partial payload)",
      midSession.status,
      404
    );

    sub("5. no session at all — 401 (behind requireRole, not reachable anonymously)");
    const anonRes = await fetch(`${BASE_URL}/api/assessment/results/${completedSessionId}`, {
      redirect: "manual",
    });
    c.eq("status 401", anonRes.status, 401);

    sub("6. a nonexistent sessionId — 404, not 500");
    const missing = await studentA.json(`/api/assessment/results/${randomUUID()}`);
    c.eq("status 404", missing.status, 404);

    const { passed, failed } = c.summary();
    hr(`RESULTS VIEW PRIVACY: ${passed} passed, ${failed} failed`);
    process.exitCode = failed === 0 ? 0 : 1;
  } finally {
    if (completedSessionId) {
      await studentA.admin.from("quiz_session_keys").delete().eq("session_id", completedSessionId);
      await studentA.admin.from("quiz_sessions").delete().eq("id", completedSessionId);
    }
    if (inProgressSessionId) {
      await studentA.admin.from("quiz_sessions").delete().eq("id", inProgressSessionId);
    }
    const notesA = await studentA.cleanup();
    console.log(`\ncleanup (student A): ${notesA}`);
    if (studentB) {
      const notesB = await studentB.cleanup();
      console.log(`cleanup (student B): ${notesB}`);
    }
  }
}

main().catch((err) => {
  console.error("\nFATAL:", err);
  process.exit(1);
});
