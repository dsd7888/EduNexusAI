/**
 * CP-04 verify — /api/assessment/submit timer enforcement + atomic completion.
 *
 * Builds synthetic quiz_sessions/quiz_session_keys rows directly (bypassing
 * the generation pipeline — deterministic, no AI spend) for a real test
 * student, then drives the live route over HTTP with a real auth cookie
 * (magiclink -> verifyOtp, same pattern as _cp_d1_verify/api.mts).
 *
 * Asserts:
 *  1. A session whose timer has already expired is rejected (409), even with
 *     a full, otherwise-valid answer payload — was: 200/graded.
 *  2. Two concurrent /submit calls on one fresh 5-question session produce
 *     exactly ONE 200 and one 409, and exactly 5 student_question_attempts
 *     rows (not 10) — the atomic claim (`.eq('status','in_progress')`)
 *     working.
 *  3. Cleans up every row it created and verifies no residue.
 */
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import fs from "fs";

const env = Object.fromEntries(
  fs
    .readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((l) => l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1)];
    })
);

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const PROJECT_REF = new URL(SUPABASE_URL).hostname.split(".")[0];
const COOKIE_NAME = `sb-${PROJECT_REF}-auth-token`;
const BASE = "http://localhost:3000";

const admin = createClient(SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const anon = createClient(SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

const SUBJECT_ID = "43003036-429f-43f7-b416-f300650a1eab";
const MODULE_ID = "c435f40e-40e6-4d15-946f-392a90c05030";
const STUDENT_EMAIL = "teststudent@gmail.com";

const createdSessionIds: string[] = [];

async function cleanup() {
  for (const id of createdSessionIds) {
    await admin.from("student_question_attempts").delete().eq("session_id", id);
    await admin.from("quiz_session_keys").delete().eq("session_id", id);
    await admin.from("quiz_sessions").delete().eq("id", id);
  }
  let residue = 0;
  for (const id of createdSessionIds) {
    const { data: a } = await admin
      .from("student_question_attempts")
      .select("id")
      .eq("session_id", id);
    const { data: s } = await admin.from("quiz_sessions").select("id").eq("id", id);
    const { data: k } = await admin.from("quiz_session_keys").select("session_id").eq("session_id", id);
    residue += (a?.length ?? 0) + (s?.length ?? 0) + (k?.length ?? 0);
  }
  console.log(`[cleanup] residue rows across ${createdSessionIds.length} sessions: ${residue}`);
}
for (const sig of ["SIGINT", "SIGTERM", "SIGPIPE", "SIGHUP"] as const) {
  process.on(sig, async () => {
    await cleanup();
    process.exit(1);
  });
}

function makeQuestions(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    slotId: `S${i + 1}`,
    type: "mcq" as const,
    question: `CP-04 fixture question ${i + 1}?`,
    options: ["Alpha", "Bravo", "Charlie", "Delta"],
    correctAnswer: "A",
    numericAnswer: null,
    numericTolerance: 0,
    explanation: `Fixture explanation ${i + 1}.`,
    marks: 1,
    subjectId: SUBJECT_ID,
    moduleId: MODULE_ID,
    bankQuestionId: null,
    source: "ai_fresh" as const,
    difficulty: "easy" as const,
  }));
}

async function createSyntheticSession(opts: {
  timeLimitMinutes: number | null;
  startedAt: Date;
  questionCount: number;
}) {
  const id = randomUUID();
  const questions = makeQuestions(opts.questionCount);
  const { data: student } = await admin
    .from("profiles")
    .select("id")
    .eq("email", STUDENT_EMAIL)
    .single();
  const studentId = student!.id as string;

  const { error: sessErr } = await admin.from("quiz_sessions").insert({
    id,
    student_id: studentId,
    mode: "exam_sim",
    subject_ids: [SUBJECT_ID],
    module_ids: [MODULE_ID],
    config: {
      question_count: questions.length,
      difficulty: "easy",
      question_types: ["mcq"],
      time_limit_minutes: opts.timeLimitMinutes,
      negative_marking: false,
      negative_marking_rule: null,
      preset: null,
      immediate_feedback: false,
      questions: questions.map((q) => ({
        slotId: q.slotId,
        question: q.question,
        type: q.type,
        options: q.options,
        marks: q.marks,
        subjectId: q.subjectId,
        moduleId: q.moduleId,
        difficulty: q.difficulty,
      })),
    },
    status: "in_progress",
    total_marks: questions.length,
    started_at: opts.startedAt.toISOString(),
  });
  if (sessErr) throw new Error(`session insert failed: ${sessErr.message}`);

  const { error: keyErr } = await admin.from("quiz_session_keys").insert({
    session_id: id,
    key: questions.map((q) => ({
      slotId: q.slotId,
      type: q.type,
      correctAnswer: q.correctAnswer,
      numericAnswer: q.numericAnswer,
      numericTolerance: q.numericTolerance,
      explanation: q.explanation,
      marks: q.marks,
      subjectId: q.subjectId,
      moduleId: q.moduleId,
      bankQuestionId: q.bankQuestionId,
      source: q.source,
      questionText: q.question,
    })),
  });
  if (keyErr) throw new Error(`key insert failed: ${keyErr.message}`);

  createdSessionIds.push(id);
  return { id, questions };
}

function fullPayload(sessionId: string, questions: ReturnType<typeof makeQuestions>) {
  return {
    sessionId,
    answers: questions.map((q, i) => ({
      questionIndex: i,
      slotId: q.slotId,
      studentAnswer: "A",
      timeTakenSeconds: 10,
    })),
  };
}

async function main() {
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: STUDENT_EMAIL,
  });
  if (error || !data) throw new Error(`generateLink failed: ${error?.message}`);
  const { data: verified, error: verifyErr } = await anon.auth.verifyOtp({
    token_hash: data.properties.hashed_token,
    type: "magiclink",
  });
  if (verifyErr || !verified.session) throw new Error(`verifyOtp failed: ${verifyErr?.message}`);
  const cookie =
    `${COOKIE_NAME}=` +
    "base64-" + Buffer.from(JSON.stringify(verified.session), "utf8").toString("base64url");

  async function post(body: unknown) {
    const res = await fetch(`${BASE}/api/assessment/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, json };
  }

  let ok = true;

  // ── 1. Expired timer: 1-minute limit, started 5 minutes ago ──────────────
  console.log("=== 1. Expired-timer submit ===");
  const expired = await createSyntheticSession({
    timeLimitMinutes: 1,
    startedAt: new Date(Date.now() - 5 * 60 * 1000),
    questionCount: 5,
  });
  const expiredRes = await post(fullPayload(expired.id, expired.questions));
  console.log("  status:", expiredRes.status, "body:", JSON.stringify(expiredRes.json));
  if (expiredRes.status !== 409) {
    console.error("FAIL: expected 409 for a submit past the deadline, got", expiredRes.status);
    ok = false;
  } else {
    console.log("  PASS: late submit rejected (was: 200/graded).");
  }
  const { data: expiredSessionRow } = await admin
    .from("quiz_sessions")
    .select("status")
    .eq("id", expired.id)
    .single();
  console.log("  session status after rejected submit (should still be in_progress):", expiredSessionRow?.status);
  if (expiredSessionRow?.status !== "in_progress") {
    console.error("FAIL: a rejected late submit must not flip the session to completed.");
    ok = false;
  }
  const { data: expiredAttempts } = await admin
    .from("student_question_attempts")
    .select("id")
    .eq("session_id", expired.id);
  console.log("  attempt rows written for rejected session (should be 0):", expiredAttempts?.length ?? 0);
  if ((expiredAttempts?.length ?? 0) !== 0) {
    console.error("FAIL: rejected late submit must not write attempt rows.");
    ok = false;
  }

  // ── 2. Concurrent submit: two calls racing on one fresh session ──────────
  console.log("\n=== 2. Concurrent submit race ===");
  const fresh = await createSyntheticSession({
    timeLimitMinutes: null,
    startedAt: new Date(),
    questionCount: 5,
  });
  const payload = fullPayload(fresh.id, fresh.questions);
  const [r1, r2] = await Promise.all([post(payload), post(payload)]);
  console.log("  r1 status:", r1.status, "r2 status:", r2.status);
  const statuses = [r1.status, r2.status].sort();
  if (statuses[0] !== 200 || statuses[1] !== 409) {
    console.error(`FAIL: expected exactly one 200 and one 409, got [${statuses.join(",")}]`);
    ok = false;
  } else {
    console.log("  PASS: exactly one winner (200), one loser (409).");
  }
  const { data: freshAttempts } = await admin
    .from("student_question_attempts")
    .select("id")
    .eq("session_id", fresh.id);
  console.log(`  student_question_attempts rows for a 5-question session (expect 5, was 10 pre-fix): ${freshAttempts?.length ?? 0}`);
  if ((freshAttempts?.length ?? 0) !== 5) {
    console.error("FAIL: expected exactly 5 attempt rows, got", freshAttempts?.length);
    ok = false;
  }
  const { data: freshSessionRow } = await admin
    .from("quiz_sessions")
    .select("status, score, total_marks")
    .eq("id", fresh.id)
    .single();
  console.log("  final session row:", JSON.stringify(freshSessionRow));
  if (freshSessionRow?.status !== "completed" || freshSessionRow?.score == null) {
    console.error("FAIL: winner's grading (score) should have landed on the session row.");
    ok = false;
  }

  // ── 3. Sanity: a 3rd submit against the now-completed session also 409s ──
  console.log("\n=== 3. Re-submit after completion ===");
  const resubmit = await post(payload);
  console.log("  status:", resubmit.status, "error:", resubmit.json.error);
  if (resubmit.status !== 409) {
    console.error("FAIL: resubmitting a completed session should 409.");
    ok = false;
  }

  await cleanup();

  if (!ok) {
    console.error("\nCP-04 VERIFY: FAIL");
    process.exitCode = 1;
    return;
  }
  console.log("\nCP-04 VERIFY: PASS");
}

main()
  .catch(async (err) => {
    console.error("VERIFY ERROR:", err);
    await cleanup();
    process.exitCode = 1;
  });
