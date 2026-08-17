import * as fs from "fs";
import sharp from "sharp";
import { generatePPSUPaperPDF, type AssembledPaper } from "../src/lib/qpaper/builder";
import { generateQpaperDocx } from "../src/lib/qpaper/docxBuilder";
import { renderPaperMath } from "../src/lib/qpaper/paperMath";
import type { PaperImageMap } from "../src/lib/qpaper/qpaperImages";
import {
  FRAC,
  FORALL,
  MATRIX,
  CHEM,
  INTEGRAL,
  UNICODE_STRESS,
  WORKED_PROBLEM,
  LONG_TABLE_MD,
} from "./stress_content";

const IMAGE_PATH = "stress/diagram.png";

const paper: AssembledPaper = {
  paperTitle: "AU-EXPORTS Stress Paper",
  universityName: "EduNexus Institute of Technology",
  examTitle: "End Semester Examination",
  courseCode: "ME301",
  courseName: `Mechanics of Vibrations — ${UNICODE_STRESS}`,
  date: "2026-08-17",
  duration: 180,
  totalMarks: 30,
  instructions: [`All questions carry marks as indicated. ${UNICODE_STRESS}`],
  sections: [
    {
      section_name: "Section A",
      questions: [
        {
          q_number: 1,
          type: "descriptive",
          total_marks: 10,
          instruction: `Answer using proper notation.`,
          parts: [
            {
              question: `${WORKED_PROBLEM}\n\nAttached image below shows the setup.`,
              marks: 10,
              co: "CO1",
              btl: 3,
              model_answer: `Using $${FRAC}$ and $${INTEGRAL}$, boundary condition $${FORALL}$, reaction ${CHEM}, system $${MATRIX}$.`,
              image_path: IMAGE_PATH,
            },
          ],
        },
        {
          q_number: 2,
          type: "mcq",
          total_marks: 5,
          sub_parts: [
            {
              label: "(a)",
              question: `Which damping ratio $\\zeta$ gives fastest return without oscillation? ${UNICODE_STRESS}`,
              options: { a: "< 1", b: "= 1", c: "> 1", d: "= 0" },
              correct_option: "b",
              co: "CO2",
              btl: 2,
            },
          ],
        },
        {
          q_number: 3,
          type: "descriptive",
          total_marks: 15,
          parts: [
            {
              question: `Tabulate the following results:\n\n${LONG_TABLE_MD}`,
              marks: 15,
              co: "CO3",
              btl: 4,
              model_answer: "See table.",
            },
          ],
        },
      ],
    },
  ],
};

async function makeStressImage(): Promise<PaperImageMap> {
  const png = await sharp({
    create: { width: 300, height: 200, channels: 4, background: { r: 30, g: 60, b: 120, alpha: 1 } },
  })
    .png()
    .toBuffer();
  const map: PaperImageMap = new Map();
  map.set(IMAGE_PATH, { bytes: new Uint8Array(png), format: "png", width: 300, height: 200 });
  return map;
}

async function main() {
  fs.mkdirSync("_audit_exports/out", { recursive: true });

  const images = await makeStressImage();
  const math = await renderPaperMath(paper);
  console.log(
    `[qpaper] math spans: ${math.size}, failed: ${[...math.values()].filter((v) => v === null).length}`
  );

  const pdfBuf = await generatePPSUPaperPDF(paper, { images, math });
  fs.writeFileSync("_audit_exports/out/qpaper_stress.pdf", pdfBuf);
  console.log("wrote _audit_exports/out/qpaper_stress.pdf", pdfBuf.length, "bytes");

  const docxBuf = await generateQpaperDocx(paper, { images, math });
  fs.writeFileSync("_audit_exports/out/qpaper_stress.docx", docxBuf);
  console.log("wrote _audit_exports/out/qpaper_stress.docx", docxBuf.length, "bytes");

  // Answer key variants too
  const pdfKeyBuf = await generatePPSUPaperPDF(paper, { images, math });
  fs.writeFileSync("_audit_exports/out/qpaper_stress_key.pdf", pdfKeyBuf);
  const docxKeyBuf = await generateQpaperDocx(paper, { images, math, answerKey: true });
  fs.writeFileSync("_audit_exports/out/qpaper_stress_key.docx", docxKeyBuf);
  console.log("wrote answer-key variants");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
