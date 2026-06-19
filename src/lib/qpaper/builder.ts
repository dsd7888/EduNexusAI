import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import type { PDFFont, PDFPage } from "pdf-lib";
import { BLOOMS_LEGEND } from "./templates";

// ── Types for the assembled paper ──────────────────────────────────────────

export interface SubQuestion {
  label: string;
  question: string;
  options?: Record<string, string>;
  correct_option?: "a" | "b" | "c" | "d" | string;
  co?: string | null;
  btl?: number | null;
  po?: string | null;
  /** Set when this sub-part was sourced from the faculty Q Bank (vs AI). */
  from_bank?: boolean;
  /** Source bank question id, when from_bank. */
  bank_id?: string;
  /** Model answer (bank-sourced or faculty-edited); shown in answer-key exports. */
  model_answer?: string | null;
}

export interface QuestionPart {
  label?: string | null;
  question: string;
  marks: number;
  co?: string | null;
  btl?: number | null;
  po?: string | null;
  is_or_alternative?: boolean;
  /** Set when this part was sourced from the faculty Q Bank (vs AI). */
  from_bank?: boolean;
  /** Source bank question id, when from_bank. */
  bank_id?: string;
  /** Model answer (bank-sourced or faculty-edited); shown in answer-key exports. */
  model_answer?: string | null;
}

export interface GeneratedQuestion {
  q_number: number;
  display_label?: string;
  type:
    | "mcq"
    | "descriptive"
    | "descriptive_with_or"
    | "attempt_any_one"
    | string;
  instruction?: string | null;
  total_marks: number;
  attempt_logic?: string | null;
  sub_parts?: SubQuestion[];
  parts?: QuestionPart[];
  /** True when at least one atomic unit of this question came from the Q Bank. */
  from_bank?: boolean;
}

export interface GeneratedSection {
  section_name: string;
  module_range?: [number, number];
  total_marks?: number;
  questions: GeneratedQuestion[];
}

export interface CourseOutcomeRow {
  co_code: string;
  description: string;
}

export interface AssembledPaper {
  paperTitle?: string;
  universityName: string;
  examTitle?: string | null;
  courseCode: string;
  courseName: string;
  date?: string | null;
  duration: number;
  totalMarks: number;
  instructions: string[];
  sections: GeneratedSection[];
  courseOutcomes?: CourseOutcomeRow[];
  hasCoPoData?: boolean;
}

// ── PDF constants ──────────────────────────────────────────────────────────

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const MARGIN_TOP = 50;
const MARGIN_BOTTOM = 50;
const MARGIN_LEFT = 50;
const MARGIN_RIGHT = 50;
const CONTENT_RIGHT = PAGE_WIDTH - MARGIN_RIGHT;

// Right-side column positions to match the PPSU PYQ format.
const COL_MARKS_X = 405;
const COL_CO_X = 450;
const COL_BTL_X = 485;
const COL_PO_X = 520;

const LINE_H = 14;

function sanitize(text: string | null | undefined): string {
  if (!text) return "";
  return String(text)
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
    .replace(/→/g, "->")
    .replace(/←/g, "<-")
    .replace(/↑/g, "^")
    .replace(/↓/g, "v")
    .replace(/•/g, "-")
    .replace(/…/g, "...")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[^\x00-\xFF]/g, "?")
    .replace(/\s+\n/g, "\n")
    .trim();
}

function wrapWords(
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number
): string[] {
  const lines: string[] = [];
  for (const para of text.split(/\n+/)) {
    const words = para.split(/\s+/);
    let line = "";
    for (const w of words) {
      const candidate = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(candidate, size) > maxWidth && line) {
        lines.push(line);
        line = w;
      } else {
        line = candidate;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

interface Ctx {
  doc: PDFDocument;
  page: PDFPage;
  y: number;
  pageNo: number;
  fonts: {
    regular: PDFFont;
    bold: PDFFont;
    italic: PDFFont;
  };
}

function newPage(ctx: Ctx): Ctx {
  ctx.page = ctx.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  ctx.y = PAGE_HEIGHT - MARGIN_TOP;
  ctx.pageNo += 1;
  return ctx;
}

function ensureSpace(ctx: Ctx, needed: number): Ctx {
  if (ctx.y - needed < MARGIN_BOTTOM + 30) {
    return newPage(ctx);
  }
  return ctx;
}

function drawCentered(
  ctx: Ctx,
  text: string,
  size: number,
  font: PDFFont,
  color = rgb(0, 0, 0)
) {
  const safe = sanitize(text);
  if (!safe) return;
  const w = font.widthOfTextAtSize(safe, size);
  ctx.page.drawText(safe, {
    x: (PAGE_WIDTH - w) / 2,
    y: ctx.y,
    size,
    font,
    color,
  });
  ctx.y -= size + 4;
}

function drawLine(ctx: Ctx) {
  ctx.page.drawLine({
    start: { x: MARGIN_LEFT, y: ctx.y },
    end: { x: CONTENT_RIGHT, y: ctx.y },
    thickness: 0.6,
    color: rgb(0, 0, 0),
  });
  ctx.y -= 6;
}

function drawHeader(ctx: Ctx, paper: AssembledPaper) {
  const { bold, regular, italic } = ctx.fonts;
  drawCentered(ctx, paper.universityName, 14, bold);
  if (paper.examTitle) {
    drawCentered(ctx, paper.examTitle, 11, regular);
  }
  drawCentered(
    ctx,
    `${new Date()
      .toLocaleString("en-US", { month: "long" })} ${new Date().getFullYear()}`,
    10,
    italic
  );
  drawCentered(
    ctx,
    `${paper.courseCode} - ${paper.courseName}`,
    12,
    bold
  );
  ctx.y -= 4;

  // Date / Time / Marks row.
  const leftText = sanitize(
    `Date: ${paper.date ?? "______________"}    Time: ${paper.duration} Minutes`
  );
  const rightText = sanitize(`Maximum Marks: ${paper.totalMarks}`);
  ctx.page.drawText(leftText, {
    x: MARGIN_LEFT,
    y: ctx.y,
    size: 10,
    font: regular,
    color: rgb(0, 0, 0),
  });
  const rw = regular.widthOfTextAtSize(rightText, 10);
  ctx.page.drawText(rightText, {
    x: CONTENT_RIGHT - rw,
    y: ctx.y,
    size: 10,
    font: bold,
    color: rgb(0, 0, 0),
  });
  ctx.y -= 14;
  drawLine(ctx);

  // Instructions block.
  ctx.page.drawText("Instructions:", {
    x: MARGIN_LEFT,
    y: ctx.y,
    size: 10,
    font: bold,
    color: rgb(0, 0, 0),
  });
  ctx.y -= 12;
  const instructions = paper.instructions ?? [];
  instructions.forEach((ins, i) => {
    const text = sanitize(`${i + 1}. ${ins}`);
    const lines = wrapWords(
      text,
      regular,
      9.5,
      CONTENT_RIGHT - MARGIN_LEFT - 12
    );
    for (const ln of lines) {
      ctx.page.drawText(ln, {
        x: MARGIN_LEFT + 8,
        y: ctx.y,
        size: 9.5,
        font: regular,
        color: rgb(0, 0, 0),
      });
      ctx.y -= 11;
    }
  });
  ctx.y -= 4;
  drawLine(ctx);
}

function drawColumnHeader(
  ctx: Ctx,
  hasCoPo: boolean,
  options: { showMarks?: boolean } = {}
) {
  if (!hasCoPo) return;
  const { bold } = ctx.fonts;
  const showMarks = options.showMarks ?? true;
  const labels: Array<[number, string]> = [
    [COL_CO_X, "CO"],
    [COL_BTL_X, "BTL"],
    [COL_PO_X, "PO"],
  ];
  if (showMarks) labels.unshift([COL_MARKS_X, "Marks"]);
  for (const [x, label] of labels) {
    const w = bold.widthOfTextAtSize(label, 9);
    ctx.page.drawText(label, {
      x: x - w / 2,
      y: ctx.y,
      size: 9,
      font: bold,
      color: rgb(0, 0, 0),
    });
  }
  ctx.y -= 12;
}

function drawRightCols(
  ctx: Ctx,
  y: number,
  marks: number | null,
  co: string | null | undefined,
  btl: number | null | undefined,
  po: string | null | undefined,
  hasCoPo: boolean
) {
  const { regular } = ctx.fonts;
  if (marks != null) {
    const m = sanitize(`[${String(marks).padStart(2, "0")}]`);
    const mw = regular.widthOfTextAtSize(m, 9.5);
    ctx.page.drawText(m, {
      x: COL_MARKS_X - mw / 2,
      y,
      size: 9.5,
      font: regular,
      color: rgb(0, 0, 0),
    });
  }
  if (!hasCoPo) return;
  const drawCol = (x: number, val: string | null | undefined) => {
    if (val == null || val === "") return;
    const s = sanitize(String(val));
    const w = regular.widthOfTextAtSize(s, 9.5);
    ctx.page.drawText(s, {
      x: x - w / 2,
      y,
      size: 9.5,
      font: regular,
      color: rgb(0, 0, 0),
    });
  };
  drawCol(COL_CO_X, co ?? null);
  drawCol(COL_BTL_X, btl != null ? String(btl) : null);
  drawCol(COL_PO_X, po ?? null);
}

function drawQuestionText(
  ctx: Ctx,
  text: string,
  indentX: number,
  size = 10
): { startY: number } {
  const { regular } = ctx.fonts;
  const startY = ctx.y;
  const maxWidth = COL_MARKS_X - indentX - 12;
  const lines = wrapWords(sanitize(text), regular, size, maxWidth);
  for (const ln of lines) {
    ctx = ensureSpace(ctx, LINE_H);
    ctx.page.drawText(ln, {
      x: indentX,
      y: ctx.y,
      size,
      font: regular,
      color: rgb(0, 0, 0),
    });
    ctx.y -= 12;
  }
  return { startY };
}

function drawMCQRow(ctx: Ctx, q: GeneratedQuestion, hasCoPo: boolean): Ctx {
  const { bold, regular } = ctx.fonts;

  ctx = ensureSpace(ctx, LINE_H * 4);
  const label = sanitize(q.display_label ?? `Q - ${q.q_number}`);
  const instruction = sanitize(q.instruction ?? "");

  // Q label
  ctx.page.drawText(label, {
    x: MARGIN_LEFT,
    y: ctx.y,
    size: 10.5,
    font: bold,
    color: rgb(0, 0, 0),
  });

  // Instruction text inline
  if (instruction) {
    ctx.page.drawText(instruction, {
      x: MARGIN_LEFT + 50,
      y: ctx.y,
      size: 10,
      font: regular,
      color: rgb(0, 0, 0),
    });
  }

  // Top-right column headers + total marks
  drawRightCols(
    ctx,
    ctx.y,
    q.total_marks,
    null,
    null,
    null,
    false
  );
  ctx.y -= 12;
  drawColumnHeader(ctx, hasCoPo, { showMarks: false });

  // Sub-questions
  const subs = q.sub_parts ?? [];
  for (const sub of subs) {
    ctx = ensureSpace(ctx, LINE_H * 4);
    const subText = sanitize(`${sub.label} ${sub.question}`);
    const r = drawQuestionText(ctx, subText, MARGIN_LEFT + 16, 10);
    drawRightCols(ctx, r.startY, null, sub.co, sub.btl, sub.po, hasCoPo);

    // Options (4 per MCQ)
    if (sub.options) {
      const opts = sub.options;
      for (const k of ["a", "b", "c", "d"]) {
        const v = (opts as Record<string, string>)[k];
        if (!v) continue;
        ctx = ensureSpace(ctx, LINE_H);
        const line = sanitize(`${k}) ${v}`);
        const lines = wrapWords(line, regular, 9.5, COL_MARKS_X - MARGIN_LEFT - 36);
        for (const ln of lines) {
          ctx = ensureSpace(ctx, LINE_H);
          ctx.page.drawText(ln, {
            x: MARGIN_LEFT + 36,
            y: ctx.y,
            size: 9.5,
            font: regular,
            color: rgb(0.2, 0.2, 0.2),
          });
          ctx.y -= 11;
        }
      }
    }
    ctx.y -= 4;
  }
  ctx.y -= 6;
  return ctx;
}

function drawSinglePart(
  ctx: Ctx,
  label: string,
  part: QuestionPart,
  hasCoPo: boolean
): Ctx {
  const { bold } = ctx.fonts;
  ctx = ensureSpace(ctx, LINE_H * 4);
  const startY = ctx.y;

  ctx.page.drawText(sanitize(label), {
    x: MARGIN_LEFT,
    y: startY,
    size: 10.5,
    font: bold,
    color: rgb(0, 0, 0),
  });

  const r = drawQuestionText(ctx, part.question, MARGIN_LEFT + 50, 10);
  drawRightCols(ctx, r.startY, part.marks, part.co, part.btl, part.po, hasCoPo);
  ctx.y -= 4;
  return ctx;
}

function wrapPartLabel(raw: string | null | undefined): string {
  if (!raw) return "";
  const cleaned = String(raw).replace(/^\(/, "").replace(/\)$/, "");
  return `(${cleaned})`;
}

function drawDescriptive(
  ctx: Ctx,
  q: GeneratedQuestion,
  hasCoPo: boolean
): Ctx {
  const parts = q.parts ?? [];
  const label = q.display_label ?? `Q - ${q.q_number}`;
  if (parts.length === 1) {
    return drawSinglePart(ctx, label, parts[0], hasCoPo);
  }
  for (const part of parts) {
    const partLabel = part.label
      ? `${label} ${wrapPartLabel(part.label)}`
      : label;
    ctx = drawSinglePart(ctx, partLabel, part, hasCoPo);
  }
  return ctx;
}

function drawDescriptiveWithOr(
  ctx: Ctx,
  q: GeneratedQuestion,
  hasCoPo: boolean
): Ctx {
  const { italic } = ctx.fonts;
  const label = q.display_label ?? `Q - ${q.q_number}`;
  const parts = q.parts ?? [];
  const primary = parts.filter((p) => !p.is_or_alternative);
  const alternatives = parts.filter((p) => p.is_or_alternative);

  for (const part of primary) {
    const partLabel = part.label ? `${label} ${wrapPartLabel(part.label)}` : label;
    ctx = drawSinglePart(ctx, partLabel, part, hasCoPo);
  }

  if (alternatives.length > 0) {
    ctx = ensureSpace(ctx, LINE_H * 2);
    const orText = "OR";
    const w = italic.widthOfTextAtSize(orText, 11);
    ctx.page.drawText(orText, {
      x: (PAGE_WIDTH - w) / 2,
      y: ctx.y,
      size: 11,
      font: italic,
      color: rgb(0, 0, 0),
    });
    ctx.y -= 14;

    for (const part of alternatives) {
      const partLabel = part.label ? `${label} ${wrapPartLabel(part.label)}` : label;
      ctx = drawSinglePart(ctx, partLabel, part, hasCoPo);
    }
  }
  return ctx;
}

function drawAttemptAnyOne(
  ctx: Ctx,
  q: GeneratedQuestion,
  hasCoPo: boolean
): Ctx {
  const { bold, regular } = ctx.fonts;
  ctx = ensureSpace(ctx, LINE_H * 5);
  const label = sanitize(q.display_label ?? `Q - ${q.q_number}`);
  const instruction = sanitize(q.instruction ?? "Attempt any one.");

  ctx.page.drawText(label, {
    x: MARGIN_LEFT,
    y: ctx.y,
    size: 10.5,
    font: bold,
    color: rgb(0, 0, 0),
  });
  ctx.page.drawText(instruction, {
    x: MARGIN_LEFT + 50,
    y: ctx.y,
    size: 10,
    font: regular,
    color: rgb(0, 0, 0),
  });
  drawRightCols(ctx, ctx.y, q.total_marks, null, null, null, false);
  ctx.y -= 14;

  const parts = q.parts ?? [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const rawLabel = part.label ?? `${["i", "ii", "iii", "iv"][i] ?? i + 1}`;
    const partLabel = wrapPartLabel(String(rawLabel));
    ctx = ensureSpace(ctx, LINE_H * 3);
    const startY = ctx.y;
    ctx.page.drawText(sanitize(partLabel), {
      x: MARGIN_LEFT + 16,
      y: startY,
      size: 10,
      font: bold,
      color: rgb(0, 0, 0),
    });
    const r = drawQuestionText(ctx, part.question, MARGIN_LEFT + 50, 10);
    drawRightCols(ctx, r.startY, null, part.co, part.btl, part.po, hasCoPo);
    ctx.y -= 4;
  }
  return ctx;
}

function drawSectionHeader(ctx: Ctx, name: string) {
  const { bold } = ctx.fonts;
  ctx = ensureSpace(ctx, LINE_H * 3);
  const text = sanitize(name.toUpperCase().replace(/SECTION\s*/i, "SECTION - "));
  const w = bold.widthOfTextAtSize(text, 12);
  const x = (PAGE_WIDTH - w) / 2;
  ctx.page.drawText(text, {
    x,
    y: ctx.y,
    size: 12,
    font: bold,
    color: rgb(0, 0, 0),
  });
  // Underline
  ctx.page.drawLine({
    start: { x, y: ctx.y - 2 },
    end: { x: x + w, y: ctx.y - 2 },
    thickness: 0.6,
    color: rgb(0, 0, 0),
  });
  ctx.y -= 18;
}

function drawFooter(ctx: Ctx, paper: AssembledPaper) {
  const { bold, regular } = ctx.fonts;
  ctx = ensureSpace(ctx, LINE_H * 10);
  ctx.y -= 4;
  drawLine(ctx);
  ctx.page.drawText("CO : Course Outcome Number      BTL : Bloom's Taxonomy Level", {
    x: MARGIN_LEFT,
    y: ctx.y,
    size: 9,
    font: bold,
    color: rgb(0, 0, 0),
  });
  ctx.y -= 12;

  // Bloom's taxonomy 6-cell row.
  const cellW = (CONTENT_RIGHT - MARGIN_LEFT) / 6;
  const top = ctx.y;
  const cellH = 18;
  for (let i = 0; i < 6; i++) {
    const x = MARGIN_LEFT + i * cellW;
    ctx.page.drawRectangle({
      x,
      y: top - cellH,
      width: cellW,
      height: cellH,
      borderColor: rgb(0, 0, 0),
      borderWidth: 0.6,
    });
    const item = BLOOMS_LEGEND[i];
    const txt = `${item.level}: ${item.name}`;
    const tw = regular.widthOfTextAtSize(txt, 9);
    ctx.page.drawText(txt, {
      x: x + (cellW - tw) / 2,
      y: top - cellH + 5,
      size: 9,
      font: regular,
      color: rgb(0, 0, 0),
    });
  }
  ctx.y = top - cellH - 14;

  // Course outcome list.
  if (paper.courseOutcomes && paper.courseOutcomes.length > 0) {
    ctx.page.drawText("Course Outcomes:", {
      x: MARGIN_LEFT,
      y: ctx.y,
      size: 9,
      font: bold,
      color: rgb(0, 0, 0),
    });
    ctx.y -= 11;
    for (const co of paper.courseOutcomes) {
      const text = sanitize(`${co.co_code}: ${co.description}`);
      const lines = wrapWords(
        text,
        regular,
        8.5,
        CONTENT_RIGHT - MARGIN_LEFT - 4
      );
      for (const ln of lines) {
        ctx = ensureSpace(ctx, 10);
        ctx.page.drawText(ln, {
          x: MARGIN_LEFT + 4,
          y: ctx.y,
          size: 8.5,
          font: regular,
          color: rgb(0, 0, 0),
        });
        ctx.y -= 10;
      }
    }
  }
  ctx.y -= 6;
  const star = "*******";
  const sw = bold.widthOfTextAtSize(star, 11);
  ctx.page.drawText(star, {
    x: (PAGE_WIDTH - sw) / 2,
    y: ctx.y,
    size: 11,
    font: bold,
    color: rgb(0, 0, 0),
  });
}

// ── Main entrypoint ────────────────────────────────────────────────────────

export async function generatePPSUPaperPDF(
  paper: AssembledPaper
): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.TimesRoman);
  const bold = await doc.embedFont(StandardFonts.TimesRomanBold);
  const italic = await doc.embedFont(StandardFonts.TimesRomanItalic);

  const ctx: Ctx = {
    doc,
    page: doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]),
    y: PAGE_HEIGHT - MARGIN_TOP,
    pageNo: 1,
    fonts: { regular, bold, italic },
  };

  drawHeader(ctx, paper);

  const hasCoPo = paper.hasCoPoData === true;

  for (const section of paper.sections) {
    drawSectionHeader(ctx, section.section_name);
    for (const q of section.questions) {
      const t = (q.type ?? "").toLowerCase();
      if (t === "mcq") {
        drawMCQRow(ctx, q, hasCoPo);
      } else if (t === "descriptive_with_or") {
        drawDescriptiveWithOr(ctx, q, hasCoPo);
      } else if (t === "attempt_any_one") {
        drawAttemptAnyOne(ctx, q, hasCoPo);
      } else {
        drawDescriptive(ctx, q, hasCoPo);
      }
      ctx.y -= 4;
    }
    ctx.y -= 8;
  }

  drawFooter(ctx, paper);

  // Page numbers on every page.
  const pages = doc.getPages();
  pages.forEach((page, idx) => {
    const text = `Page ${idx + 1} of ${pages.length}`;
    const w = regular.widthOfTextAtSize(text, 9);
    page.drawText(text, {
      x: PAGE_WIDTH - MARGIN_RIGHT - w,
      y: 20,
      size: 9,
      font: regular,
      color: rgb(0.3, 0.3, 0.3),
    });
  });

  const bytes = await doc.save();
  return Buffer.from(bytes);
}
