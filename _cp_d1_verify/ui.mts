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
const BASE = "http://localhost:3000";
const OUT = "_cp_d1_verify/screens";
fs.mkdirSync(OUT, { recursive: true });

const admin = createClient(SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const anon = createClient(SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

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

async function authedContext(
  browser: import("playwright").Browser,
  email: string,
  viewport: { width: number; height: number }
) {
  const session = await sessionFor(email);
  const ctx = await browser.newContext({ viewport });
  await ctx.addCookies([
    {
      name: COOKIE_NAME,
      value: cookieValueFor(session),
      domain: "localhost",
      path: "/",
      httpOnly: false,
      secure: false,
      sameSite: "Lax",
    },
  ]);
  return { ctx, userId: session.user.id };
}

const EMAIL = "teststudent@gmail.com";
const HOLLOW_BULLET = "Worked on the backend and helped improve performance";
const JD_TEXT =
  "We are hiring a Backend Engineer to build and operate distributed systems. " +
  "You will work with Kafka for event streaming, own services in production, " +
  "and participate in on-call rotations. Strong Java or Go experience required. " +
  "Experience with Kubernetes and observability tooling (Prometheus, Grafana) is a plus.";

const SEED_RESUME = {
  full_name: "Test Student",
  email: EMAIL,
  phone: "9999999999",
  linkedin_url: null,
  github_url: null,
  portfolio_url: null,
  education: [
    { degree: "B.Tech", branch: "Computer Science and Engineering", university: "P.P. Savani University", cgpa: "8.2", year_of_passing: "2026", relevant_courses: [] },
  ],
  technical_skills: { languages: ["Java", "Python"], frameworks: ["Spring Boot"], tools: ["Git"], concepts: ["DSA", "OOP"] },
  soft_skills: [],
  projects: [
    {
      id: "cp-d1-p1",
      title: "Order Processing Service",
      tech_stack: ["Java", "Spring Boot", "PostgreSQL"],
      bullets: [HOLLOW_BULLET, "Built a REST API for order tracking used by 3 internal teams"],
      github_url: null,
      live_url: null,
      duration: "Jan 2025 - Mar 2025",
    },
  ],
  internships: [],
  certifications: [],
  achievements: [],
  summary: "",
  skills: [],
  last_updated: "",
  completeness: 0,
};

async function main() {
  let cleanup: (() => Promise<void>) | null = null;
  const cleanupOnSignal = async (sig: string) => {
    console.log(`\nreceived ${sig}, running cleanup before exit...`);
    if (cleanup) await cleanup();
    process.exit(1);
  };
  process.on("SIGINT", () => void cleanupOnSignal("SIGINT"));
  process.on("SIGTERM", () => void cleanupOnSignal("SIGTERM"));
  process.on("SIGHUP", () => void cleanupOnSignal("SIGHUP"));

  const probeSession = await sessionFor(EMAIL);
  const userId = probeSession.user.id;

  const { data: before } = await admin
    .from("student_placement_profiles")
    .select("resume_data, resume_completeness")
    .eq("student_id", userId)
    .maybeSingle();

  cleanup = async () => {
    await admin
      .from("student_placement_profiles")
      .update({ resume_data: before?.resume_data ?? null, resume_completeness: before?.resume_completeness ?? 0 })
      .eq("student_id", userId);
    console.log("restored original resume_data for", EMAIL);
  };

  const browser = await chromium.launch();
  const errors: string[] = [];

  try {
    // Seed a resume with one deliberately hollow bullet + one substantive one.
    const { error: seedErr } = await admin
      .from("student_placement_profiles")
      .update({ resume_data: SEED_RESUME, resume_completeness: 60 })
      .eq("student_id", userId);
    if (seedErr) throw new Error(`seed failed: ${seedErr.message}`);

    // ── Desktop ──
    {
      const { ctx } = await authedContext(browser, EMAIL, { width: 1280, height: 1400 });
      const page = await ctx.newPage();
      page.on("pageerror", (e) => errors.push(String(e)));
      await page.goto(`${BASE}/student/placement/resume`, { waitUntil: "networkidle" });
      await page.waitForSelector("text=Resume Builder", { timeout: 20000 });

      // Switch to the Projects section, then expand the seeded project so
      // the hollow bullet is visible in the editor.
      await page.getByRole("button", { name: "Projects", exact: false }).first().click();
      await page.getByRole("button", { name: /Order Processing Service/ }).click();
      await page.waitForSelector(`text=${HOLLOW_BULLET}`, { timeout: 10000 });

      // Paste JD and analyze — exercises both the ATS pass and the new
      // interviewer-lens pass in the same request.
      const jdBox = page.getByPlaceholder("Paste the full job description here...");
      await jdBox.fill(JD_TEXT);
      await page.getByRole("button", { name: "Analyze Resume" }).click();
      await page.waitForSelector("text=Interviewer Lens", { timeout: 45000 });
      await page.waitForSelector("text=ATS Match Score", { timeout: 5000 });

      const lensFlagged = await page.getByText(HOLLOW_BULLET.slice(0, 40)).count();
      console.log("[desktop] interviewer-lens panel shows the hollow bullet (count>=1):", lensFlagged);
      await page.screenshot({ path: `${OUT}/desktop-interviewer-lens.png`, fullPage: true });

      // Rewrite the hollow bullet (first bullet in the project, so the first
      // "Rewrite" button) with the JD in scope — confirm the "Tailored to
      // your JD" tag renders on the resulting variant cards.
      await page.getByRole("button", { name: "Rewrite" }).first().click();
      await page.waitForSelector("text=Tailored to your JD", { timeout: 20000 });
      console.log("[desktop] 'Tailored to your JD' tag rendered after rewrite");
      await page.screenshot({ path: `${OUT}/desktop-tailored-rewrite.png`, fullPage: true });

      await ctx.close();
    }

    // ── Mobile ──
    {
      const { ctx } = await authedContext(browser, EMAIL, { width: 390, height: 844 });
      const page = await ctx.newPage();
      page.on("pageerror", (e) => errors.push(String(e)));
      await page.goto(`${BASE}/student/placement/resume`, { waitUntil: "networkidle" });
      await page.waitForSelector("text=Resume Builder", { timeout: 20000 });

      const jdBox = page.getByPlaceholder("Paste the full job description here...");
      await jdBox.fill(JD_TEXT);
      await page.getByRole("button", { name: "Analyze Resume" }).click();
      await page.waitForSelector("text=Interviewer Lens", { timeout: 45000 });
      console.log("[mobile] Interviewer Lens section reached");
      await page.screenshot({ path: `${OUT}/mobile-interviewer-lens.png`, fullPage: true });

      await ctx.close();
    }

    console.log("page errors total:", errors.length, errors);
  } finally {
    await browser.close();
    if (cleanup) await cleanup();
  }
}

main().catch(async (e) => {
  console.error("FATAL:", e);
  process.exitCode = 1;
});
