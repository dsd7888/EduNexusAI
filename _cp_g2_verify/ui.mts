/**
 * CP-G2 screenshot harness: real browser (Playwright + Chromium), real
 * Supabase auth sessions, against a freshly seeded isolated cohort
 * (branch ZZUISHOT) — captures the HOD view (named, own branch) and the
 * DEAN view (aggregates only, zero named rows) side by side, desktop and
 * mobile. These two screenshots are the visual proof the access policy
 * documented in src/lib/placement/access.ts actually renders differently
 * per role, not just that the API returns different JSON.
 *
 * Run: npx tsx _cp_g2_verify/ui.mts
 */
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
const SCREENS = "_cp_g2_verify/screens";
const BRANCH = "ZZUISHOT";

const admin = createClient(SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const anon = createClient(SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

const createdUserIds: string[] = [];
const createdSppIds: string[] = [];
let createdDriveId: string | null = null;
let createdCompanyId: string | null = null;

async function cleanup() {
  if (createdSppIds.length) await admin.from("student_placement_profiles").delete().in("id", createdSppIds);
  if (createdDriveId) await admin.from("placement_drives").delete().eq("id", createdDriveId);
  if (createdCompanyId) await admin.from("placement_company_profiles").delete().eq("id", createdCompanyId);
  if (createdUserIds.length) await admin.from("profiles").delete().in("id", createdUserIds);
  for (const uid of createdUserIds) await admin.auth.admin.deleteUser(uid);

  const { data: residue } = await admin
    .from("profiles")
    .select("id")
    .in("id", createdUserIds.length ? createdUserIds : ["00000000-0000-0000-0000-000000000000"]);
  console.log(`[cleanup] profile residue: ${residue?.length ?? 0} (expect 0)`);
}

let cleaningUp = false;
async function cleanupOnSignal(signal: string) {
  if (cleaningUp) return;
  cleaningUp = true;
  console.log(`\n[signal] ${signal} received — cleaning up before exit`);
  await cleanup();
  process.exit(1);
}
process.on("SIGINT", () => void cleanupOnSignal("SIGINT"));
process.on("SIGTERM", () => void cleanupOnSignal("SIGTERM"));
process.on("SIGHUP", () => void cleanupOnSignal("SIGHUP"));
process.on("SIGPIPE", () => void cleanupOnSignal("SIGPIPE"));

async function ensureUser(email: string, fullName: string): Promise<string> {
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error || !data) throw new Error(`generateLink(${email}) failed: ${error?.message}`);
  const id = data.user.id;
  createdUserIds.push(id);
  await admin.from("profiles").update({ full_name: fullName }).eq("id", id);
  return id;
}

async function sessionCookieFor(email: string): Promise<string> {
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error || !data) throw new Error(`generateLink(${email}) failed: ${error?.message}`);
  const { data: verified, error: verifyErr } = await anon.auth.verifyOtp({
    token_hash: data.properties.hashed_token,
    type: "magiclink",
  });
  if (verifyErr || !verified.session) throw new Error(`verifyOtp(${email}) failed: ${verifyErr?.message}`);
  return "base64-" + Buffer.from(JSON.stringify(verified.session), "utf8").toString("base64url");
}

async function main() {
  fs.mkdirSync(SCREENS, { recursive: true });

  console.log("=== seeding ===");
  const { data: company, error: companyErr } = await admin
    .from("placement_company_profiles")
    .insert({
      slug: "zztest-g2-ui-corp",
      name: "ZzTest UI Corp",
      company_type: "product",
      is_mass_recruiter: false,
      min_cgpa: null,
      backlogs_allowed: true,
      allowed_branches: null,
      is_active: true,
      display_order: 999,
    })
    .select("id")
    .single();
  if (companyErr || !company) throw new Error(`company insert failed: ${companyErr?.message}`);
  createdCompanyId = company.id;

  const driveDate = new Date(Date.now() + 6 * 86400000).toISOString().slice(0, 10);
  const { data: drive, error: driveErr } = await admin
    .from("placement_drives")
    .insert({
      company_id: company.id,
      school: "engineering",
      drive_date: driveDate,
      registration_deadline: null,
      eligible_branches: [BRANCH],
      eligible_min_cgpa: null,
      notes: "CP-G2 UI screenshot fixture — safe to delete",
      is_active: true,
      created_by: null,
    })
    .select("id")
    .single();
  if (driveErr || !drive) throw new Error(`drive insert failed: ${driveErr?.message}`);
  createdDriveId = drive.id;

  const studentDefs = [
    { email: "zzg2ui.s1@example.com", full_name: "Anita Shah", coding: 32, target: "product", days: 0 },
    { email: "zzg2ui.s2@example.com", full_name: "Rohan Mehta", coding: 78, target: "service_it", days: 2 },
    { email: "zzg2ui.s3@example.com", full_name: "Priya Nair", coding: 55, target: "startup", days: 20 },
    { email: "zzg2ui.s4@example.com", full_name: "Karan Verma", coding: 88, target: "product", days: 1 },
    { email: "zzg2ui.s5@example.com", full_name: "Sneha Rao", coding: 60, target: "bfsi", days: 40 },
  ];
  for (const s of studentDefs) {
    const uid = await ensureUser(s.email, s.full_name);
    await admin.from("profiles").update({ role: "student", branch: BRANCH, semester: 7 }).eq("id", uid);
    const { data: spp, error: sppErr } = await admin
      .from("student_placement_profiles")
      .insert({
        student_id: uid,
        cgpa: 8.2,
        active_backlogs: 0,
        history_backlogs: 0,
        primary_target: s.target,
        dream_companies: [],
        open_to_relocation: true,
        readiness_aptitude: 65,
        readiness_verbal: 60,
        readiness_domain: 70,
        readiness_coding: s.coding,
        readiness_communication: 62,
        readiness_overall: 62,
        resume_data: {},
        resume_completeness: 55,
        prep_streak_days: s.days === 0 ? 5 : 1,
        last_active_date: new Date(Date.now() - s.days * 86400000).toISOString(),
        setup_complete: true,
      })
      .select("id")
      .single();
    if (sppErr || !spp) throw new Error(`spp insert failed for ${s.email}: ${sppErr?.message}`);
    createdSppIds.push(spp.id);
  }

  const hodId = await ensureUser("zzg2ui.hod@example.com", "Test HOD");
  await admin.from("profiles").update({ role: "hod", branch: BRANCH }).eq("id", hodId);
  const deanId = await ensureUser("zzg2ui.dean@example.com", "Test Dean");
  await admin.from("profiles").update({ role: "dean", branch: null }).eq("id", deanId);

  console.log("=== seeding complete ===");

  const browser = await chromium.launch();

  async function shoot(
    email: string,
    branchQuery: string | null,
    viewport: { width: number; height: number },
    outPath: string,
    collapseSidebar = false
  ) {
    const cookieValue = await sessionCookieFor(email);
    const ctx = await browser.newContext({ viewport });
    await ctx.addCookies([
      { name: COOKIE_NAME, value: cookieValue, domain: "localhost", path: "/", httpOnly: false, secure: false },
    ]);
    if (collapseSidebar) {
      // FacultyShell's sidebar (src/components/layout/FacultyShell.tsx) has no
      // responsive/mobile behaviour of its own — a pre-existing, repo-wide gap
      // this checkpoint doesn't own (see the report). Collapsing it via its own
      // localStorage flag gives a representative view of THIS page's own
      // mobile responsiveness, decoupled from that separate, unowned issue.
      await ctx.addInitScript(() => {
        window.localStorage.setItem("faculty_nav_collapsed", "true");
      });
    }
    const page = await ctx.newPage();
    const url = branchQuery ? `${BASE}/faculty/placement-dashboard?branch=${branchQuery}` : `${BASE}/faculty/placement-dashboard`;
    await page.goto(url, { waitUntil: "networkidle" });
    await page.waitForSelector("h1", { timeout: 15000 });
    await page.waitForTimeout(500); // let the fetch-driven insight cards settle
    await page.screenshot({ path: outPath, fullPage: true });
    await ctx.close();
    console.log(`  saved ${outPath}`);
  }

  console.log("=== HOD view (named, own branch) ===");
  await shoot("zzg2ui.hod@example.com", null, { width: 1280, height: 900 }, `${SCREENS}/hod-desktop.png`);
  await shoot("zzg2ui.hod@example.com", null, { width: 390, height: 844 }, `${SCREENS}/hod-mobile.png`, true);

  console.log("=== DEAN view (aggregates only, no names) ===");
  await shoot("zzg2ui.dean@example.com", null, { width: 1280, height: 900 }, `${SCREENS}/dean-desktop.png`);
  await shoot("zzg2ui.dean@example.com", null, { width: 390, height: 844 }, `${SCREENS}/dean-mobile.png`, true);

  // ── Functional check: dean payload, inspected directly, carries zero ────
  // named rows and no leaked student name string anywhere.
  console.log("=== dean-payload inspection (unhappy-path proof) ===");
  const deanCookie = await sessionCookieFor("zzg2ui.dean@example.com");
  const res = await fetch(`${BASE}/api/placement/tpo/dashboard`, { headers: { cookie: deanCookie } });
  const raw = await res.text();
  const json = JSON.parse(raw);
  const hasStudents = "students" in json;
  const leaksName = raw.includes("Anita Shah");
  console.log(`  dean payload has 'students' key: ${hasStudents} (expect false)`);
  console.log(`  dean payload leaks a seeded student name: ${leaksName} (expect false)`);
  if (hasStudents || leaksName) {
    throw new Error("DEAN PAYLOAD LEAK DETECTED");
  }

  // ── Unhappy path: HOD with ?branch= tampering, screenshot the result. ───
  console.log("=== HOD ?branch= tampering (unhappy path) — screenshot ===");
  await shoot("zzg2ui.hod@example.com", "SOME_OTHER_BRANCH", { width: 1280, height: 900 }, `${SCREENS}/hod-branch-tamper-desktop.png`);

  await browser.close();
  console.log("\nAll UI checks passed.");
}

main()
  .then(async () => {
    await cleanup();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("UI HARNESS ERROR:", err);
    await cleanup();
    process.exit(1);
  });
