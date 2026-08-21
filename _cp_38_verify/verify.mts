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

const admin = createClient(SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const anon = createClient(SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

const BASE = "http://localhost:3000";
const OUT = "_cp_38_verify/screens";
fs.mkdirSync(OUT, { recursive: true });

async function sessionFor(email: string) {
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (error || !data) throw new Error(`generateLink failed: ${error?.message}`);
  const tokenHash = data.properties.hashed_token;
  const { data: verified, error: verifyErr } = await anon.auth.verifyOtp({
    token_hash: tokenHash,
    type: "magiclink",
  });
  if (verifyErr || !verified.session) throw new Error(`verifyOtp failed: ${verifyErr?.message}`);
  return verified.session;
}

function cookieValueFor(session: unknown): string {
  const json = JSON.stringify(session);
  const b64url = Buffer.from(json, "utf8").toString("base64url");
  return "base64-" + b64url;
}

const PAGES = [
  { path: "/student/placement/resume", wait: "text=Resume Builder", name: "resume" },
  { path: "/student/placement/jd-analyzer", wait: "text=JD Analyzer", name: "jd-analyzer" },
  { path: "/student/placement/interview", wait: "text=Interview Prep Bank", name: "interview-bank" },
  { path: "/student/placement/projects", wait: "text=Mini-Project Guides", name: "projects" },
  {
    path: "/student/placement/projects/personal-portfolio",
    wait: "text=Step-by-Step Guide",
    name: "project-detail",
  },
];

async function main() {
  const session = await sessionFor("teststudent@gmail.com");
  const cookieValue = cookieValueFor(session);

  const consoleErrors: string[] = [];
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
        sameSite: "Lax",
      },
    ]);
    return ctx;
  }

  // ── Happy path: desktop + mobile screenshots of all 5 pages ──
  for (const viewport of [
    { width: 1280, height: 900, tag: "desktop" },
    { width: 390, height: 844, tag: "mobile" },
  ]) {
    const ctx = await newAuthedContext(viewport);
    const page = await ctx.newPage();
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(`[${viewport.tag}] ${msg.text()}`);
    });
    for (const p of PAGES) {
      await page.goto(`${BASE}${p.path}`, { waitUntil: "networkidle" });
      await page.waitForSelector(p.wait, { timeout: 20000 });
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${OUT}/${viewport.tag}-${p.name}.png`, fullPage: true });
    }
    await ctx.close();
  }

  // ── Unhappy 1: interrupted flow — navigate away from jd-analyzer mid-analysis ──
  {
    const ctx = await newAuthedContext({ width: 1280, height: 900 });
    const page = await ctx.newPage();
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(`[interrupted] ${msg.text()}`);
    });
    await page.goto(`${BASE}/student/placement/jd-analyzer`, { waitUntil: "networkidle" });
    await page.waitForSelector("text=JD Analyzer", { timeout: 20000 });
    const textarea = page.locator("textarea");
    await textarea.fill(
      "We are looking for a Software Development Engineer Intern to join our team. " +
        "Required Skills: Data Structures and Algorithms, Object-Oriented Programming, " +
        "Database Management (SQL), Operating Systems concepts, Computer Networks basics. " +
        "CGPA: 7.0 or above."
    );
    const analyzeBtn = page.getByRole("button", { name: /Analyze$/ });
    await analyzeBtn.click();
    // Navigate away almost immediately, mid-request
    await page.waitForTimeout(150);
    await page.goto(`${BASE}/student/placement/interview`, { waitUntil: "commit" });
    await page.goto(`${BASE}/student/placement/jd-analyzer`, { waitUntil: "networkidle" });
    await page.waitForSelector("text=JD Analyzer", { timeout: 20000 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/unhappy-1-interrupted-jd-analyzer.png`, fullPage: true });
    await ctx.close();
  }

  // ── Unhappy 2: concurrent — rapid double-click on projects difficulty filter ──
  {
    const ctx = await newAuthedContext({ width: 1280, height: 900 });
    const page = await ctx.newPage();
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(`[concurrent] ${msg.text()}`);
    });
    await page.goto(`${BASE}/student/placement/projects`, { waitUntil: "networkidle" });
    await page.waitForSelector("text=Mini-Project Guides", { timeout: 20000 });
    const beginnerBtn = page.getByRole("button", { name: "Beginner" });
    const intermediateBtn = page.getByRole("button", { name: "Intermediate" });
    await Promise.all([beginnerBtn.click(), intermediateBtn.click()]);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/unhappy-2-concurrent-projects-filter.png`, fullPage: true });
    await ctx.close();
  }

  // ── Unhappy 3: interview bank — rapid double-click round tabs (concurrent) ──
  {
    const ctx = await newAuthedContext({ width: 1280, height: 900 });
    const page = await ctx.newPage();
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(`[interview-concurrent] ${msg.text()}`);
    });
    await page.goto(`${BASE}/student/placement/interview`, { waitUntil: "networkidle" });
    await page.waitForSelector("text=Interview Prep Bank", { timeout: 20000 });
    const hrTab = page.getByRole("button", { name: "HR", exact: true });
    const techTab = page.getByRole("button", { name: "Technical", exact: true });
    await Promise.all([hrTab.click(), techTab.click()]);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/unhappy-3-interview-concurrent-tabs.png`, fullPage: true });
    await ctx.close();
  }

  await browser.close();

  console.log("Console errors:", consoleErrors.length);
  if (consoleErrors.length) {
    console.log(consoleErrors.join("\n"));
    process.exit(1);
  }
  console.log("done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
