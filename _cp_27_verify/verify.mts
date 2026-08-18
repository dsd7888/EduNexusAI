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
const OUT = "_cp_27_verify/screens";
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
  { path: "/student/dashboard", wait: "text=Welcome back", name: "dashboard" },
  { path: "/student/subjects", wait: "text=Group by", name: "subjects" },
  { path: "/student/profile", wait: "text=Profile information", name: "profile" },
  { path: "/student/history", wait: "h1:has-text('Chat History')", name: "history" },
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

  // ── Happy path: desktop + mobile screenshots of all 5 shell-chrome surfaces ──
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
      await page.waitForSelector(p.wait, { timeout: 15000 });
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${OUT}/${viewport.tag}-${p.name}.png`, fullPage: true });
    }
    await ctx.close();
  }

  // ── Unhappy path 1: interrupted flow — navigate away mid-load, then back ──
  {
    const ctx = await newAuthedContext({ width: 1280, height: 900 });
    const page = await ctx.newPage();
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(`[interrupted] ${msg.text()}`);
    });
    await page.goto(`${BASE}/student/subjects`, { waitUntil: "commit" });
    await page.goto(`${BASE}/student/dashboard`, { waitUntil: "commit" });
    await page.goto(`${BASE}/student/subjects`, { waitUntil: "networkidle" });
    await page.waitForSelector("text=Group by", { timeout: 15000 });
    await page.screenshot({ path: `${OUT}/unhappy-1-interrupted-subjects.png`, fullPage: true });
    await ctx.close();
  }

  // ── Unhappy path 2: concurrent — rapid double-click on subjects group-by toggle ──
  {
    const ctx = await newAuthedContext({ width: 1280, height: 900 });
    const page = await ctx.newPage();
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(`[concurrent] ${msg.text()}`);
    });
    await page.goto(`${BASE}/student/subjects`, { waitUntil: "networkidle" });
    await page.waitForSelector("text=Group by", { timeout: 15000 });
    const codeBtn = page.getByRole("button", { name: "Subject Code" });
    const semBtn = page.getByRole("button", { name: "Semester" });
    await Promise.all([codeBtn.click(), semBtn.click()]);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/unhappy-2-concurrent-groupby.png`, fullPage: true });
    await ctx.close();
  }

  // ── Unhappy path 3: sidebar collapse toggle rapid double-click (layout.tsx) ──
  {
    const ctx = await newAuthedContext({ width: 1280, height: 900 });
    const page = await ctx.newPage();
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(`[collapse] ${msg.text()}`);
    });
    await page.goto(`${BASE}/student/dashboard`, { waitUntil: "networkidle" });
    await page.waitForSelector("text=Welcome back", { timeout: 15000 });
    const toggle = page.locator('button[title="Collapse menu"], button[title="Expand menu"]');
    await Promise.all([toggle.click(), toggle.click()]);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/unhappy-3-sidebar-toggle.png`, fullPage: true });
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
