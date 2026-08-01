/**
 * CP-N5 harness 3 — renderer smoke test, unit-level (no server, no DB).
 *
 * Exercises the block factory (`drawBlock`, `src/lib/notes/pdf/index.ts`)
 * directly against one block of each kind, independent of the HTTP route —
 * a failure here says "a renderer is broken", not "the route glued things
 * together wrong", which `export_route.ts` already covers separately.
 *
 * PAGE COUNT COMES FROM `doc.getPageCount()`, NOT A NEW PDFBuilder METHOD.
 * `PDFBuilder`'s `pages` array is private, but `createPDFBuilder()` already
 * hands back the raw `PDFDocument` alongside the builder, and `PDFDocument`
 * itself exposes `getPageCount()` (pdf-lib). That is an existing public seam,
 * not a primitive CP-N5 needed to add — Architectural Decision A only calls
 * for extending `PDFBuilder` when no such seam exists.
 *
 * Run: npx tsx _cp_n5_verify/renderer_smoke.ts > /tmp/cpn5_renderer.log 2>&1
 */
import { createPDFBuilder } from "@/lib/pdf/builder";
import { drawBlock, prerenderNotesMath } from "@/lib/notes/pdf";
import type { EnrichedNoteBlock } from "@/lib/notes/pyq-frequency";

import { loadEnvLocal, makeChecker, hr, sub } from "./shared";

loadEnvLocal();

async function main() {
  const { check, summary } = makeChecker();

  hr("CP-N5 harness 3 — renderer_smoke");

  const blocks: EnrichedNoteBlock[] = [
    {
      kind: "concept",
      id: "concept-with-signal",
      title: "Concept With PYQ Signal",
      plainExplanation: "A plain explanation with inline math $x^2 + 1$.",
      formalStatement: "Formally, $f(x) = x^2 + 1$ for all real $x$.",
      whyItMatters: "It shows up constantly in exams.",
      relatedTerms: ["Quadratics", "Polynomials"],
      pyqSignal: { kind: "rich", coveredPapers: 3, totalPapers: 5, questionsCount: 7 },
    },
    {
      kind: "concept",
      id: "concept-no-signal",
      title: "Concept Without PYQ Signal",
      plainExplanation: "A second concept with no exam-frequency data at all.",
      whyItMatters: "Tests the no-signal branch renders without a chip.",
    },
    {
      kind: "formula",
      id: "formula-smoke",
      name: "Smoke Test Formula",
      formula: "$E = mc^2$",
      symbols: [
        { symbol: "E", meaning: "Energy", unit: "J" },
        { symbol: "m", meaning: "Mass", unit: "kg" },
        { symbol: "c", meaning: "Speed of light", unit: "\\text{m/s}" },
      ],
      workedExample: {
        problem: "A mass of $m = 2kg$. Find its rest energy.",
        solution: "Step 1: $E = mc^2$\nStep 2: $E = 2 \\times (3 \\times 10^8)^2$",
      },
      conditions: "Applies in the rest frame.",
      pyqSignal: { kind: "weak" },
    },
    {
      kind: "comparison",
      id: "comparison-smoke",
      title: "Smoke Test Comparison",
      axes: ["Axis A", "Axis B", "Axis C", "Axis D"],
      items: [
        { name: "Item 1", values: ["a1", "b1", "c1", "d1"] },
        { name: "Item 2", values: ["a2", "b2", "c2", "d2"] },
        { name: "Item 3", values: ["a3", "b3", "c3", "d3"] },
      ],
    },
  ];

  sub("drawBlock — one block of each kind, no thrown errors");
  let threw: unknown = null;
  let pageCount = -1;
  let pdfBytes: Uint8Array | null = null;

  try {
    const mathMap = await prerenderNotesMath(blocks);
    const { builder, doc } = await createPDFBuilder();
    await builder.embedMath(mathMap);

    for (const block of blocks) {
      drawBlock(builder, block, mathMap);
    }

    pageCount = doc.getPageCount();
    pdfBytes = await builder.build();
  } catch (err) {
    threw = err;
  }

  check("did not throw for any of the four blocks", threw === null, threw ? String(threw) : "");
  check(
    "PDFDocument's page count > 0 (content was actually added, not silently skipped)",
    pageCount > 0,
    `pageCount=${pageCount}`
  );
  check(
    "built PDF bytes start with the %PDF magic number",
    pdfBytes != null && Buffer.from(pdfBytes.slice(0, 4)).toString("latin1") === "%PDF",
    pdfBytes ? Buffer.from(pdfBytes.slice(0, 4)).toString("latin1") : "no bytes"
  );
  check(
    "built PDF is non-trivially sized (> 2000 bytes for four blocks + math)",
    pdfBytes != null && pdfBytes.length > 2000,
    pdfBytes ? `${pdfBytes.length} bytes` : "no bytes"
  );

  const { passed, failed } = summary();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
