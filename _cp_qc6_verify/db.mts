/**
 * CP-QC6 — verifies the CP-QC5b migration actually landed correctly on the
 * LIVE database, and that it did not narrow question_type.
 *
 * This exists because the first version of that migration silently dropped
 * 'msq' and 'nat' (added by 20260725000000_assessment_engine.sql) while
 * rebuilding the CHECK list. Reading the migration file proves nothing about
 * what is actually enforced; only the live constraint does.
 *
 * Run:
 *   npx tsx _cp_qc6_verify/db.mts > _cp_qc6_verify/run.log 2>&1
 *
 * Writes exactly one temporary row and deletes it, then re-queries for residue.
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
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const admin = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY
);

let pass = 0;
let fail = 0;
function assert(cond: boolean, label: string) {
  if (cond) {
    pass += 1;
    console.log(`  ok   ${label}`);
  } else {
    fail += 1;
    console.error(`  FAIL ${label}`);
  }
}

// ── Cleanup tracking — exact ids, never a blanket delete ───────────────────
const createdQuestionIds: string[] = [];

async function cleanup() {
  if (createdQuestionIds.length) {
    await admin
      .from("faculty_question_bank")
      .delete()
      .in("id", createdQuestionIds);
  }
  const { data: residue } = await admin
    .from("faculty_question_bank")
    .select("id")
    .in(
      "id",
      createdQuestionIds.length
        ? createdQuestionIds
        : ["00000000-0000-0000-0000-000000000000"]
    );
  console.log(
    `\n[cleanup] created ${createdQuestionIds.length} row(s); residue: ${residue?.length ?? 0} (expect 0)`
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
// A `finally` block does NOT run when the process is signalled, and piping
// this harness through `head` SIGPIPE-kills it mid-run — which is how a
// previous harness left a subject half-mutated. Hence explicit handlers.
process.on("SIGINT", () => void cleanupOnSignal("SIGINT"));
process.on("SIGTERM", () => void cleanupOnSignal("SIGTERM"));
process.on("SIGHUP", () => void cleanupOnSignal("SIGHUP"));
process.on("SIGPIPE", () => void cleanupOnSignal("SIGPIPE"));

async function main() {
  console.log(`Project: ${new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname}\n`);

  // ── 1. The live constraint definition ────────────────────────────────────
  console.log("1. Live CHECK constraint");
  const { data: conRows, error: conErr } = await admin.rpc("exec_sql_readonly", {
    q: "select 1",
  } as never);
  // The project has no generic SQL RPC; fall back to probing behaviour instead
  // of reading catalogs. Probing is actually the stronger test: it verifies
  // what is ENFORCED, not what is declared.
  void conRows;
  void conErr;
  console.log("  (no catalog RPC available — probing enforced behaviour instead)");

  // ── 2. A real subject + faculty to hang the fixture row on ───────────────
  const { data: subj } = await admin
    .from("subjects")
    .select("id, code, name")
    .limit(1)
    .maybeSingle();
  if (!subj) {
    console.error("FAIL: no subject rows — cannot build a fixture.");
    process.exit(1);
  }
  const { data: fac } = await admin
    .from("profiles")
    .select("id, role")
    .eq("role", "faculty")
    .limit(1)
    .maybeSingle();
  if (!fac) {
    console.error("FAIL: no faculty profile — cannot build a fixture.");
    process.exit(1);
  }
  console.log(`\n2. Fixture anchors: subject ${subj.code}, faculty ${fac.id.slice(0, 8)}…`);

  // ── 3. The change under test: 'custom' must be storable ──────────────────
  console.log("\n3. question_type = 'custom' is accepted (the migration's purpose)");
  const CANARY = "ZZQC6-CANARY-custom-format-probe";
  const insertOne = async (question_type: string) =>
    admin
      .from("faculty_question_bank")
      .insert({
        subject_id: subj.id,
        faculty_id: fac.id,
        question_text: `${CANARY} :: ${question_type}`,
        question_type,
        marks: 6,
        difficulty: "medium",
        source: "ai_generated",
        is_verified: false,
      })
      .select("id, question_type")
      .maybeSingle();

  const { data: customRow, error: customErr } = await insertOne("custom");
  assert(
    customErr === null && customRow !== null,
    `insert 'custom' succeeds${customErr ? ` (error: ${customErr.message})` : ""}`
  );
  if (customRow?.id) createdQuestionIds.push(customRow.id);
  assert(customRow?.question_type === "custom", "round-trips as 'custom'");

  // ── 4. The regression: msq / nat must STILL be accepted ──────────────────
  // The first migration dropped these. If this harness had existed then, this
  // is the assertion that would have caught it before it reached the DB.
  console.log("\n4. [REGRESSION] the assessment engine's types survive");
  for (const t of ["msq", "nat"]) {
    const { data, error } = await insertOne(t);
    assert(
      error === null && data !== null,
      `insert '${t}' still succeeds${error ? ` (error: ${error.message})` : ""}`
    );
    if (data?.id) createdQuestionIds.push(data.id);
  }

  // ── 5. Pre-existing types unaffected ─────────────────────────────────────
  console.log("\n5. Pre-existing types unaffected");
  for (const t of ["mcq", "short_answer", "long_answer", "numerical", "fill_blank"]) {
    const { data, error } = await insertOne(t);
    assert(error === null && data !== null, `insert '${t}' succeeds`);
    if (data?.id) createdQuestionIds.push(data.id);
  }

  // ── 6. Negative control ──────────────────────────────────────────────────
  // Without this, every assertion above would pass identically against a table
  // with NO constraint at all — which is a real possible outcome of a botched
  // DROP/ADD, and would be worse than the bug being fixed.
  console.log("\n6. Negative control — the constraint still constrains");
  const { data: bogus, error: bogusErr } = await insertOne("definitely_not_a_type");
  assert(
    bogusErr !== null && bogus === null,
    "an invalid question_type is REJECTED (constraint exists and is enforced)"
  );
  if (bogus && (bogus as { id?: string }).id) {
    createdQuestionIds.push((bogus as { id: string }).id);
  }
  if (bogusErr) {
    assert(
      /question_type/i.test(bogusErr.message) || /check/i.test(bogusErr.message),
      `rejection names the constraint (got: ${bogusErr.message.slice(0, 90)})`
    );
  }

  // ── 7. What is actually stored today ─────────────────────────────────────
  console.log("\n7. Distinct question_type values in the bank (excluding this harness's own rows)");
  // Excluding the canary matters: without it this step would be measuring the
  // eight rows THIS harness just inserted and reporting them as pre-existing
  // data — the query would confirm its own contamination.
  const { data: allRows } = await admin
    .from("faculty_question_bank")
    .select("question_type")
    .not("question_text", "like", `${CANARY}%`);
  const distinct = Array.from(
    new Set((allRows ?? []).map((r) => (r as { question_type: string }).question_type))
  ).sort();
  console.log(`  ${distinct.join(", ") || "(bank is empty)"}`);
  // The failed first migration proved msq/nat rows exist in real data. If they
  // are absent here the exclusion filter is wrong, not the database.
  assert(
    distinct.includes("msq") || distinct.includes("nat"),
    "real (non-fixture) msq/nat rows are present — the rows the first migration would have orphaned"
  );
  const allowed = new Set([
    "mcq", "short_answer", "long_answer", "numerical", "fill_blank",
    "msq", "nat", "custom",
  ]);
  const unexpected = distinct.filter((t) => !allowed.has(t));
  assert(
    unexpected.length === 0,
    `every stored value is in the declared list${unexpected.length ? ` (unexpected: ${unexpected.join(", ")})` : ""}`
  );
}

main()
  .then(async () => {
    await cleanup();
    console.log(`\n${pass} passed, ${fail} failed`);
    if (fail > 0) {
      console.error("RESULT: FAIL");
      process.exit(1);
    }
    console.log("RESULT: PASS");
  })
  .catch(async (err) => {
    console.error("\nHarness error:", err);
    await cleanup();
    process.exit(1);
  });
