/**
 * One-off admin script: FULL PLATFORM DATA RESET (pre-pilot clean slate).
 *
 * Wipes all dev/test CONTENT, LOGS and ANALYTICS so real faculty start on a
 * genuinely empty platform and self-serve everything from scratch. User accounts
 * are explicitly PRESERVED — this NEVER touches auth.users or profiles.
 *
 * Run ONCE (destructive, not idempotent-by-intent, not an app route):
 *
 *   CONFIRM_RESET=1 npx tsx scripts/reset-platform-data.ts
 *     (or:  npx tsx scripts/reset-platform-data.ts --confirm)
 *
 * Without the confirmation flag the script prints the plan and exits WITHOUT
 * deleting anything — a deliberate fat-finger guard on an irreversible action.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT IT DOES (all verified against supabase/migrations FK definitions):
 *
 * PART A — DB deletes
 *   1. DELETE FROM subjects — cascades (ON DELETE CASCADE, confirmed per-FK) to:
 *        modules, exam_structures, course_outcomes, co_po_mapping, co_pso_mapping,
 *        exam_scheme, subject_content, faculty_assignments, documents,
 *        document_chunks, note_change_requests, chat_sessions, chat_messages,
 *        quizzes, quiz_attempts, generated_content, usage_analytics, pyq_questions,
 *        faculty_question_bank, semantic_cache (via modules), module_co_mapping
 *        (via modules), and subject-scoped qpaper_templates (subject_id NOT NULL,
 *        incl. is_snapshot rows). We do NOT delete those individually — the cascade
 *        does it; step 3 verifies each is empty afterward.
 *   2. Explicit deletes for tables that DON'T cascade from subjects:
 *        - explainers            (subject_id SET NULL, not CASCADE)
 *        - ai_call_logs          (subject_id SET NULL)
 *        - usage_analytics       (actually CASCADEs too — kept for spec parity; no-op)
 *        - user_sessions         (standalone, user_id SET NULL)
 *        - subject_change_log    (subject_id SET NULL)
 *        - system_incidents      (standalone)
 *        - storage_usage_snapshots (standalone)
 *        - pilot_analysis_settings (standalone key/value — clears test recharge budget)
 *        - qpaper_drafts         (subject_id SET NULL — would survive orphaned; wiped
 *                                 per reset decision so no phantom "resume draft?")
 *        - qpaper_history        (subject_id SET NULL — would survive orphaned with
 *                                 broken storage links; wiped per reset decision)
 *   3. Verify every targeted table has COUNT(*) = 0 (the "after" picture).
 *   4. qpaper_templates is fully wiped too (presets included). The DB currently has
 *      only 2 of the 3 canonical presets (CUSTOM missing) and the route's seed-on-empty
 *      only fires at count=0, so it would never self-heal. Wiping all preset rows lets
 *      GET /api/qpaper/templates reseed the full canonical set of 3
 *      (PPSU_ESE, CE_QUIZ, CUSTOM) on the next templates-page load. Verify it reads 0.
 *   5. Verify profiles count + every auth.users email EXACTLY match the "before"
 *      snapshot. This is the one check that must never fail; if it doesn't match,
 *      STOP immediately and report before doing anything else.
 *
 * PART B — Storage bucket cleanup (deleting a DB row does NOT delete the file bytes)
 *   Cleans FOUR content buckets (all confirmed referenced in src/, incl. the two
 *   const-referenced ones a shallow grep misses):
 *        documents, generated-content, explainers, question-images
 *   For each: recursively list (paginated, folder-aware), batch-remove, re-list to
 *   confirm empty. Prints objects-removed per bucket.
 *
 * EXPLICITLY DOES NOT TOUCH:
 *   - auth.users / profiles — every account stays exactly as-is.
 *   - Any migration / schema — data-only reset.
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
// Same source of truth the templates route seeds from — reseeding here is the
// identical insert GET /api/qpaper/templates performs when zero presets exist.
import { PRESET_TEMPLATES, PRESET_ORDER, type PresetKey } from "@/lib/qpaper/templates";

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

// Service role — bypasses RLS (required for full deletes). Never persist session.
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const CONFIRMED =
  process.env.CONFIRM_RESET === "1" || process.argv.includes("--confirm");

// ── Table sets ──────────────────────────────────────────────────────────────
// Every table below MUST be empty after the reset. Grouped for a readable log.
// (pk column is used only to satisfy PostgREST's "DELETE needs a filter" rule.)

// Tables wiped by the `DELETE FROM subjects` cascade — we never delete these
// directly, only verify they emptied. (The 11 named in the spec + the additional
// cascade-reachable tables, all confirmed ON DELETE CASCADE in the migrations.)
const CASCADE_VERIFY_TABLES = [
  // Spec's 11:
  "subjects",
  "modules",
  "course_outcomes",
  "exam_scheme",
  "co_po_mapping",
  "co_pso_mapping",
  "subject_content",
  "module_co_mapping",
  "faculty_assignments",
  "generated_content",
  "faculty_question_bank",
  // Additional cascade-reachable (verified — proves the cascade fully fired):
  "exam_structures",
  "documents",
  "document_chunks",
  "note_change_requests",
  "chat_sessions",
  "chat_messages",
  "quizzes",
  "quiz_attempts",
  "pyq_questions",
  "semantic_cache",
] as const;

// Tables deleted EXPLICITLY (don't cascade from subjects, or belong-and-add).
// pk column defaults to "id"; overridden where the PK differs.
const EXPLICIT_DELETE_TABLES: { table: string; pk?: string }[] = [
  { table: "explainers" },
  { table: "ai_call_logs" },
  { table: "usage_analytics" }, // cascades too; kept for spec parity (no-op)
  { table: "user_sessions" },
  { table: "subject_change_log" },
  { table: "system_incidents" },
  { table: "storage_usage_snapshots" },
  { table: "pilot_analysis_settings", pk: "key" },
  { table: "qpaper_drafts" }, // SET NULL — wiped per reset decision
  { table: "qpaper_history" }, // SET NULL — wiped per reset decision
  // Presets wiped too (DB has 2/3; route reseeds full canonical 3 on next load).
  // Subject-scoped rows/snapshots would cascade from subjects anyway; this also
  // clears the subject_id-NULL preset rows the cascade can't reach.
  { table: "qpaper_templates" },
];

// Every table that must read 0 after the reset (for the "after" verification).
const ALL_ZERO_TABLES: string[] = [
  ...CASCADE_VERIFY_TABLES,
  ...EXPLICIT_DELETE_TABLES.map((t) => t.table),
];

const CONTENT_BUCKETS = [
  "documents",
  "generated-content",
  "explainers",
  "question-images",
] as const;

// ── Helpers ─────────────────────────────────────────────────────────────────
async function countRows(table: string): Promise<number> {
  const { count, error } = await supabase
    .from(table)
    .select("*", { count: "exact", head: true });
  if (error) throw new Error(`count(${table}) failed: ${error.message}`);
  return count ?? 0;
}

async function deleteAll(table: string, pk = "id"): Promise<void> {
  // PostgREST refuses an unfiltered DELETE; `not(pk, is, null)` matches every row.
  const { error } = await supabase.from(table).delete().not(pk, "is", null);
  if (error) throw new Error(`delete(${table}) failed: ${error.message}`);
}

async function listAllAuthEmails(): Promise<string[]> {
  const emails: string[] = [];
  const perPage = 1000;
  let page = 1;
  for (;;) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage,
    });
    if (error) throw new Error(`listUsers failed: ${error.message}`);
    const users = data.users ?? [];
    for (const u of users) emails.push((u.email ?? "").toLowerCase());
    if (users.length < perPage) break;
    page++;
  }
  return emails.sort();
}

// Recursively list every file path in a bucket, paginating each folder level.
// Supabase marks folder entries with `id === null`; real objects carry an id.
async function listAllFiles(bucket: string, prefix = ""): Promise<string[]> {
  const files: string[] = [];
  const pageSize = 100;
  let offset = 0;
  for (;;) {
    const { data, error } = await supabase.storage.from(bucket).list(prefix, {
      limit: pageSize,
      offset,
      sortBy: { column: "name", order: "asc" },
    });
    if (error) throw new Error(`list(${bucket}/${prefix}) failed: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const entry of data) {
      const full = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.id === null) {
        // Folder — recurse.
        files.push(...(await listAllFiles(bucket, full)));
      } else {
        files.push(full);
      }
    }
    if (data.length < pageSize) break;
    offset += pageSize;
  }
  return files;
}

function line() {
  console.log("──────────────────────────────────────────────────────────");
}

function fail(msg: string): never {
  console.error(`\n❌ STOP: ${msg}`);
  console.error("No further steps run. Investigate before re-running.\n");
  process.exit(1);
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log("\n=== FULL PLATFORM DATA RESET — pre-pilot clean slate ===");
  console.log(`Target: ${SUPABASE_URL}\n`);

  // ═══ SAFETY SNAPSHOT (before) ════════════════════════════════════════════
  line();
  console.log("SAFETY CHECK — BEFORE snapshot");
  line();

  const beforeCounts: Record<string, number> = {};
  for (const t of ALL_ZERO_TABLES) {
    beforeCounts[t] = await countRows(t);
    console.log(`  ${t.padEnd(28)} ${beforeCounts[t]}`);
  }

  const { count: qtemplPresetBefore } = await supabase
    .from("qpaper_templates")
    .select("*", { count: "exact", head: true })
    .eq("is_preset", true)
    .is("subject_id", null);
  console.log(
    `    (of which is_preset+subject_id-NULL: ${qtemplPresetBefore ?? "?"} — all wiped, reseeded to 3 below)`
  );

  // The reference that must be IDENTICAL afterward.
  const profilesBefore = await countRows("profiles");
  const authEmailsBefore = await listAllAuthEmails();
  console.log("");
  console.log(`  profiles                     ${profilesBefore}  — PRESERVED`);
  console.log(`  auth.users                   ${authEmailsBefore.length}  — PRESERVED`);
  console.log("  auth.users emails:");
  for (const e of authEmailsBefore) console.log(`    - ${e || "(no email)"}`);

  if (!CONFIRMED) {
    console.log("");
    line();
    console.log("DRY RUN — nothing deleted.");
    console.log("Re-run with confirmation to execute:");
    console.log("  CONFIRM_RESET=1 npx tsx scripts/reset-platform-data.ts");
    line();
    return;
  }

  // ═══ PART A — DB deletes ═════════════════════════════════════════════════
  console.log("");
  line();
  console.log("PART A — DB deletes");
  line();

  console.log("  DELETE FROM subjects (cascading)...");
  await deleteAll("subjects");
  console.log("  ✓ subjects deleted (cascade fired)");

  for (const { table, pk } of EXPLICIT_DELETE_TABLES) {
    await deleteAll(table, pk);
    console.log(`  ✓ ${table} deleted`);
  }

  // ── Step 3: verify all targeted tables empty (AFTER picture) ──
  console.log("");
  line();
  console.log("AFTER — row counts (all must be 0)");
  line();
  const nonEmpty: string[] = [];
  for (const t of ALL_ZERO_TABLES) {
    const c = await countRows(t);
    const flag = c === 0 ? "✓" : "✗";
    console.log(`  ${flag} ${t.padEnd(28)} ${beforeCounts[t]} → ${c}`);
    if (c !== 0) nonEmpty.push(`${t} (${c} rows remain)`);
  }
  if (nonEmpty.length) {
    fail(`tables not empty after reset: ${nonEmpty.join(", ")}`);
  }

  // qpaper_templates was fully wiped above (it's in ALL_ZERO_TABLES, so the
  // "AFTER" block already asserted it reads 0). Presets reseed at the end.

  // ── Step 5: profiles + auth.users must be UNCHANGED ──
  console.log("");
  line();
  console.log("USER-ACCOUNT INTEGRITY — must be IDENTICAL to BEFORE");
  line();
  const profilesAfter = await countRows("profiles");
  const authEmailsAfter = await listAllAuthEmails();
  console.log(`  profiles: ${profilesBefore} → ${profilesAfter}`);
  console.log(`  auth.users: ${authEmailsBefore.length} → ${authEmailsAfter.length}`);

  if (profilesAfter !== profilesBefore) {
    fail(
      `profiles count changed (${profilesBefore} → ${profilesAfter}). User accounts were touched — investigate immediately.`
    );
  }
  const beforeSet = authEmailsBefore.join(" ");
  const afterSet = authEmailsAfter.join(" ");
  if (beforeSet !== afterSet) {
    const missing = authEmailsBefore.filter((e) => !authEmailsAfter.includes(e));
    const added = authEmailsAfter.filter((e) => !authEmailsBefore.includes(e));
    fail(
      `auth.users email set changed. Missing: [${missing.join(", ")}] Added: [${added.join(", ")}]`
    );
  }
  console.log("  ✓ profiles count identical");
  console.log("  ✓ auth.users email set identical — no account touched");

  // ═══ PART B — Storage bucket cleanup ═════════════════════════════════════
  console.log("");
  line();
  console.log("PART B — Storage bucket cleanup");
  line();

  const REMOVE_BATCH = 200; // stay well under Supabase remove() limits
  for (const bucket of CONTENT_BUCKETS) {
    const paths = await listAllFiles(bucket);
    console.log(`  ${bucket}: ${paths.length} object(s) found`);

    let removed = 0;
    for (let i = 0; i < paths.length; i += REMOVE_BATCH) {
      const batch = paths.slice(i, i + REMOVE_BATCH);
      const { error } = await supabase.storage.from(bucket).remove(batch);
      if (error) {
        fail(`remove() in bucket "${bucket}" failed: ${error.message}`);
      }
      removed += batch.length;
    }
    console.log(`  ${bucket}: removed ${removed} object(s)`);

    // Re-list to confirm empty.
    const remaining = await listAllFiles(bucket);
    if (remaining.length > 0) {
      fail(
        `bucket "${bucket}" still has ${remaining.length} object(s) after cleanup: ${remaining
          .slice(0, 10)
          .join(", ")}${remaining.length > 10 ? " …" : ""}`
      );
    }
    console.log(`  ✓ ${bucket} confirmed empty`);
  }

  // ═══ PART C — Reseed canonical presets ═══════════════════════════════════
  // GET /api/qpaper/templates would do this on next page load, but it requires
  // faculty/oversight auth — a bare request can't trigger it. So we perform the
  // route's OWN seed insert here (same PRESET_TEMPLATES / PRESET_ORDER source of
  // truth), leaving the platform with the full canonical 3 immediately.
  console.log("");
  line();
  console.log("PART C — Reseed canonical presets");
  line();
  const seedRows = PRESET_ORDER.map((key: PresetKey) => {
    const preset = PRESET_TEMPLATES[key];
    return {
      subject_id: null,
      created_by: null,
      name: preset.name,
      is_default: false,
      is_preset: true,
      is_snapshot: false,
      scope: "school",
      university_name: preset.university_name,
      exam_title: preset.exam_title,
      duration_minutes: preset.duration_minutes,
      total_marks: preset.total_marks,
      instructions: preset.instructions,
      structure: preset.structure,
    };
  });
  const { error: seedErr } = await supabase
    .from("qpaper_templates")
    .insert(seedRows);
  if (seedErr) {
    fail(
      `preset reseed failed: ${seedErr.message}. DB left with 0 presets — the templates route will still reseed on next authenticated load.`
    );
  }
  const presetsFinal = await countRows("qpaper_templates");
  if (presetsFinal !== 3) {
    fail(`expected 3 presets after reseed, found ${presetsFinal}.`);
  }
  console.log(`  ✓ reseeded ${PRESET_ORDER.join(", ")} — qpaper_templates = 3`);

  // ═══ DONE ════════════════════════════════════════════════════════════════
  console.log("");
  line();
  console.log("✅ RESET COMPLETE");
  line();
  console.log(`  DB tables cleared:     ${ALL_ZERO_TABLES.length} (all 0)`);
  console.log(`  qpaper_templates:      wiped, reseeded to 3 canonical presets`);
  console.log(`  profiles / auth.users: unchanged (${profilesAfter} / ${authEmailsAfter.length})`);
  console.log(`  storage buckets:       ${CONTENT_BUCKETS.length} emptied`);
  console.log("");
}

main().catch((err) => {
  console.error("\nFatal error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
