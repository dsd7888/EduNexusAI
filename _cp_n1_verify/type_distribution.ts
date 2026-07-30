/**
 * CP-N1 harness 2 — the generator TYPES content, it does not just chunk it.
 *
 * Two-point empirical probe (§17): the same prompt against two modules chosen
 * to sit at opposite poles.
 *
 *   SOEEC1010 M1 "Fundamentals of Electrical Circuits"  — Ohm's law, KCL, KVL.
 *     A module that SHOULD produce formula blocks. If it produces none, the
 *     generator is under-typing: it is emitting prose where the syllabus gives
 *     equations, and every formula's symbol table is being lost.
 *
 *   IDSH2020 M5 "Mathematical Logic and Proofs" — propositions, quantifiers,
 *     rules of inference. Predominantly conceptual.
 *
 * The assertion is about the DIFFERENCE between the two, not an absolute count.
 * A generator that emitted the same mix regardless of input would pass any
 * single-module check and fail here.
 *
 * Run: npx tsx _cp_n1_verify/type_distribution.ts > /tmp/cpn1_types.log 2>&1
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
  type ResolvedModule,
} from "./shared";

loadEnvLocal();

import { generateModuleNotes } from "@/lib/notes/generator";
import type { NoteBlock } from "@/lib/notes/types";

function distribution(blocks: NoteBlock[]): Record<string, number> {
  return blocks.reduce<Record<string, number>>((acc, b) => {
    acc[b.kind] = (acc[b.kind] ?? 0) + 1;
    return acc;
  }, {});
}

async function main() {
  const admin = adminClient();
  const runInScope = await makeRunInScope();
  const { check, summary } = makeChecker();

  hr("CP-N1 harness 2 — type_distribution");

  const formulaic = await resolveModule(
    admin,
    FIXTURES.SOEEC1010.code,
    FIXTURES.SOEEC1010.formulaicModule
  );
  const conceptual = await resolveModule(
    admin,
    FIXTURES.IDSH2020.code,
    FIXTURES.IDSH2020.conceptualModule
  );

  let cleaned = false;
  const cleanup = async (): Promise<string> => {
    if (cleaned) return "already cleaned";
    cleaned = true;
    const residual = await purgeNotes(admin, [formulaic.moduleId, conceptual.moduleId]);
    return `study_notes residual rows: ${residual}`;
  };
  onSignals(cleanup);

  const gen = async (t: ResolvedModule) => {
    await purgeNotes(admin, [t.moduleId]);
    const res = await runInScope(() =>
      generateModuleNotes({
        subjectId: t.subjectId,
        moduleId: t.moduleId,
        adminClient: admin,
        logContext: {
          userId: null,
          userEmail: null,
          userRole: "superadmin",
          subjectId: t.subjectId,
          subjectCode: t.subjectCode,
          jobId: randomUUID(),
          relatedContentId: null,
        },
      })
    );
    if (!res.ok) throw new Error(`${t.subjectCode} M${t.moduleNumber}: ${res.message}`);
    return res;
  };

  try {
    sub(`formulaic pole — ${formulaic.subjectCode} M${formulaic.moduleNumber} "${formulaic.moduleName}"`);
    const f = await gen(formulaic);
    const fDist = distribution(f.blocks);
    console.log(`    ${f.blocks.length} blocks: ${JSON.stringify(fDist)}`);
    for (const b of f.blocks) {
      console.log(`      [${b.kind.padEnd(10)}] ${"title" in b ? b.title : b.name}`);
    }
    const fFormula = fDist.formula ?? 0;
    check(
      "at least 2 formula blocks on a formulaic module",
      fFormula >= 2,
      `${fFormula} formula block(s)`
    );
    const withSymbols = f.blocks.filter(
      (b) => b.kind === "formula" && b.symbols.length > 0
    ).length;
    check(
      "every formula block explains its symbols",
      withSymbols === fFormula,
      `${withSymbols}/${fFormula}`
    );
    const withWorked = f.blocks.filter(
      (b) => b.kind === "formula" && b.workedExample
    ).length;
    console.log(`    worked examples: ${withWorked}/${fFormula} formula blocks`);

    sub(`conceptual pole — ${conceptual.subjectCode} M${conceptual.moduleNumber} "${conceptual.moduleName}"`);
    const c = await gen(conceptual);
    const cDist = distribution(c.blocks);
    console.log(`    ${c.blocks.length} blocks: ${JSON.stringify(cDist)}`);
    for (const b of c.blocks) {
      console.log(`      [${b.kind.padEnd(10)}] ${"title" in b ? b.title : b.name}`);
    }
    const cConcept = cDist.concept ?? 0;
    const cFormula = cDist.formula ?? 0;
    check(
      "conceptual module is majority-concept",
      cConcept > c.blocks.length / 2,
      `${cConcept}/${c.blocks.length} concept`
    );
    check(
      "conceptual module produces few formula blocks",
      cFormula <= 2,
      `${cFormula} formula block(s)`
    );

    sub("the two poles actually differ");
    // The real assertion: typing RESPONDS to input. A fixed mix would pass each
    // pole's own check only by luck and would fail this one every time.
    check(
      "formulaic module yields strictly more formula blocks",
      fFormula > cFormula,
      `${fFormula} (electrical) vs ${cFormula} (logic)`
    );
    const fShare = fFormula / f.blocks.length;
    const cShare = cFormula / c.blocks.length;
    console.log(
      `    formula share: ${(fShare * 100).toFixed(0)}% vs ${(cShare * 100).toFixed(0)}%`
    );

    const { passed, failed } = summary();
    console.log(`\n${passed} passed, ${failed} failed`);
    console.log(`cleanup: ${await cleanup()}`);
    process.exit(failed === 0 ? 0 : 1);
  } catch (err) {
    console.error("harness error:", err);
    console.log(`cleanup: ${await cleanup()}`);
    process.exit(1);
  }
}

main();
