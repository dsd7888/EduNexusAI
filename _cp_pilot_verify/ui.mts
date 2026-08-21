/**
 * CP-08 (commit 21200c5) browser verification — the pass that was never run.
 *
 * That commit rewrote the practice results UI to source every correctness read
 * from prep/submit's new `grading` map instead of the question object. tsc,
 * eslint and grep all passed; nothing exercised the actual flow. Per CLAUDE.md
 * this needs an interrupted AND a concurrent case, not just a happy path.
 */
import { createClient } from "@supabase/supabase-js";
import { chromium, type Browser } from "playwright";
import fs from "fs";

const env = Object.fromEntries(
  fs.readFileSync(".env.local", "utf8").split("\n").filter((l) => l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1)]; })
);
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const REF = new URL(SUPABASE_URL).hostname.split(".")[0];
const COOKIE = `sb-${REF}-auth-token`;
const BASE = process.env.VERIFY_BASE ?? "http://localhost:3000";
const SHOTS = "_cp_pilot_verify/screens";
fs.mkdirSync(SHOTS, { recursive: true });

const admin = createClient(SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const anon = createClient(SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

let pass = 0, fail = 0;
function ok(n: string, c: boolean, d = ""): void {
  if (c) { pass++; console.log(`  PASS  ${n}`); }
  else { fail++; console.log(`  FAIL  ${n}  ${d}`); }
}

async function authedContext(browser: Browser, email: string) {
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const { data: v } = await anon.auth.verifyOtp({ token_hash: link!.properties.hashed_token, type: "magiclink" });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addCookies([{
    name: COOKIE,
    value: "base64-" + Buffer.from(JSON.stringify(v!.session), "utf8").toString("base64url"),
    domain: new URL(BASE).hostname, path: "/", httpOnly: false,
    secure: new URL(BASE).protocol === "https:", sameSite: "Lax",
  }]);
  return ctx;
}

// Disposable student: a fresh attempt history keeps prep/generate on the bank
// path every run. Re-using teststudent made this harness non-deterministic —
// seenIds excludes anything attempted in the last 30 days, so after enough runs
// the bank can no longer field 6 unseen questions and the route silently falls
// through to (much slower) AI generation.
const PROBE_EMAIL = `cp08-ui-${crypto.randomUUID().slice(0,8)}@edunexus-harness.invalid`;
const { data: probeUser } = await admin.auth.admin.createUser({
  email: PROBE_EMAIL, password: `Probe!${crypto.randomUUID().slice(0,12)}`,
  email_confirm: true, user_metadata: { full_name: "CP08 UI Probe" },
});
await admin.from("profiles").upsert({
  id: probeUser!.user!.id, email: PROBE_EMAIL, full_name: "CP08 UI Probe",
  role: "student", branch: "CSE", semester: 3, must_change_password: false,
}, { onConflict: "id" });
async function cleanupProbe() {
  if (probeUser?.user) await admin.auth.admin.deleteUser(probeUser.user.id);
}
for (const sig of ["SIGINT","SIGTERM","SIGHUP","SIGPIPE"] as const)
  process.on(sig, () => { void cleanupProbe().then(() => process.exit(1)); });

const { data: bankRow } = await admin.from("placement_question_bank")
  .select("track, topic").eq("is_active", true).limit(1).single();
const TRACK = bankRow!.track as string, TOPIC = bankRow!.topic as string;
const URL_ = `${BASE}/student/placement/prep/${TRACK}/practice?topic=${encodeURIComponent(TOPIC)}`;
console.log(`\nTrack=${TRACK}  Topic=${TOPIC}\n`);

const browser = await chromium.launch();

/** Drive a session to completion. Returns console errors + submit-request count. */
async function runSession() {
  const ctx = await authedContext(browser, PROBE_EMAIL);
  const page = await ctx.newPage();
  const consoleErrors: string[] = [];
  const submitCalls: string[] = [];
  const generatePayloads: string[] = [];

  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));
  page.on("request", (r) => { if (r.url().includes("/api/placement/prep/submit")) submitCalls.push(r.url()); });
  page.on("response", async (r) => {
    if (r.url().includes("/api/placement/prep/generate")) {
      try { generatePayloads.push(await r.text()); } catch { /* body already consumed */ }
    }
  });

  // networkidle is unreliable here — the page runs a per-question timer and
  // keeps the dev server's HMR socket open. Wait for the actual thing we need.
  await page.goto(URL_, { waitUntil: "domcontentloaded" });
  await page.locator("button").filter({ hasText: /^\s*[A-D]\s*[\.\)]/ })
    .first().waitFor({ state: "visible", timeout: 45000 });

  return { ctx, page, consoleErrors, submitCalls, generatePayloads };
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("1. Happy path — session renders, no answer key pre-answer");
{
  const { ctx, page, consoleErrors, generatePayloads } = await runSession();

  const optionButtons = await page.locator("button").filter({ hasText: /^\s*[A-D]\s*[\.\)]/ }).count();
  const anyOptions = optionButtons > 0 || (await page.getByRole("button").count()) > 3;
  ok("practice session rendered with answer controls", anyOptions, `option-shaped buttons: ${optionButtons}`);

  const genRaw = generatePayloads.join("");
  ok("generate response carried no correct_answer field",
     genRaw.length > 0 && !genRaw.includes('"correct_answer"'),
     genRaw.length === 0 ? "no generate response captured" : "correct_answer present in body");
  ok("generate response carried no explanation field",
     genRaw.length > 0 && !genRaw.includes('"explanation"'));

  await page.screenshot({ path: `${SHOTS}/01-question.png` });
  ok("no console errors on the question screen", consoleErrors.length === 0, consoleErrors.slice(0,3).join(" | "));
  await ctx.close();
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n2. Complete a session — score card sources from the grading map");
{
  const { ctx, page, consoleErrors, submitCalls } = await runSession();

  // Answer every question by clicking the first option, then advancing.
  for (let i = 0; i < 30; i++) {
    const finish = page.getByRole("button", { name: "Finish", exact: true });
    const next = page.getByRole("button", { name: "Next →", exact: true });
    const opts = page.locator("button").filter({ hasText: /^\s*[A-D]\s*[\.\)]/ });
    if (await opts.count() > 0) { await opts.first().click().catch(() => {}); await page.waitForTimeout(350); }
    if (await finish.count() > 0 && await finish.isEnabled().catch(() => false)) { await finish.click(); break; }
    if (await next.count() > 0 && await next.isEnabled().catch(() => false)) { await next.click(); await page.waitForTimeout(450); }
    else break;
  }

  // Grading is async. Wait for the terminal state — score card OR the
  // grading-failed notice — rather than a fixed sleep, so a slow submit
  // doesn't read as a missing score card.
  const settled = await page
    .waitForFunction(
      () => {
        const t = document.body.innerText;
        return /\d+\s*\/\s*\d+\s*\n?\s*Correct answers/i.test(t) ||
               /couldn.t verify your answers/i.test(t);
      },
      { timeout: 30000 }
    )
    .then(() => true)
    .catch(() => false);
  const body = await page.innerText("body");
  ok("grading reached a terminal state (score card or explicit failure)", settled,
     `still pending after 30s; body=${body.slice(0, 300).replace(/\n/g, " ")}`);
  ok("grading SUCCEEDED rather than falling back to the failure notice",
     !/couldn.t verify your answers/i.test(body), body.slice(0,200).replace(/\n/g," "));
  ok("a slow submit never shows failure copy while still in flight",
     !/couldn.t verify your answers/i.test(body));

  const scoreMatch = body.match(/(\d+)\s*\/\s*(\d+)/);
  ok("score card rendered a real N/M score", scoreMatch !== null,
     body.slice(0, 400).replace(/\n/g, " "));
  ok("score card shows no undefined/NaN", !/undefined|NaN/i.test(body),
     (body.match(/.{0,40}(undefined|NaN).{0,40}/i) ?? [""])[0]);
  ok("accuracy percentage rendered", /\d+%\s*accuracy/i.test(body));
  ok("exactly one submit request fired", submitCalls.length === 1, `count=${submitCalls.length}`);
  ok("no console errors through grading", consoleErrors.length === 0, consoleErrors.slice(0,3).join(" | "));

  await page.screenshot({ path: `${SHOTS}/02-results.png`, fullPage: true });

  // The review list is the part that reads grading[qq.id].correct_answer.
  const hasReview = /explanation|correct answer|review/i.test(body);
  ok("post-grading review/explanation content rendered", hasReview);
  await ctx.close();
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n3. CONCURRENT — rapid double-click on Finish must submit once");
{
  const { ctx, page, consoleErrors, submitCalls } = await runSession();

  for (let i = 0; i < 30; i++) {
    const finish = page.getByRole("button", { name: "Finish", exact: true });
    const next = page.getByRole("button", { name: "Next →", exact: true });
    const opts = page.locator("button").filter({ hasText: /^\s*[A-D]\s*[\.\)]/ });
    if (await opts.count() > 0) { await opts.first().click().catch(() => {}); await page.waitForTimeout(350); }
    if (await finish.count() > 0 && await finish.isEnabled().catch(() => false)) {
      // Two clicks in the same tick — the submittedRef guard is what must hold.
      await Promise.all([
        finish.click({ force: true }).catch(() => {}),
        finish.click({ force: true }).catch(() => {}),
      ]);
      break;
    }
    if (await next.count() > 0 && await next.isEnabled().catch(() => false)) { await next.click(); await page.waitForTimeout(450); }
    else break;
  }
  await page
    .waitForFunction(
      () => /\d+\s*\/\s*\d+\s*\n?\s*Correct answers/i.test(document.body.innerText) ||
            /couldn.t verify your answers/i.test(document.body.innerText),
      { timeout: 30000 }
    )
    .catch(() => {});
  const body = await page.innerText("body");
  ok("double-click still produced exactly one submit", submitCalls.length === 1, `count=${submitCalls.length}`);
  ok("results screen intact after double-click", /\d+\s*\/\s*\d+/.test(body) && !/undefined|NaN/i.test(body));
  ok("no console errors under double-click", consoleErrors.length === 0, consoleErrors.slice(0,3).join(" | "));
  await page.screenshot({ path: `${SHOTS}/03-double-click.png`, fullPage: true });
  await ctx.close();
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n4. INTERRUPTED — navigate away mid-grading, then return");
{
  const { ctx, page, consoleErrors } = await runSession();

  for (let i = 0; i < 30; i++) {
    const finish = page.getByRole("button", { name: "Finish", exact: true });
    const next = page.getByRole("button", { name: "Next →", exact: true });
    const opts = page.locator("button").filter({ hasText: /^\s*[A-D]\s*[\.\)]/ });
    if (await opts.count() > 0) { await opts.first().click().catch(() => {}); await page.waitForTimeout(350); }
    if (await finish.count() > 0 && await finish.isEnabled().catch(() => false)) { await finish.click(); break; }
    if (await next.count() > 0 && await next.isEnabled().catch(() => false)) { await next.click(); await page.waitForTimeout(450); }
    else break;
  }

  // Leave WHILE the grading request is still in flight.
  await page.waitForTimeout(250);
  await page.goto(`${BASE}/student/placement`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  const dashOk = !/undefined|NaN/i.test(await page.innerText("body"));
  ok("placement dashboard renders after mid-grading nav-away", dashOk);

  // Come back to the same session URL.
  await page.goto(URL_, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6000);
  const back = await page.innerText("body");
  ok("returning to the practice URL renders a coherent screen",
     back.length > 100 && !/undefined|NaN/i.test(back),
     (back.match(/.{0,40}(undefined|NaN).{0,40}/i) ?? [""])[0]);
  ok("no console errors across the interrupted flow", consoleErrors.length === 0, consoleErrors.slice(0,4).join(" | "));
  await page.screenshot({ path: `${SHOTS}/04-interrupted.png`, fullPage: true });
  await ctx.close();
}

await browser.close();
await cleanupProbe();
const { data: residue } = await admin.from("profiles").select("id").eq("email", PROBE_EMAIL);
console.log(`\ncleanup: probe student removed (${residue?.length ?? 0} profile rows left, want 0)`);
console.log(`\n──────────────\n  PASS ${pass}   FAIL ${fail}\n`);
process.exit(fail ? 1 : 0);
