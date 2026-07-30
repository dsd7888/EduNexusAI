/**
 * CP-N1 harness 1 — module-scope generation against a real seeded module.
 *
 * Target: IDSH2020 M1 ("Set") — real syllabus content, moderate scope.
 *
 * Asserts the contract Part 3 promises: a block count inside the coverage
 * band, every block validating against the NoteBlock model, every id in
 * <kind>-<slug> form and derivable from its own title, and a stored row
 * carrying the right hash at version 1.
 *
 * Run:  npx tsx _cp_n1_verify/module_generation.ts > /tmp/cpn1_gen.log 2>&1
 * (redirect, do not pipe — see onSignals)
 */
import { randomUUID } from "node:crypto";

import {
  loadEnvLocal,
  adminClient,
  makeRunInScope,
  makeChecker,
  hr,
  sub,
  onSignals,
  resolveModule,
  purgeNotes,
  FIXTURES,
} from "./shared";

loadEnvLocal();

import { generateModuleNotes } from "@/lib/notes/generator";
import {
  validateNoteBlocks,
  buildBlockId,
  formatValidationIssues,
  NOTE_BLOCKS_MIN,
  NOTE_BLOCKS_MAX,
  NOTE_BLOCK_ID_PATTERN,
} from "@/lib/notes/types";

async function main() {
  const admin = adminClient();
  const runInScope = await makeRunInScope();
  const { check, eq, summary } = makeChecker();

  hr("CP-N1 harness 1 — module_generation (IDSH2020 M1)");

  const target = await resolveModule(
    admin,
    FIXTURES.IDSH2020.code,
    FIXTURES.IDSH2020.moduleOne
  );
  console.log(
    `target: ${target.subjectCode} M${target.moduleNumber} "${target.moduleName}"`
  );
  console.log(`        subject=${target.subjectId}\n        module =${target.moduleId}`);

  let cleaned = false;
  const cleanup = async (): Promise<string> => {
    if (cleaned) return "already cleaned";
    cleaned = true;
    const residual = await purgeNotes(admin, [target.moduleId]);
    return `study_notes residual rows for this module: ${residual}`;
  };
  onSignals(cleanup);

  try {
    // Start from a known-empty state so version numbering is deterministic.
    await purgeNotes(admin, [target.moduleId]);

    const jobId = randomUUID();
    const t0 = Date.now();
    const res = await runInScope(() =>
      generateModuleNotes({
        subjectId: target.subjectId,
        moduleId: target.moduleId,
        adminClient: admin,
        logContext: {
          userId: null,
          userEmail: null,
          userRole: "superadmin",
          subjectId: target.subjectId,
          subjectCode: target.subjectCode,
          jobId,
          relatedContentId: null,
        },
      })
    );
    const elapsed = Date.now() - t0;

    sub("generation");
    check("generateModuleNotes succeeded", res.ok, res.ok ? `${elapsed}ms` : `${res.error}: ${res.message}`);
    if (!res.ok) {
      if (res.issues) console.log("    issues:", formatValidationIssues(res.issues));
      if (res.rawBlocks) console.log("    raw:", JSON.stringify(res.rawBlocks).slice(0, 1500));
      const { passed, failed } = summary();
      console.log(`\n${passed} passed, ${failed} failed`);
      console.log(await cleanup());
      process.exit(1);
    }

    eq("source is 'fresh'", res.source, "fresh");
    eq("version is 1", res.version, 1);
    check("model is a flash tier", /flash/i.test(res.model), res.model);
    check("tokens were spent", res.tokensUsed > 0, String(res.tokensUsed));
    check("cost recorded", res.costInr > 0, `₹${res.costInr}`);

    sub(`coverage band (${NOTE_BLOCKS_MIN}–${NOTE_BLOCKS_MAX})`);
    check(
      `block count within band`,
      res.blocks.length >= NOTE_BLOCKS_MIN && res.blocks.length <= NOTE_BLOCKS_MAX,
      `${res.blocks.length} blocks`
    );
    const dist = res.blocks.reduce<Record<string, number>>((acc, b) => {
      acc[b.kind] = (acc[b.kind] ?? 0) + 1;
      return acc;
    }, {});
    console.log(`    distribution: ${JSON.stringify(dist)}`);

    sub("block model");
    const v = validateNoteBlocks(res.blocks);
    check("every block validates", v.ok, v.ok ? "" : formatValidationIssues(v.issues));

    sub("id discipline");
    const badPattern = res.blocks.filter((b) => !NOTE_BLOCK_ID_PATTERN.test(b.id));
    check(
      "every id matches <kind>-<slug>",
      badPattern.length === 0,
      badPattern.map((b) => b.id).join(", ")
    );
    const badPrefix = res.blocks.filter((b) => !b.id.startsWith(`${b.kind}-`));
    check(
      "every id prefix matches its kind",
      badPrefix.length === 0,
      badPrefix.map((b) => `${b.id} (kind=${b.kind})`).join(", ")
    );
    const ids = res.blocks.map((b) => b.id);
    check("ids unique", new Set(ids).size === ids.length);

    // Determinism is what CP-N4's "Ask about this" depends on: the id must be
    // recoverable from the block's own title, not chosen freely by the model.
    const derived = res.blocks.map((b) => {
      const title = "title" in b ? b.title : b.name;
      return { id: b.id, expected: buildBlockId(b.kind, title), title };
    });
    const drifted = derived.filter((d) => d.id !== d.expected);
    check(
      "every id is derivable from its own title",
      drifted.length === 0,
      drifted.map((d) => `"${d.title}" -> got ${d.id}, expected ${d.expected}`).join("; ")
    );

    sub("storage");
    const { data: rows } = await admin
      .from("study_notes")
      .select("id, version, scope, content_hash, is_stale, blocks, tokens_used, cost_inr, source_metadata")
      .eq("module_id", target.moduleId)
      .eq("scope", "module");
    eq("exactly one stored row", rows?.length ?? 0, 1);
    const row = rows?.[0];
    if (row) {
      eq("stored version is 1", row.version, 1);
      eq("stored scope is 'module'", row.scope, "module");
      eq("stored hash matches returned hash", row.content_hash, res.contentHash);
      eq("stored row is not stale", row.is_stale, false);
      eq(
        "stored block count matches",
        Array.isArray(row.blocks) ? row.blocks.length : -1,
        res.blocks.length
      );
      const stored = validateNoteBlocks(row.blocks);
      check("stored blocks re-validate from the DB", stored.ok,
        stored.ok ? "" : formatValidationIssues(stored.issues));
      check("source_metadata records the model", Boolean(row.source_metadata?.model),
        String(row.source_metadata?.model));
    }

    sub("block titles");
    for (const b of res.blocks) {
      const title = "title" in b ? b.title : b.name;
      console.log(`    [${b.kind.padEnd(10)}] ${b.id}`);
      console.log(`                 ${title}`);
    }

    const { passed, failed } = summary();
    console.log(`\n${passed} passed, ${failed} failed`);
    console.log(await cleanup());
    process.exit(failed === 0 ? 0 : 1);
  } catch (err) {
    console.error("harness error:", err);
    console.log(await cleanup());
    process.exit(1);
  }
}

main();
