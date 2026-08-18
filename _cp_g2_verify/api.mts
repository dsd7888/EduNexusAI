/**
 * CP-G2 HTTP-harness: proves the access policy end-to-end against a real
 * running dev server (`npm run dev`, localhost:3000) and real Supabase auth
 * sessions — the "four-assertion template" CLAUDE.md asks for, adapted from
 * an RLS claim to an API-response-shape claim (same spirit: a real client
 * per role, a positive control, "empty AND no error" checked explicitly,
 * and a canary string grepped across the full serialized payload).
 *
 * Isolated fixture branches (ZZTEST / ZZTEST2) so this harness never reads
 * or reasons about real pilot students — it seeds its own cohort, asserts
 * against it, and deletes every row it created.
 *
 * Run: npx tsx _cp_g2_verify/api.mts
 */
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
const DASHBOARD_PATH = "/api/placement/tpo/dashboard";

const admin = createClient(SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const anon = createClient(SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

const BRANCH_MAIN = "ZZTESTG2";
const BRANCH_THIN = "ZZTESTG2SMALL";
const CANARY_NAME = "Zz Canary Weakcoder";

// ── Cleanup tracking — exact, not a blanket delete. ─────────────────────────
const createdUserIds: string[] = [];
const createdProfileIds: string[] = [];
const createdSppIds: string[] = [];
let createdDriveId: string | null = null;
let createdCompanyId: string | null = null;

async function cleanup() {
  if (createdSppIds.length) {
    await admin.from("student_placement_profiles").delete().in("id", createdSppIds);
  }
  if (createdDriveId) {
    await admin.from("placement_drives").delete().eq("id", createdDriveId);
  }
  if (createdCompanyId) {
    await admin.from("placement_company_profiles").delete().eq("id", createdCompanyId);
  }
  if (createdProfileIds.length) {
    await admin.from("profiles").delete().in("id", createdProfileIds);
  }
  for (const uid of createdUserIds) {
    await admin.auth.admin.deleteUser(uid);
  }

  // Verify, don't assume.
  const { data: residueSpp } = await admin
    .from("student_placement_profiles")
    .select("id")
    .in("id", createdSppIds.length ? createdSppIds : ["00000000-0000-0000-0000-000000000000"]);
  const { data: residueProfiles } = await admin
    .from("profiles")
    .select("id")
    .in("id", createdProfileIds.length ? createdProfileIds : ["00000000-0000-0000-0000-000000000000"]);
  console.log(
    `[cleanup] spp residue: ${residueSpp?.length ?? 0} (expect 0), profile residue: ${residueProfiles?.length ?? 0} (expect 0)`
  );
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

// ── Auth: mint a real session for a real role, same pattern as every prior ──
// checkpoint's harness (CP-A2 onward).
async function ensureUser(email: string, fullName: string): Promise<string> {
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error || !data) throw new Error(`generateLink(${email}) failed: ${error?.message}`);
  const id = data.user.id;
  createdUserIds.push(id);
  await admin.from("profiles").update({ full_name: fullName }).eq("id", id);
  createdProfileIds.push(id);
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
  const value = "base64-" + Buffer.from(JSON.stringify(verified.session), "utf8").toString("base64url");
  return `${COOKIE_NAME}=${value}`;
}

// Minimal shape of the dashboard route's response, just what this harness
// asserts on — not a full mirror of route.ts's types.
interface DashboardJson {
  access?: { role: string; branch: string | null; warning: string | null };
  stats?: { total_students: number } | null;
  students?: Array<{ email: string; branch: string | null }>;
  insights?: {
    dimension_gaps?: { suppressed: boolean; ranked: unknown };
    activity?: { suppressed: boolean };
    target_distribution?: { suppressed: boolean };
    at_risk?: { count: number | null; named?: Array<{ full_name: string | null }> };
    readiness_lift?: { branch: string; points: unknown[] };
  };
}

async function getDashboard(
  cookie: string,
  query = ""
): Promise<{ status: number; json: DashboardJson; raw: string }> {
  const res = await fetch(`${BASE}${DASHBOARD_PATH}${query}`, { headers: { cookie } });
  const raw = await res.text();
  let json: DashboardJson = {};
  try {
    json = JSON.parse(raw) as DashboardJson;
  } catch {
    // leave {}; caller asserts on raw/status
  }
  return { status: res.status, json, raw };
}

let pass = 0;
let fail = 0;
function assert(cond: boolean, label: string) {
  if (cond) {
    pass += 1;
    console.log(`  ok  ${label}`);
  } else {
    fail += 1;
    console.error(`FAIL  ${label}`);
  }
}

async function main() {
  console.log("=== CP-G2 seeding ===");

  // ── Company + drive (within the 14-day sprint window, product-weighted — ──
  // coding is the heaviest dimension — so a coding-weak student is at risk).
  const { data: company, error: companyErr } = await admin
    .from("placement_company_profiles")
    .insert({
      slug: "zztest-g2-corp",
      name: "ZzTest G2 Corp",
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

  const driveDate = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
  const { data: drive, error: driveErr } = await admin
    .from("placement_drives")
    .insert({
      company_id: company.id,
      school: "engineering",
      drive_date: driveDate,
      registration_deadline: null,
      eligible_branches: [BRANCH_MAIN],
      eligible_min_cgpa: null,
      notes: "CP-G2 harness fixture — safe to delete",
      is_active: true,
      created_by: null,
    })
    .select("id")
    .single();
  if (driveErr || !drive) throw new Error(`drive insert failed: ${driveErr?.message}`);
  createdDriveId = drive.id;

  // ── 5-student cohort in BRANCH_MAIN (at the privacy floor, so aggregates ──
  // render). Student 1 is the canary + the at-risk fixture: weak coding,
  // eligible for the drive above.
  const mainStudents = [
    { email: "zzg2.student1@example.com", full_name: CANARY_NAME, coding: 30 },
    { email: "zzg2.student2@example.com", full_name: "Zz Student Two", coding: 70 },
    { email: "zzg2.student3@example.com", full_name: "Zz Student Three", coding: 70 },
    { email: "zzg2.student4@example.com", full_name: "Zz Student Four", coding: 70 },
    { email: "zzg2.student5@example.com", full_name: "Zz Student Five", coding: 70 },
  ];
  for (const s of mainStudents) {
    const uid = await ensureUser(s.email, s.full_name);
    await admin
      .from("profiles")
      .update({ role: "student", branch: BRANCH_MAIN, semester: 7 })
      .eq("id", uid);
    const { data: spp, error: sppErr } = await admin
      .from("student_placement_profiles")
      .insert({
        student_id: uid,
        cgpa: 8,
        active_backlogs: 0,
        history_backlogs: 0,
        primary_target: "product",
        dream_companies: [],
        open_to_relocation: true,
        readiness_aptitude: 70,
        readiness_verbal: 70,
        readiness_domain: 70,
        readiness_coding: s.coding,
        readiness_communication: 70,
        readiness_overall: 65,
        resume_data: {},
        resume_completeness: 50,
        prep_streak_days: 3,
        last_active_date: new Date().toISOString(),
        setup_complete: true,
      })
      .select("id")
      .single();
    if (sppErr || !spp) throw new Error(`spp insert failed for ${s.email}: ${sppErr?.message}`);
    createdSppIds.push(spp.id);
  }

  // ── 2-student cohort in BRANCH_THIN (below MIN_COHORT_FOR_AGGREGATE=5). ──
  const thinStudents = [
    { email: "zzg2.thin1@example.com", full_name: "Zz Thin One" },
    { email: "zzg2.thin2@example.com", full_name: "Zz Thin Two" },
  ];
  for (const s of thinStudents) {
    const uid = await ensureUser(s.email, s.full_name);
    await admin
      .from("profiles")
      .update({ role: "student", branch: BRANCH_THIN, semester: 7 })
      .eq("id", uid);
    const { data: spp, error: sppErr } = await admin
      .from("student_placement_profiles")
      .insert({
        student_id: uid,
        cgpa: 8,
        active_backlogs: 0,
        history_backlogs: 0,
        primary_target: "service_it",
        dream_companies: [],
        open_to_relocation: true,
        readiness_aptitude: 50,
        readiness_verbal: 50,
        readiness_domain: 50,
        readiness_coding: 50,
        readiness_communication: 50,
        readiness_overall: 50,
        resume_data: {},
        resume_completeness: 40,
        prep_streak_days: 1,
        last_active_date: new Date().toISOString(),
        setup_complete: true,
      })
      .select("id")
      .single();
    if (sppErr || !spp) throw new Error(`spp insert failed for ${s.email}: ${sppErr?.message}`);
    createdSppIds.push(spp.id);
  }

  // ── Management fixtures ─────────────────────────────────────────────────
  const hodId = await ensureUser("zzg2.hod@example.com", "Zz Test HOD");
  await admin.from("profiles").update({ role: "hod", branch: BRANCH_MAIN }).eq("id", hodId);

  const hodNoBranchId = await ensureUser("zzg2.hodnobranch@example.com", "Zz Test HOD No Branch");
  await admin.from("profiles").update({ role: "hod", branch: null }).eq("id", hodNoBranchId);

  const deanId = await ensureUser("zzg2.dean@example.com", "Zz Test Dean");
  await admin.from("profiles").update({ role: "dean", branch: null }).eq("id", deanId);

  const superadminId = await ensureUser("zzg2.superadmin@example.com", "Zz Test Superadmin");
  await admin.from("profiles").update({ role: "superadmin", branch: null }).eq("id", superadminId);

  console.log("=== CP-G2 seeding complete ===\n=== Tests ===");

  // ── 1. Positive control: superadmin sees named rows, all branches. ──────
  {
    const cookie = await sessionCookieFor("zzg2.superadmin@example.com");
    const { status, json } = await getDashboard(cookie);
    assert(status === 200, "superadmin: 200 OK");
    assert(Array.isArray(json?.students), "superadmin: `students` array present (positive control)");
    const emails = new Set((json?.students ?? []).map((s) => s.email));
    assert(
      emails.has("zzg2.student1@example.com") && emails.has("zzg2.thin1@example.com"),
      "superadmin: sees students across BOTH seeded branches (unrestricted)"
    );
  }

  // ── 2. HOD branch-tampering: ?branch=<other branch> is ignored, own ─────
  //    branch enforced server-side. THE core access-policy test.
  {
    const cookie = await sessionCookieFor("zzg2.hod@example.com");
    const { status, json } = await getDashboard(cookie, `?branch=${BRANCH_THIN}`);
    assert(status === 200, "hod tampering: 200 OK (not blocked, not 500)");
    assert(json?.access?.branch === BRANCH_MAIN, "hod tampering: access.branch is OWN branch, not the requested one");
    assert(json?.stats !== null && typeof json?.stats?.total_students === "number", "hod tampering: `stats` present (named role keeps legacy stats)");
    const branches = new Set((json?.students ?? []).map((s) => s.branch));
    assert(
      branches.size === 1 && branches.has(BRANCH_MAIN),
      "hod tampering: `students` contains ONLY own-branch rows despite ?branch=<other>"
    );
    assert(
      (json?.students ?? []).length === mainStudents.length,
      "hod tampering: exact own-branch student count, not the other branch's"
    );
  }

  // ── 3. HOD with no branch set: graceful block, not a crash or a leak. ───
  {
    const cookie = await sessionCookieFor("zzg2.hodnobranch@example.com");
    const { status, json } = await getDashboard(cookie);
    assert(status === 200, "hod no-branch: 200 OK, not 500 (degrades gracefully)");
    assert(typeof json?.access?.warning === "string" && json.access.warning.length > 0,
      "hod no-branch: plain-language warning present");
    assert(!("students" in json), "hod no-branch: `students` key absent entirely (no accidental all-branch leak)");
  }

  // ── 4. Dean: zero named rows, ever — the core privacy assertion. ────────
  {
    const cookie = await sessionCookieFor("zzg2.dean@example.com");
    const { json, raw } = await getDashboard(cookie);
    assert(!("students" in json), "dean: `students` key ABSENT from the payload (not hidden client-side)");
    assert(json?.stats === null, "dean: `stats` (unfloored legacy aggregate) is null, not a raw recompute");
    // Canary: the flagged at-risk student's actual name must not survive
    // ANYWHERE in the serialized response — not just absent from `students`.
    assert(!raw.includes(CANARY_NAME), "dean: canary student name absent from the FULL serialized payload");
    assert(!raw.includes("zzg2.student1@example.com"), "dean: canary student email absent from the full payload");
  }

  // ── 5. Dean scoped to the AT-FLOOR branch: aggregates render, count-only ──
  //    at-risk (not named).
  {
    const cookie = await sessionCookieFor("zzg2.dean@example.com");
    const { json, raw } = await getDashboard(cookie, `?branch=${BRANCH_MAIN}`);
    assert(!("students" in json), "dean scoped: still zero named rows when narrowed by ?branch=");
    assert(
      json?.insights?.dimension_gaps?.suppressed === false,
      "dean scoped: 5-student branch is AT the floor — dimension gaps render, not suppressed"
    );
    assert(
      typeof json?.insights?.at_risk?.count === "number" && json.insights.at_risk.count >= 1,
      "dean scoped: at-risk COUNT is a number (the seeded coding-weak student)"
    );
    assert(!("named" in (json?.insights?.at_risk ?? {})), "dean scoped: at-risk `named` key absent for dean");
    assert(!raw.includes(CANARY_NAME), "dean scoped: canary name still absent even in the at-risk aggregate view");
  }

  // ── 6. Dean scoped to the BELOW-FLOOR branch: suppressed, not zero. ─────
  {
    const cookie = await sessionCookieFor("zzg2.dean@example.com");
    const { json } = await getDashboard(cookie, `?branch=${BRANCH_THIN}`);
    assert(json?.insights?.dimension_gaps?.suppressed === true, "below-floor: dimension_gaps.suppressed === true");
    assert(json?.insights?.dimension_gaps?.ranked === null, "below-floor: dimension_gaps.ranked is null, not []");
    assert(json?.insights?.activity?.suppressed === true, "below-floor: activity.suppressed === true");
    assert(json?.insights?.target_distribution?.suppressed === true, "below-floor: target_distribution.suppressed === true");
    assert(json?.insights?.at_risk?.count === null, "below-floor: at-risk count suppressed to null for dean, not 0");
  }

  // ── 7. HOD sees NAMED at-risk entry for their own branch (not just a ────
  //    count) — the counterpart assertion: management-blocked data must
  //    still be visible to the role that legitimately owns it.
  {
    const cookie = await sessionCookieFor("zzg2.hod@example.com");
    const { json } = await getDashboard(cookie);
    assert(Array.isArray(json?.insights?.at_risk?.named), "hod: at-risk `named` array present");
    const names = (json?.insights?.at_risk?.named ?? []).map((e) => e.full_name);
    assert(names.includes(CANARY_NAME), "hod: sees the actual at-risk student's name for their own branch");
  }

  // ── 8. Readiness-lift-over-time key present and correctly scoped. ───────
  {
    const cookie = await sessionCookieFor("zzg2.hod@example.com");
    const { json } = await getDashboard(cookie);
    assert(json?.insights?.readiness_lift?.branch === BRANCH_MAIN, "hod: readiness_lift scoped to own branch");
    assert(Array.isArray(json?.insights?.readiness_lift?.points), "hod: readiness_lift.points is an array (possibly empty pre-backfill)");
  }

  console.log(`\n${pass} passed, ${fail} failed`);
}

main()
  .then(async () => {
    await cleanup();
    process.exit(fail > 0 ? 1 : 0);
  })
  .catch(async (err) => {
    console.error("HARNESS ERROR:", err);
    await cleanup();
    process.exit(1);
  });
