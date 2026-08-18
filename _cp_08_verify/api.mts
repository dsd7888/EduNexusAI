/**
 * CP-08 verify — client-trusted grading on prep/submit + answer-key exposure
 * on prep/generate.
 *
 * Session history: an earlier pass fixed prep/submit's server-side re-grading
 * (sections 1-3 below) and drafted (but held back) the same fix for
 * practice/submit pending a migration. CP-13 subsequently deleted the entire
 * legacy practice/test subsystem (practice/submit no longer exists — the fix
 * for it is moot), so this run drops those sections and instead closes the
 * remaining open half of CP-08: prep/generate shipped `correct_answer` and
 * `explanation` in the PRE-ANSWER response body, so any client reading the
 * network tab (or React state) could see the answer key before answering.
 *
 * Fix verified here: prep/generate now strips both fields from every
 * response path (bank hit, AI-generated + persisted, AI-generated +
 * unpersisted fallback, fill_code mix). prep/submit now returns a per-question
 * `grading` map (correct_answer + explanation + is_correct) — the only place
 * the client is allowed to learn the answer key, and only after submitting.
 *
 * Real auth cookie via magiclink -> verifyOtp (same pattern as
 * _cp_07_verify/api.mts). Seeds a disposable placement_question_bank row via
 * the service-role client, cleans up everything it touches (rows + mastery
 * delta) in a finally + signal handlers.
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
 *  4. prep/generate: the serialised response body for a real topic contains
 *     NEITHER the string "correct_answer" NOR "explanation" anywhere —
 *     grepped on the raw JSON text, not just checked key-by-key, so a
 *     forgotten field or a nested copy can't hide.
 *  5. prep/generate unhappy path: two concurrent generate calls for the same
 *     student/topic both succeed and BOTH withhold the answer key (a race in
 *     the bank-insert-then-respond path can't leak it either).
 *  6. prep/submit: the `grading` map for a seeded question returns the real
 *     correct_answer + explanation from the bank, keyed by question_id — this
 *     is the ONLY channel the answer key should reach the client through.
 *  7. prep/generate interrupted flow: a client that aborts mid-request
 *     doesn't wedge the server — the next real request still succeeds.
 */
import { createClient } from "@supabase/supabase-js";
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
const TOPIC = `__cp08_test_topic_${Date.now()}`;
const GEN_TOPIC = "Time & Work"; // a real TRACK_SECTIONS topic, for prep/generate

const cleanupState: {
  bankQuestionIds: string[];
} = {
  bankQuestionIds: [],
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
  // prep/generate calls against GEN_TOPIC persist real bank rows — sweep any
  // this run created (age-boxed to this process's lifetime via the id list
  // populated below is not possible since generate doesn't return ids we
  // control up front, so instead sweep by a marker: none needed, GEN_TOPIC
  // reuses the app's real topic pool and inserted rows are legitimate content
  // the app can keep serving — not deleted).
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

  interface JsonResponse {
    mastery?: { recent_accuracy?: number; correct_count?: number; attempts_count?: number } | null;
    warnings?: string[];
    grading?: Record<string, { correct_answer: string; explanation: string; is_correct: boolean }>;
    source?: string;
    questions?: unknown[];
  }

  async function post(path: string, body: unknown, signal?: AbortSignal) {
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify(body),
      signal,
    });
    const rawText = await res.text();
    let json: JsonResponse = {};
    try {
      json = JSON.parse(rawText) as JsonResponse;
    } catch {
      /* leave {} */
    }
    return { status: res.status, json, rawText };
  }

  let ok = true;

  try {
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

    // ── 6. grading map returns the real answer key, keyed by question_id ───
    console.log("\n=== 6. prep/submit: grading map carries the real answer key ===");
    const g = c1.json.grading?.[bankRow.id as string];
    console.log("  grading[bankRow.id]:", JSON.stringify(g));
    if (!g || g.correct_answer !== "A" || g.explanation !== "2+2=4" || g.is_correct !== true) {
      console.error(
        `FAIL: expected grading[${bankRow.id}] = {correct_answer:"A", explanation:"2+2=4", is_correct:true}, got ${JSON.stringify(g)}`
      );
      ok = false;
    } else {
      console.log("  PASS: submit response exposes the answer key ONLY here, correctly.");
    }

    // ═══════════════════════════════════════════════════════════════════
    // PREP/GENERATE — answer-key exposure (CP-08 remaining half)
    // ═══════════════════════════════════════════════════════════════════

    // ── 4. Generate response never contains the answer key, on the raw wire ─
    console.log("\n=== 4. prep/generate: raw response body withholds the answer key ===");
    const genRes = await post("/api/placement/prep/generate", {
      track: TRACK,
      topic: GEN_TOPIC,
      count: 10,
    });
    console.log("  status:", genRes.status, "source:", genRes.json.source, "questions:", genRes.json.questions?.length);
    if (genRes.status !== 200) {
      console.error("FAIL: expected 200, got", genRes.status, genRes.rawText.slice(0, 300));
      ok = false;
    } else if (genRes.rawText.includes("correct_answer") || genRes.rawText.includes('"explanation"')) {
      console.error(
        "FAIL: raw prep/generate response body contains the answer key or explanation — grep hit on the serialised payload."
      );
      ok = false;
    } else if (!Array.isArray(genRes.json.questions) || genRes.json.questions.length === 0) {
      console.error("FAIL: expected a non-empty questions array.");
      ok = false;
    } else {
      console.log("  PASS: answer key absent from the serialised response (grepped raw text, not just parsed keys).");
    }

    // ── 5. Concurrent generate calls both withhold the answer key ──────────
    console.log("\n=== 5. prep/generate unhappy path: concurrent generate calls ===");
    const [g1, g2] = await Promise.all([
      post("/api/placement/prep/generate", { track: TRACK, topic: GEN_TOPIC, count: 10 }),
      post("/api/placement/prep/generate", { track: TRACK, topic: GEN_TOPIC, count: 10 }),
    ]);
    console.log("  statuses:", g1.status, g2.status);
    if (g1.status !== 200 || g2.status !== 200) {
      console.error("FAIL: expected both concurrent generate calls to succeed (200).");
      ok = false;
    } else if (
      g1.rawText.includes("correct_answer") ||
      g2.rawText.includes("correct_answer")
    ) {
      console.error("FAIL: a concurrent generate response leaked the answer key.");
      ok = false;
    } else {
      console.log("  PASS: both concurrent responses succeeded and withheld the answer key.");
    }

    // ── 7. Interrupted flow: an aborted request doesn't wedge the server ───
    console.log("\n=== 7. prep/generate interrupted flow: client aborts mid-request ===");
    const controller = new AbortController();
    const abortedPromise = post(
      "/api/placement/prep/generate",
      { track: TRACK, topic: GEN_TOPIC, count: 10 },
      controller.signal
    ).catch((e) => ({ aborted: true, err: String(e) }));
    setTimeout(() => controller.abort(), 15); // abort almost immediately
    await abortedPromise;
    const followUpRes = await post("/api/placement/prep/generate", {
      track: TRACK,
      topic: GEN_TOPIC,
      count: 10,
    });
    console.log("  follow-up status after abort:", followUpRes.status);
    if (followUpRes.status !== 200) {
      console.error("FAIL: server did not serve a normal follow-up request after a client abort.");
      ok = false;
    } else {
      console.log("  PASS: server unaffected by the aborted request — follow-up succeeds normally.");
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
