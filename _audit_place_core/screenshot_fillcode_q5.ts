import { chromium } from "playwright";
import { createBrowserClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";

function loadEnvLocal(): void {
  const raw = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (!process.env[key]) process.env[key] = val;
  }
}
loadEnvLocal();
const BASE_URL = "http://localhost:3000";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

  const email = `cp-audit-place-fc-${randomUUID().slice(0, 8)}@edunexus-harness.invalid`;
  const { data: created } = await admin.auth.admin.createUser({ email, password: `Hx-${randomUUID()}`, email_confirm: true });
  const userId = created!.user!.id;
  for (let i = 0; i < 20; i++) {
    const { data } = await admin.from("profiles").select("id").eq("id", userId).maybeSingle();
    if (data) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  await admin.from("profiles").update({ role: "student", branch: "Computer Science", semester: 7, department: "Engineering" }).eq("id", userId);

  const fc = Array.from({ length: 4 }).map((_, i) => ({
    track: "domain", topic: "SQL Queries & Joins", topic_bucket: "sql_ui_seed2", difficulty: "easy",
    question_text: `Fill-code Q${i + 1}: complete the query so it returns every department, including ones with zero employees.`,
    options: [
      { key: "A", text: "SELECT d.name, COUNT(e.id) FROM departments d JOIN employees e ON e.dept_id = d.id GROUP BY d.name" },
      { key: "B", text: "SELECT d.name, COUNT(e.id) FROM departments d LEFT JOIN employees e ON e.dept_id = d.id GROUP BY d.name" },
      { key: "C", text: "SELECT d.name, COUNT(e.id) FROM departments d RIGHT JOIN employees e ON e.dept_id = d.id GROUP BY d.name" },
      { key: "D", text: "SELECT d.name, COUNT(e.id) FROM departments d, employees e GROUP BY d.name" },
    ],
    correct_answer: "B",
    explanation: "LEFT JOIN keeps every department row.",
    question_type: "fill_code",
    code_context: { language: "SQL", before_blank: "-- Department headcount, including empty depts\nSELECT d.name, COUNT(e.id)", after_blank: "GROUP BY d.name;", blank_description: "The FROM/JOIN clause including zero-employee departments" },
    is_active: true,
  }));
  const mcq = Array.from({ length: 4 }).map((_, i) => ({
    track: "domain", topic: "SQL Queries & Joins", topic_bucket: "sql_ui_seed2", difficulty: "easy",
    question_text: `Seed MCQ ${i + 1}: which clause removes duplicate rows?`,
    options: [{ key: "A", text: "UNIQUE" }, { key: "B", text: "DISTINCT" }, { key: "C", text: "GROUP" }, { key: "D", text: "FILTER" }],
    correct_answer: "B", explanation: "DISTINCT removes duplicates.", question_type: "mcq",
  }));
  await admin.from("placement_question_bank").insert([...fc, ...mcq]);

  const jar = new Map<string, { value: string }>();
  const browserLike = createBrowserClient(url, anonKey, {
    isSingleton: false,
    cookies: { getAll: () => [...jar.entries()].map(([name, v]) => ({ name, value: v.value })), setAll: (list) => { for (const { name, value } of list) jar.set(name, { value }); } },
  });
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  await browserLike.auth.verifyOtp({ type: "email", token_hash: link!.properties!.hashed_token! });

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: "light" });
  await context.addCookies([...jar.entries()].map(([name, v]) => ({ name, value: v.value, domain: "localhost", path: "/" })));
  const page = await context.newPage();
  await page.goto(`${BASE_URL}/student/placement/prep/domain/practice?topic=${encodeURIComponent("SQL Queries & Joins")}`, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(1200);

  // Click through Q1-Q4 (MCQ) to reach Q5 (first fill_code).
  for (let i = 0; i < 4; i++) {
    await page.locator("button", { hasText: "A." }).first().click();
    await page.locator("button", { hasText: /Next|Finish/ }).click();
    await page.waitForTimeout(400);
  }
  await page.waitForTimeout(600);
  await page.screenshot({ path: "_audit_place_core/screenshots/practice-fillcode-Q5-desktop-light.png", fullPage: true });
  const codeBlockVisible = await page.locator(".font-mono.bg-gray-900, .bg-gray-900").first().isVisible().catch(() => false);
  const optButtons = await page.locator("button").filter({ hasText: /^[A-D]\./ }).count();
  console.log("fill_code screen: code block visible=", codeBlockVisible, "option buttons=", optButtons);

  await context.close();
  await browser.close();
  await admin.from("placement_question_bank").delete().eq("topic_bucket", "sql_ui_seed2");
  await admin.from("placement_question_attempts").delete().eq("student_id", userId);
  await admin.from("placement_topic_mastery").delete().eq("student_id", userId);
  await admin.from("student_placement_profiles").delete().eq("student_id", userId);
  await admin.from("profiles").delete().eq("id", userId);
  await admin.auth.admin.deleteUser(userId);
  console.log("done");
}
main().catch((e) => { console.error("FATAL:", e); process.exitCode = 1; });
