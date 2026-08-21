/**
 * CP-08 API-level contract check, before any browser work.
 *
 * The commit under test (21200c5) made two coupled changes:
 *   - prep/generate MUST NOT ship correct_answer/explanation pre-answer
 *   - prep/submit MUST return a per-question `grading` map, which is now the
 *     ONLY way the results UI learns correctness
 * If either half is wrong the browser test can't be interpreted, so check the
 * wire contract first.
 */
import { createClient } from "@supabase/supabase-js";
import fs from "fs";

const env = Object.fromEntries(
  fs.readFileSync(".env.local", "utf8").split("\n").filter((l) => l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1)]; })
);
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const REF = new URL(SUPABASE_URL).hostname.split(".")[0];
const COOKIE = `sb-${REF}-auth-token`;
const BASE = process.env.VERIFY_BASE ?? "http://localhost:3000";

const admin = createClient(SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const anon = createClient(SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

let pass = 0, fail = 0;
function ok(n: string, c: boolean, d = ""): void {
  if (c) { pass++; console.log(`  PASS  ${n}`); }
  else { fail++; console.log(`  FAIL  ${n}  ${d}`); }
}

const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: "teststudent@gmail.com" });
const { data: v } = await anon.auth.verifyOtp({ token_hash: link!.properties.hashed_token, type: "magiclink" });
const session = v!.session!;
const cookie = `${COOKIE}=base64-${Buffer.from(JSON.stringify(session), "utf8").toString("base64url")}`;
const H = { "Content-Type": "application/json", Cookie: cookie };

// Pick a track+topic that the bank actually covers, so we exercise the bank path.
const { data: bankRow } = await admin.from("placement_question_bank")
  .select("track, topic").eq("is_active", true).limit(1).single();
const TRACK = bankRow!.track, TOPIC = bankRow!.topic;
console.log(`\nUsing track=${TRACK} topic=${TOPIC}\n`);

// ── 1. generate must not leak the answer key ────────────────────────────────
console.log("1. prep/generate answer-key redaction");
const genRes = await fetch(`${BASE}/api/placement/prep/generate`, {
  method: "POST", headers: H, body: JSON.stringify({ track: TRACK, topic: TOPIC }),
});
const gen = await genRes.json();
ok("generate returns 200", genRes.status === 200, `got ${genRes.status} ${JSON.stringify(gen).slice(0,200)}`);
const qs = gen.questions ?? gen.data?.questions ?? [];
ok("returned questions", qs.length > 0, `got ${qs.length}`);
ok("no question carries correct_answer", qs.every((q: { id: string; correct_answer?: unknown; explanation?: unknown }) => q.correct_answer === undefined));
ok("no question carries explanation", qs.every((q: { id: string; correct_answer?: unknown; explanation?: unknown }) => q.explanation === undefined));
// Canary: the key must not survive anywhere in the serialised payload, not just
// on the property we thought to check.
const { data: keys } = await admin.from("placement_question_bank")
  .select("id, correct_answer, explanation").in("id", qs.map((q: { id: string; correct_answer?: unknown; explanation?: unknown }) => q.id));
const raw = JSON.stringify(gen);
const leakedExpl = (keys ?? []).filter(k => k.explanation && raw.includes(k.explanation));
ok("no explanation text anywhere in payload", leakedExpl.length === 0, `${leakedExpl.length} leaked`);

// ── 2. submit returns the grading map, and grades server-side ───────────────
console.log("\n2. prep/submit grading map + server-side re-grading");
const keyById = new Map((keys ?? []).map(k => [k.id, k.correct_answer]));
// Answer EVERY question wrong on purpose, while forging is_correct: true.
const attempts = qs.map((q: { id: string; correct_answer?: unknown; explanation?: unknown }) => {
  const right = keyById.get(q.id);
  const wrong = ["A","B","C","D"].find(o => o !== right) ?? "A";
  return { question_id: q.id, selected_answer: wrong, is_correct: true, time_spent_seconds: 5, is_skipped: false };
});
const subRes = await fetch(`${BASE}/api/placement/prep/submit`, {
  method: "POST", headers: H,
  body: JSON.stringify({ track: TRACK, topic: TOPIC, attempts, total_time_seconds: 40 }),
});
const sub = await subRes.json();
const payload = sub.data ?? sub;
ok("submit returns 200", subRes.status === 200, `got ${subRes.status} ${JSON.stringify(sub).slice(0,300)}`);
ok("response carries a grading map", payload.grading && typeof payload.grading === "object",
   `keys: ${Object.keys(payload).join(",")}`);
const grading = payload.grading ?? {};
ok("grading covers every submitted question", qs.every((q: { id: string; correct_answer?: unknown; explanation?: unknown }) => grading[q.id] !== undefined));
ok("grading map now reveals correct_answer", qs.every((q: { id: string; correct_answer?: unknown; explanation?: unknown }) => typeof grading[q.id]?.correct_answer === "string"));
ok("forged is_correct:true was OVERRIDDEN to false", Object.values(grading).every((g: { is_correct?: boolean; correct_answer?: string }) => g.is_correct === false),
   JSON.stringify(Object.values(grading).map((g: { is_correct?: boolean; correct_answer?: string }) => g.is_correct)));
// recent_accuracy is a rolling blend across this student's prior sessions
// (CP-05's weight-capped ladder), so it is NOT this session's score. The claim
// under test is that the forgery didn't land: this session graded 0 correct,
// and the blended figure did not jump to the forged 100.
const acc = payload.mastery?.recent_accuracy ?? payload.mastery?.accuracy;
console.log(`     (submit payload keys: ${Object.keys(payload).join(", ")})`);
const gradedCorrect = Object.values(grading).filter((g: { is_correct?: boolean }) => g.is_correct).length;
ok("this session graded 0 of the submitted answers correct", gradedCorrect === 0, `got ${gradedCorrect}`);
ok("blended mastery accuracy did not become the forged 100",
   acc === null || acc === undefined || Number(acc) < 100, `got ${acc}`);

console.log(`\n──────────────\n  PASS ${pass}   FAIL ${fail}\n`);
process.exit(fail ? 1 : 0);
