import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { createBrowserClient } from "@supabase/ssr";
import { loadEnvLocal, BASE_URL } from "../src/lib/testing/httpHarness";

const SECE2250_ZERO_NOTES = "b862c433-29d1-4e43-ac54-4a1369a7f195"; // CSE sem3, 0 study_notes rows per AU-NOTES

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

  const ctxD = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: "light" });
  await ctxD.addCookies(cookies.map((c) => ({ name: c.name, value: c.value, url: BASE_URL })));
  const pageD = await ctxD.newPage();
  await pageD.goto(`${BASE_URL}/student/notes/${SECE2250_ZERO_NOTES}/flashcards`, { waitUntil: "networkidle", timeout: 20000 });
  await pageD.waitForTimeout(1200);
  const textD = await pageD.evaluate(() => document.body.innerText);
  console.log("zero-notes subject flashcards body:", textD.slice(0, 400));
  await pageD.screenshot({ path: "_audit_flash/20-empty-state-desktop.png" });
  await ctxD.close();

  const ctxM = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "light" });
  await ctxM.addCookies(cookies.map((c) => ({ name: c.name, value: c.value, url: BASE_URL })));
  const pageM = await ctxM.newPage();
  await pageM.goto(`${BASE_URL}/student/notes/${SECE2250_ZERO_NOTES}/flashcards`, { waitUntil: "networkidle", timeout: 20000 });
  await pageM.waitForTimeout(1200);
  await pageM.screenshot({ path: "_audit_flash/21-empty-state-mobile.png" });
  await ctxM.close();

  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
