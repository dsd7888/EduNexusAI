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
// Batch 2 (2026-07-17): remaining 126 faculty from the full PPSU roster PDF
// ("Faculty Details for Registration at Edu Nexus.pdf"), excluding:
//   - the 26 already created in batch 1 (see faculty-credentials-2026-07-09
//     *.csv / git history of this file for that roster)
//   - Misha Patel (misha.patel@ppsu.ac.in) and Ravishankar Kumar Yadav
//     (ravishankar.yadav@ppsu.ac.in) — treated as the same people as
//     existing accounts misharpatel2000@gmail.com / ravishanker706@gmail.com
//   - Kamini S. Sharma — no email listed in the source PDF
// createUser SKIPs any email that already has an account, so this list is
// safe to re-run for stragglers without recreating batch 1.
type RosterRow = { email: string; full_name: string };

const ROSTER: RosterRow[] = [
  { full_name: "Dr. Niraj Shah", email: "niraj.shah@ppsu.ac.in" },
  { full_name: "Paresh Mistry", email: "paresh.mistry@ppsu.ac.in" },
  { full_name: "Nafisa Shaikh", email: "shaikh.nafisa@ppsu.ac.in" },
  { full_name: "Subhrata Biswal", email: "subhrata.biswal@ppsu.ac.in" },
  { full_name: "Keval Jariwala", email: "keval.jariwala@ppsu.ac.in" },
  { full_name: "Isha Patel", email: "isha.patel@ppsu.ac.in" },
  { full_name: "Siddharth Shah", email: "siddharth.shah@ppsu.ac.in" },
  { full_name: "Dr. Penaganti Praveen", email: "penaganti.praveen@ppsu.ac.in" },
  { full_name: "Shobhit Mohta", email: "shobhit.mohta@ppsu.ac.in" },
  { full_name: "Dr. Surendra Pratap Singh", email: "surendra.singh@ppsu.ac.in" },
  { full_name: "Amir Patel", email: "amir.patel@ppsu.ac.in" },
  { full_name: "Dr. Hardik Majiwala", email: "hardik.majiwala@ppsu.ac.in" },
  { full_name: "Dr. Rahul Sinha", email: "rahul.sinha@ppsu.ac.in" },
  { full_name: "Dr. Rakesh Kumar", email: "rakesh.kumar@ppsu.ac.in" },
  { full_name: "Dr. Chiragkumar Desai", email: "chirag.desai@ppsu.ac.in" },
  { full_name: "Abhinav Kashyap", email: "abhinav.kashyap@ppsu.ac.in" },
  { full_name: "Dr. Ranjitkumar Dehury", email: "ranjit.dehury@ppsu.ac.in" },
  { full_name: "Dr. Rahulkumar", email: "rahul.kumar@ppsu.ac.in" },
  { full_name: "Dr. Vinit Gupta", email: "vinit.gupta@ppsu.ac.in" },
  { full_name: "Palakkumar Patel", email: "palak.patel@ppsu.ac.in" },
  { full_name: "Dr. Satish Kumar Ajmera", email: "satish.ajmera@ppsu.ac.in" },
  { full_name: "Dr. Deepak Singh Panwar", email: "deepaksingh.panwar@ppsu.ac.in" },
  { full_name: "Dr. Bhupendra Singh Ken", email: "bhupendrasingh.ken@ppsu.ac.in" },
  { full_name: "Rahul Kumar", email: "kumar.rahul@ppsu.ac.in" },
  { full_name: "Aarti Sonawane", email: "aarti.sonawane@ppsu.ac.in" },
  { full_name: "Dr. Shiv Shankar", email: "shiv.shankar@ppsu.ac.in" },
  { full_name: "Dr. Pappu Kumar Burnwal", email: "pappu.burnwal@ppsu.ac.in" },
  { full_name: "Dr. Anurag Kumar Shastri", email: "anurag.shastri@ppsu.ac.in" },
  { full_name: "Mitul Raj", email: "mitul.raj@ppsu.ac.in" },
  { full_name: "Neha Shah", email: "neha.shah@ppsu.ac.in" },
  { full_name: "Megha Patel", email: "megha.patel@ppsu.ac.in" },
  { full_name: "Maulika Patel", email: "maulika.patel@ppsu.ac.in" },
  { full_name: "Bhavishaben Shah", email: "bhavisha.shah@ppsu.ac.in" },
  { full_name: "Srikant Singh", email: "srikant.singh@ppsu.ac.in" },
  { full_name: "Priyankaben Vashi", email: "priyanka.vashi@ppsu.ac.in" },
  { full_name: "Twisha Patel", email: "twisha.patel@ppsu.ac.in" },
  { full_name: "Aakash Gupta", email: "aakash.gupta@ppsu.ac.in" },
  { full_name: "Dharmesh Purani", email: "dharmesh.purani@ppsu.ac.in" },
  { full_name: "Kaushal Singh", email: "kaushal.singh@ppsu.ac.in" },
  { full_name: "Sneha Saini", email: "sneha.saini@ppsu.ac.in" },
  { full_name: "Khushbu Chauhan", email: "khushbu.chauhan@ppsu.ac.in" },
  { full_name: "Vijay Patil", email: "vijay.patil@ppsu.ac.in" },
  { full_name: "Vinaykumar Pathak", email: "vinaykumar.pathak@ppsu.ac.in" },
  { full_name: "Subhashini K.", email: "subhashini.k@ppsu.ac.in" },
  { full_name: "Dr. Shruti Suman", email: "shruti.suman@ppsu.ac.in" },
  { full_name: "Shilpa Gautam", email: "shilpa.gautam@ppsu.ac.in" },
  { full_name: "Ekta Patel", email: "ekta.patel@ppsu.ac.in" },
  { full_name: "Hemangni Mehta", email: "hemangni.mehta@ppsu.ac.in" },
  { full_name: "Suman Pandit", email: "suman.pandit@ppsu.ac.in" },
  { full_name: "Subhankar Naskar", email: "subhankar.naskar@ppsu.ac.in" },
  { full_name: "Ashwin Parihar", email: "ashwin.parihar@ppsu.ac.in" },
  { full_name: "Ajay Chouhan", email: "ajay.chouhan@ppsu.ac.in" },
  { full_name: "Anjali Nizama", email: "anjali.nizama@ppsu.ac.in" },
  { full_name: "Rajkumar Sharma", email: "raj.sharma@ppsu.ac.in" },
  { full_name: "Anurag Anand", email: "anurag.anand@ppsu.ac.in" },
  { full_name: "Anurag Yadav", email: "anurag.yadav@ppsu.ac.in" },
  { full_name: "Dr. Indrajeet Kumar", email: "indrajeet.kumar@ppsu.ac.in" },
  { full_name: "Aarti Sharma", email: "aarti.sharma@ppsu.ac.in" },
  { full_name: "Ajit Singh", email: "ajit.singh@ppsu.ac.in" },
  { full_name: "Ushoshee Mukherjee", email: "ushoshee.mukherjee@ppsu.ac.in" },
  { full_name: "Kamini Sharma", email: "kamini.sharma@ppsu.ac.in" },
  { full_name: "Ayush Dodia", email: "ayush.dodia@ppsu.ac.in" },
  { full_name: "Adarsh Kushwaha", email: "adarsh.kushwaha@ppsu.ac.in" },
  { full_name: "Saurav Singh", email: "saurav.singh@ppsu.ac.in" },
  { full_name: "Khushali Domadiya", email: "khushali.domadiya@ppsu.ac.in" },
  { full_name: "Mohammad Iqbal", email: "iqbal.mohammad@ppsu.ac.in" },
  { full_name: "Husen Kagdi", email: "husen.kagdi@ppsu.ac.in" },
  { full_name: "Danish Chopan", email: "danish.chopan@ppsu.ac.in" },
  { full_name: "Akhilesh Yadav", email: "akhilesh.yadav@ppsu.ac.in" },
  { full_name: "Dr. Pratima Upadhyay", email: "pratima.upadhyay@ppsu.ac.in" },
  { full_name: "Harshita Rai", email: "harshita.rai@ppsu.ac.in" },
  { full_name: "Rakesh Tanwar", email: "rakesh.tanwar@ppsu.ac.in" },
  { full_name: "Anish Kumar", email: "anish.kumar@ppsu.ac.in" },
  { full_name: "Abhishek Kumar S", email: "kumar.abhishek@ppsu.ac.in" },
  { full_name: "Tarun Soni", email: "tarun.soni@ppsu.ac.in" },
  { full_name: "Shrijal Patel", email: "shrijal.patel@ppsu.ac.in" },
  { full_name: "Kirti Bhatt", email: "kirti.bhatt@ppsu.ac.in" },
  { full_name: "Ashutosh Sharma", email: "ashutosh.sharma@ppsu.ac.in" },
  { full_name: "Seema Chhunga", email: "seema.chhunga@ppsu.ac.in" },
  { full_name: "Anand Yadav", email: "anand.yadav@ppsu.ac.in" },
  { full_name: "Chiragkumar Aboti", email: "chirag.kumar@ppsu.ac.in" },
  { full_name: "Dr. Anand Kumar Gupta", email: "anand.kumar@ppsu.ac.in" },
  { full_name: "Vikas Chandra Sharma", email: "vikas.sharma@ppsu.ac.in" },
  { full_name: "Rahul Kumar Yadav", email: "rahul.kumaar@ppsu.ac.in" },
  { full_name: "Kavita Pujari", email: "kavita.pujari@ppsu.ac.in" },
  { full_name: "Ritika Sharma", email: "ritika.sharma@ppsu.ac.in" },
  { full_name: "Deepa Javiya", email: "deepa.javiya@ppsu.ac.in" },
  { full_name: "Imran Ansari", email: "imran.ansari@ppsu.ac.in" },
  { full_name: "Dibyadarshini Maharatha", email: "dibyadarshini.maharatha@ppsu.ac.in" },
  { full_name: "Riya Kumbhare", email: "riya.kumbhare@ppsu.ac.in" },
  { full_name: "Rutvik Bhondekar", email: "rutvik.bhondekar@ppsu.ac.in" },
  { full_name: "Nikunjkumar Tailor", email: "nikunj.tailor@ppsu.ac.in" },
  { full_name: "Santosh Kumar Kavuri", email: "santosh.kavuri@ppsu.ac.in" },
  { full_name: "Dipak Pandey", email: "dipak.pandey@ppsu.ac.in" },
  { full_name: "Girish Badgujar", email: "girish.badgujar@ppsu.ac.in" },
  { full_name: "Dr. Ankur Rai", email: "ankur.rai@ppsu.ac.in" },
  { full_name: "Aagnik Chakraborty", email: "aagnik.chakraborty@ppsu.ac.in" },
  { full_name: "Priyanshu Rathore", email: "priyanshu.rathor@ppsu.ac.in" },
  { full_name: "Ravi Dhandhukiya", email: "ravi.dhandhukiya@ppsu.ac.in" },
  { full_name: "Dr. Hirenkumar Lekhadiya", email: "hiren.lekhadiya@ppsu.ac.in" },
  { full_name: "Tushar Mandanaka", email: "tushar.mandanaka@ppsu.ac.in" },
  { full_name: "Dhruvika Jadav", email: "dhruvika.jadav@ppsu.ac.in" },
  { full_name: "Prakruti Dave", email: "prakruti.dave@ppsu.ac.in" },
  { full_name: "Mansi Nadiyadra", email: "mansi.nadiyadra@ppsu.ac.in" },
  { full_name: "Geetanjali Rathod", email: "geetanjali.rathod@ppsu.ac.in" },
  { full_name: "Dr. Pratiksha More", email: "pratiksha.more@ppsu.ac.in" },
  { full_name: "Dr. Bivas Bank", email: "bivas.bank@ppsu.ac.in" },
  { full_name: "Dr. Nihal Khaitan", email: "nihal.khaitan@ppsu.ac.in" },
  { full_name: "Drashti Varachhiya", email: "drashti.varachhiya@ppsu.ac.in" },
  { full_name: "Divya Bachda", email: "divya.bachda@ppsu.ac.in" },
  { full_name: "Dr. Kavita Bhesaniya", email: "kavita.bhesaniya@ppsu.ac.in" },
  { full_name: "Mahamadsohil Arora", email: "sohil.mahamad@ppsu.ac.in" },
  { full_name: "Dr. Suman Maiti", email: "suman.maiti@ppsu.ac.in" },
  { full_name: "Dr. Sunil Kundu", email: "sunil.kundu@ppsu.ac.in" },
  { full_name: "Dr. Krishna Murari Malav", email: "krishna.malav@ppsu.ac.in" },
  { full_name: "Ajay Pathak", email: "ajay.pathak@ppsu.ac.in" },
  { full_name: "Deepa Roshtom", email: "deepa.roshtom@ppsu.ac.in" },
  { full_name: "Dr. Nikit Deshmukh", email: "nikit.deshmukh@ppsu.ac.in" },
  { full_name: "Dr. Vaishali Patel", email: "vaishali.patel@ppsu.ac.in" },
  { full_name: "Dr. Ajay Bassi", email: "ajay.bassi@ppsu.ac.in" },
  { full_name: "Dr. Yash Doshi", email: "yash.doshi@ppsu.ac.in" },
  { full_name: "Pinky Yadav", email: "pinky.yadav@ppsu.ac.in" },
  { full_name: "Dr. Pankaj Kumar Maheshwari", email: "pankaj.maheshwari@ppsu.ac.in" },
  { full_name: "Dr. Ritesh Upadhyay", email: "ritesh.upadhyay@ppsu.ac.in" },
  { full_name: "Dr. Harish Chandra Mohanta", email: "harish.mohanta@ppsu.ac.in" },
  { full_name: "Ram Babu Mourya", email: "rambabu.maurya@ppsu.ac.in" },
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
