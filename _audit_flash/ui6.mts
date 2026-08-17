import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { createBrowserClient } from "@supabase/ssr";
import { loadEnvLocal, BASE_URL } from "../src/lib/testing/httpHarness";

const SOEEC1010_ECE_ONLY = "37912b3a-98b0-43b6-8403-e33ac4bd5f3e"; // offered to ECE sem1, teststudent is CSE
const IDSH2020_ZERO_NOTES = null; // will look up if needed

async function mintCookies() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email: "teststudent@gmail.com" });
  if (error || !data.properties?.hashed_token) throw new Error(`generateLink failed: ${error?.message}`);
  const jar = new Map<string, string>();
  const browserLike = createBrowserClient(url, anonKey, {
    isSingleton: false,
    cookies: {
      getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })),
      setAll: (list) => { for (const { name, value } of list) jar.set(name, value); },
    },
  });
  const { error: otpErr } = await browserLike.auth.verifyOtp({ type: "email", token_hash: data.properties.hashed_token });
  if (otpErr) throw new Error(`verifyOtp failed: ${otpErr.message}`);
  return [...jar.entries()].map(([name, value]) => ({ name, value }));
}

async function main() {
  loadEnvLocal();
  const browser = await chromium.launch();
  const cookies = await mintCookies();

  // Authorization: subject offered to a different branch entirely
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: "light" });
    await ctx.addCookies(cookies.map((c) => ({ name: c.name, value: c.value, url: BASE_URL })));
    const page = await ctx.newPage();
    const errs: string[] = [];
    page.on("pageerror", (e) => errs.push(e.message));
    const resp = await page.goto(`${BASE_URL}/student/notes/${SOEEC1010_ECE_ONLY}/flashcards`, { waitUntil: "networkidle", timeout: 20000 });
    await page.waitForTimeout(1000);
    const bodyText = await page.evaluate(() => document.body.innerText);
    console.log("cross-branch subject: status=", resp?.status(), "errs=", errs);
    console.log("bodyText snippet:", bodyText.slice(0, 300));
    await page.screenshot({ path: "_audit_flash/18-cross-branch-auth.png" });
    await ctx.close();
  }

  // Malformed subjectId in URL
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: "light" });
    await ctx.addCookies(cookies.map((c) => ({ name: c.name, value: c.value, url: BASE_URL })));
    const page = await ctx.newPage();
    const errs: string[] = [];
    page.on("pageerror", (e) => errs.push(e.message));
    const resp = await page.goto(`${BASE_URL}/student/notes/not-a-real-uuid-at-all/flashcards`, { waitUntil: "networkidle", timeout: 20000 });
    await page.waitForTimeout(1000);
    const bodyText = await page.evaluate(() => document.body.innerText);
    console.log("malformed subjectId: status=", resp?.status(), "errs=", errs);
    console.log("bodyText snippet:", bodyText.slice(0, 300));
    await page.screenshot({ path: "_audit_flash/19-malformed-subjectid.png" });
    await ctx.close();
  }

  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
