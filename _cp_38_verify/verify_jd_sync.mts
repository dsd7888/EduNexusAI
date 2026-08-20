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

async function main() {
  const session = await sessionFor("teststudent@gmail.com");
  const cookieValue = cookieValueFor(session);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addCookies([
    { name: COOKIE_NAME, value: cookieValue, domain: "localhost", path: "/", httpOnly: false, secure: false, sameSite: "Lax" },
  ]);
  const page = await ctx.newPage();
  const consoleErrors: string[] = [];
  page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });

  // Seed sessionStorage as if JD analyzer had just run
  await page.goto(`${BASE}/student/placement/jd-analyzer`, { waitUntil: "networkidle" });
  await page.evaluate(() => {
    sessionStorage.setItem(
      "jd_analysis_last",
      JSON.stringify({
        analysis: { job_title: "SDE Intern" },
        jdText: "sample jd text ".repeat(5),
        savedAt: Date.now(),
      })
    );
  });

  // Navigate to resume page and check "Use last JD Analyzer result" appears
  await page.goto(`${BASE}/student/placement/resume`, { waitUntil: "networkidle" });
  await page.waitForSelector("text=Resume Builder", { timeout: 20000 });
  const hasLink = await page.getByText("Use last JD Analyzer result").count();
  console.log("hasStoredJD link visible:", hasLink > 0);
  await page.screenshot({ path: "_cp_38_verify/screens/sync-check-resume-hasStoredJD.png", fullPage: true });

  await browser.close();
  console.log("Console errors:", consoleErrors.length);
  if (consoleErrors.length) console.log(consoleErrors.join("\n"));
  if (hasLink === 0) {
    console.error("FAIL: expected hasStoredJD link to render");
    process.exit(1);
  }
  console.log("done");
}

main().catch((e) => { console.error(e); process.exit(1); });
