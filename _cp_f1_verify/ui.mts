import { chromium } from "playwright";
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
const EMAIL = "teststudent@gmail.com";
const SCREENS = "_cp_f1_verify/screens";

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

async function main() {
  const session = await sessionFor(EMAIL);
  const cookieValue = "base64-" + Buffer.from(JSON.stringify(session), "utf8").toString("base64url");

  const browser = await chromium.launch();

  async function newAuthedContext(viewport: { width: number; height: number }) {
    const ctx = await browser.newContext({ viewport });
    await ctx.addCookies([
      {
        name: COOKIE_NAME,
        value: cookieValue,
        domain: "localhost",
        path: "/",
        httpOnly: false,
        secure: false,
      },
    ]);
    return ctx;
  }

  // ── 1. Round selection + happy path through an HR round question ────────
  console.log("=== 1. Round selection + HR round happy path (desktop) ===");
  const ctxDesktop = await newAuthedContext({ width: 1280, height: 900 });
  const page = await ctxDesktop.newPage();
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));

  await page.goto(`${BASE}/student/placement/interview/mock`, { waitUntil: "networkidle" });
  await page.waitForSelector("text=Run a mock round");
  await page.screenshot({ path: `${SCREENS}/desktop-round-select.png`, fullPage: true });

  await page.getByRole("button", { name: /HR Round/ }).click();
  await page.waitForSelector("text=Question 1 of 6");
  await page.screenshot({ path: `${SCREENS}/desktop-question.png`, fullPage: true });

  await page.locator("textarea").fill(
    "I am a final-year CSE student. I have built two full-stack projects, interned briefly " +
      "on a backend team, and I am looking to join a company where I can keep growing as an engineer."
  );
  await page.getByRole("button", { name: "Get feedback" }).click();
  await page.waitForSelector("text=Practice score", { timeout: 30000 });
  await page.screenshot({ path: `${SCREENS}/desktop-feedback.png`, fullPage: true });
  console.log("  HR round question answered and scored: OK");

  // ── 2. Technical round through to the reactive follow-up ────────────────
  console.log("\n=== 2. Technical round -> project question -> reactive follow-up ===");
  await page.getByRole("button", { name: "Change round" }).click();
  await page.waitForSelector("text=Run a mock round");
  await page.getByRole("button", { name: /Technical Round/ }).click();
  await page.waitForSelector("text=Question 1 of 4");

  for (let i = 0; i < 3; i++) {
    await page.locator("textarea").first().fill(
      "This is a technical answer with enough detail to pass the length floor for scoring."
    );
    await page.getByRole("button", { name: "Get feedback" }).first().click();
    await page.waitForSelector("text=Practice score", { timeout: 30000 });
    const isLast = (await page.locator("text=/Question 4 of 4/").count()) > 0;
    await page.getByRole("button", { name: isLast ? "Finish round" : "Next question" }).click();
    if (!isLast) await page.waitForSelector(`text=/Question ${i + 2} of 4/`);
  }

  await page.waitForSelector("text=Question 4 of 4");
  console.log("  reached the project_deep_dive question (Question 4 of 4): OK");

  // The Reactive follow-up card only renders once the project question's own
  // answer has been evaluated — submit that first.
  await page.locator("textarea").first().fill(
    "I built an order tracking service in Java and Spring Boot backed by PostgreSQL, and used " +
      "Kafka to process order events asynchronously so the REST API stayed responsive under load."
  );
  await page.getByRole("button", { name: "Get feedback" }).first().click();
  await page.waitForSelector("text=Practice score", { timeout: 30000 });
  await page.waitForSelector("text=Reactive follow-up");
  console.log("  Reactive follow-up card now visible after scoring the project answer: OK");
  await page.screenshot({ path: `${SCREENS}/desktop-project-question.png`, fullPage: true });

  const getFollowUpBtn = page.getByRole("button", { name: /Get the follow-up/ });
  const followUpUnavailable = (await page.locator("text=Add a project to your resume").count()) > 0;
  if (followUpUnavailable) {
    console.log(
      "  reactive follow-up unavailable — teststudent's resume has no project text " +
        "(expected/honest degraded state, not a crash)"
    );
    await page.screenshot({ path: `${SCREENS}/desktop-followup-unavailable.png`, fullPage: true });
  } else {
    await getFollowUpBtn.click();
    await page.waitForSelector("text=Probing:", { timeout: 30000 });
    await page.screenshot({ path: `${SCREENS}/desktop-followup-question.png`, fullPage: true });
    console.log("  reactive follow-up generated and rendered: OK");

    const followUpTextarea = page.locator("textarea").nth(1);
    await followUpTextarea.fill(
      "The Kafka-based async flow decouples order intake from downstream processing, so the API " +
        "responds immediately while a consumer handles the heavier work in the background."
    );
    await page.getByRole("button", { name: "Get feedback" }).nth(1).click();
    await page.waitForSelector("text=Probing:").then(async () => {
      // wait for the follow-up's own score tag to appear (second scored panel)
      await page.waitForTimeout(500);
    });
    await page.screenshot({ path: `${SCREENS}/desktop-followup-scored.png`, fullPage: true });
  }

  await page.getByRole("button", { name: "Finish round" }).click();
  await page.waitForSelector("text=complete");
  await page.screenshot({ path: `${SCREENS}/desktop-summary.png`, fullPage: true });
  console.log("  round summary rendered: OK");

  console.log("\n  page errors during full flow (expect 0):", pageErrors.length, pageErrors);

  await ctxDesktop.close();

  // ── 3. Mobile screenshots ────────────────────────────────────────────────
  console.log("\n=== 3. Mobile (390px) ===");
  const ctxMobile = await newAuthedContext({ width: 390, height: 844 });
  const mpage = await ctxMobile.newPage();
  await mpage.goto(`${BASE}/student/placement/interview/mock`, { waitUntil: "networkidle" });
  await mpage.waitForSelector("text=Run a mock round");
  await mpage.screenshot({ path: `${SCREENS}/mobile-round-select.png`, fullPage: true });
  await mpage.getByRole("button", { name: /HR Round/ }).click();
  await mpage.waitForSelector("text=Question 1 of 6");
  await mpage.screenshot({ path: `${SCREENS}/mobile-question.png`, fullPage: true });
  await ctxMobile.close();
  console.log("  mobile screenshots captured");

  // ── 4. Unhappy path: interrupted flow ────────────────────────────────────
  console.log("\n=== 4. Unhappy path: interrupted flow ===");
  const ctxInterrupt = await newAuthedContext({ width: 1280, height: 900 });
  const ipage = await ctxInterrupt.newPage();
  const interruptErrors: string[] = [];
  ipage.on("pageerror", (e) => interruptErrors.push(String(e)));

  await ipage.goto(`${BASE}/student/placement/interview/mock`, { waitUntil: "networkidle" });
  await ipage.waitForSelector("text=Run a mock round");
  await ipage.getByRole("button", { name: /HR Round/ }).click();
  await ipage.waitForSelector("text=Question 1 of 6");
  await ipage.locator("textarea").fill(
    "Answering a question, then navigating away before the feedback request resolves."
  );
  // Fire the evaluate request, then immediately navigate away — no await on the click's
  // network settling, simulating a real interrupted flow.
  await ipage.getByRole("button", { name: "Get feedback" }).click();
  await ipage.goto(`${BASE}/student/placement`, { waitUntil: "networkidle" });
  await ipage.goto(`${BASE}/student/placement/interview/mock`, { waitUntil: "networkidle" });
  await ipage.waitForSelector("text=Run a mock round");
  await ipage.getByRole("button", { name: /HR Round/ }).click();
  await ipage.waitForSelector("text=Question 1 of 6");
  console.log("  navigated away mid-request then back in: clean re-render, no crash");
  console.log("  page errors during interrupted flow (expect 0):", interruptErrors.length, interruptErrors);
  await ipage.screenshot({ path: `${SCREENS}/unhappy-interrupted-then-back.png`, fullPage: true });
  await ctxInterrupt.close();

  // ── 5. Unhappy path: concurrent double-click on Get feedback ────────────
  console.log("\n=== 5. Unhappy path: concurrent double-click ===");
  const ctxConcurrent = await newAuthedContext({ width: 1280, height: 900 });
  const cpage = await ctxConcurrent.newPage();
  const concurrentErrors: string[] = [];
  cpage.on("pageerror", (e) => concurrentErrors.push(String(e)));

  await cpage.goto(`${BASE}/student/placement/interview/mock`, { waitUntil: "networkidle" });
  await cpage.waitForSelector("text=Run a mock round");
  await cpage.getByRole("button", { name: /HR Round/ }).click();
  await cpage.waitForSelector("text=Question 1 of 6");
  await cpage.locator("textarea").fill(
    "Testing a rapid double-click on the Get feedback button to confirm the disabled state holds."
  );
  const feedbackBtn = cpage.getByRole("button", { name: "Get feedback" });
  await feedbackBtn.click();
  // Fire a second click immediately after — the button disables synchronously
  // in React's click handler before the fetch resolves, so a native <button
  // disabled> ignores further .click() calls entirely (HTML spec: "If this
  // element is disabled, do nothing"). Expect this to fail fast (element not
  // enabled) rather than actually re-trigger evaluation — that failure IS the
  // proof the concurrency guard holds, not a script bug.
  let secondClickBlocked = false;
  try {
    await feedbackBtn.click({ timeout: 2000 });
  } catch {
    secondClickBlocked = true;
  }
  console.log("  second click while disabled was blocked (expect true):", secondClickBlocked);

  await cpage.waitForSelector("text=Practice score", { timeout: 30000 });
  const scoreTags = await cpage.locator("text=/^\\d+\\/10$/").count();
  console.log("  score tags rendered after the double-click attempt (expect 1, not 2):", scoreTags);
  console.log("  page errors during concurrent double-click (expect 0):", concurrentErrors.length, concurrentErrors);
  await ctxConcurrent.close();

  await browser.close();
  console.log("\nDone.");
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exitCode = 1;
});
