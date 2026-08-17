import * as fs from "fs";
import { createPDFBuilder } from "../src/lib/pdf/builder";
import { drawBlock, prerenderNotesMath } from "../src/lib/notes/pdf";
import type { NoteBlock } from "../src/lib/notes/types";
import { generatePPSUPaperPDF, type AssembledPaper } from "../src/lib/qpaper/builder";
import { renderPaperMath } from "../src/lib/qpaper/paperMath";

// Malformed / boundary LaTeX: unclosed brace, undefined command, empty span,
// deeply nested, and a 5000-char blob — adversarial input per AU_SPEC §3C.
const UNCLOSED = "$\\frac{a}{b$";
const UNDEFINED_CMD = "$\\notarealcommand{x}$";
const EMPTY_SPAN = "$$";
const HUGE = "$" + "x+".repeat(3000) + "x$";

const blocks: NoteBlock[] = [
  {
    kind: "formula",
    id: "formula-malformed",
    name: "Malformed LaTeX Stress",
    formula: UNCLOSED,
    symbols: [{ symbol: UNDEFINED_CMD, meaning: "undefined command" }],
    workedExample: { problem: `Empty span: ${EMPTY_SPAN} end.`, solution: `Huge span follows: ${HUGE}` },
  },
];

const paper: AssembledPaper = {
  universityName: "EduNexus Institute of Technology",
  courseCode: "ME302",
  courseName: "Malformed LaTeX Stress Paper",
  duration: 60,
  totalMarks: 10,
  instructions: [],
  sections: [
    {
      section_name: "Section A",
      questions: [
        {
          q_number: 1,
          type: "descriptive",
          total_marks: 10,
          parts: [{ question: `Solve ${UNCLOSED} and ${UNDEFINED_CMD} and ${HUGE.slice(0, 200)}`, marks: 10 }],
        },
      ],
    },
  ],
};

async function main() {
  fs.mkdirSync("_audit_exports/out", { recursive: true });

  console.log("=== notes malformed ===");
  const mathMap = await prerenderNotesMath(blocks);
  console.log(`spans: ${mathMap.size}, failed: ${[...mathMap.values()].filter((v) => v === null).length}`);
  const { builder } = await createPDFBuilder();
  await builder.embedMath(mathMap);
  for (const b of blocks) drawBlock(builder, b, mathMap);
  const bytes = await builder.build();
  fs.writeFileSync("_audit_exports/out/notes_malformed.pdf", Buffer.from(bytes));
  console.log("notes_malformed.pdf OK", bytes.length);

  console.log("=== qpaper malformed ===");
  const math = await renderPaperMath(paper);
  console.log(`spans: ${math.size}, failed: ${[...math.values()].filter((v) => v === null).length}`);
  const pdfBuf = await generatePPSUPaperPDF(paper, { math });
  fs.writeFileSync("_audit_exports/out/qpaper_malformed.pdf", pdfBuf);
  console.log("qpaper_malformed.pdf OK", pdfBuf.length);
}

main().catch((e) => {
  console.error("CRASHED:", e);
  process.exit(1);
});
