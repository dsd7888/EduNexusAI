/**
 * CP-05 verify — upsert_placement_topic_mastery atomic RPC.
 *
 * Two parts:
 *  1. Direct RPC concurrency test (no HTTP, no AI spend): fires two truly
 *     concurrent upsert_placement_topic_mastery calls for a fresh
 *     (student, track, topic) key and confirms sessions_count lands at
 *     exactly 2 (not 1) and attempts_count/correct_count reflect both
 *     sessions' deltas summed — the accumulator race the migration exists
 *     to close.
 *  2. End-to-end smoke test: a single real call to the live
 *     /api/placement/prep/submit route (real auth cookie) against a real
 *     placement_question_bank fixture, confirming the route's new RPC
 *     wiring (Step 3) round-trips correctly (response shape, difficulty
 *     fields) and doesn't 500.
 *
 * Cleans up every row it creates and confirms no residue.
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

const STUDENT_EMAIL = "teststudent@gmail.com";
const TRACK = "aptitude";
const RPC_TEST_TOPIC = "CP-05 verify fixture topic (RPC)";
const HTTP_TEST_TOPIC = "Time & Work (Easy → Medium → Hard)";

const createdBankQuestionIds: string[] = [];
let studentId = "";

async function cleanup() {
  await admin
    .from("placement_topic_mastery")
    .delete()
    .eq("student_id", studentId)
    .eq("track", TRACK)
    .eq("topic", RPC_TEST_TOPIC);
  await admin
    .from("placement_topic_mastery")
    .delete()
    .eq("student_id", studentId)
    .eq("track", TRACK)
    .eq("topic", HTTP_TEST_TOPIC);
  await admin
    .from("placement_question_attempts")
    .delete()
    .in("question_id", createdBankQuestionIds);
  if (createdBankQuestionIds.length > 0) {
    await admin.from("placement_question_bank").delete().in("id", createdBankQuestionIds);
  }

  const { data: r1 } = await admin
    .from("placement_topic_mastery")
    .select("student_id")
    .eq("student_id", studentId)
    .eq("track", TRACK)
    .eq("topic", RPC_TEST_TOPIC);
  const { data: r2 } = await admin
    .from("placement_topic_mastery")
    .select("student_id")
    .eq("student_id", studentId)
    .eq("track", TRACK)
    .eq("topic", HTTP_TEST_TOPIC);
  const { data: r3 } = await admin
    .from("placement_question_bank")
    .select("id")
    .in("id", createdBankQuestionIds.length > 0 ? createdBankQuestionIds : ["00000000-0000-0000-0000-000000000000"]);
  const residue = (r1?.length ?? 0) + (r2?.length ?? 0) + (r3?.length ?? 0);
  console.log(`[cleanup] residue rows: ${residue}`);
}

for (const sig of ["SIGINT", "SIGTERM", "SIGPIPE", "SIGHUP"] as const) {
  process.on(sig, async () => {
    await cleanup();
    process.exit(1);
  });
}

async function main() {
  let ok = true;

  const { data: student, error: studentErr } = await admin
    .from("profiles")
    .select("id")
    .eq("email", STUDENT_EMAIL)
    .single();
  if (studentErr || !student) throw new Error(`test student lookup failed: ${studentErr?.message}`);
  studentId = student.id as string;

  await cleanup(); // pre-clean in case a prior aborted run left residue

  // ── 1. Direct RPC concurrency test ────────────────────────────────────────
  console.log("=== 1. Concurrent upsert_placement_topic_mastery RPC ===");
  const rpcArgs = {
    p_student_id: studentId,
    p_track: TRACK,
    p_topic: RPC_TEST_TOPIC,
    p_session_attempted: 5,
    p_session_correct: 3,
    p_session_accuracy: 60,
  };
  const [rpc1, rpc2] = await Promise.all([
    admin.rpc("upsert_placement_topic_mastery", rpcArgs),
    admin.rpc("upsert_placement_topic_mastery", rpcArgs),
  ]);
  if (rpc1.error || rpc2.error) {
    console.error("FAIL: RPC call errored:", rpc1.error ?? rpc2.error);
    ok = false;
  } else {
    console.log("  rpc1:", JSON.stringify(rpc1.data));
    console.log("  rpc2:", JSON.stringify(rpc2.data));
  }

  const { data: finalMastery, error: finalErr } = await admin
    .from("placement_topic_mastery")
    .select("*")
    .eq("student_id", studentId)
    .eq("track", TRACK)
    .eq("topic", RPC_TEST_TOPIC)
    .single();
  if (finalErr) {
    console.error("FAIL: could not read final mastery row:", finalErr.message);
    ok = false;
  } else {
    console.log("  final row:", JSON.stringify(finalMastery));
    if (finalMastery.sessions_count !== 2) {
      console.error(`FAIL: expected sessions_count=2 (was 1 pre-fix, lost update), got ${finalMastery.sessions_count}`);
      ok = false;
    } else {
      console.log("  PASS: sessions_count=2 — both concurrent submits counted, neither lost.");
    }
    if (finalMastery.attempts_count !== 10 || finalMastery.correct_count !== 6) {
      console.error(
        `FAIL: expected attempts_count=10/correct_count=6 (both deltas summed), got attempts_count=${finalMastery.attempts_count}/correct_count=${finalMastery.correct_count}`
      );
      ok = false;
    } else {
      console.log("  PASS: attempts_count=10, correct_count=6 — both sessions' deltas summed, not overwritten.");
    }
  }

  // ── 2. End-to-end smoke test via the live route ───────────────────────────
  console.log("\n=== 2. Live /api/placement/prep/submit smoke test ===");
  const q1 = randomUUID();
  const q2 = randomUUID();
  createdBankQuestionIds.push(q1, q2);
  const { error: bankErr } = await admin.from("placement_question_bank").insert([
    {
      id: q1,
      track: TRACK,
      topic: HTTP_TEST_TOPIC,
      difficulty: "easy",
      question_type: "mcq",
      question_text: "CP-05 fixture question 1?",
      options: ["A", "B", "C", "D"],
      correct_answer: "A",
      explanation: "Fixture.",
    },
    {
      id: q2,
      track: TRACK,
      topic: HTTP_TEST_TOPIC,
      difficulty: "easy",
      question_type: "mcq",
      question_text: "CP-05 fixture question 2?",
      options: ["A", "B", "C", "D"],
      correct_answer: "B",
      explanation: "Fixture.",
    },
  ]);
  if (bankErr) throw new Error(`bank fixture insert failed: ${bankErr.message}`);

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

  const res = await fetch(`${BASE}/api/placement/prep/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({
      attempts: [
        { question_id: q1, selected_answer: "A", is_correct: false, is_skipped: false, time_spent_seconds: 10 },
        { question_id: q2, selected_answer: "X", is_correct: false, is_skipped: false, time_spent_seconds: 10 },
      ],
      track: TRACK,
      topic: HTTP_TEST_TOPIC,
      session_duration_seconds: 60,
    }),
  });
  const json = await res.json().catch(() => ({}));
  console.log("  status:", res.status, "body:", JSON.stringify(json));

  if (res.status !== 200) {
    console.error("FAIL: expected 200 from live route, got", res.status);
    ok = false;
  } else {
    if (!json.mastery || typeof json.mastery.sessions_count !== "number") {
      console.error("FAIL: response missing mastery.sessions_count — RPC wiring broken.");
      ok = false;
    }
    // q1 selected "A" == correct_answer "A" -> correct; q2 selected "X" != "B" -> wrong.
    // Server-graded, not client-trusted (forged is_correct:false on both above was ignored).
    if (json.grading?.[q1]?.is_correct !== true) {
      console.error("FAIL: server-side re-grading (CP-08) regressed — q1 should be graded correct.");
      ok = false;
    } else {
      console.log("  PASS: route responded 200 with a well-formed mastery object from the RPC, grading server-computed.");
    }
  }

  await cleanup();

  if (!ok) {
    console.error("\nCP-05 VERIFY: FAIL");
    process.exitCode = 1;
    return;
  }
  console.log("\nCP-05 VERIFY: PASS");
}

main().catch(async (err) => {
  console.error("VERIFY ERROR:", err);
  await cleanup();
  process.exitCode = 1;
});
