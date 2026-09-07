/**
 * Adds placement_company_profiles rows for companies present in the ingested
 * prep-material corpus (scripts/ingest-placement-bank.ts) but missing from the
 * existing 8-company seed: IBM, Deloitte, Genpact.
 *
 * Idempotent — upsert on slug, safe to re-run.
 *
 * Usage: npx tsx scripts/seed-missing-placement-companies.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadEnvLocal(): void {
  let raw: string;
  try {
    raw = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
  } catch {
    return;
  }
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}
loadEnvLocal();

const ROWS = [
  {
    slug: "ibm",
    name: "IBM",
    company_type: "service_it",
    is_mass_recruiter: true,
    min_cgpa: 6.0,
    backlogs_allowed: false,
    allowed_branches: null,
    oa_pattern: {
      sections: [
        { name: "Verbal Ability", weight_percent: 20, question_count: 20, time_minutes: 20 },
        { name: "Quantitative Aptitude", weight_percent: 25, question_count: 20, time_minutes: 25 },
        { name: "Logical Reasoning", weight_percent: 20, question_count: 20, time_minutes: 20 },
        { name: "Technical MCQs (CS Fundamentals)", weight_percent: 15, question_count: 15, time_minutes: 15 },
        { name: "Coding", weight_percent: 20, question_count: 2, time_minutes: 40 },
      ],
    },
    rounds: [
      { round: 1, name: "Online Assessment", type: "aptitude" },
      { round: 2, name: "Technical Interview", type: "technical" },
      { round: 3, name: "HR Interview", type: "hr" },
    ],
    avg_prep_weeks: 3,
    difficulty_band: "medium",
    display_order: 9,
  },
  {
    slug: "deloitte",
    name: "Deloitte",
    company_type: "bfsi", // matches this codebase's own PlacementTarget comment: "bfsi // HDFC, ICICI, Deloitte"
    is_mass_recruiter: true,
    min_cgpa: 6.5,
    backlogs_allowed: false,
    allowed_branches: null,
    oa_pattern: {
      sections: [
        { name: "Quantitative Aptitude", weight_percent: 25, question_count: 20, time_minutes: 25 },
        { name: "Logical Reasoning", weight_percent: 25, question_count: 20, time_minutes: 25 },
        { name: "Verbal Ability", weight_percent: 25, question_count: 20, time_minutes: 20 },
        { name: "Business Email Writing", weight_percent: 25, question_count: 1, time_minutes: 15 },
      ],
    },
    rounds: [
      { round: 1, name: "Online Assessment", type: "aptitude" },
      { round: 2, name: "Group Discussion", type: "communication" },
      { round: 3, name: "Technical Interview", type: "technical" },
      { round: 4, name: "HR Interview", type: "hr" },
    ],
    avg_prep_weeks: 3,
    difficulty_band: "medium",
    display_order: 10,
  },
  {
    slug: "genpact",
    name: "Genpact",
    company_type: "service_it",
    is_mass_recruiter: true,
    min_cgpa: 6.0,
    backlogs_allowed: false,
    allowed_branches: null,
    oa_pattern: {
      sections: [
        { name: "Verbal & Communication", weight_percent: 30, question_count: 24, time_minutes: 25 },
        { name: "Quantitative Aptitude", weight_percent: 25, question_count: 20, time_minutes: 20 },
        { name: "Logical Reasoning", weight_percent: 25, question_count: 20, time_minutes: 20 },
        { name: "Basic Computer & Analytical Awareness", weight_percent: 20, question_count: 15, time_minutes: 15 },
      ],
    },
    rounds: [
      { round: 1, name: "Online Assessment", type: "aptitude" },
      { round: 2, name: "Communication Assessment", type: "communication" },
      { round: 3, name: "HR Interview", type: "hr" },
    ],
    avg_prep_weeks: 2,
    difficulty_band: "easy",
    display_order: 11,
  },
] as const;

async function main(): Promise<void> {
  const { createAdminClient } = await import("@/lib/db/supabase-server");
  const admin = createAdminClient();

  for (const row of ROWS) {
    const { error } = await admin
      .from("placement_company_profiles")
      .upsert(
        {
          ...row,
          logo_url: null,
          syllabus_relevance: null,
          campus_notes: null,
          is_active: true,
        },
        { onConflict: "slug" }
      );
    if (error) {
      console.log(`✗ ${row.slug}: ${error.message}`);
    } else {
      console.log(`✓ ${row.slug} (${row.name})`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
