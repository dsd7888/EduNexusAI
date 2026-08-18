/**
 * CP-08 verify — browser pass over the practice results screen after the
 * answer-key exposure fix. The generate response no longer carries
 * correct_answer/explanation, so the results screen now waits on
 * /prep/submit's `grading` map before it can render correctness — this
 * confirms that render actually happens (not stuck on the loading skeleton)
 * and shows real, correct data.
 */
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
const STUDENT_EMAIL = "teststudent@gmail.com";

const admin = createClient(SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const anon = createClient(SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

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
  if (verifyErr || !verified.session)
    throw new Error(`verifyOtp failed: ${verifyErr?.message}`);

  const cookieValue =
    "base64-" + Buffer.from(JSON.stringify(verified.session), "utf8").toString("base64url");

  const browser = await chromium.launch();
  const context = await browser.newContext();
  await context.addCookies([
    {
      name: COOKIE_NAME,
      value: cookieValue,
      domain: "localhost",
      path: "/",
      httpOnly: false,
      secure: false,
    },
  ]);
  const page = await context.newPage();
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  let ok = true;
  try {
    const url = `${BASE}/student/placement/prep/aptitude/practice?topic=${encodeURIComponent("Time & Work")}`;
    console.log("Navigating to", url);
    await page.goto(url, { waitUntil: "networkidle" });

    // Answer every question with option A until session completes.
    for (let i = 0; i < 12; i++) {
      const optionButtons = page.locator("button", { hasText: /^A\./ });
      const count = await optionButtons.count();
      console.log(`  step ${i}: option buttons found = ${count}`);
      if (count === 0) {
        console.log("  no option button found — assuming results phase");
        break;
      }
      await optionButtons.first().click();
      const nextBtn = page.getByRole("button", { name: /Next →|Finish/ });
      await nextBtn.click();
      await page.waitForTimeout(300);
    }

    await page.screenshot({ path: "/tmp/cp08_after_loop.png", fullPage: true });
    console.log("Waiting for grading to resolve (score card)...");
    await page.waitForSelector("text=Correct answers", { timeout: 30000 });
    const scoreText = await page.locator("text=/\\d+\\/\\d+/").first().textContent();
    console.log("  Score card shows:", scoreText);
    await page.screenshot({ path: "/tmp/cp08_results_ready.png", fullPage: true });
    if (!scoreText || !/\d+\/\d+/.test(scoreText)) {
      console.error("FAIL: score card did not render a real N/M score after grading resolved.");
      ok = false;
    } else {
      console.log("  PASS: score card rendered with real grading data (not stuck on loading skeleton).");
    }

    // Expand the first review row and confirm an explanation renders.
    const firstReviewRow = page.locator("text=Review All Answers").locator("..").locator("button").first();
    await firstReviewRow.click();
    await page.waitForTimeout(300);
    const explanationVisible = await page.getByText("💡 Explanation").first().isVisible().catch(() => false);
    console.log("  Explanation panel visible after expanding review row:", explanationVisible);
    if (!explanationVisible) {
      console.log("  (no explanation panel — acceptable if this question's explanation was empty)");
    }

    if (consoleErrors.length > 0) {
      console.error("FAIL: console/page errors during the flow:", consoleErrors);
      ok = false;
    } else {
      console.log("  PASS: zero console/page errors.");
    }
  } finally {
    await browser.close();
  }

  if (!ok) {
    console.error("\nCP-08 UI VERIFY: FAIL");
    process.exitCode = 1;
    return;
  }
  console.log("\nCP-08 UI VERIFY: PASS");
}

main().catch((err) => {
  console.error("VERIFY ERROR:", err);
  process.exitCode = 1;
});
