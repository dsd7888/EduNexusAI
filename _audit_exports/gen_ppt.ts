import * as fs from "fs";
import { generatePPTXBuffer, type PPTSlideJSON, type SlideContent } from "../src/lib/ppt/generator";
import {
  FRAC,
  FORALL,
  CHEM,
  INTEGRAL,
  UNICODE_STRESS,
  SVG_DIAGRAM,
  MERMAID_DIAGRAM,
} from "./stress_content";

const slides: SlideContent[] = [
  {
    type: "title",
    title: `AU-EXPORTS Stress Deck — ${UNICODE_STRESS}`,
  },
  {
    type: "overview",
    title: "Overview",
    bullets: [
      `Damped harmonic oscillator: $${FRAC}$`,
      `Boundary condition: $${FORALL}$`,
      `Unicode check: ${UNICODE_STRESS}`,
    ],
  },
  {
    type: "concept",
    title: "Governing Equation",
    bullets: [
      `The governing ODE is $${FRAC}$.`,
      `Energy relation: $${INTEGRAL}$`,
      `Reaction analogy: ${CHEM}`,
      `Plain unicode bullet: ${UNICODE_STRESS}`,
    ],
  },
  {
    type: "diagram",
    title: "RC Circuit (SVG)",
    diagramRenderType: "svg",
    svgCode: SVG_DIAGRAM,
    diagramCaption: "Simple RC low-pass diagram",
  },
  {
    type: "diagram",
    title: "Fracture Decision Flow (Mermaid)",
    diagramRenderType: "mermaid",
    mermaidCode: MERMAID_DIAGRAM,
    diagramCaption: "Load vs deflection decision flow",
  },
  {
    type: "example",
    title: "Worked Example",
    example: {
      problem: `Find y(t) given $${FRAC}$ and $${FORALL}$. ${UNICODE_STRESS}`,
      steps: [`Apply $${INTEGRAL}$`, `Solve for constants`, `Reaction check ${CHEM}`],
      answer: `$y(t) = A\\cos(\\omega t)$`,
    },
  },
  {
    type: "summary",
    title: "Summary",
    bullets: [`Key formula $${FRAC}$`, `Unicode: ${UNICODE_STRESS}`],
  },
];

const data: PPTSlideJSON = {
  presentationTitle: "AU-EXPORTS Stress Deck",
  subject: "Mechanics of Vibrations",
  topic: "Damped Oscillations",
  slides,
};

async function main() {
  const buffer = await generatePPTXBuffer(data);
  fs.mkdirSync("_audit_exports/out", { recursive: true });
  fs.writeFileSync("_audit_exports/out/ppt_stress.pptx", buffer);
  console.log("wrote _audit_exports/out/ppt_stress.pptx", buffer.length, "bytes");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
