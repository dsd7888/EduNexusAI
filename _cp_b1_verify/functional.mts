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
const OUT = "_cp_b1_verify/screens";
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
  viewport: { width: number; height: number } = { width: 1280, height: 900 }
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

async function main() {
  const browser = await chromium.launch();

  // ── 1. Functional: search -> click a result -> lands on the correct practice drill ──
  {
    const ctx = await authedContext(browser, "teststudent@gmail.com");
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));

    await page.goto(`${BASE}/student/placement/prep`, { waitUntil: "networkidle" });
    await page.getByRole("searchbox", { name: "Search a topic across every track" }).fill("normalization");
    await page.waitForTimeout(300);
    const resultLink = page.getByRole("link", { name: /Normalization/ });
    const href = await resultLink.getAttribute("href");
    await resultLink.click();
    await page.waitForURL(/\/student\/placement\/prep\/domain\/practice\?topic=/, { timeout: 10000 });
    console.log(
      "[1] search -> click -> practice route: OK. href=",
      href,
      "landed=",
      page.url(),
      "errors=",
      errors.length
    );
    await ctx.close();
  }

  // ── 2. Deep-link: ?track=domain&topic=... pre-opens the right section ──
  {
    const ctx = await authedContext(browser, "teststudent@gmail.com");
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(
      `${BASE}/student/placement/prep?topic=${encodeURIComponent("SQL Queries & Joins")}`,
      { waitUntil: "networkidle" }
    );
    await page.waitForSelector("text=Core Domain", { timeout: 10000 });
    const activeTab = await page.getByRole("tab", { name: "Core Domain" }).getAttribute("aria-selected");
    const topicVisible = await page.getByText("SQL Queries & Joins").isVisible();
    console.log(
      "[2] ?topic= deep link: active tab aria-selected=",
      activeTab,
      "topic row visible=",
      topicVisible,
      "errors=",
      errors.length
    );
    await page.screenshot({ path: `${OUT}/functional-deep-link-topic.png`, fullPage: true });
    await ctx.close();
  }

  // ── 3. Interrupted flow: navigate away before mastery fetch resolves, then back ──
  {
    const ctx = await authedContext(browser, "teststudent@gmail.com");
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });

    await page.goto(`${BASE}/student/placement/prep`, { waitUntil: "domcontentloaded" });
    await page.goto(`${BASE}/student/dashboard`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(300);
    await page.goto(`${BASE}/student/placement/prep`, { waitUntil: "networkidle" });
    await page.waitForSelector("text=Placement Prep", { timeout: 10000 });
    // Confirm interactive after re-mount: expand a section successfully.
    await page.getByRole("button", { name: /Quantitative Ability/ }).click();
    await page.waitForTimeout(300);
    const expanded = await page.getByText("Time & Work (Easy → Medium → Hard)").isVisible();
    console.log(
      "[3] interrupted-flow re-navigate: section expands after remount=",
      expanded,
      "console/page errors=",
      errors.length,
      errors
    );
    await ctx.close();
  }

  // ── 4. Concurrent: rapid double-click a section toggle + overlapping tab switches ──
  {
    const ctx = await authedContext(browser, "teststudent@gmail.com");
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));

    await page.goto(`${BASE}/student/placement/prep`, { waitUntil: "networkidle" });
    await page.waitForSelector("text=Placement Prep", { timeout: 10000 });

    const sectionBtn = page.getByRole("button", { name: /Quantitative Ability/ });
    await Promise.all([sectionBtn.click(), sectionBtn.click()]);
    await page.waitForTimeout(400);
    const expandedAfterDoubleClick = await page
      .getByText("Time & Work (Easy → Medium → Hard)")
      .count();

    const domainTab = page.getByRole("tab", { name: "Core Domain" });
    const verbalTab = page.getByRole("tab", { name: "Verbal Ability" });
    await Promise.all([domainTab.click(), verbalTab.click()]);
    await page.waitForTimeout(400);
    const finalActive = await page.evaluate(() => {
      const el = document.querySelector('[role="tab"][aria-selected="true"]');
      return el?.textContent ?? null;
    });

    console.log(
      "[4] concurrent double-click toggle + overlapping tab switch: page errors=",
      errors.length,
      "topic-row-visible-count(0 or 1, no duplicate)=",
      expandedAfterDoubleClick,
      "final active tab settled to one value=",
      finalActive
    );
    await page.screenshot({ path: `${OUT}/functional-concurrent.png`, fullPage: true });
    await ctx.close();
  }

  await browser.close();
  console.log("done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
