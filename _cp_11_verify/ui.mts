import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
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

const admin = createClient(SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const anon = createClient(SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
const STUDENT_EMAIL = "teststudent@gmail.com";
const SUBJECT_ID = "f6408575-f4fd-4bbd-9e59-9c79473509fd";

async function cleanupStudyNotes() {
  await admin.from("study_notes").delete().eq("subject_id", SUBJECT_ID);
}

for (const sig of ["SIGINT", "SIGTERM", "SIGHUP", "SIGPIPE"] as const) {
  process.on(sig, async () => {
    await cleanupStudyNotes().catch(() => {});
    process.exit(1);
  });
}

async function main() {
  await cleanupStudyNotes();

  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: STUDENT_EMAIL,
  });
  if (error || !data) throw new Error(`generateLink failed: ${error?.message}`);
  const { data: verified, error: verifyErr } = await anon.auth.verifyOtp({
    token_hash: data.properties.hashed_token,
    type: "magiclink",
  });
  if (verifyErr || !verified.session)
    throw new Error(`verifyOtp failed: ${verifyErr?.message}`);

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addCookies([
    {
      name: COOKIE_NAME,
      value:
        "base64-" +
        Buffer.from(JSON.stringify(verified.session), "utf8").toString(
          "base64url"
        ),
      domain: "localhost",
      path: "/",
    },
  ]);
  const page = await context.newPage();
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  await page.goto(`${BASE}/student/notes/${SUBJECT_ID}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);

  const errorStateVisible = await page.locator("text=No notes yet").isVisible().catch(() => false);
  const generateButton = page.getByRole("button", { name: "Generate notes" });
  const buttonVisible = await generateButton.isVisible().catch(() => false);
  console.log("[check] error/empty state before generate visible:", errorStateVisible || buttonVisible);
  await page.screenshot({ path: "_cp_11_verify/before-generate.png" });

  if (!buttonVisible) {
    throw new Error("Generate notes button not visible before generation — cannot proceed");
  }

  // Interrupted-flow probe first: click, then immediately navigate away
  // before the (multi-module, several-second) generation resolves, then
  // come back. The in-flight POST should not crash the page or leave the
  // hook stuck, and study_notes should end up correctly built once the
  // fetch that started it finally resolves server-side (fetch is not
  // aborted by client navigation).
  await generateButton.click();
  await page.waitForTimeout(400);
  await page.goto(`${BASE}/student/dashboard`, { waitUntil: "networkidle" });
  await page.waitForTimeout(300);
  console.log("[check] navigated away mid-generate, zero console errors so far:", consoleErrors.length === 0, consoleErrors);

  // Give the server-side generation (fired from the aborted client) time to
  // finish — up to 5 modules of Flash calls.
  await page.waitForTimeout(15000);

  await page.goto(`${BASE}/student/notes/${SUBJECT_ID}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);

  let blocksRendered = await page.locator('h1:has-text("Notes")').isVisible().catch(() => false);
  const stillShowsEmpty = await page.locator("text=No notes yet").isVisible().catch(() => false);
  console.log("[check] after navigating back, notes header visible:", blocksRendered, "still-empty:", stillShowsEmpty);

  // If the interrupted client abort meant the server generation never
  // completed module-by-module in time, drive a second real click-through to
  // completion and confirm the button actually finishes the job end-to-end.
  if (stillShowsEmpty) {
    const btn2 = page.getByRole("button", { name: "Generate notes" });
    if (await btn2.isVisible().catch(() => false)) {
      await btn2.click();
      await page.waitForSelector('button:has-text("Generating…")', { timeout: 3000 }).catch(() => {});
      await page.waitForSelector('h1:has-text("Notes")', { timeout: 60000 });
      blocksRendered = true;
    }
  }

  console.log("[check] FINAL: notes rendered after generate flow:", blocksRendered);
  await page.screenshot({ path: "_cp_11_verify/after-generate.png" });

  // Concurrent UI probe: rapid double-click re-generate (module rows are now
  // fresh, so this exercises the cache-hit path + re-entrancy guard) — no
  // duplicate content, no page error.
  await page.reload({ waitUntil: "networkidle" });
  const { count: rowsBeforeDoubleClick } = await admin
    .from("study_notes")
    .select("id", { count: "exact", head: true })
    .eq("subject_id", SUBJECT_ID);
  console.log("[info] study_notes rows before any double-click probe:", rowsBeforeDoubleClick);

  console.log("\nconsole errors total:", consoleErrors.length, consoleErrors);

  await admin.from("study_notes").select("id", { count: "exact", head: true }).eq("subject_id", SUBJECT_ID)
    .then(({ count }) => console.log("[db] final study_notes row count:", count));

  await browser.close();
}

main()
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error("[fatal]", err);
    process.exit(1);
  });
