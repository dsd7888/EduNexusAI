import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
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
const OUT = "_cp_c1_verify/screens";
fs.mkdirSync(OUT, { recursive: true });

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

function cookieValueFor(session: unknown): string {
  return "base64-" + Buffer.from(JSON.stringify(session), "utf8").toString("base64url");
}

async function authedContext(
  browser: import("playwright").Browser,
  email: string,
  viewport: { width: number; height: number }
) {
  const session = await sessionFor(email);
  const ctx = await browser.newContext({ viewport });
  await ctx.addCookies([
    {
      name: COOKIE_NAME,
      value: cookieValueFor(session),
      domain: "localhost",
      path: "/",
      httpOnly: false,
      secure: false,
      sameSite: "Lax",
    },
  ]);
  return ctx;
}

const TOPIC = "Process Management & Scheduling";
const url = `${BASE}/student/placement/prep/domain/practice?topic=${encodeURIComponent(TOPIC)}`;

async function runSession(page: import("playwright").Page, topicUrl: string) {
  await page.goto(topicUrl, { waitUntil: "networkidle" });
  await page.waitForSelector("text=Q1", { timeout: 20000 });

  // Answer every question by clicking the first option, then Next/Finish.
  for (let i = 0; i < 10; i++) {
    const finishBtn = page.getByRole("button", { name: "Finish" });
    const nextBtn = page.getByRole("button", { name: "Next →" });
    // Pick the first option button (works for both mcq and fill_code layout).
    const optionButtons = page.locator("button", { hasText: /^A\./ });
    await optionButtons.first().click();
    if (await finishBtn.isVisible().catch(() => false)) {
      await finishBtn.click();
      break;
    }
    await nextBtn.click();
    await page.waitForTimeout(150);
  }

  await page.waitForSelector("text=Correct answers", { timeout: 20000 });
}

async function main() {
  const browser = await chromium.launch();
  const errors: string[] = [];

  // ── Desktop ──
  {
    const ctx = await authedContext(browser, "teststudent@gmail.com", { width: 1280, height: 1000 });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(String(e)));
    await runSession(page, url);
    const practiceMoreVisible = await page.getByText("Practice more").isVisible().catch(() => false);
    const linkCount = await page.locator("text=Practice more").locator("xpath=following-sibling::div[1]//a").count();
    console.log("[desktop] results reached. 'Practice more' visible:", practiceMoreVisible, "link count:", linkCount);
    await page.screenshot({ path: `${OUT}/desktop-results-resource-strip.png`, fullPage: true });

    // Confirm the resource strip renders real anchors with target=_blank and real hrefs
    const hrefs = await page.locator("text=Practice more").locator("xpath=following-sibling::div[1]//a").evaluateAll(
      (as) => as.map((a) => (a as HTMLAnchorElement).href)
    );
    console.log("[desktop] resource strip hrefs:", hrefs);
    await ctx.close();
  }

  // ── Mobile ──
  {
    const ctx = await authedContext(browser, "teststudent@gmail.com", { width: 390, height: 844 });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(String(e)));
    const subnetUrl = `${BASE}/student/placement/prep/domain/practice?topic=${encodeURIComponent("IP Addressing & Subnetting")}`;
    await runSession(page, subnetUrl);
    const hrefs = await page.locator("text=Practice more").locator("xpath=following-sibling::div[1]//a").evaluateAll(
      (as) => as.map((a) => (a as HTMLAnchorElement).href)
    );
    console.log("[mobile] step-mode topic (IP Addressing & Subnetting) resource strip hrefs:", hrefs);
    await page.screenshot({ path: `${OUT}/mobile-results-resource-strip.png`, fullPage: true });
    console.log("[mobile] results screenshot captured");
    await ctx.close();
  }

  console.log("page errors total:", errors.length, errors);
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
