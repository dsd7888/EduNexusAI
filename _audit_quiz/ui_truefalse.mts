import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { createBrowserClient } from "@supabase/ssr";
import { loadEnvLocal, BASE_URL } from "../src/lib/testing/httpHarness";

const SUBJECT_ID = "b862c433-29d1-4e43-ac54-4a1369a7f195";
const TEST_EMAIL = "teststudent@gmail.com";

async function mintCookies(admin: any, anonKey: string, url: string) {
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: TEST_EMAIL,
  });
  if (error || !data.properties?.hashed_token) {
    throw new Error(`generateLink failed: ${error?.message}`);
  }
  const jar = new Map<string, string>();
  const browserLike = createBrowserClient(url, anonKey, {
    isSingleton: false,
    cookies: {
      getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })),
      setAll: (list: any) => { for (const { name, value } of list) jar.set(name, value); },
    },
  });
  const { error: otpErr } = await browserLike.auth.verifyOtp({ type: "email", token_hash: data.properties.hashed_token });
  if (otpErr) throw new Error(`verifyOtp failed: ${otpErr.message}`);
  return [...jar.entries()].map(([name, value]) => ({ name, value }));
}

async function main() {
  loadEnvLocal();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  // Generate a true_false-only quick session AS teststudent, via the real route,
  // using its own auth cookie set (so the browser session below owns it).
  const cookies = await mintCookies(admin, anonKey, url);
  const cookieHeader = cookies.map((c) => `${c.name}=${encodeURIComponent(c.value)}`).join("; ");
  const genRes = await fetch(`${BASE_URL}/api/assessment/quick`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: cookieHeader },
    body: JSON.stringify({ subjectIds: [SUBJECT_ID], questionCount: 5, questionTypes: ["true_false"] }),
  });
  const genBody = await genRes.json();
  console.log("generate status:", genRes.status, "sessionId:", genBody.sessionId, "count:", genBody.questions?.length);
  const sessionId = genBody.sessionId;
  if (!sessionId) throw new Error("no session generated: " + JSON.stringify(genBody));

  const browser = await chromium.launch();

  async function newCtx(viewport: { width: number; height: number }, colorScheme: "light" | "dark") {
    const context = await browser.newContext({ viewport, colorScheme });
    await context.addCookies(cookies.map((c) => ({ name: c.name, value: c.value, url: BASE_URL })));
    return context;
  }

  for (const [label, viewport] of [["desktop", { width: 1280, height: 900 }], ["mobile", { width: 390, height: 844 }]] as const) {
    for (const scheme of ["light", "dark"] as const) {
      const ctx = await newCtx(viewport, scheme);
      const page = await ctx.newPage();
      const errs: string[] = [];
      page.on("pageerror", (e) => errs.push(e.message));
      await page.goto(`${BASE_URL}/student/quiz/session/${sessionId}`, { waitUntil: "networkidle", timeout: 20000 });
      await page.waitForTimeout(1000);
      const path = `_audit_quiz/truefalse-${label}-${scheme}.png`;
      await page.screenshot({ path });
      // Count rendered answer option buttons/inputs for the current question.
      const optionButtonCount = await page.locator("button").filter({ hasText: /^[A-D]$/ }).count();
      const natInputCount = await page.locator('input[inputmode="decimal"]').count();
      console.log(`${label}/${scheme}: screenshot=${path} optionButtons=${optionButtonCount} natInputs=${natInputCount} pageErrors=${JSON.stringify(errs)}`);
      await ctx.close();
    }
  }

  await browser.close();

  // cleanup this generated session only (leave teststudent's other history alone)
  await admin.from("quiz_session_keys").delete().eq("session_id", sessionId);
  await admin.from("quiz_sessions").delete().eq("id", sessionId);
  console.log("cleaned up session", sessionId);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
