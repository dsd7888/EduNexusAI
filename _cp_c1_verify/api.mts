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

async function sessionFor(email: string) {
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error || !data) throw new Error(`generateLink failed: ${error?.message}`);
  const { data: verified, error: verifyErr } = await anon.auth.verifyOtp({
    token_hash: data.properties.hashed_token,
    type: "magiclink",
  });
  if (verifyErr || !verified.session) throw new Error(`verifyOtp failed: ${verifyErr?.message}`);
  return verified.session;
}

function cookieHeaderFor(session: unknown): string {
  const value = "base64-" + Buffer.from(JSON.stringify(session), "utf8").toString("base64url");
  return `${COOKIE_NAME}=${value}`;
}

const TOPIC_CODE = "Process Management & Scheduling"; // newly-reachable, mode: "code"
const TOPIC_STEP = "IP Addressing & Subnetting"; // newly-reachable, mode: "step"
const NON_FILLCODE_TRACK_TOPIC = "Time & Work (Easy → Medium → Hard)"; // aptitude — must stay plain MCQ

async function main() {
  const email = "teststudent@gmail.com";
  const session = await sessionFor(email);
  const cookie = cookieHeaderFor(session);
  const studentId = session.user.id;

  // Clean any pre-existing bank rows for the two probe topics so this run's
  // "first call = generated, second call = bank" assertions aren't confused
  // by state left over from a previous manual test.
  await admin.from("placement_question_bank").delete().eq("track", "domain").eq("topic", TOPIC_CODE);
  await admin.from("placement_question_bank").delete().eq("track", "domain").eq("topic", TOPIC_STEP);
  await admin.from("placement_topic_mastery").delete().eq("student_id", studentId).eq("track", "domain").in("topic", [TOPIC_CODE, TOPIC_STEP]);

  interface GenQuestion {
    id: string;
    question_type: "mcq" | "fill_code";
    question_text: string;
    correct_answer: string;
    code_context?: { language: string };
  }
  interface GenResponse {
    status: number;
    json: { questions?: GenQuestion[]; source?: string };
  }

  async function generate(track: string, topic: string): Promise<GenResponse> {
    const res = await fetch(`${BASE}/api/placement/prep/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ track, topic }),
    });
    const json = await res.json();
    return { status: res.status, json };
  }

  // ── 1. First call for a newly-reachable "code" mode topic: must generate live (not bank) ──
  const gen1 = await generate("domain", TOPIC_CODE);
  const qs1 = gen1.json.questions ?? [];
  const mcqCount1 = qs1.filter((q) => q.question_type === "mcq").length;
  const fcCount1 = qs1.filter((q) => q.question_type === "fill_code").length;
  console.log("[1] first generate() for", JSON.stringify(TOPIC_CODE));
  console.log("    status:", gen1.status, "source:", gen1.json.source, "mcq:", mcqCount1, "fill_code:", fcCount1);
  const fc1 = qs1.find((q) => q.question_type === "fill_code");
  console.log("    sample fill_code question_text:", fc1?.question_text?.slice(0, 80));
  console.log("    sample fill_code language:", fc1?.code_context?.language);
  console.log("    sample fill_code correct_answer in A-D:", ["A", "B", "C", "D"].includes(fc1?.correct_answer ?? ""));

  // ── 2. Second call for the same topic: bank now has rows, must serve from bank ──
  const gen2 = await generate("domain", TOPIC_CODE);
  console.log("[2] second generate() for same topic -> source:", gen2.json.source, "(expect bank)");

  // ── 3. "step" mode topic (literal code doesn't fit — subnetting) ──
  const gen3 = await generate("domain", TOPIC_STEP);
  const qs3 = gen3.json.questions ?? [];
  const fc3 = qs3.find((q) => q.question_type === "fill_code");
  console.log("[3] step-mode topic", JSON.stringify(TOPIC_STEP), "-> source:", gen3.json.source,
    "fill_code count:", qs3.filter((q) => q.question_type === "fill_code").length,
    "sample language:", fc3?.code_context?.language);

  // ── 4. Non-domain track topic must remain plain MCQ (regression guard) ──
  const gen4 = await generate("aptitude", NON_FILLCODE_TRACK_TOPIC);
  const qs4 = gen4.json.questions ?? [];
  const anyFillCode4 = qs4.some((q) => q.question_type === "fill_code");
  console.log("[4] aptitude track (never fill_code) -> any fill_code present:", anyFillCode4, "(expect false)");

  // ── 5. Unhappy path: unknown/malformed topic string for domain track ──
  const gen5 = await generate("domain", "Not A Real Topic");
  console.log("[5] unknown domain topic -> status:", gen5.status, "source:", gen5.json.source,
    "(expect: plain MCQ generation path, not fill_code mix, since it doesn't match FILL_CODE_TOPICS)");

  // ── 6. Grading: submit one deliberately-correct and one deliberately-wrong fill_code answer ──
  const fcQuestions: GenQuestion[] = qs1.filter((q) => q.question_type === "fill_code");
  if (fcQuestions.length < 2) throw new Error("Need >=2 fill_code questions from step 1 to test grading");
  const [right, wrong] = fcQuestions;
  const wrongKey = ["A", "B", "C", "D"].find((k) => k !== wrong.correct_answer)!;

  const attempts = [
    { question_id: right.id, selected_answer: right.correct_answer, is_correct: true, is_skipped: false, time_spent_seconds: 12 },
    { question_id: wrong.id, selected_answer: wrongKey, is_correct: false, is_skipped: false, time_spent_seconds: 20 },
  ];

  const submitRes = await fetch(`${BASE}/api/placement/prep/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ attempts, track: "domain", topic: TOPIC_CODE, session_duration_seconds: 32 }),
  });
  const submitJson = await submitRes.json();
  console.log("[6] submit status:", submitRes.status, "mastery.attempts_count:", submitJson.mastery?.attempts_count,
    "mastery.correct_count:", submitJson.mastery?.correct_count, "recent_accuracy:", submitJson.mastery?.recent_accuracy,
    "readiness_updated:", submitJson.readiness_updated);

  // Verify bank stat rows actually reflect the right/wrong split (times_correct vs times_served)
  const { data: bankRows } = await admin
    .from("placement_question_bank")
    .select("id, times_served, times_correct")
    .in("id", [right.id, wrong.id]);
  console.log("[6b] bank stat rows after submit:", JSON.stringify(bankRows));
  const rightRow = bankRows?.find((r) => r.id === right.id);
  const wrongRow = bankRows?.find((r) => r.id === wrong.id);
  const gradingCorrect =
    rightRow?.times_served === 1 && rightRow?.times_correct === 1 &&
    wrongRow?.times_served === 1 && wrongRow?.times_correct === 0;
  console.log("[6c] grading recorded correctly (right=1/1, wrong=1/0):", gradingCorrect);

  // ── 7. practiceRecs coverage sanity (imported at build time already verified via tsx diff earlier) ──
  console.log("[7] verification script complete.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
