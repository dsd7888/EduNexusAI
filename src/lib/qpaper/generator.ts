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

export type QuestionSource = "fresh" | "pyq_mix" | "pyq_pattern";

export interface QPaperConfig {
  subjectName: string;
  subjectCode: string;
  totalMarks: number;
  duration: number;
  uniquenessMode: "all_new" | "mixed";
  /** Faculty builder: how to blend PYQ style vs fresh questions. */
  questionSource?: QuestionSource;
  sections: SectionConfig[];
  generalInstructions?: string;
}

/** Client-side drag-and-drop builder payload (faculty qpaper page). */
export interface StructuredPart {
  id: string;
  marks: number;
}

export type StructuredQuestionType =
  | "mcq"
  | "truefalse"
  | "short"
  | "long"
  | "numerical";

export interface StructuredQuestion {
  id: string;
  type: StructuredQuestionType;
  parts: StructuredPart[];
}

export interface StructuredSection {
  id: string;
  name: string;
  questions: StructuredQuestion[];
}

function mapStructuredQuestionType(
  t: StructuredQuestionType
): QuestionType {
  if (t === "truefalse") return "true_false";
  return t;
}

/**
 * Maps the interactive paper builder UI into the flat SectionConfig list
 * consumed by {@link buildQPaperPrompt}.
 */
export function structuredSectionsToQPaperConfig(args: {
  subjectName: string;
  subjectCode: string;
  totalMarks: number;
  duration: number;
  questionSource?: QuestionSource;
  generalInstructions?: string;
  sections: StructuredSection[];
}): QPaperConfig {
  const questionSource: QuestionSource = args.questionSource ?? "fresh";
  const uniquenessMode: "all_new" | "mixed" =
    questionSource === "pyq_mix" ? "mixed" : "all_new";

  const sectionConfigs: SectionConfig[] = [];
  const partLabels = "abcdefghijklmnopqrstuvwxyz";

  for (const sec of args.sections) {
    for (const q of sec.questions) {
      if (!q.parts?.length) continue;

      const mappedType = mapStructuredQuestionType(q.type);
      const marks = q.parts.map((p) => p.marks);
      const uniform = marks.every((m) => m === marks[0]);

      let extraInstructions: string | undefined;
      if (marks.length > 1 && !uniform) {
        extraInstructions = `Marks per part: ${marks
          .map((m, i) => `(${partLabels[i]}) ${m}M`)
          .join(", ")}`;
      }

      if (q.parts.length === 1) {
        sectionConfigs.push({
          sectionLabel: sec.name,
          questionType: mappedType,
          numberOfQuestions: 1,
          marksPerQuestion: q.parts[0].marks,
          hasSubQuestions: false,
          instructions: extraInstructions,
        });
      } else {
        sectionConfigs.push({
          sectionLabel: sec.name,
          questionType: mappedType,
          numberOfQuestions: 1,
          marksPerQuestion: marks.reduce((a, b) => a + b, 0),
          hasSubQuestions: true,
          subQuestionsCount: q.parts.length,
          subQuestionsMarks: uniform
            ? marks[0]
            : Math.max(
                1,
                Math.round(marks.reduce((a, b) => a + b, 0) / q.parts.length)
              ),
          instructions: extraInstructions,
        });
      }
    }
  }

  return {
    subjectName: args.subjectName,
    subjectCode: args.subjectCode,
    totalMarks: args.totalMarks,
    duration: args.duration,
    uniquenessMode,
    questionSource,
    sections: sectionConfigs,
    generalInstructions:
      args.generalInstructions ||
      "1. Answer all questions in the answer booklet provided.\n2. Figures to the right indicate full marks.\n3. Assume reasonable data wherever necessary and state assumptions clearly.\n4. Use neat diagrams wherever necessary.",
  };
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
  const questionSource = config.questionSource ?? "fresh";

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
- Question Source: ${questionSource} (fresh = all new from syllabus; pyq_mix = blend PYQ patterns with new; pyq_pattern = new questions written in PYQ style/difficulty)

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
   - If questionSource = 'fresh' (or uniquenessMode = 'all_new' without pyq_mix):
     - Every question must be NEW — conceptually different from any PYQ.
     - Mark isFromPYQ: false for all questions.
   - If questionSource = 'pyq_mix' (uniquenessMode = 'mixed'):
     - Approximately 40% of questions can be inspired by PYQs
       (rephrased or slightly modified), and 60% must be new.
     - Set isFromPYQ = true only when the question is clearly inspired by a PYQ
       (similar structure or numbers), else false.
   - If questionSource = 'pyq_pattern':
     - Every question must be NEW — isFromPYQ: false for all.
     - Still mirror typical PYQ phrasing, difficulty, and mark-weighting using the PYQ context
       (length, style, and topic depth like real papers for this institution).

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
        const optIndentX = MARGIN_LEFT + 16;
        const labels = ["a", "b", "c", "d"] as const;
        ctx = checkNewPage(ctx, LINE_HEIGHT * 5);
        for (let j = 0; j < q.options.length; j++) {
          ctx = checkNewPage(ctx, LINE_HEIGHT * 2);
          const opt = sanitizeForPDF(String(q.options[j] ?? ""));
          ctx.y = drawText(
            ctx.page,
            `    (${labels[j]})  ${opt}`,
            optIndentX,
            ctx.y,
            timesRoman,
            12,
            headerColor,
            PAGE_WIDTH - MARGIN_RIGHT - optIndentX
          );
          ctx.y -= 2;
        }
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

/** AI JSON shape from the new qpaper route prompt (parts-based). */
export interface StructuredPaperPart {
  partLabel?: string;
  type?: string;
  marks: number;
  question: string;
  options?: string[];
  correct_answer?: string;
  solution?: string;
}

export interface StructuredPaperQuestion {
  qNumber: number;
  parts: StructuredPaperPart[];
}

export interface StructuredPaperSection {
  name: string;
  questions: StructuredPaperQuestion[];
}

export interface StructuredPaperData {
  paperTitle?: string;
  sections: StructuredPaperSection[];
}

export async function generateStructuredQPaperPDF(
  paper: StructuredPaperData,
  meta: {
    subjectName: string;
    subjectCode: string;
    totalMarks: number;
    duration: number;
  },
  options?: {
    /** Per-section, per-question attemptAny from client (aligned by index). */
    attemptAnyMatrix?: (number | undefined)[][];
  }
): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  const timesRoman = await pdfDoc.embedFont(StandardFonts.TimesRoman);
  const timesBold = await pdfDoc.embedFont(StandardFonts.TimesRomanBold);
  const timesItalic = await pdfDoc.embedFont(StandardFonts.TimesRomanItalic);
  const mutedColor = rgb(0.35, 0.35, 0.35);
  const lightColor = rgb(0.45, 0.45, 0.45);
  const black = rgb(0, 0, 0);

  const addPage = () => {
    const page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    return { page, y: PAGE_HEIGHT - MARGIN_TOP };
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

  const drawText: DrawTextFn = (page, text, x, y, font, size, color, maxWidth) => {
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

  let ctx = addPage();
  const centerX = PAGE_WIDTH / 2;

  const title = sanitizeForPDF(
    paper.paperTitle ?? `${meta.subjectName} Examination`
  );
  const titleW = timesBold.widthOfTextAtSize(title, 14);
  ctx.page.drawText(title, {
    x: centerX - titleW / 2,
    y: ctx.y,
    size: 14,
    font: timesBold,
    color: black,
  });
  ctx.y -= LINE_HEIGHT;

  ctx.page.drawLine({
    start: { x: MARGIN_LEFT, y: ctx.y },
    end: { x: PAGE_WIDTH - MARGIN_RIGHT, y: ctx.y },
    thickness: 1,
    color: black,
  });
  ctx.y -= LINE_HEIGHT / 2;

  const subjLine = sanitizeForPDF(
    `${meta.subjectName} (${meta.subjectCode})`
  );
  const subjW = timesBold.widthOfTextAtSize(subjLine, 13);
  ctx.page.drawText(subjLine, {
    x: centerX - subjW / 2,
    y: ctx.y,
    size: 13,
    font: timesBold,
    color: black,
  });
  ctx.y -= LINE_HEIGHT;

  const metaLine = sanitizeForPDF(
    `Total Marks: ${meta.totalMarks}    Duration: ${meta.duration} minutes`
  );
  const metaW = timesRoman.widthOfTextAtSize(metaLine, 12);
  ctx.page.drawText(metaLine, {
    x: centerX - metaW / 2,
    y: ctx.y,
    size: 12,
    font: timesRoman,
    color: black,
  });
  ctx.y -= LINE_HEIGHT;

  ctx.page.drawLine({
    start: { x: MARGIN_LEFT, y: ctx.y },
    end: { x: PAGE_WIDTH - MARGIN_RIGHT, y: ctx.y },
    thickness: 1,
    color: black,
  });
  ctx.y -= LINE_HEIGHT * 1.5;

  const attemptAnyMatrix = options?.attemptAnyMatrix;

  for (let sIdx = 0; sIdx < (paper.sections ?? []).length; sIdx++) {
    const section = paper.sections![sIdx];
    ctx = checkNewPage(ctx, LINE_HEIGHT * 6);
    const secTitle = sanitizeForPDF(section.name ?? "Section");
    const secW = timesBold.widthOfTextAtSize(secTitle, 13);
    ctx.page.drawText(secTitle, {
      x: centerX - secW / 2,
      y: ctx.y,
      size: 13,
      font: timesBold,
      color: black,
    });
    ctx.y -= LINE_HEIGHT * 2;

    const questions = section.questions ?? [];
    for (let qIdx = 0; qIdx < questions.length; qIdx++) {
      const question = questions[qIdx];
      ctx = checkNewPage(ctx, LINE_HEIGHT * 6);
      const qn = question.qNumber ?? 0;
      const qHeader = sanitizeForPDF(`Q.${qn}`);
      ctx.page.drawText(qHeader, {
        x: MARGIN_LEFT,
        y: ctx.y,
        size: 12,
        font: timesBold,
        color: black,
      });
      ctx.y -= LINE_HEIGHT * 1.5;

      const parts = question.parts ?? [];
      const multi = parts.length > 1;

      const attemptAny = attemptAnyMatrix?.[sIdx]?.[qIdx];
      if (attemptAny !== undefined && parts.length > 1) {
        const attemptLine = sanitizeForPDF(
          `  (Attempt any ${attemptAny} out of ${parts.length})`
        );
        ctx.page.drawText(attemptLine, {
          x: MARGIN_LEFT,
          y: ctx.y,
          size: 10,
          font: timesItalic,
          color: mutedColor,
        });
        ctx.y -= LINE_HEIGHT * 0.9;
      }

      for (const part of parts) {
        ctx = checkNewPage(ctx, LINE_HEIGHT * 8);
        const startY = ctx.y;
        const qText = multi
          ? `  (${part.partLabel ?? "?"}) ${part.question ?? ""}`
          : `  ${part.question ?? ""}`;
        const indent = MARGIN_LEFT + 8;
        ctx.y = drawText(
          ctx.page,
          qText,
          indent,
          ctx.y,
          timesRoman,
          11,
          black,
          PAGE_WIDTH - MARGIN_RIGHT - indent - 80
        );

        const partTypeNorm = String(part.type ?? "").toLowerCase().replace(/-/g, "_");
        const isTrueFalse =
          partTypeNorm === "truefalse" || partTypeNorm === "true_false";
        const displayOptions =
          isTrueFalse && !(part.options?.length)
            ? ["True", "False"]
            : (part.options ?? []);

        if (displayOptions.length > 0) {
          ctx.y -= 4;
          const optIndent = indent + 8;
          for (const opt of displayOptions) {
            ctx = checkNewPage(ctx, LINE_HEIGHT * 2);
            const o = sanitizeForPDF(String(opt));
            ctx.y = drawText(
              ctx.page,
              o,
              optIndent,
              ctx.y,
              timesRoman,
              10.5,
              mutedColor,
              PAGE_WIDTH - MARGIN_RIGHT - optIndent
            );
            ctx.y -= 4;
          }
        }

        const marks = Number(part.marks) || 0;
        const markStr = `[${marks} Mark${marks > 1 ? "s" : ""}]`;
        const markW = timesRoman.widthOfTextAtSize(markStr, 9);
        ctx.page.drawText(sanitizeForPDF(markStr), {
          x: PAGE_WIDTH - MARGIN_RIGHT - markW,
          y: startY,
          size: 9,
          font: timesRoman,
          color: lightColor,
        });

        ctx.y -= 6;
      }

      ctx.y -= LINE_HEIGHT;
    }

    ctx.y -= LINE_HEIGHT * 2;
  }

  const pages = pdfDoc.getPages();
  pages.forEach((page, idx) => {
    const footerText = sanitizeForPDF(`Page ${idx + 1}`);
    const size = 10;
    const textWidth = timesRoman.widthOfTextAtSize(footerText, size);
    const y = MARGIN_BOTTOM / 2;
    page.drawLine({
      start: { x: MARGIN_LEFT, y: y + LINE_HEIGHT / 2 },
      end: { x: PAGE_WIDTH - MARGIN_RIGHT, y: y + LINE_HEIGHT / 2 },
      thickness: 0.5,
      color: black,
    });
    page.drawText(footerText, {
      x: PAGE_WIDTH - MARGIN_RIGHT - textWidth,
      y,
      size,
      font: timesRoman,
      color: black,
    });
  });

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

export async function generateQPaper(topic: string, options?: Record<string, unknown>) {
  return { questions: [] };
}
