import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

// ── TYPES ──────────────────────────────────────────────────

export type QuestionType =
  | "mcq"
  | "short"
  | "long"
  | "numerical"
  | "true_false"
  | "fill_blank"
  | "custom";

export interface SectionConfig {
  sectionLabel: string;
  questionType: QuestionType;
  customTypeName?: string;
  numberOfQuestions: number;
  marksPerQuestion: number;
  hasSubQuestions: boolean;
  subQuestionsCount?: number;
  subQuestionsMarks?: number;
  instructions?: string;
}

export interface QPaperConfig {
  subjectName: string;
  subjectCode: string;
  totalMarks: number;
  duration: number;
  uniquenessMode: "all_new" | "mixed";
  sections: SectionConfig[];
  generalInstructions?: string;
}

export interface GeneratedQuestion {
  sectionLabel: string;
  questionNumber: string;
  type: QuestionType;
  text: string;
  marks: number;
  options?: string[];
  isFromPYQ: boolean;
  bloomsLevel?: string;
}

export interface GeneratedQPaper {
  title: string;
  subjectName: string;
  subjectCode: string;
  totalMarks: number;
  duration: number;
  generalInstructions: string;
  sections: {
    label: string;
    instructions?: string;
    questions: GeneratedQuestion[];
  }[];
}

// ── PROMPT BUILDERS ────────────────────────────────────────

export function buildQPaperPrompt(options: {
  config: QPaperConfig;
  syllabusContent: string;
  pyqContext: string;
  uniquenessMode: "all_new" | "mixed";
}): string {
  const { config, syllabusContent, pyqContext, uniquenessMode } = options;

  const configJson = JSON.stringify(config.sections, null, 2);

  return `You are an expert university examiner for ${config.subjectName} (${config.subjectCode}).

SYLLABUS CONTENT:
${syllabusContent}

PAST YEAR QUESTION (PYQ) STYLE CONTEXT:
${pyqContext}

EXAM CONFIGURATION:
- Total Marks: ${config.totalMarks}
- Duration: ${config.duration} minutes
- Uniqueness Mode: ${uniquenessMode}

SECTION STRUCTURE (READ CAREFULLY AND MATCH EXACTLY):
The paper has these sections (this is the authoritative structure):
${configJson}

Each SectionConfig row means:
- sectionLabel: label for the section (e.g. "Section A", "Part I", "Q1")
- questionType: one of 'mcq' | 'short' | 'long' | 'numerical' | 'true_false' | 'fill_blank' | 'custom'
- customTypeName: if questionType = 'custom', give the custom style (e.g. "case-study")
- numberOfQuestions: exactly how many questions to generate for this section
- marksPerQuestion: marks for each main question in this section
- hasSubQuestions: if true, the main question will have sub-questions
- subQuestionsCount: number of sub-questions, if hasSubQuestions is true
- subQuestionsMarks: marks per sub-question, if hasSubQuestions is true
- instructions: section-specific instructions (e.g. "Attempt any 3 out of 5")

TASK:
1. Study the PYQ context carefully to understand:
   - The university's question style and language
   - Difficulty distribution across marks
   - Common topic coverage patterns
   - How questions are phrased for this specific institution

2. Generate questions for each section as defined in config.sections:
   - Match EXACTLY the numberOfQuestions per section.
   - Match EXACTLY the marksPerQuestion for each main question.
   - Ensure the questionType per section is followed strictly.
   - If hasSubQuestions is true:
     - Create sub-questions (a), (b), (c)... based on subQuestionsCount.
     - Each sub-question must have subQuestionsMarks marks.
     - Use questionNumber like "Q2a", "Q2b" etc. for sub-questions.

3. Uniqueness rules:
   - If uniquenessMode = 'all_new':
     - Every question must be NEW — conceptually different from any PYQ.
     - Mark isFromPYQ: false for all questions.
   - If uniquenessMode = 'mixed':
     - Approximately 40% of questions can be inspired by PYQs
       (rephrased or slightly modified), and 60% must be new.
     - Set isFromPYQ = true only when the question is clearly inspired by a PYQ
       (similar structure or numbers), else false.

4. Quality rules:
   - All questions must be answerable from the syllabus content.
   - Difficulty must correlate with marks:
     - 2-mark questions: simple recall / basic understanding.
     - 3–5 mark questions: application / short derivations / short numericals.
     - 10-mark questions: analysis, synthesis, or complex multi-step problems.
   - Numerical problems:
     - Use clean, solvable numbers with a unique, well-defined answer.
   - MCQ questions:
     - Must have exactly 4 options.
     - Only one option is clearly correct.
     - Options should be plausible, not trivial.
   - Fill-in-the-blank:
     - Use ___ in place of the missing term or value.
   - Long answer (10M):
     - Should imply a complex, multi-part expected answer
       (even if you do not list the marking scheme).
   - Bloom's taxonomy:
     - Assign bloomsLevel per question such as "remember", "understand",
       "apply", "analyze", "evaluate", "create".

5. OUTPUT FORMAT:
Return ONLY a valid JSON object matching this TypeScript type exactly. No markdown. No backticks. No extra commentary.
{
  "title": "string",
  "subjectName": "string",
  "subjectCode": "string", 
  "totalMarks": number,
  "duration": number,
  "generalInstructions": "string with standard exam instructions",
  "sections": [
    {
      "label": "Section A",
      "instructions": "Attempt all questions",
      "questions": [
        {
          "sectionLabel": "Section A",
          "questionNumber": "Q1",
          "type": "mcq",
          "text": "question text here",
          "marks": 2,
          "options": ["A. ...", "B. ...", "C. ...", "D. ..."],
          "isFromPYQ": false,
          "bloomsLevel": "remember"
        }
      ]
    }
  ]
}`;
}

export function buildPYQContextPrompt(pyqTexts: string[]): string {
  const joined = pyqTexts.join("\n\n");
  return `You are analyzing a set of past year question papers (PYQs).

Here are raw excerpts from PYQs:
${joined}

TASK:
- Summarize the exam style in clear bullet-point-like sentences.
- Focus on:
  - Typical question patterns and phrasing.
  - Common topics and how frequently they appear.
  - Marks distribution trends (how many marks per type of question).
  - Any noticeable style for numericals vs theory questions.

OUTPUT:
Return a concise plain text summary (no JSON, no markdown, no bullet characters),
just 5–10 sentences separated by newlines, that captures the \"style\" of these PYQs.`;
}

// ── PARSERS ────────────────────────────────────────────────

export function parseQPaperResponse(rawText: string): GeneratedQPaper | null {
  try {
    let cleaned = rawText.trim();
    cleaned = cleaned
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
    const first = cleaned.indexOf("{");
    const last = cleaned.lastIndexOf("}");
    if (first === -1 || last === -1) return null;
    cleaned = cleaned.slice(first, last + 1);
    const parsed = JSON.parse(cleaned) as GeneratedQPaper;
    if (!parsed.sections || !Array.isArray(parsed.sections)) return null;
    return parsed;
  } catch (err) {
    console.error("[parseQPaper] Parse error:", err);
    return null;
  }
}

// ── PDF GENERATOR ──────────────────────────────────────────

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const MARGIN_TOP = 60;
const MARGIN_BOTTOM = 60;
const MARGIN_LEFT = 60;
const MARGIN_RIGHT = 60;
const LINE_HEIGHT = 20;

type DrawTextFn = (
  page: any,
  text: string,
  x: number,
  y: number,
  font: any,
  size: number,
  color: ReturnType<typeof rgb>,
  maxWidth?: number
) => number;

function sanitizeForPDF(text: string): string {
  if (!text) return "";
  return text
    // Greek letters (common in engineering/science)
    .replace(/ρ/g, "rho")
    .replace(/μ/g, "mu")
    .replace(/σ/g, "sigma")
    .replace(/τ/g, "tau")
    .replace(/η/g, "eta")
    .replace(/θ/g, "theta")
    .replace(/α/g, "alpha")
    .replace(/β/g, "beta")
    .replace(/γ/g, "gamma")
    .replace(/δ/g, "delta")
    .replace(/λ/g, "lambda")
    .replace(/π/g, "pi")
    .replace(/ω/g, "omega")
    .replace(/Δ/g, "Delta")
    .replace(/Σ/g, "Sigma")
    .replace(/Ω/g, "Omega")
    // Math symbols
    .replace(/×/g, "x")
    .replace(/÷/g, "/")
    .replace(/≈/g, "~=")
    .replace(/≠/g, "!=")
    .replace(/≤/g, "<=")
    .replace(/≥/g, ">=")
    .replace(/²/g, "^2")
    .replace(/³/g, "^3")
    .replace(/√/g, "sqrt")
    .replace(/∞/g, "infinity")
    .replace(/∑/g, "sum")
    .replace(/∫/g, "integral")
    .replace(/∂/g, "d")
    .replace(/°/g, " deg")
    // Arrows and special chars
    .replace(/→/g, "->")
    .replace(/←/g, "<-")
    .replace(/↑/g, "^")
    .replace(/↓/g, "v")
    .replace(/•/g, "-")
    .replace(/…/g, "...")
    // Quotes
    .replace(/"/g, '"')
    .replace(/"/g, '"')
    .replace(/'/g, "'")
    .replace(/'/g, "'")
    // Remove any remaining non-WinAnsi characters
    .replace(/[^\x00-\xFF]/g, "?")
    .trim();
}

export async function generateQPaperPDF(
  paper: GeneratedQPaper
): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  const timesRoman = await pdfDoc.embedFont(StandardFonts.TimesRoman);
  const timesBold = await pdfDoc.embedFont(StandardFonts.TimesRomanBold);
  const timesItalic = await pdfDoc.embedFont(StandardFonts.TimesRomanItalic);

  const addPage = () => {
    const page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    const yStart = PAGE_HEIGHT - MARGIN_TOP;
    return { page, y: yStart };
  };

  const checkNewPage = (
    current: { page: any; y: number },
    needed: number
  ) => {
    if (current.y - needed < MARGIN_BOTTOM) {
      return addPage();
    }
    return current;
  };

  const drawText: DrawTextFn = (
    page,
    text,
    x,
    y,
    font,
    size,
    color,
    maxWidth
  ) => {
    const safe = sanitizeForPDF(text);
    if (!safe) return y;
    const words = safe.split(/\s+/);
    let line = "";
    let currentY = y;
    const availableWidth = maxWidth ?? PAGE_WIDTH - MARGIN_LEFT - MARGIN_RIGHT;

    for (const word of words) {
      const testLine = line ? `${line} ${word}` : word;
      const testWidth = font.widthOfTextAtSize(testLine, size);
      if (testWidth > availableWidth && line) {
        page.drawText(line, { x, y: currentY, size, font, color });
        currentY -= LINE_HEIGHT;
        line = word;
      } else {
        line = testLine;
      }
    }
    if (line) {
      page.drawText(line, { x, y: currentY, size, font, color });
      currentY -= LINE_HEIGHT;
    }
    return currentY;
  };

  // Start first page
  let ctx = addPage();

  // PAGE 1 HEADER
  const centerX = PAGE_WIDTH / 2;
  const headerColor = rgb(0, 0, 0);

  // University name placeholder
  const uniTitle = sanitizeForPDF("UNIVERSITY EXAMINATION");
  const uniWidth = timesBold.widthOfTextAtSize(uniTitle, 14);
  ctx.page.drawText(uniTitle, {
    x: centerX - uniWidth / 2,
    y: ctx.y,
    size: 14,
    font: timesBold,
    color: headerColor,
  });
  ctx.y -= LINE_HEIGHT;

  // Horizontal line
  ctx.page.drawLine({
    start: { x: MARGIN_LEFT, y: ctx.y },
    end: { x: PAGE_WIDTH - MARGIN_RIGHT, y: ctx.y },
    thickness: 1,
    color: headerColor,
  });
  ctx.y -= LINE_HEIGHT / 2;

  // Subject line
  const subjLine = sanitizeForPDF(
    `${paper.subjectName} (${paper.subjectCode})`
  );
  const subjWidth = timesBold.widthOfTextAtSize(subjLine, 13);
  ctx.page.drawText(subjLine, {
    x: centerX - subjWidth / 2,
    y: ctx.y,
    size: 13,
    font: timesBold,
    color: headerColor,
  });
  ctx.y -= LINE_HEIGHT;

  const metaLine = sanitizeForPDF(
    `Total Marks: ${paper.totalMarks}    Duration: ${paper.duration} minutes`
  );
  const metaWidth = timesRoman.widthOfTextAtSize(metaLine, 12);
  ctx.page.drawText(metaLine, {
    x: centerX - metaWidth / 2,
    y: ctx.y,
    size: 12,
    font: timesRoman,
    color: headerColor,
  });
  ctx.y -= LINE_HEIGHT;

  // Horizontal line
  ctx.page.drawLine({
    start: { x: MARGIN_LEFT, y: ctx.y },
    end: { x: PAGE_WIDTH - MARGIN_RIGHT, y: ctx.y },
    thickness: 1,
    color: headerColor,
  });
  ctx.y -= LINE_HEIGHT;

  // GENERAL INSTRUCTIONS
  ctx = checkNewPage(ctx, LINE_HEIGHT * 4);
  ctx.page.drawText("General Instructions:", {
    x: MARGIN_LEFT,
    y: ctx.y,
    size: 12,
    font: timesBold,
    color: headerColor,
  });
  ctx.y -= LINE_HEIGHT;

  const instructionsText = paper.generalInstructions || "";
  const instructionsLines = instructionsText
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);

  instructionsLines.forEach((line, idx) => {
    ctx = checkNewPage(ctx, LINE_HEIGHT * 2);
    const numbered = `${idx + 1}. ${line}`;
    ctx.y = drawText(
      ctx.page,
      numbered,
      MARGIN_LEFT + 10,
      ctx.y,
      timesRoman,
      11,
      headerColor,
      PAGE_WIDTH - MARGIN_LEFT - MARGIN_RIGHT - 20
    );
  });

  ctx.y -= LINE_HEIGHT / 2;

  // SECTIONS
  for (const section of paper.sections) {
    // Section header
    ctx = checkNewPage(ctx, LINE_HEIGHT * 4);
    const sectionTitle = sanitizeForPDF(`--- ${section.label} ---`);
    const secWidth = timesBold.widthOfTextAtSize(sectionTitle, 13);
    ctx.page.drawText(sectionTitle, {
      x: centerX - secWidth / 2,
      y: ctx.y,
      size: 13,
      font: timesBold,
      color: headerColor,
    });
    ctx.y -= LINE_HEIGHT;

    if (section.instructions) {
      const safeInst = sanitizeForPDF(section.instructions);
      const instWidth = timesItalic.widthOfTextAtSize(safeInst, 11);
      ctx.page.drawText(safeInst, {
        x: centerX - instWidth / 2,
        y: ctx.y,
        size: 11,
        font: timesItalic,
        color: headerColor,
      });
      ctx.y -= LINE_HEIGHT;
    }

    ctx.y -= LINE_HEIGHT / 2;

    for (const q of section.questions) {
      ctx = checkNewPage(ctx, LINE_HEIGHT * 4);

      const qPrefix = sanitizeForPDF(`${q.questionNumber}. `);
      const marksSuffix = sanitizeForPDF(` [${q.marks} Marks]`);
      const boldWidth = timesBold.widthOfTextAtSize(
        qPrefix + marksSuffix,
        12
      );

      // Draw question number and marks in bold, then text in regular
      const startX = MARGIN_LEFT;
      const questionTextX = startX + timesBold.widthOfTextAtSize(
        qPrefix,
        12
      );

      ctx.page.drawText(qPrefix, {
        x: startX,
        y: ctx.y,
        size: 12,
        font: timesBold,
        color: headerColor,
      });

      const textWidthAvailable =
        PAGE_WIDTH - MARGIN_RIGHT - questionTextX - marksSuffix.length * 3;

      // Draw main question text
      const originalY = ctx.y;
      const qText = sanitizeForPDF(q.text);
      ctx.y = drawText(
        ctx.page,
        qText,
        questionTextX,
        ctx.y,
        timesRoman,
        12,
        headerColor,
        textWidthAvailable
      );

      // Draw marks suffix at end of first line
      ctx.page.drawText(marksSuffix, {
        x: startX + boldWidth - timesBold.widthOfTextAtSize(marksSuffix, 12),
        y: originalY,
        size: 12,
        font: timesBold,
        color: headerColor,
      });

      ctx.y -= 4;

      // MCQ options
      if (q.type === "mcq" && q.options && q.options.length === 4) {
        const optIndentX = MARGIN_LEFT + 20;
        const [rawA, rawB, rawC, rawD] = q.options;
        const a = sanitizeForPDF(rawA);
        const b = sanitizeForPDF(rawB);
        const c = sanitizeForPDF(rawC);
        const d = sanitizeForPDF(rawD);
        ctx = checkNewPage(ctx, LINE_HEIGHT * 3);
        ctx.y = drawText(
          ctx.page,
          `(a) ${a}    (b) ${b}`,
          optIndentX,
          ctx.y,
          timesRoman,
          12,
          headerColor,
          PAGE_WIDTH - MARGIN_RIGHT - optIndentX
        );
        ctx.y = drawText(
          ctx.page,
          `(c) ${c}    (d) ${d}`,
          optIndentX,
          ctx.y,
          timesRoman,
          12,
          headerColor,
          PAGE_WIDTH - MARGIN_RIGHT - optIndentX
        );
      }

      ctx.y -= 8;
    }

    ctx.y -= 15;
  }

  // FOOTERS: add page numbers
  const pages = pdfDoc.getPages();
  pages.forEach((page, idx) => {
    const footerText = sanitizeForPDF(`Page ${idx + 1}`);
    const size = 10;
    const textWidth = timesRoman.widthOfTextAtSize(footerText, size);
    const y = MARGIN_BOTTOM / 2;

    // thin line above footer
    page.drawLine({
      start: { x: MARGIN_LEFT, y: y + LINE_HEIGHT / 2 },
      end: { x: PAGE_WIDTH - MARGIN_RIGHT, y: y + LINE_HEIGHT / 2 },
      thickness: 0.5,
      color: headerColor,
    });

    page.drawText(footerText, {
      x: PAGE_WIDTH - MARGIN_RIGHT - textWidth,
      y,
      size,
      font: timesRoman,
      color: headerColor,
    });
  });

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

export async function generateQPaper(topic: string, options?: Record<string, unknown>) {
  return { questions: [] };
}
