/**
 * AU-PLACE-TOOLS UI verification: desktop + mobile of resume, jd-analyzer,
 * interview bank, interview mock landing, skill-map, projects. Dark mode is
 * confirmed unreachable app-wide by AU-CHAT/AU-NOTES/AU-PLACE-CORE (ledgered
 * cross-cutting finding) — not re-litigated per screen, light only.
 */
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
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
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

  const email = `cp-audit-place-tools-ui-${randomUUID().slice(0, 8)}@edunexus-harness.invalid`;
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password: `Hx-${randomUUID()}`,
    email_confirm: true,
    user_metadata: { full_name: "AU-PLACE-TOOLS UI Audit" },
  });
  if (createErr || !created.user) throw new Error(`createUser failed: ${createErr?.message}`);
  const userId = created.user.id;

  for (let i = 0; i < 20; i++) {
    const { data } = await admin.from("profiles").select("id").eq("id", userId).maybeSingle();
    if (data) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  await admin
    .from("profiles")
    .update({ role: "student", branch: "Computer Science", semester: 7, full_name: "AU-PLACE-TOOLS UI Audit", department: "Engineering" })
    .eq("id", userId);

  const resumeData = {
    full_name: "AU-PLACE-TOOLS UI Audit",
    email,
    phone: "9998887776",
    linkedin_url: "https://linkedin.com/in/audit",
    github_url: "https://github.com/audit",
    portfolio_url: null,
    education: [
      { degree: "B.Tech", branch: "Computer Science and Engineering", university: "P.P. Savani University", cgpa: "8.2", year_of_passing: "2027", relevant_courses: ["DSA", "DBMS", "OS"] },
    ],
    technical_skills: { languages: ["Java", "Python", "SQL"], frameworks: ["React", "Express"], tools: ["Git", "Docker"], concepts: ["DSA", "OOP", "DBMS"] },
    soft_skills: ["Teamwork"],
    projects: [
      { id: "p1", title: "Student Management API", tech_stack: ["Node.js", "Express", "MySQL"], bullets: ["Built REST API with 5 CRUD endpoints", "Reduced query latency 30% via indexing"], github_url: "https://github.com/audit/sma", live_url: null, duration: "Jan 2026 - Feb 2026" },
    ],
    internships: [],
    certifications: [],
    achievements: [],
    summary: "",
    skills: [],
    last_updated: new Date().toISOString(),
    completeness: 80,
  };

  // Seed a realistic, setup-complete placement profile so pages render real
  // content, not just the setup-incomplete empty state.
  await admin.from("student_placement_profiles").upsert({
    student_id: userId,
    setup_complete: true,
    primary_target: "service_it",
    cgpa: 8.2,
    active_backlogs: 0,
    history_backlogs: 0,
    readiness_aptitude: 55,
    readiness_verbal: 40,
    readiness_domain: 62,
    readiness_coding: 30,
    readiness_communication: 70,
    readiness_overall: 51,
    resume_completeness: 80,
    resume_data: resumeData,
  });

  const jar = new Map<string, { value: string }>();
  const browserLike = createBrowserClient(url, anonKey, {
    isSingleton: false,
    cookies: {
      getAll: () => [...jar.entries()].map(([name, v]) => ({ name, value: v.value })),
      setAll: (list) => {
        for (const { name, value } of list) jar.set(name, { value });
      },
    },
  });

  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (linkErr || !link.properties?.hashed_token) throw new Error(`generateLink failed: ${linkErr?.message}`);
  const { error: otpErr } = await browserLike.auth.verifyOtp({ type: "email", token_hash: link.properties.hashed_token });
  if (otpErr) throw new Error(`verifyOtp failed: ${otpErr.message}`);

  console.log(`signed in as ${email}`);

  const browser = await chromium.launch();
  const cookiesForPlaywright = [...jar.entries()].map(([name, v]) => ({
    name,
    value: v.value,
    domain: "localhost",
    path: "/",
  }));

  const viewports: { name: string; width: number; height: number }[] = [
    { name: "desktop", width: 1280, height: 900 },
    { name: "mobile", width: 390, height: 844 },
  ];

  const pages = [
    { slug: "resume", path: "/student/placement/resume" },
    { slug: "jd-analyzer", path: "/student/placement/jd-analyzer" },
    { slug: "interview-bank", path: "/student/placement/interview" },
    { slug: "interview-mock-landing", path: "/student/placement/interview/mock" },
    { slug: "skill-map", path: "/student/placement/skill-map" },
    { slug: "projects", path: "/student/placement/projects" },
    { slug: "project-detail", path: "/student/placement/projects/personal-portfolio" },
  ];

  for (const pg of pages) {
    for (const vp of viewports) {
      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        colorScheme: "light",
      });
      await context.addCookies(cookiesForPlaywright);
      const page = await context.newPage();
      try {
        await page.goto(`${BASE_URL}${pg.path}`, { waitUntil: "networkidle", timeout: 30000 });
        await page.waitForTimeout(1200);
        const outPath = `_audit_place_tools/screenshots/${pg.slug}-${vp.name}-light.png`;
        await page.screenshot({ path: outPath, fullPage: true });
        console.log(`wrote ${outPath}`);
      } catch (err) {
        console.error(`FAILED ${pg.path} @ ${vp.name}:`, err instanceof Error ? err.message : err);
      }
      await context.close();
    }
  }

  // Dark-mode probe (cross-cutting: expected unreachable) — try forcing the
  // .dark class + colorScheme:'dark' on the resume page to confirm/deny.
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: "dark" });
    await context.addCookies(cookiesForPlaywright);
    const page = await context.newPage();
    await page.goto(`${BASE_URL}/student/placement/resume`, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(800);
    const hasDarkClass = await page.evaluate(() => document.documentElement.classList.contains("dark"));
    console.log("resume page — <html> has .dark class under prefers-color-scheme:dark:", hasDarkClass);
    await page.screenshot({ path: "_audit_place_tools/screenshots/resume-desktop-darkprobe.png", fullPage: true });
    await context.close();
  }

  await browser.close();

  // cleanup
  await admin.from("student_placement_profiles").delete().eq("student_id", userId);
  await admin.from("profiles").delete().eq("id", userId);
  await admin.auth.admin.deleteUser(userId);
  console.log("cleanup done");
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exitCode = 1;
});
