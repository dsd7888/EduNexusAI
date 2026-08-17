import { createPDFBuilder } from "../src/lib/pdf/builder";
import { drawBlock, drawModuleSectionHeader, prerenderNotesMath } from "../src/lib/notes/pdf";
import type { NoteBlock } from "../src/lib/notes/types";
import * as fs from "fs";
import {
  FRAC,
  FORALL,
  MATRIX,
  CHEM,
  INTEGRAL,
  UNICODE_STRESS,
  WORKED_PROBLEM,
  WORKED_SOLUTION,
} from "./stress_content";

const blocks: NoteBlock[] = [
  {
    kind: "concept",
    id: "concept-stress-test",
    title: `Stress Concept — ${UNICODE_STRESS}`,
    plainExplanation: `A concept block carrying unicode: ${UNICODE_STRESS} and inline math $${FORALL}$.`,
    formalStatement: `$${INTEGRAL}$ and chemistry ${CHEM}`,
    whyItMatters: "Appears in every mechanics/vibrations exam.",
    relatedTerms: ["SHM", "damping"],
  },
  {
    kind: "formula",
    id: "formula-stress-test",
    name: "Damped Harmonic Oscillator",
    formula: `$${FRAC}$`,
    symbols: [
      { symbol: "$\\omega$", meaning: "angular frequency", unit: "rad/s" },
      { symbol: "$\\zeta$", meaning: "damping ratio (unicode ζ)", unit: "-" },
    ],
    workedExample: { problem: WORKED_PROBLEM, solution: WORKED_SOLUTION },
    conditions: `Valid when $${MATRIX}$ is non-singular.`,
  },
  {
    kind: "comparison",
    id: "comparison-stress-test",
    title: "Damping Regimes",
    axes: ["Condition", "Formula", "Behaviour"],
    items: [
      { name: "Underdamped", values: [`$\\zeta < 1$`, `$${FRAC}$`, UNICODE_STRESS] },
      { name: "Critically damped", values: ["$\\zeta = 1$", "$x=Ae^{-\\omega t}$", "fastest return"] },
      { name: "Overdamped", values: ["$\\zeta > 1$", "$x=Ae^{r_1t}+Be^{r_2t}$", "no oscillation"] },
    ],
  },
];

async function main() {
  const enriched = blocks as (NoteBlock & { pyqSignal?: undefined })[];
  const mathMap = await prerenderNotesMath(enriched);
  console.log(
    `[notes] math spans: ${mathMap.size}, failed: ${[...mathMap.values()].filter((v) => v === null).length}`
  );
  const { builder } = await createPDFBuilder();
  await builder.embedMath(mathMap);
  builder.addPageHeader("Study Notes — AU-EXPORTS Stress Test", "Mechanics of Vibrations", "Module 1 · Stress Doc");
  drawModuleSectionHeader(builder, 1, "Vibrations");
  for (const b of enriched) drawBlock(builder, b, mathMap);
  const bytes = await builder.build();
  fs.mkdirSync("_audit_exports/out", { recursive: true });
  fs.writeFileSync("_audit_exports/out/notes_stress.pdf", Buffer.from(bytes));
  console.log("wrote _audit_exports/out/notes_stress.pdf", bytes.length, "bytes");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
