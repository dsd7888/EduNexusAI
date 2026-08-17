import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { createBrowserClient } from "@supabase/ssr";
import { loadEnvLocal, BASE_URL } from "../src/lib/testing/httpHarness";

async function mintCookies(): Promise<{ name: string; value: string }[]> {
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
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: subj } = await admin.from("subjects").select("id, name, code").eq("code", "IDSH2020").maybeSingle();

  const browser = await chromium.launch();
  const cookies = await mintCookies();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addCookies(cookies.map((c) => ({ name: c.name, value: c.value, url: BASE_URL })));
  const page = await context.newPage();
  await page.goto(`${BASE_URL}/student/notes/${subj.id}`, { waitUntil: "networkidle", timeout: 20000 });
  await page.waitForTimeout(1000);

  const retryBtn = page.getByRole("button", { name: "Generate notes" });
  await retryBtn.click();
  await page.waitForResponse((r) => r.url().includes(`/api/notes/subject/${subj.id}`), { timeout: 10000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: "_audit_notes/empty-path-3-settled-after-retry.png" });
  const bodyText = await page.textContent("body");
  console.log("Settled state shows the SAME error again:", bodyText?.includes("No module notes are available for this subject yet"));

  await context.close();
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
