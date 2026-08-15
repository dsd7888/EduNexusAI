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
const OUT = "_cp_a2_verify/screens";
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

async function main() {
  const session = await sessionFor("teststudent@gmail.com");
  const cookieValue = cookieValueFor(session);
  console.log("cookie length:", cookieValue.length);

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

  // ── Desktop, light ──────────────────────────────────────────────────────
  {
    const ctx = await newAuthedContext({ width: 1280, height: 900 });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/student/placement`, { waitUntil: "networkidle" });
    await page.waitForSelector("text=Next move", { timeout: 15000 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/desktop-light-collapsed.png`, fullPage: true });

    const readinessBtn = page.getByRole("button", { name: "Your readiness" });
    if (await readinessBtn.count()) {
      await readinessBtn.click();
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${OUT}/desktop-light-expanded.png`, fullPage: true });
    }

    await ctx.close();
  }

  // ── Mobile, light ───────────────────────────────────────────────────────
  {
    const ctx = await newAuthedContext({ width: 390, height: 844 });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/student/placement`, { waitUntil: "networkidle" });
    await page.waitForSelector("text=Next move", { timeout: 15000 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/mobile-light-collapsed.png`, fullPage: true });

    const readinessBtn = page.getByRole("button", { name: "Your readiness" });
    if (await readinessBtn.count()) {
      await readinessBtn.click();
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${OUT}/mobile-light-expanded.png`, fullPage: true });
    }
    await ctx.close();
  }

  await browser.close();
  console.log("done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
