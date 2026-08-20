/**
 * Admin script: bulk-create student login accounts for the pilot.
 *
 * Sibling of scripts/bulk-create-faculty.ts, which it deliberately mirrors —
 * same password generation, same skip-if-exists behaviour, same CSV output,
 * same must_change_password handover. Two things differ, both because students
 * are scoped in a way faculty are not:
 *
 *   1. Students carry branch + semester. Those are not decoration: the student
 *      subject list resolves through `subject_offerings` on exactly this pair,
 *      so a student created with the wrong branch or semester logs in
 *      successfully and sees an entirely empty product. There is no in-app way
 *      for them to fix it either — the profile page is read-only for these
 *      fields by design ("contact your administrator"), and CP-01 locked the
 *      profiles self-service column allow-list to zero columns.
 *
 *      So this script REFUSES to create a student whose (branch, semester) has
 *      no offerings, and prints the pairs that do. Catching that here costs a
 *      re-run; catching it on pilot morning costs fifty confused students.
 *
 *   2. The roster is read from a CSV, not hardcoded. Fifty pilot students are
 *      real people whose names and emails do not belong in git — the roster
 *      path is gitignored, as is the credentials file this writes.
 *
 * Usage:
 *
 *   # 1. Dry run. Validates the roster, checks offerings, creates NOTHING.
 *   npx tsx scripts/bulk-create-students.ts
 *
 *   # 2. Once the dry run is clean, actually create the accounts.
 *   npx tsx scripts/bulk-create-students.ts --apply
 *
 *   # Non-default roster path:
 *   npx tsx scripts/bulk-create-students.ts --roster=path/to/file.csv --apply
 *
 * Roster CSV — header required, column order free:
 *
 *   email,full_name,branch,semester
 *   riya.shah@ppsu.ac.in,Riya Shah,CSE,3
 *   arjun.mehta@ppsu.ac.in,Arjun Mehta,CSE,3
 *
 * `branch` must be the SHORT code ('CSE', not 'Computer Science and
 * Engineering') — the 20260717000000_subject_offerings migration normalized
 * every existing row to short codes, and the offering lookup is an exact match.
 *
 * IMPORTANT — profiles are created by a DB trigger, NOT by this script.
 *   handle_new_user() (20260207000000_initial_schema.sql) fires AFTER INSERT ON
 *   auth.users and inserts a bare profiles row with the default role='student'.
 *   The profile therefore already exists by the time createUser returns; the
 *   write below is an UPSERT (fill in branch/semester/must_change_password),
 *   never a fresh INSERT. onConflict: id also covers the theoretical race where
 *   the trigger has not landed yet.
 *
 * What the student experiences: they sign in with the temp password, and
 * proxy.ts's forced-password-change gate (which is role-agnostic — it fires on
 * the profiles flag, not on role) redirects every route to
 * /auth/change-password until they set a real one. That page clears the flag
 * through /api/auth/change-password, which uses the admin client and is
 * therefore unaffected by CP-01's RLS lockdown.
 *
 * SCOPE: touches ONLY auth.users and profiles. Creates no enrollment rows —
 * student subject visibility is derived from (branch, semester) against
 * subject_offerings, there is no per-student enrollment table to populate.
 */

import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// ── Args ──────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const rosterArg = argv.find((a) => a.startsWith("--roster="));
const ROSTER_PATH = resolve(
  process.cwd(),
  rosterArg ? rosterArg.slice("--roster=".length) : "scripts/students-roster.csv"
);

// ── Env (same resolution as bulk-create-faculty.ts) ───────────────────────────
function loadEnvLocal(): Record<string, string> {
  const out: Record<string, string> = {};
  const envPath = resolve(process.cwd(), ".env.local");
  if (!existsSync(envPath)) return out;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

const fileEnv = loadEnvLocal();
const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || fileEnv.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || fileEnv.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (checked env + .env.local)."
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ── Password generation (identical policy to the faculty script) ──────────────
// base64url of 12 bytes -> 16 chars from [A-Za-z0-9_-]. Supabase Auth's default
// policy only requires length >= 6; we go well beyond and additionally guarantee
// at least one lower, upper and digit so the password also satisfies any
// stricter policy that might be enabled later.
function generatePassword(): string {
  for (;;) {
    const p = randomBytes(12).toString("base64url");
    if (/[a-z]/.test(p) && /[A-Z]/.test(p) && /[0-9]/.test(p)) return p;
  }
}

function isAlreadyRegistered(err: { code?: string; message?: string }): boolean {
  if (err.code === "email_exists") return true;
  const m = (err.message || "").toLowerCase();
  return (
    m.includes("already been registered") ||
    m.includes("already registered") ||
    m.includes("already exists")
  );
}

function csvEscape(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

// ── Roster parsing ────────────────────────────────────────────────────────────
// Minimal RFC4180-ish reader: handles quoted fields containing commas and
// escaped quotes, which real names do produce ("Shah, Riya A."). Not a general
// CSV library — it does not handle embedded newlines inside quoted fields, and
// rejects rows it cannot parse rather than guessing.
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((f) => f.trim());
}

type RosterRow = {
  email: string;
  full_name: string;
  branch: string;
  semester: number;
  lineNo: number;
};

type RosterProblem = { lineNo: number; raw: string; why: string };

function readRoster(path: string): {
  rows: RosterRow[];
  problems: RosterProblem[];
} {
  if (!existsSync(path)) {
    console.error(`Roster not found: ${path}`);
    console.error(
      "\nCreate it with this header, one student per line:\n\n" +
        "  email,full_name,branch,semester\n" +
        "  riya.shah@ppsu.ac.in,Riya Shah,CSE,3\n"
    );
    process.exit(1);
  }

  const lines = readFileSync(path, "utf8")
    .split("\n")
    .map((l) => l.replace(/\r$/, ""));

  const headerIdx = lines.findIndex((l) => l.trim() !== "");
  if (headerIdx === -1) {
    console.error(`Roster is empty: ${path}`);
    process.exit(1);
  }

  const header = parseCsvLine(lines[headerIdx]).map((h) => h.toLowerCase());
  const col = {
    email: header.indexOf("email"),
    full_name: header.indexOf("full_name"),
    branch: header.indexOf("branch"),
    semester: header.indexOf("semester"),
  };

  const missing = Object.entries(col)
    .filter(([, idx]) => idx === -1)
    .map(([name]) => name);
  if (missing.length) {
    console.error(
      `Roster header is missing required column(s): ${missing.join(", ")}\n` +
        `Found: ${header.join(", ")}\n` +
        `Expected: email, full_name, branch, semester`
    );
    process.exit(1);
  }

  const rows: RosterRow[] = [];
  const problems: RosterProblem[] = [];
  const seenEmails = new Set<string>();

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const raw = lines[i];
    if (raw.trim() === "") continue;

    const lineNo = i + 1;
    const f = parseCsvLine(raw);
    const email = (f[col.email] ?? "").toLowerCase();
    const full_name = f[col.full_name] ?? "";
    const branch = f[col.branch] ?? "";
    const semesterRaw = f[col.semester] ?? "";

    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      problems.push({ lineNo, raw, why: `invalid email: ${JSON.stringify(email)}` });
      continue;
    }
    if (seenEmails.has(email)) {
      problems.push({ lineNo, raw, why: `duplicate email in roster: ${email}` });
      continue;
    }
    if (!full_name) {
      problems.push({ lineNo, raw, why: "full_name is empty" });
      continue;
    }
    if (!branch) {
      problems.push({ lineNo, raw, why: "branch is empty" });
      continue;
    }
    const semester = Number(semesterRaw);
    if (!Number.isInteger(semester) || semester < 1 || semester > 12) {
      problems.push({
        lineNo,
        raw,
        why: `semester must be a whole number 1-12, got ${JSON.stringify(semesterRaw)}`,
      });
      continue;
    }

    seenEmails.add(email);
    rows.push({ email, full_name, branch, semester, lineNo });
  }

  return { rows, problems };
}

// ── Offering pre-flight ───────────────────────────────────────────────────────
// The check that makes this script worth running twice. A student whose
// (branch, semester) has zero offerings can log in and do literally nothing.
async function loadOfferedPairs(): Promise<Map<string, number>> {
  const { data, error } = await supabase
    .from("subject_offerings")
    .select("branch, semester");

  if (error) {
    console.error(
      `Could not read subject_offerings: ${error.message}\n` +
        "Refusing to create students without confirming they'll see subjects."
    );
    process.exit(1);
  }

  const counts = new Map<string, number>();
  for (const row of (data ?? []) as Array<{ branch: string; semester: number }>) {
    const key = `${row.branch}|${row.semester}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

type Status = "created" | "skipped" | "failed";
type Result = {
  email: string;
  full_name: string;
  branch: string;
  semester: number;
  tempPassword: string;
  status: Status;
  note?: string;
};

async function main() {
  console.log(`Roster:  ${ROSTER_PATH}`);
  console.log(`Mode:    ${APPLY ? "APPLY (accounts will be created)" : "DRY RUN (nothing will be created)"}\n`);

  const { rows, problems } = readRoster(ROSTER_PATH);

  if (problems.length) {
    console.error(`Roster has ${problems.length} unusable row(s):\n`);
    for (const p of problems) {
      console.error(`  line ${p.lineNo}: ${p.why}`);
      console.error(`    ${p.raw}`);
    }
    console.error(
      "\nFix these and re-run. Nothing was created — a partially-correct roster is " +
        "not worth half a cohort of broken accounts.\n"
    );
    process.exit(1);
  }

  if (rows.length === 0) {
    console.error("Roster parsed cleanly but contains zero students.");
    process.exit(1);
  }

  // ── Pre-flight: will these students actually see anything? ──────────────────
  const offered = await loadOfferedPairs();

  if (offered.size === 0) {
    console.error(
      "subject_offerings is EMPTY — no branch/semester has any subject offered.\n" +
        "Every student created now would log in to a blank product. Seed subjects first.\n"
    );
    process.exit(1);
  }

  const unoffered = rows.filter(
    (r) => !offered.has(`${r.branch}|${r.semester}`)
  );

  console.log("Subject offerings currently in the database:");
  for (const [key, count] of [...offered.entries()].sort()) {
    const [branch, semester] = key.split("|");
    console.log(`  ${branch} semester ${semester}  —  ${count} subject(s)`);
  }
  console.log();

  if (unoffered.length) {
    console.error(
      `${unoffered.length} of ${rows.length} roster students are in a (branch, semester) ` +
        "with NO subjects offered:\n"
    );
    for (const r of unoffered) {
      console.error(`  line ${r.lineNo}: ${r.email} — ${r.branch} semester ${r.semester}`);
    }
    console.error(
      "\nThese students would log in successfully and see an empty subject list, with no\n" +
        "way to fix it themselves (branch/semester are admin-only fields). Either correct\n" +
        "the roster or add the offerings, then re-run. Nothing was created.\n"
    );
    process.exit(1);
  }

  const byCohort = new Map<string, number>();
  for (const r of rows) {
    const key = `${r.branch} semester ${r.semester}`;
    byCohort.set(key, (byCohort.get(key) ?? 0) + 1);
  }
  console.log(`${rows.length} students ready to create:`);
  for (const [cohort, n] of [...byCohort.entries()].sort()) {
    console.log(`  ${cohort}: ${n}`);
  }
  console.log();

  if (!APPLY) {
    console.log("──────────────────────────────────────────");
    console.log("DRY RUN — no accounts created, no CSV written.");
    console.log("Re-run with --apply to create these accounts.");
    console.log("──────────────────────────────────────────\n");
    return;
  }

  // ── Create ─────────────────────────────────────────────────────────────────
  const results: Result[] = [];

  for (const row of rows) {
    const { email, full_name, branch, semester } = row;
    const tempPassword = generatePassword();

    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password: tempPassword,
      email_confirm: true,
      user_metadata: { full_name },
    });

    if (error) {
      if (isAlreadyRegistered(error)) {
        console.log(`  SKIP    ${email} (already registered)`);
        results.push({
          email,
          full_name,
          branch,
          semester,
          tempPassword: "",
          status: "skipped",
          note: "already registered",
        });
        continue;
      }
      console.error(`  FAIL    ${email}: ${error.message}`);
      results.push({
        email,
        full_name,
        branch,
        semester,
        tempPassword: "",
        status: "failed",
        note: error.message,
      });
      continue;
    }

    const userId = data.user?.id;
    if (!userId) {
      console.error(`  FAIL    ${email}: createUser returned no user id`);
      results.push({
        email,
        full_name,
        branch,
        semester,
        tempPassword: "",
        status: "failed",
        note: "no user id returned",
      });
      continue;
    }

    // handle_new_user() already inserted a bare profiles row with role='student'.
    // Upsert to fill in branch/semester and force the password change.
    const { error: profileError } = await supabase
      .from("profiles")
      .upsert(
        {
          id: userId,
          email,
          full_name,
          role: "student",
          branch,
          semester,
          must_change_password: true,
        },
        { onConflict: "id" }
      );

    if (profileError) {
      console.error(
        `  FAIL    ${email}: auth user created but profile upsert failed: ${profileError.message}`
      );
      results.push({
        email,
        full_name,
        branch,
        semester,
        tempPassword,
        status: "failed",
        note: `profile upsert failed: ${profileError.message}`,
      });
      continue;
    }

    console.log(`  CREATED ${email}  (${branch} sem ${semester})`);
    results.push({
      email,
      full_name,
      branch,
      semester,
      tempPassword,
      status: "created",
    });
  }

  // ── CSV ────────────────────────────────────────────────────────────────────
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const csvName = `student-credentials-${stamp}.csv`;
  const csvPath = resolve(process.cwd(), csvName);
  const header = "email,full_name,branch,semester,temp_password,status";
  const lines = results.map((r) =>
    [
      r.email,
      r.full_name,
      r.branch,
      String(r.semester),
      r.tempPassword,
      r.status,
    ]
      .map(csvEscape)
      .join(",")
  );
  writeFileSync(csvPath, [header, ...lines].join("\n") + "\n", "utf8");

  // ── Summary ────────────────────────────────────────────────────────────────
  const created = results.filter((r) => r.status === "created");
  const skipped = results.filter((r) => r.status === "skipped");
  const failed = results.filter((r) => r.status === "failed");

  console.log("\n──────────────────────────────────────────");
  console.log("SUMMARY");
  console.log(`  Created (new):           ${created.length}`);
  console.log(`  Skipped (already exist): ${skipped.length}`);
  console.log(`  Failed (real errors):    ${failed.length}`);
  if (failed.length) {
    console.log("\n  FAILURES (investigate — NOT swallowed):");
    for (const f of failed) console.log(`    - ${f.email}: ${f.note}`);
  }
  console.log("──────────────────────────────────────────");
  console.log(`\nCredentials written to: ${csvName}`);
  console.log(
    "  ⚠  This file contains LIVE passwords. It is gitignored — do NOT commit it."
  );
  console.log("  ⚠  Delete it once credentials have been distributed.");
  console.log(
    "  ⚠  Every student is flagged must_change_password — they are redirected to\n" +
      "     /auth/change-password on first sign-in and cannot reach the app until\n" +
      "     they set their own password.\n"
  );
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
