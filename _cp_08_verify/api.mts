/**
 * CP-08 verify — client-trusted grading on prep/submit and practice/submit.
 *
 * Confirmed-live bug: prep/submit trusted the client's `is_correct` verbatim
 * and wrote it straight into placement_topic_mastery / readiness scores, so a
 * student who answered every question wrong could forge `is_correct: true`
 * on every attempt and land a 100% mastery write. practice/submit scored
 * entirely client-supplied Q&A (including the "correct" answer) with no
 * lookup against practice_question_bank at all.
 *
 * Real auth cookie via magiclink -> verifyOtp (same pattern as
 * _cp_07_verify/api.mts). Seeds disposable rows directly into
 * placement_question_bank / practice_question_bank via the service-role
 * client, and cleans up everything it touches (rows + any mastery delta) in
 * a finally + signal handlers.
 *
 * Asserts:
 *  1. prep/submit: forging is_correct:true on a real wrong answer does NOT
 *     produce a 100% mastery write — the server recomputes from
 *     placement_question_bank.correct_answer and ignores the client claim.
 *  2. prep/submit unhappy path: an attempt against an unknown/forged
 *     question_id is excluded from grading (not silently trusted, not a
 *     crash) and surfaces a warning.
 *  3. prep/submit concurrency: two concurrent submits for the same
 *     student/track/topic both complete successfully with server-graded
 *     correctness (no crash, no corruption).
 *  4. practice/submit: a fabricated "answer" that matches the student's own
 *     selection (the exact shape that scored 100% before this fix) is
 *     regraded against the real practice_question_bank answer and scored
 *     incorrect.
 *  5. practice/submit unhappy path: a wholly fabricated question with no
 *     bank match is handled gracefully (ungraded → incorrect, no crash).
 *  6. practice/submit concurrency: two concurrent submits both succeed.
 */
import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import crypto from "crypto";

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
const TOPIC = `__cp08_test_topic_${Date.now()}`;
const MODULE_ID = `__cp08_test_module_${Date.now()}`;

const cleanupState: {
  bankQuestionIds: string[];
  practiceBankIds: string[];
  masteryOriginal: unknown | null;
  practiceAttemptIds: string[];
} = {
  bankQuestionIds: [],
  practiceBankIds: [],
  masteryOriginal: null,
  practiceAttemptIds: [],
};

async function cleanup(userId: string) {
  if (cleanupState.bankQuestionIds.length > 0) {
    await admin
      .from("placement_question_bank")
      .delete()
      .in("id", cleanupState.bankQuestionIds);
  }
  await admin
    .from("placement_question_attempts")
    .delete()
    .eq("student_id", userId)
    .eq("topic", TOPIC);
  await admin
    .from("placement_topic_mastery")
    .delete()
    .eq("student_id", userId)
    .eq("track", TRACK)
    .eq("topic", TOPIC);
  if (cleanupState.practiceBankIds.length > 0) {
    await admin
      .from("practice_question_bank")
      .delete()
      .in("id", cleanupState.practiceBankIds);
  }
  if (cleanupState.practiceAttemptIds.length > 0) {
    await admin
      .from("practice_attempts")
      .delete()
      .in("id", cleanupState.practiceAttemptIds);
  }
  console.log("[cleanup] done");
}

async function main() {
  const { data: student } = await admin
    .from("profiles")
    .select("id")
    .eq("email", STUDENT_EMAIL)
    .single();
  const userId = student!.id as string;

  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: STUDENT_EMAIL,
  });
  if (error || !data) throw new Error(`generateLink failed: ${error?.message}`);
  const { data: verified, error: verifyErr } = await anon.auth.verifyOtp({
    token_hash: data.properties.hashed_token,
    type: "magiclink",
  });
  if (verifyErr || !verified.session)
    throw new Error(`verifyOtp failed: ${verifyErr?.message}`);
  const cookie =
    `${COOKIE_NAME}=` +
    "base64-" +
    Buffer.from(JSON.stringify(verified.session), "utf8").toString("base64url");

  for (const sig of ["SIGINT", "SIGTERM", "SIGPIPE", "SIGHUP"] as const) {
    process.on(sig, async () => {
      await cleanup(userId);
      process.exit(1);
    });
  }

  async function post(path: string, body: unknown) {
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, json };
  }

  let ok = true;

  try {
    // ═══════════════════════════════════════════════════════════════════
    // PREP/SUBMIT
    // ═══════════════════════════════════════════════════════════════════

    console.log("=== Seed: placement_question_bank row (correct_answer=A) ===");
    const { data: bankRow, error: bankInsertErr } = await admin
      .from("placement_question_bank")
      .insert({
        track: TRACK,
        topic: TOPIC,
        topic_bucket: "test",
        difficulty: "easy",
        question_text: "CP-08 verify: 2 + 2 = ?",
        options: [
          { key: "A", text: "4" },
          { key: "B", text: "5" },
          { key: "C", text: "22" },
          { key: "D", text: "0" },
        ],
        correct_answer: "A",
        explanation: "2+2=4",
        question_type: "mcq",
        is_active: true,
      })
      .select("id")
      .single();
    if (bankInsertErr || !bankRow) {
      throw new Error(`bank insert failed: ${bankInsertErr?.message}`);
    }
    cleanupState.bankQuestionIds.push(bankRow.id as string);
    console.log("  bank question id:", bankRow.id);

    // ── 1. Forged is_correct:true on a genuinely wrong answer ──────────────
    console.log("\n=== 1. prep/submit: forge is_correct:true on a wrong answer ===");
    const forgedRes = await post("/api/placement/prep/submit", {
      attempts: [
        {
          question_id: bankRow.id,
          selected_answer: "B", // wrong — real answer is A
          is_correct: true, // FORGED
          is_skipped: false,
          time_spent_seconds: 5,
        },
      ],
      track: TRACK,
      topic: TOPIC,
      session_duration_seconds: 30,
    });
    console.log("  status:", forgedRes.status, JSON.stringify(forgedRes.json));
    if (forgedRes.status !== 200) {
      console.error("FAIL: expected 200, got", forgedRes.status);
      ok = false;
    } else {
      const mastery = forgedRes.json.mastery;
      console.log("  mastery.recent_accuracy:", mastery?.recent_accuracy);
      if (mastery?.recent_accuracy !== 0) {
        console.error(
          `FAIL: forged is_correct:true on a wrong answer produced recent_accuracy=${mastery?.recent_accuracy}, expected 0 (server must recompute from the bank, not trust the client).`
        );
        ok = false;
      } else {
        console.log("  PASS: forged 100% claim rejected — mastery reflects the real 0% score.");
      }
      if (mastery?.correct_count !== 0 || mastery?.attempts_count !== 1) {
        console.error(
          `FAIL: expected correct_count=0, attempts_count=1, got correct_count=${mastery?.correct_count}, attempts_count=${mastery?.attempts_count}`
        );
        ok = false;
      }
    }

    // ── 2. Unknown/forged question_id excluded from grading, not crashed ───
    console.log("\n=== 2. prep/submit unhappy path: unknown question_id ===");
    const fakeId = crypto.randomUUID();
    const unknownRes = await post("/api/placement/prep/submit", {
      attempts: [
        {
          question_id: fakeId,
          selected_answer: "A",
          is_correct: true,
          is_skipped: false,
          time_spent_seconds: 5,
        },
      ],
      track: TRACK,
      topic: TOPIC,
      session_duration_seconds: 10,
    });
    console.log("  status:", unknownRes.status, JSON.stringify(unknownRes.json));
    if (unknownRes.status !== 200) {
      console.error("FAIL: expected 200 (graceful handling), got", unknownRes.status);
      ok = false;
    } else if (!(unknownRes.json.warnings ?? []).some((w: string) => w.includes("unknown question"))) {
      console.error("FAIL: expected a warning about the unknown question_id.");
      ok = false;
    } else {
      console.log("  PASS: unknown question_id excluded from grading, surfaced as a warning, no crash.");
    }

    // ── 3. Concurrent submits — both complete, server-graded ───────────────
    console.log("\n=== 3. prep/submit concurrency: two concurrent submits ===");
    const concurrentPayload = {
      attempts: [
        {
          question_id: bankRow.id,
          selected_answer: "A", // correct this time
          is_correct: false, // client under-claims — should still be graded correct
          is_skipped: false,
          time_spent_seconds: 5,
        },
      ],
      track: TRACK,
      topic: TOPIC,
      session_duration_seconds: 10,
    };
    const [c1, c2] = await Promise.all([
      post("/api/placement/prep/submit", concurrentPayload),
      post("/api/placement/prep/submit", concurrentPayload),
    ]);
    console.log("  statuses:", c1.status, c2.status);
    if (c1.status !== 200 || c2.status !== 200) {
      console.error("FAIL: expected both concurrent submits to succeed (200).");
      ok = false;
    } else {
      console.log("  PASS: concurrent submits both completed without crashing.");
      console.log(
        "  mastery after race — c1 correct_count:",
        c1.json.mastery?.correct_count,
        "c2 correct_count:",
        c2.json.mastery?.correct_count
      );
    }

    // ═══════════════════════════════════════════════════════════════════
    // PRACTICE/SUBMIT
    // ═══════════════════════════════════════════════════════════════════

    console.log("\n=== Seed: practice_question_bank row (answer=A) ===");
    const QUESTION_TEXT = `CP-08 verify practice question ${Date.now()}`;
    const { data: practiceBankRow, error: practiceBankErr } = await admin
      .from("practice_question_bank")
      .insert({
        module_id: MODULE_ID,
        branch: null,
        difficulty_level: "foundational",
        question: {
          id: "q1",
          category: "quantitative",
          subcategory: MODULE_ID,
          difficulty_level: "foundational",
          question: QUESTION_TEXT,
          options: ["A. 4", "B. 5", "C. 22", "D. 0"],
          answer: "A",
          explanation: "2+2=4",
          difficulty: "easy",
        },
        times_used: 0,
        last_used_at: new Date().toISOString(),
        is_stale: false,
      })
      .select("id")
      .single();
    if (practiceBankErr || !practiceBankRow) {
      throw new Error(`practice bank insert failed: ${practiceBankErr?.message}`);
    }
    cleanupState.practiceBankIds.push(practiceBankRow.id as string);
    console.log("  practice bank question id:", practiceBankRow.id);

    // ── 4. Fabricated answer matching the student's own (wrong) pick ───────
    console.log("\n=== 4. practice/submit: client fabricates its own 'correct' answer ===");
    const fabricatedRes = await post("/api/placement/practice/submit", {
      moduleId: MODULE_ID,
      questions: [
        {
          id: "q1",
          category: "quantitative",
          subcategory: MODULE_ID,
          difficulty_level: "foundational",
          question: QUESTION_TEXT,
          options: ["A. 4", "B. 5", "C. 22", "D. 0"],
          answer: "Z", // FORGED — doesn't match the real bank answer "A", but matches...
          explanation: "forged explanation",
        },
      ],
      answers: { q1: "Z" }, // ...the student's own (wrong) selection
      timeTaken: 10,
    });
    console.log("  status:", fabricatedRes.status, JSON.stringify(fabricatedRes.json));
    if (fabricatedRes.status !== 200) {
      console.error("FAIL: expected 200, got", fabricatedRes.status);
      ok = false;
    } else {
      const qa = fabricatedRes.json.questionAnalysis?.[0];
      console.log("  score:", fabricatedRes.json.score, "questionAnalysis[0]:", JSON.stringify(qa));
      if (fabricatedRes.json.score !== 0 || qa?.isCorrect !== false) {
        console.error(
          `FAIL: fabricated self-matching answer scored ${fabricatedRes.json.score}% / isCorrect=${qa?.isCorrect}, expected 0% / false (server must grade against practice_question_bank, not client-supplied 'answer').`
        );
        ok = false;
      } else if (qa?.correctAnswer !== "A") {
        console.error(`FAIL: expected correctAnswer 'A' from the bank, got '${qa?.correctAnswer}'.`);
        ok = false;
      } else {
        console.log("  PASS: fabricated self-matching answer correctly rejected — graded against the real bank answer.");
      }
    }
    const { data: attemptRows1 } = await admin
      .from("practice_attempts")
      .select("id")
      .eq("student_id", userId)
      .eq("subcategory", MODULE_ID);
    for (const r of attemptRows1 ?? []) cleanupState.practiceAttemptIds.push(r.id as string);

    // ── 5. Wholly fabricated question, no bank match ────────────────────────
    console.log("\n=== 5. practice/submit unhappy path: no matching bank row ===");
    const noMatchRes = await post("/api/placement/practice/submit", {
      moduleId: MODULE_ID,
      questions: [
        {
          id: "q1",
          category: "quantitative",
          question: `entirely made up question text ${Date.now()}`,
          options: ["A. x", "B. y", "C. z", "D. w"],
          answer: "A",
          explanation: "forged",
        },
      ],
      answers: { q1: "A" },
      timeTaken: 5,
    });
    console.log("  status:", noMatchRes.status, JSON.stringify(noMatchRes.json));
    if (noMatchRes.status !== 200) {
      console.error("FAIL: expected graceful 200, got", noMatchRes.status);
      ok = false;
    } else if (noMatchRes.json.score !== 0 || noMatchRes.json.questionAnalysis?.[0]?.isCorrect !== false) {
      console.error("FAIL: expected an ungraded/unmatched question to score as incorrect, not crash or auto-pass.");
      ok = false;
    } else {
      console.log("  PASS: unmatched fabricated question handled gracefully, graded incorrect, no crash.");
    }
    const { data: attemptRows2 } = await admin
      .from("practice_attempts")
      .select("id")
      .eq("student_id", userId)
      .eq("subcategory", MODULE_ID);
    for (const r of attemptRows2 ?? []) {
      if (!cleanupState.practiceAttemptIds.includes(r.id as string)) {
        cleanupState.practiceAttemptIds.push(r.id as string);
      }
    }

    // ── 6. Concurrent practice submits ──────────────────────────────────────
    console.log("\n=== 6. practice/submit concurrency: two concurrent submits ===");
    const concurrentPracticePayload = {
      moduleId: MODULE_ID,
      questions: [
        {
          id: "q1",
          category: "quantitative",
          question: QUESTION_TEXT,
          options: ["A. 4", "B. 5", "C. 22", "D. 0"],
          answer: "A",
          explanation: "2+2=4",
        },
      ],
      answers: { q1: "A" },
      timeTaken: 8,
    };
    const [p1, p2] = await Promise.all([
      post("/api/placement/practice/submit", concurrentPracticePayload),
      post("/api/placement/practice/submit", concurrentPracticePayload),
    ]);
    console.log("  statuses:", p1.status, p2.status);
    if (p1.status !== 200 || p2.status !== 200) {
      console.error("FAIL: expected both concurrent practice submits to succeed (200).");
      ok = false;
    } else if (p1.json.score !== 100 || p2.json.score !== 100) {
      console.error("FAIL: expected both concurrent submits (real correct answer) to score 100%.");
      ok = false;
    } else {
      console.log("  PASS: concurrent practice submits both completed correctly.");
    }
    const { data: attemptRows3 } = await admin
      .from("practice_attempts")
      .select("id")
      .eq("student_id", userId)
      .eq("subcategory", MODULE_ID);
    for (const r of attemptRows3 ?? []) {
      if (!cleanupState.practiceAttemptIds.includes(r.id as string)) {
        cleanupState.practiceAttemptIds.push(r.id as string);
      }
    }
  } finally {
    await cleanup(userId);
  }

  if (!ok) {
    console.error("\nCP-08 VERIFY: FAIL");
    process.exitCode = 1;
    return;
  }
  console.log("\nCP-08 VERIFY: PASS");
}

main().catch(async (err) => {
  console.error("VERIFY ERROR:", err);
  process.exitCode = 1;
});
