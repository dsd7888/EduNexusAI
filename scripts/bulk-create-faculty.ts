/**
 * One-off admin script: bulk-create faculty login accounts.
 *
 * Run ONCE (not a persisted API route — must not be accidentally re-runnable
 * against the roster from the app):
 *
 *   npx tsx scripts/bulk-create-faculty.ts
 *
 * What it does per roster row:
 *   1. Generates a cryptographically-random, unique temp password.
 *   2. Calls supabase.auth.admin.createUser (service role, email_confirm: true).
 *   3. If the email already has an account -> SKIP (does not error the batch),
 *      so it is safe to re-run for stragglers without recreating everyone.
 *   4. On success, upserts the profiles row to role='faculty' +
 *      must_change_password=true.
 *   5. Writes faculty-credentials-<timestamp>.csv (gitignored) with the temp
 *      passwords for distribution.
 *
 * IMPORTANT — profiles are created by a DB trigger, NOT by this script.
 *   handle_new_user() (20260207000000_initial_schema.sql) fires AFTER INSERT ON
 *   auth.users and inserts a bare profiles row (id, email, full_name) with the
 *   default role='student'. So the profile already exists by the time createUser
 *   returns; step 4 is therefore an UPSERT (update role + must_change_password),
 *   never a fresh INSERT. Upsert (onConflict: id) also covers the theoretical
 *   race where the trigger hasn't landed yet.
 *
 * SCOPE: touches ONLY auth.users and profiles. It sets NO subject /
 * faculty_assignments data — subject assignment is entirely faculty self-serve.
 */

import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// ── Roster ────────────────────────────────────────────────────────────────
// 25 real faculty (from the PPSU Google Form) + Dhruv's test row + Raviraj.
// Hardcoded on purpose (spec) rather than re-parsing the xlsx — the subject /
// syllabus-upload columns are irrelevant here.
type RosterRow = { email: string; full_name: string };

const ROSTER: RosterRow[] = [
  { full_name: "Urvashi Solanki", email: "urvashi.solanki@ppsu.ac.in" },
  { full_name: "Khushi Vaishnav", email: "khushi.vaishnav@ppsu.ac.in" },
  { full_name: "Sweta Dave", email: "sweta.dave@ppsu.ac.in" },
  { full_name: "Astha B. Barot", email: "astha.barot@ppsu.ac.in" },
  { full_name: "Anuja Gunale", email: "anuja.gunale@ppsu.ac.in" },
  { full_name: "Unnati Shukla", email: "unnati.shukla@ppsu.ac.in" },
  { full_name: "Het Pandya", email: "het.pandya@ppsu.ac.in" },
  { full_name: "Subhi Kumari", email: "subhi.kumari@ppsu.ac.in" },
  { full_name: "Dr. Sweta Singh", email: "sweta.singh@ppsu.ac.in" },
  { full_name: "Dr. Jayshri Patil", email: "jayshri.patil@ppsu.ac.in" },
  { full_name: "Dr. Amit Sharma", email: "sharma.amit@ppsu.ac.in" },
  { full_name: "Dr. M. Thomas Victor", email: "thomas.victor@ppsu.ac.in" },
  { full_name: "Misha Patel", email: "misharpatel2000@gmail.com" },
  { full_name: "Satish Kumar", email: "satish.kumar@ppsu.ac.in" },
  { full_name: "Balraj Krishnan Tudu", email: "balraj.tudu@ppsu.ac.in" },
  { full_name: "Meenakshi Kashyap", email: "meenakshi.kashyap@ppsu.ac.in" },
  { full_name: "Sadik Lakhani", email: "sadik.lakhani@ppsu.ac.in" },
  { full_name: "Dr. Dinesh Singh", email: "dinesh.singh@ppsu.ac.in" },
  { full_name: "Shruti Mishra", email: "shruti.mishra@ppsu.ac.in" },
  { full_name: "Zarana Gajjar", email: "zarana.gajjar@ppsu.ac.in" },
  { full_name: "Rishi Kumar Sharma", email: "rishi.sharma@ppsu.ac.in" },
  { full_name: "Tasneem Kagzi", email: "tasneem.kagzi@ppsu.ac.in" },
  { full_name: "Ankur Narendrabhai Shah", email: "ankur.shah@ppsu.ac.in" },
  { full_name: "Reema Sorathiya", email: "reema.sorathiya@ppsu.ac.in" },
  { full_name: "Ravishankar Kumar Raman", email: "ravishanker706@gmail.com" },
  // Raviraj Chauhan (faculty mentor) — added per instruction.
  { full_name: "Raviraj Chauhan", email: "raviraj.chauhan@ppsu.ac.in" },
  // Dhruv's own test row.
  { full_name: "Dhruv", email: "dsd7888@gmail.com" },
];

// ── Env loading (standalone script; Next.js does not load .env.local here) ──
function loadEnvLocal(): Record<string, string> {
  const path = resolve(process.cwd(), ".env.local");
  const out: Record<string, string> = {};
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return out;
  }
  for (const line of raw.split("\n")) {
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

// ── Password generation ─────────────────────────────────────────────────────
// Unique per person, cryptographically random. base64url of 12 bytes -> 16
// chars from [A-Za-z0-9_-]. Supabase Auth's default policy only requires
// length >= 6; we go well beyond and additionally guarantee at least one lower,
// upper and digit so the password also satisfies any stricter policy that might
// be enabled later — never discover a policy mismatch mid-batch.
function generatePassword(): string {
  for (;;) {
    const p = randomBytes(12).toString("base64url");
    if (/[a-z]/.test(p) && /[A-Z]/.test(p) && /[0-9]/.test(p)) return p;
  }
}

// A createUser error meaning "this email already has an account" — SKIP, don't
// fail the batch. Match on Supabase's code first, message as a fallback.
function isAlreadyRegistered(err: { code?: string; message?: string }): boolean {
  if (err.code === "email_exists") return true;
  const m = (err.message || "").toLowerCase();
  return (
    m.includes("already been registered") ||
    m.includes("already registered") ||
    m.includes("already exists")
  );
}

type Status = "created" | "skipped" | "failed";
type Result = {
  email: string;
  full_name: string;
  tempPassword: string;
  status: Status;
  note?: string;
};

function csvEscape(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

async function main() {
  console.log(`Bulk-creating ${ROSTER.length} faculty accounts...\n`);

  const results: Result[] = [];

  for (const row of ROSTER) {
    const email = row.email.trim().toLowerCase();
    const full_name = row.full_name.trim();
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
          tempPassword: "",
          status: "skipped",
          note: "already registered",
        });
        continue;
      }
      // Real, unexpected auth failure — surface loudly, keep going.
      console.error(`  FAIL    ${email}: ${error.message}`);
      results.push({
        email,
        full_name,
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
        tempPassword: "",
        status: "failed",
        note: "no user id returned",
      });
      continue;
    }

    // The handle_new_user() trigger already inserted a bare profiles row with
    // role='student'. Upsert to promote to faculty + force password change.
    // onConflict: id => works whether the trigger row exists yet or not.
    const { error: profileError } = await supabase
      .from("profiles")
      .upsert(
        {
          id: userId,
          email,
          full_name,
          role: "faculty",
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
        tempPassword,
        status: "failed",
        note: `profile upsert failed: ${profileError.message}`,
      });
      continue;
    }

    console.log(`  CREATED ${email}`);
    results.push({ email, full_name, tempPassword, status: "created" });
  }

  // ── CSV ───────────────────────────────────────────────────────────────────
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const csvName = `faculty-credentials-${stamp}.csv`;
  const csvPath = resolve(process.cwd(), csvName);
  const header = "email,full_name,temp_password,status";
  const lines = results.map((r) =>
    [r.email, r.full_name, r.tempPassword, r.status].map(csvEscape).join(",")
  );
  writeFileSync(csvPath, [header, ...lines].join("\n") + "\n", "utf8");

  // ── Summary ─────────────────────────────────────────────────────────────
  const created = results.filter((r) => r.status === "created");
  const skipped = results.filter((r) => r.status === "skipped");
  const failed = results.filter((r) => r.status === "failed");

  console.log("\n──────────────────────────────────────────");
  console.log("SUMMARY");
  console.log(`  Created (new):          ${created.length}`);
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
  console.log("  ⚠  Delete it once credentials have been distributed.\n");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
