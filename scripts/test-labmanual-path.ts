/**
 * Checkpoint-2 test harness — lab manual learning path.
 *
 * Two halves:
 *
 *  (A) GATE TESTS — pure, free, no AI. validateLearningPath is exported so the
 *      partition rules can be driven with forced-bad fixtures directly instead
 *      of waiting for the model to misbehave. This is where the guarantee that
 *      "every practical is in exactly one unit" is actually proven.
 *
 *  (B) LIVE RUNS — one real Flash call per subject, printed in full for manual
 *      inspection, with the partition re-asserted on the real output.
 *
 *   npx tsx scripts/test-labmanual-path.ts             # gate tests + both live subjects
 *   GATE_ONLY=1 npx tsx scripts/test-labmanual-path.ts # gate tests only (free)
 *   SUBJECT=IDSH2020 npx tsx scripts/test-labmanual-path.ts
 *
 * Live runs call the real Gemini API (costs money). Same fake-request-scope
 * shim as test-lessonplan-generator.ts: routeAI logs via next/server's after(),
 * which needs a request scope. The shim lives ONLY here.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";

(globalThis as Record<string, unknown>).AsyncLocalStorage = AsyncLocalStorage;

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

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

/** The invariant the whole gate exists to guarantee. */
function assertPartition(
  label: string,
  units: { practicalNos: number[] }[],
  expected: number[],
) {
  const flat = units.flatMap((u) => u.practicalNos);
  const sortedFlat = [...flat].sort((a, b) => a - b);
  const sortedExp = [...expected].sort((a, b) => a - b);
  check(
    `${label}: units are an exact partition of the practicals`,
    JSON.stringify(sortedFlat) === JSON.stringify(sortedExp),
    `got [${sortedFlat}] want [${sortedExp}]`,
  );
  check(
    `${label}: no practical appears twice`,
    new Set(flat).size === flat.length,
    `${flat.length} placements, ${new Set(flat).size} distinct`,
  );
}

async function gateTests() {
  const { validateLearningPath } = await import("@/lib/labmanual/pathGenerator");
  const ALL = [1, 2, 3, 4, 5];

  console.log("\n══════════ (A) GATE TESTS — forced-bad fixtures, no AI ══════════");

  // 1. happy path
  console.log("\n--- 1. well-formed proposal ---");
  {
    const r = validateLearningPath(
      [
        { unitNo: 1, name: "Basics", practicalNos: [1, 2], rationale: "foundation" },
        { unitNo: 2, name: "Advanced", practicalNos: [3, 4, 5], rationale: "builds on basics" },
      ],
      [],
      ALL,
    );
    assertPartition("happy", r.units, ALL);
    check("no warnings on a clean proposal", r.warnings.length === 0, `${r.warnings.length} warnings`);
    check("unit count preserved", r.units.length === 2);
  }

  // 2. MISSING practical → appended as Ungrouped + warning
  console.log("\n--- 2. AI dropped practical #4 and #5 ---");
  {
    const r = validateLearningPath(
      [{ unitNo: 1, name: "Only some", practicalNos: [1, 2, 3], rationale: "partial" }],
      [],
      ALL,
    );
    assertPartition("missing", r.units, ALL);
    const ungrouped = r.units.find((u) => u.name === "Ungrouped");
    check("an 'Ungrouped' unit was appended", !!ungrouped);
    check(
      "it holds exactly the dropped practicals",
      JSON.stringify(ungrouped?.practicalNos) === JSON.stringify([4, 5]),
      `got ${JSON.stringify(ungrouped?.practicalNos)}`,
    );
    check(
      "path_practical_missing warning fired",
      r.warnings.some((w) => w.kind === "path_practical_missing"),
      r.warnings.map((w) => w.kind).join(","),
    );
  }

  // 3. DUPLICATED practical → first placement wins + warning
  console.log("\n--- 3. AI put practical #2 in two units ---");
  {
    const r = validateLearningPath(
      [
        { unitNo: 1, name: "A", practicalNos: [1, 2], rationale: "x" },
        { unitNo: 2, name: "B", practicalNos: [2, 3, 4, 5], rationale: "y" },
      ],
      [],
      ALL,
    );
    assertPartition("duplicate", r.units, ALL);
    check(
      "first placement kept (unit A keeps #2)",
      r.units[0].practicalNos.includes(2) && !r.units[1].practicalNos.includes(2),
    );
    check(
      "path_practical_duplicated warning fired",
      r.warnings.some((w) => w.kind === "path_practical_duplicated"),
      r.warnings.map((w) => w.kind).join(","),
    );
  }

  // 4. INVENTED practical → removed + warning
  console.log("\n--- 4. AI invented practical #99 ---");
  {
    const r = validateLearningPath(
      [
        { unitNo: 1, name: "A", practicalNos: [1, 2, 99], rationale: "x" },
        { unitNo: 2, name: "B", practicalNos: [3, 4, 5], rationale: "y" },
      ],
      [],
      ALL,
    );
    assertPartition("invented", r.units, ALL);
    check("#99 does not survive", !r.units.flatMap((u) => u.practicalNos).includes(99));
    check(
      "warning fired for the invented number",
      r.warnings.some((w) => w.message.includes("99")),
      r.warnings.map((w) => w.message).join(" | "),
    );
  }

  // 5. > 2 bridges → truncate + warning
  console.log("\n--- 5. AI proposed 4 bridges (cap is 2) ---");
  {
    const mk = (n: number) => ({
      afterPracticalNo: n,
      title: `Bridge ${n}`,
      statement: `Do the thing ${n}`,
      expected: "ok",
    });
    const r = validateLearningPath(
      [
        { unitNo: 1, name: "A", practicalNos: [1, 2], rationale: "x" },
        { unitNo: 2, name: "B", practicalNos: [3, 4, 5], rationale: "y" },
      ],
      [mk(1), mk(2), mk(3), mk(4)],
      ALL,
    );
    check("bridges truncated to 2", r.bridges.length === 2, `got ${r.bridges.length}`);
    check(
      "path_bridges_truncated warning fired",
      r.warnings.some((w) => w.kind === "path_bridges_truncated"),
      r.warnings.map((w) => w.kind).join(","),
    );
  }

  // 6. bridge anchored to a non-existent practical → dropped
  console.log("\n--- 6. bridge anchored to a practical that doesn't exist ---");
  {
    const r = validateLearningPath(
      [
        { unitNo: 1, name: "A", practicalNos: [1, 2], rationale: "x" },
        { unitNo: 2, name: "B", practicalNos: [3, 4, 5], rationale: "y" },
      ],
      [{ afterPracticalNo: 77, title: "Nowhere", statement: "s", expected: "e" }],
      ALL,
    );
    check("dangling bridge dropped", r.bridges.length === 0, `got ${r.bridges.length}`);
  }

  // 7. empty units dropped + dense renumbering
  console.log("\n--- 7. empty unit + non-dense unitNo ---");
  {
    const r = validateLearningPath(
      [
        { unitNo: 5, name: "A", practicalNos: [1, 2], rationale: "x" },
        { unitNo: 9, name: "Empty", practicalNos: [], rationale: "nothing" },
        { unitNo: 12, name: "B", practicalNos: [3, 4, 5], rationale: "y" },
      ],
      [],
      ALL,
    );
    check("empty unit dropped", !r.units.some((u) => u.name === "Empty"));
    check(
      "unitNo renumbered densely from 1",
      JSON.stringify(r.units.map((u) => u.unitNo)) === JSON.stringify([1, 2]),
      JSON.stringify(r.units.map((u) => u.unitNo)),
    );
  }

  // 8. total AI failure → everything Ungrouped, still a valid partition
  console.log("\n--- 8. total AI failure (null/garbage) ---");
  {
    const r = validateLearningPath(null, null, ALL);
    assertPartition("ai-failure", r.units, ALL);
    check("single Ungrouped unit holds everything", r.units.length === 1 && r.units[0].name === "Ungrouped");
    check("warning fired", r.warnings.some((w) => w.kind === "path_practical_missing"));
  }

  // 9. AI returned a unit as a string / malformed row
  console.log("\n--- 9. malformed unit rows ---");
  {
    const r = validateLearningPath(
      ["not an object", null, { unitNo: 1, name: "Real", practicalNos: [1, 2, 3, 4, 5], rationale: "ok" }],
      "not an array",
      ALL,
    );
    assertPartition("malformed", r.units, ALL);
    check("survives malformed rows without throwing", r.units.length >= 1);
  }
}

async function liveRun(subjectCode: string) {
  const { workAsyncStorage } = await import(
    "next/dist/server/app-render/work-async-storage.external"
  );
  const { createAdminClient } = await import("@/lib/db/supabase-server");
  const { loadSubjectContext } = await import("@/lib/subjectContext");
  const { generateLearningPath } = await import("@/lib/labmanual/pathGenerator");

  const admin = createAdminClient();
  const { data } = await admin
    .from("subjects")
    .select("id, name, code")
    .eq("code", subjectCode)
    .maybeSingle();
  const row = data as { id: string; name: string; code: string } | null;
  if (!row) {
    console.log(`\n!! could not resolve subject ${subjectCode} — skipped`);
    return;
  }

  const ctx = await loadSubjectContext(row.id);
  console.log(
    `\n══════════ LIVE: ${row.code} — ${row.name} (${ctx.practicals.length} practicals) ══════════`,
  );

  const logContext = {
    userId: null,
    userEmail: "harness@test",
    userRole: "faculty",
    subjectId: ctx.subjectId,
    subjectCode: ctx.subjectCode,
    jobId: crypto.randomUUID(),
    relatedContentId: null,
    feature: "lab_path_gen_test",
    metadata: {},
  };

  const store = { afterContext: { after: (_fn: unknown) => { void _fn; } } };

  await workAsyncStorage.run(store as never, async () => {
    const t0 = Date.now();
    const { path, warnings } = await generateLearningPath(ctx, logContext);
    const ms = Date.now() - t0;

    console.log(`\nUnits: ${path.units.length} | Bridges: ${path.bridges.length} | ${ms}ms`);
    console.log(`approved (must be false — faculty action only): ${path.approved}`);

    for (const u of path.units) {
      const titles = u.practicalNos.map((n) => {
        const p = ctx.practicals.find((x) => x.sr_no === n);
        return `      #${n}: ${p?.name ?? "??"}`;
      });
      console.log(`\n  UNIT ${u.unitNo}: ${u.name}  [${u.practicalNos.join(", ")}]`);
      console.log(`    rationale: ${u.rationale}`);
      console.log(titles.join("\n"));
    }

    if (path.bridges.length) {
      console.log("\n  BRIDGES (supplementary):");
      for (const b of path.bridges) {
        console.log(`    after #${b.afterPracticalNo} — ${b.title}`);
        console.log(`      ${b.statement}`);
        console.log(`      expected: ${b.expected}`);
      }
    }

    console.log(`\n  Warnings (${warnings.length}):`);
    for (const w of warnings) console.log(`    [${w.kind}] ${w.message}`);

    // the invariant, on real model output
    console.log("");
    assertPartition(
      row.code,
      path.units,
      ctx.practicals.map((p) => p.sr_no),
    );
    check(
      `${row.code}: unit count within 2-5 (or Ungrouped repair present)`,
      (path.units.length >= 2 && path.units.length <= 5) ||
        path.units.some((u) => u.name === "Ungrouped"),
      `${path.units.length} units`,
    );
    check(`${row.code}: approved is false`, path.approved === false);
    check(
      `${row.code}: every unit has a rationale`,
      path.units.every((u) => u.rationale.length > 0 || u.name === "Ungrouped"),
    );
    check(
      `${row.code}: no unit rationale exceeds 200 chars`,
      path.units.every((u) => u.rationale.length <= 200),
    );
  });
}

async function main() {
  await gateTests();

  if (!process.env.GATE_ONLY) {
    const only = process.env.SUBJECT;
    // 15 practicals and 9 practicals — see the CP2 report for why no ~5 subject.
    const subjects = only ? [only] : ["IDSH2020", "IDCH3051"];
    for (const s of subjects) await liveRun(s);
  } else {
    console.log("\n(GATE_ONLY set — skipped live AI runs)");
  }

  console.log(`\n══════════ lab-manual path: ${passed} passed, ${failed} failed ══════════\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("Harness failed:", e);
  process.exit(1);
});
