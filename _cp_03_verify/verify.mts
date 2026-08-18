/**
 * CP-03 verify — notes concurrent-generation race + raw error leak.
 *
 * Fires two genuinely parallel generateModuleNotes() calls at a zero-notes
 * module. Uses the aiOverride test seam (documented in generator.ts as the
 * sanctioned way to exercise this without paying for two real Gemini calls
 * per run) so the harness is cheap to re-run and deterministic about content.
 *
 * Asserts:
 *  1. Both calls resolve ok:true (no discarded/errored loser).
 *  2. Exactly ONE row lands in study_notes for (subject, module, scope) —
 *     the unique constraint raced, the loser served the winner's row instead
 *     of erroring.
 *  3. Neither result nor any storage_failed-shaped message contains raw
 *     Postgres error text (constraint/index names, "duplicate key", etc).
 *  4. Cleans up the row(s) it created, and verifies cleanup left no residue.
 */
import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import { generateModuleNotes } from "../src/lib/notes/generator";

const env = Object.fromEntries(
  fs
    .readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((l) => l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1)];
    }),
);

const admin = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
);

const SUBJECT_ID = "43003036-429f-43f7-b416-f300650a1eab";
const MODULE_ID = "c435f40e-40e6-4d15-946f-392a90c05030";
const TEST_USER_ID = "d4a32a8a-cc85-4ac2-bd14-ea6896ec150a";

let cleanupRan = false;
async function cleanup() {
  if (cleanupRan) return;
  cleanupRan = true;
  const { error } = await admin
    .from("study_notes")
    .delete()
    .eq("subject_id", SUBJECT_ID)
    .eq("module_id", MODULE_ID);
  if (error) console.error("[cleanup] delete failed:", error.message);
  const { data: residue } = await admin
    .from("study_notes")
    .select("id")
    .eq("subject_id", SUBJECT_ID)
    .eq("module_id", MODULE_ID);
  console.log(`[cleanup] residue rows after delete: ${residue?.length ?? "?"}`);
}
for (const sig of ["SIGINT", "SIGTERM", "SIGPIPE", "SIGHUP"] as const) {
  process.on(sig, async () => {
    await cleanup();
    process.exit(1);
  });
}

function fakeAiOverride(tag: string) {
  return async () => ({
    content: JSON.stringify({
      blocks: Array.from({ length: 4 }, (_, i) => ({
        kind: "concept",
        id: `concept-cp-03-${tag.toLowerCase()}-${i}`,
        title: `CP-03 fixture concept ${tag}-${i}`,
        plainExplanation: "A minimal valid concept block used only by this harness.",
        whyItMatters: "Exercises the concurrent-insert race path, nothing more.",
      })),
    }),
    tokensUsed: { input: 10, output: 10, thinking: 0 },
    costInr: 0,
    modelUsed: "cp-03-test-seam",
  });
}

async function main() {
  const { data: preExisting } = await admin
    .from("study_notes")
    .select("id")
    .eq("subject_id", SUBJECT_ID)
    .eq("module_id", MODULE_ID);
  if ((preExisting?.length ?? 0) > 0) {
    throw new Error(
      `Fixture module already has ${preExisting!.length} study_notes rows — pick a genuinely zero-notes module.`,
    );
  }

  const [r1, r2] = await Promise.all([
    generateModuleNotes({
      subjectId: SUBJECT_ID,
      moduleId: MODULE_ID,
      adminClient: admin,
      aiOverride: fakeAiOverride("A"),
      logContext: {
        userId: TEST_USER_ID,
        userEmail: null,
        userRole: "student",
        subjectId: SUBJECT_ID,
        subjectCode: null,
        jobId: crypto.randomUUID(),
        relatedContentId: null,
      },
    }),
    generateModuleNotes({
      subjectId: SUBJECT_ID,
      moduleId: MODULE_ID,
      adminClient: admin,
      aiOverride: fakeAiOverride("B"),
      logContext: {
        userId: TEST_USER_ID,
        userEmail: null,
        userRole: "student",
        subjectId: SUBJECT_ID,
        subjectCode: null,
        jobId: crypto.randomUUID(),
        relatedContentId: null,
      },
    }),
  ]);

  console.log("r1:", JSON.stringify(r1, null, 2).slice(0, 500));
  console.log("r2:", JSON.stringify(r2, null, 2).slice(0, 500));

  let ok = true;

  if (!r1.ok || !r2.ok) {
    console.error("FAIL: at least one concurrent call was rejected outright (expected both ok:true).");
    ok = false;
  } else {
    console.log(`sources: r1=${r1.source} r2=${r2.source}`);
    const sources = [r1.source, r2.source].sort();
    const freshCount = sources.filter((s) => s === "fresh").length;
    const loserOk = sources.some((s) => s === "concurrent" || s === "cache");
    // Node's event loop means the two calls aren't guaranteed to race at
    // exactly the DB-insert step — the loser can either (a) lose the insert
    // race and fall back to re-reading the winner's row ("concurrent"), or
    // (b) have its own step-2 existing-rows read happen after the winner
    // already committed, serving it straight from cache ("cache"). Both are
    // the fix working correctly; only a second "fresh" (both inserted) or an
    // error would indicate the race is still open.
    if (freshCount !== 1 || !loserOk) {
      console.error(
        `FAIL: expected exactly one "fresh" winner and a "concurrent"/"cache" loser, got [${sources.join(",")}]`,
      );
      ok = false;
    }
    if (r1.version !== r2.version) {
      console.error(`FAIL: winner/loser versions diverged (${r1.version} vs ${r2.version}) — loser should serve the winner's row.`);
      ok = false;
    }
  }

  const rawErrorNeedles = ["duplicate key", "constraint", "23505", "study_notes_module_version_key"];
  for (const [label, r] of [["r1", r1], ["r2", r2]] as const) {
    const serialized = JSON.stringify(r);
    for (const needle of rawErrorNeedles) {
      if (serialized.toLowerCase().includes(needle.toLowerCase())) {
        console.error(`FAIL: ${label} result leaks raw DB error text ("${needle}"): ${serialized}`);
        ok = false;
      }
    }
  }

  const { data: rows, error: rowsErr } = await admin
    .from("study_notes")
    .select("id, version")
    .eq("subject_id", SUBJECT_ID)
    .eq("module_id", MODULE_ID)
    .eq("scope", "module");
  if (rowsErr) {
    console.error("FAIL: could not verify row count:", rowsErr.message);
    ok = false;
  } else if ((rows?.length ?? 0) !== 1) {
    console.error(`FAIL: expected exactly 1 study_notes row after the race, found ${rows?.length}.`);
    ok = false;
  } else {
    console.log(`PASS: exactly 1 study_notes row landed (id=${rows![0].id}, version=${rows![0].version}) — only one insert billed/survived.`);
  }

  await cleanup();

  if (!ok) {
    console.error("\nCP-03 VERIFY: FAIL");
    process.exit(1);
  }
  console.log("\nCP-03 VERIFY: PASS");
}

main()
  .catch(async (err) => {
    console.error("VERIFY ERROR:", err);
    await cleanup();
    process.exit(1);
  })
  .then(async () => {
    await cleanup();
  });
