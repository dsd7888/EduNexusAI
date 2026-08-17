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
  console.log("Testing empty-state UI against:", subj);
  const { data: existingRows } = await admin.from("study_notes").select("id").eq("subject_id", subj.id);
  console.log("Pre-existing study_notes rows for this subject:", existingRows?.length ?? 0);

  const browser = await chromium.launch();
  const cookies = await mintCookies();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addCookies(cookies.map((c) => ({ name: c.name, value: c.value, url: BASE_URL })));
  const page = await context.newPage();
  await page.goto(`${BASE_URL}/student/notes/${subj.id}`, { waitUntil: "networkidle", timeout: 20000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: "_audit_notes/empty-path-1-initial.png" });

  const bodyText1 = await page.textContent("body");
  console.log("Page shows 'Generate notes' button:", bodyText1?.includes("Generate notes"));
  console.log("Page shows error message:", bodyText1?.match(/No module notes[^.]*\./)?.[0] ?? bodyText1?.match(/We couldn't load[^.]*\./)?.[0]);

  // Click the "Generate notes" retry button
  const retryBtn = page.getByRole("button", { name: "Generate notes" });
  const btnExists = await retryBtn.count();
  console.log("Retry button count:", btnExists);
  if (btnExists > 0) {
    await retryBtn.click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: "_audit_notes/empty-path-2-after-retry.png" });
    const bodyText2 = await page.textContent("body");
    console.log("After clicking 'Generate notes': still shows error:", bodyText2?.includes("No module notes") || bodyText2?.includes("couldn't load"));
    console.log("After click, blocks visible (notes actually generated):", !bodyText2?.includes("No module notes"));
  }

  // Confirm via DB: did clicking the button create ANY study_notes rows?
  const { data: afterRows } = await admin.from("study_notes").select("id").eq("subject_id", subj.id);
  console.log("study_notes rows AFTER clicking retry:", afterRows?.length ?? 0, "(should be >0 if the button actually generates anything)");

  await context.close();
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
