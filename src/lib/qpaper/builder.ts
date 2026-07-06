import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import type { PDFFont, PDFImage, PDFPage } from "pdf-lib";
import { imageDisplaySize, type PaperImageMap } from "./qpaperImages";
import { BLOOMS_LEGEND } from "./templates";
import type { PoolItem } from "./templates";
import { isPoolItemMcqLike } from "./templates";
import {
  poolAttemptCount,
  poolItemLabel,
  poolItemToPart,
  poolItemToSubQuestion,
  poolMarksPerItem,
} from "./poolRender";
import { parseMarkdownLite, type Segment } from "@/lib/text/markdownLite";
import type { TagValidation } from "./validateTags";

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
  /** Storage path of an attached image (bank-sourced); used by PDF/Word export. */
  image_path?: string | null;
  /** Signed URL for the attached image; minted server-side for the web preview. */
  image_url?: string | null;
  /** CO/BTL tag-validation verdict; present only on a genuine mismatch. */
  validation?: TagValidation;
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
  /** Storage path of an attached image (bank-sourced); used by PDF/Word export. */
  image_path?: string | null;
  /** Signed URL for the attached image; minted server-side for the web preview. */
  image_url?: string | null;
  /** CO/BTL tag-validation verdict; present only on a genuine mismatch. */
  validation?: TagValidation;
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
  /** Populated on pool blocks after generation. */
  items?: PoolItem[];
  /**
   * Explicit slot key hint. Normal paper questions leave this unset and the
   * answer-key AI derives "Q<q_number>". Set only on the synthetic per-item
   * questions the answer-key pipeline builds when decomposing a pool block,
   * so each item carries its own "Q<n>_i" / "Q<n>_ii" key through generation.
   */
  slotKey?: string;
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
  /** When true: section headers are suppressed and questions are numbered Q-1, Q-2 … globally. */
  flatLayout?: boolean;
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
/** Full-width rule stroke — shared with bordered blocks and tables. */
const RULE_WEIGHT = 0.6;
/** Gap after a header-area rule (was 6pt; matches the date-row lead-in of 14pt). */
const RULE_GAP_AFTER = LINE_H;
/** Inner padding for bordered blocks — same 12pt drop the old title→list used. */
const BOX_PAD = 12;
/** Title-to-body gap inside a block (preview `mb-1`, half of BOX_PAD). */
const TITLE_LIST_GAP = 8;
/** Space after a completed question block (main loop 4pt + MCQ tail 6pt). */
const QUESTION_BLOCK_GAP = 10;
/** Wrapped instruction-list row step. */
const INSTRUCTION_LINE_H = 11;

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

/** A question image already embedded into the document, with its natural size. */
interface EmbeddedPdfImage {
  img: PDFImage;
  width: number;
  height: number;
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
  /** Question images embedded up-front, keyed by storage path (may be empty). */
  images: Map<string, EmbeddedPdfImage>;
}

/**
 * True when any atomic unit of the paper carries a CO, BTL, or PO tag.
 *
 * The on-screen preview renders these badges per-question, gated only on the
 * individual value being present — never on `hasCoPoData`. The PDF must use the
 * same rule, or papers whose questions are tagged but whose subject lacks
 * populated `course_outcomes` / `co_po_mapping` rows would silently lose the
 * CO/BTL/PO columns the preview clearly shows. (See builder gate at line ~933.)
 */
function paperHasTagData(paper: AssembledPaper): boolean {
  const tagged = (u: {
    co?: string | null;
    btl?: number | null;
    po?: string | null;
  }) =>
    (u.co != null && u.co !== "") ||
    u.btl != null ||
    (u.po != null && u.po !== "");
  for (const section of paper.sections) {
    for (const q of section.questions) {
      if ((q.sub_parts ?? []).some(tagged)) return true;
      if ((q.parts ?? []).some(tagged)) return true;
      if ((q.items ?? []).some(tagged)) return true;
    }
  }
  return false;
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

function drawLine(ctx: Ctx, gapAfter = 6) {
  ctx.page.drawLine({
    start: { x: MARGIN_LEFT, y: ctx.y },
    end: { x: CONTENT_RIGHT, y: ctx.y },
    thickness: RULE_WEIGHT,
    color: rgb(0, 0, 0),
  });
  ctx.y -= gapAfter;
}

/** Full-width rule with explicit lead-in / follow-on gaps (header + MCQ headers). */
function drawHorizontalRule(
  ctx: Ctx,
  gapBefore = 0,
  gapAfter: number = RULE_GAP_AFTER
) {
  ctx.y -= gapBefore;
  drawLine(ctx, gapAfter);
}

function drawHeader(ctx: Ctx, paper: AssembledPaper) {
  const { bold, regular } = ctx.fonts;
  drawCentered(ctx, paper.universityName, 14, bold);
  if (paper.examTitle) {
    drawCentered(ctx, paper.examTitle, 11, regular);
  }
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
  ctx.y -= LINE_H;
  drawHorizontalRule(ctx);

  // Instructions — fully bordered box (matches on-screen preview `border p-3`).
  const instructions = paper.instructions ?? [];
  const boxW = CONTENT_RIGHT - MARGIN_LEFT;
  const listSize = 9.5;
  const listIndent = 8;
  const listMaxW = boxW - BOX_PAD * 2 - listIndent;
  const titleSize = 10;

  const listLineGroups = instructions.map((ins, i) =>
    wrapWords(sanitize(`${i + 1}. ${ins}`), regular, listSize, listMaxW)
  );
  const titleBlockH = titleSize + TITLE_LIST_GAP;
  const listH = listLineGroups.reduce(
    (sum, lines) => sum + lines.length * INSTRUCTION_LINE_H,
    0
  );
  const boxH = BOX_PAD + titleBlockH + listH + BOX_PAD;

  ensureSpace(ctx, boxH + QUESTION_BLOCK_GAP);
  const boxTop = ctx.y;
  const boxBottom = boxTop - boxH;

  ctx.page.drawRectangle({
    x: MARGIN_LEFT,
    y: boxBottom,
    width: boxW,
    height: boxH,
    borderColor: rgb(0, 0, 0),
    borderWidth: RULE_WEIGHT,
  });

  let ty = boxTop - BOX_PAD;
  ctx.page.drawText("Instructions:", {
    x: MARGIN_LEFT + BOX_PAD,
    y: ty - titleSize,
    size: titleSize,
    font: bold,
    color: rgb(0, 0, 0),
  });
  ty -= titleBlockH;

  for (const lines of listLineGroups) {
    for (const ln of lines) {
      ctx.page.drawText(ln, {
        x: MARGIN_LEFT + BOX_PAD + listIndent,
        y: ty - listSize,
        size: listSize,
        font: regular,
        color: rgb(0, 0, 0),
      });
      ty -= INSTRUCTION_LINE_H;
    }
  }

  ctx.y = boxBottom - QUESTION_BLOCK_GAP;
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

// Plain wrapped-text run: the original drawQuestionText body, unchanged. Shared
// by drawQuestionText (text segments) so the no-markdown path is byte-identical
// to before this file learned about tables/lists.
function drawTextLines(
  ctx: Ctx,
  text: string,
  indentX: number,
  size: number
) {
  const { regular } = ctx.fonts;
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
}

// Bordered, even-column table ported from pdf/builder.ts drawTable() into this
// engine's bottom-anchored ctx/cursor model: shaded+bold header row, wrapped
// cell text, whole-table page-break when it would otherwise be split, and a
// per-row break with header repeat for tables taller than a page.
function drawMarkdownTable(
  ctx: Ctx,
  headers: string[],
  rows: string[][],
  indentX: number,
  baseSize: number
) {
  const { regular, bold } = ctx.fonts;
  const size = Math.min(baseSize, 9.5);
  const x0 = indentX;
  const tableW = COL_MARKS_X - indentX - 12;
  const nCols = Math.max(1, headers.length);
  const colW = tableW / nCols;
  const padX = 4;
  const padY = 3;
  const lineH = size * 1.25;
  const innerW = colW - padX * 2;
  const bottomLimit = MARGIN_BOTTOM + 30; // matches ensureSpace's threshold
  const pageTopY = PAGE_HEIGHT - MARGIN_TOP;

  const cellLines = (txt: string, font: PDFFont) =>
    wrapWords(sanitize(txt), font, size, innerW);
  const rowHeight = (cells: string[], font: PDFFont) => {
    let maxLines = 1;
    for (let c = 0; c < nCols; c++) {
      const ls = cellLines(cells[c] ?? "", font);
      if (ls.length > maxLines) maxLines = ls.length;
    }
    return maxLines * lineH + padY * 2;
  };

  const headerH = rowHeight(headers, bold);
  const totalH =
    headerH + rows.reduce((s, r) => s + rowHeight(r, regular), 0);

  // If the whole table fits on a fresh page but not in the space left here,
  // push it to a new page rather than letting it split.
  const remaining = ctx.y - bottomLimit;
  const pageInnerH = pageTopY - bottomLimit;
  if (totalH > remaining && totalH <= pageInnerH) {
    newPage(ctx);
  }

  const drawRow = (cells: string[], font: PDFFont, fill: boolean) => {
    const h = rowHeight(cells, font);
    // Over-long table: break between rows, repeating the header on each page.
    // (Guarded so a single row taller than a page can't loop forever.)
    if (ctx.y - h < bottomLimit && ctx.y < pageTopY) {
      newPage(ctx);
      if (!fill) drawRow(headers, bold, true);
    }
    const topY = ctx.y;
    for (let c = 0; c < nCols; c++) {
      const cx = x0 + c * colW;
      ctx.page.drawRectangle({
        x: cx,
        y: topY - h,
        width: colW,
        height: h,
        color: fill ? rgb(0.93, 0.93, 0.93) : rgb(1, 1, 1),
        borderColor: rgb(0.4, 0.4, 0.4),
        borderWidth: 0.5,
      });
      let ty = topY - padY - size;
      for (const ln of cellLines(cells[c] ?? "", font)) {
        ctx.page.drawText(ln, {
          x: cx + padX,
          y: ty,
          size,
          font,
          color: rgb(0, 0, 0),
        });
        ty -= lineH;
      }
    }
    ctx.y = topY - h;
  };

  ctx.y -= 2; // small gap before the table
  drawRow(headers, bold, true);
  for (const r of rows) drawRow(r, regular, false);
  // Drop a full line below the bottom border: text draws upward from its
  // baseline, so a baseline just under the border would overlap the table.
  ctx.y -= size + 6;
}

// Bullet / numbered list with a marker column and hanging indent, in the same
// cursor model as drawTextLines.
function drawMarkdownList(
  ctx: Ctx,
  seg: Extract<Segment, { type: "list" }>,
  indentX: number,
  size: number
) {
  const { regular, bold } = ctx.fonts;
  const markerW = 16;
  const textX = indentX + markerW;
  const maxWidth = COL_MARKS_X - textX - 12;
  seg.items.forEach((item, i) => {
    const lines = wrapWords(sanitize(item), regular, size, maxWidth);
    if (lines.length === 0) lines.push("");
    ctx = ensureSpace(ctx, LINE_H);
    ctx.page.drawText(seg.ordered ? `${i + 1}.` : "-", {
      x: indentX + 4,
      y: ctx.y,
      size,
      font: bold,
      color: rgb(0, 0, 0),
    });
    lines.forEach((ln, li) => {
      if (li > 0) ctx = ensureSpace(ctx, LINE_H);
      ctx.page.drawText(ln, {
        x: textX,
        y: ctx.y,
        size,
        font: regular,
        color: rgb(0, 0, 0),
      });
      ctx.y -= 12;
    });
  });
}

function drawQuestionText(
  ctx: Ctx,
  text: string,
  indentX: number,
  size = 10
): { startY: number } {
  const startY = ctx.y;
  const segments = parseMarkdownLite(text ?? "");
  // Common case (no embedded table/list): behave exactly as before.
  if (!segments.some((s) => s.type !== "text")) {
    drawTextLines(ctx, text ?? "", indentX, size);
    return { startY };
  }
  for (const seg of segments) {
    if (seg.type === "table") {
      drawMarkdownTable(ctx, seg.headers, seg.rows, indentX, size);
    } else if (seg.type === "list") {
      drawMarkdownList(ctx, seg, indentX, size);
    } else {
      drawTextLines(ctx, seg.content, indentX, size);
    }
  }
  return { startY };
}

/**
 * Draw a question's attached image (bank-sourced) below its text, scaled by the
 * shared sizing rule so it matches the Word export. Page-breaks before drawing
 * when it would overflow — the same overflow strategy ensureSpace uses
 * everywhere else. No-op when the unit has no image or it wasn't embeddable.
 */
function drawUnitImage(
  ctx: Ctx,
  unit: { image_path?: string | null },
  indentX: number
): Ctx {
  const path = unit.image_path;
  if (!path) return ctx;
  const entry = ctx.images.get(path);
  if (!entry) return ctx;
  const { width, height } = imageDisplaySize(entry.width, entry.height);
  ctx.y -= 4;
  ctx = ensureSpace(ctx, height + 6);
  ctx.page.drawImage(entry.img, {
    x: indentX,
    y: ctx.y - height,
    width,
    height,
  });
  ctx.y -= height + 6;
  return ctx;
}

/** One MCQ / true-false sub-row (label + text + CO/BTL/PO + optional options). */
function drawTaggedSubRow(ctx: Ctx, sub: SubQuestion, hasCoPo: boolean): Ctx {
  ctx = ensureSpace(ctx, LINE_H * 4);
  const subText = sanitize(`${sub.label} ${sub.question}`);
  const r = drawQuestionText(ctx, subText, MARGIN_LEFT + 16, 10);
  drawRightCols(ctx, r.startY, null, sub.co, sub.btl, sub.po, hasCoPo);
  ctx = drawUnitImage(ctx, sub, MARGIN_LEFT + 16);

  if (sub.options) {
    const opts = sub.options;
    const { regular } = ctx.fonts;
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
  return ctx;
}

/** One attempt-any / pool descriptive option row (roman label + text + CO/BTL/PO). */
function drawTaggedOptionRow(
  ctx: Ctx,
  part: QuestionPart,
  partLabel: string,
  hasCoPo: boolean
): Ctx {
  const { bold } = ctx.fonts;
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
  ctx = drawUnitImage(ctx, part, MARGIN_LEFT + 50);
  ctx.y -= 4;
  return ctx;
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
      maxWidth: COL_MARKS_X - (MARGIN_LEFT + 50) - 12,
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
  drawColumnHeader(ctx, hasCoPo, { showMarks: false });

  for (const sub of q.sub_parts ?? []) {
    ctx = drawTaggedSubRow(ctx, sub, hasCoPo);
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
  ctx = drawUnitImage(ctx, part, MARGIN_LEFT + 50);
  ctx.y -= 4;
  return ctx;
}

/**
 * Draw a question-level instruction note (e.g. "Answer any two parts") above
 * the parts. The preview shows `q.instruction` in the header of every question
 * type; the MCQ and attempt-any-one PDF paths already render it, so this covers
 * the descriptive paths that otherwise dropped it silently.
 */
function drawQuestionInstruction(ctx: Ctx, instruction: string | null | undefined): Ctx {
  const text = sanitize(instruction ?? "");
  if (!text) return ctx;
  const { italic } = ctx.fonts;
  const lines = wrapWords(text, italic, 9.5, CONTENT_RIGHT - MARGIN_LEFT);
  for (const ln of lines) {
    ctx = ensureSpace(ctx, LINE_H);
    ctx.page.drawText(ln, {
      x: MARGIN_LEFT,
      y: ctx.y,
      size: 9.5,
      font: italic,
      color: rgb(0, 0, 0),
    });
    ctx.y -= 12;
  }
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
  ctx = drawQuestionInstruction(ctx, q.instruction);
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
  ctx = drawQuestionInstruction(ctx, q.instruction);
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
    maxWidth: COL_MARKS_X - (MARGIN_LEFT + 50) - 12,
  });
  drawRightCols(ctx, ctx.y, q.total_marks, null, null, null, false);

  for (let i = 0; i < (q.parts ?? []).length; i++) {
    const part = q.parts![i];
    const rawLabel = part.label ?? poolItemLabel(i);
    ctx = drawTaggedOptionRow(ctx, part, wrapPartLabel(String(rawLabel)), hasCoPo);
  }
  return ctx;
}

function drawPool(ctx: Ctx, q: GeneratedQuestion, hasCoPo: boolean): Ctx {
  const { bold, regular } = ctx.fonts;
  ctx = ensureSpace(ctx, LINE_H * 5);
  const label = sanitize(q.display_label ?? `Q - ${q.q_number}`);
  const instruction = sanitize(
    q.instruction ?? `Attempt any ${poolAttemptCount(q)} of the following ${q.items?.length ?? 0} questions.`
  );

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
    maxWidth: COL_MARKS_X - (MARGIN_LEFT + 50) - 12,
  });
  drawRightCols(ctx, ctx.y, q.total_marks, null, null, null, false);

  const marksPer = poolMarksPerItem(q);
  for (let i = 0; i < (q.items ?? []).length; i++) {
    const item = q.items![i];
    if (isPoolItemMcqLike(item.itemType)) {
      ctx = drawTaggedSubRow(ctx, poolItemToSubQuestion(item, i), hasCoPo);
    } else {
      ctx = drawTaggedOptionRow(
        ctx,
        poolItemToPart(item, i, marksPer),
        wrapPartLabel(poolItemLabel(i)),
        hasCoPo
      );
    }
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

export interface PdfBuildOptions {
  /** Decoded question images keyed by storage path (from loadPaperImages). */
  images?: PaperImageMap;
}

export async function generatePPSUPaperPDF(
  paper: AssembledPaper,
  options: PdfBuildOptions = {}
): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.TimesRoman);
  const bold = await doc.embedFont(StandardFonts.TimesRomanBold);
  const italic = await doc.embedFont(StandardFonts.TimesRomanItalic);

  // Embed every decoded image once up-front so the synchronous draw helpers can
  // look them up by path (pdf-lib's embed calls are async; drawing isn't).
  const images = new Map<string, EmbeddedPdfImage>();
  for (const [path, asset] of options.images ?? []) {
    try {
      const img =
        asset.format === "png"
          ? await doc.embedPng(asset.bytes)
          : await doc.embedJpg(asset.bytes);
      images.set(path, { img, width: asset.width, height: asset.height });
    } catch (err) {
      console.warn(
        `[qpaper/builder] could not embed image ${path}: ${
          err instanceof Error ? err.message : "unknown"
        }`
      );
    }
  }

  const ctx: Ctx = {
    doc,
    page: doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]),
    y: PAGE_HEIGHT - MARGIN_TOP,
    pageNo: 1,
    fonts: { regular, bold, italic },
    images,
  };

  drawHeader(ctx, paper);

  // Render CO/BTL/PO columns whenever the questions actually carry those tags
  // (matching the preview), not only when the subject's CO-PO metadata tables
  // are populated. The explicit flag remains an override for callers that set it.
  const hasCoPo = paper.hasCoPoData === true || paperHasTagData(paper);
  const flat = paper.flatLayout === true;
  let qGlobal = 0;

  for (const section of paper.sections) {
    if (!flat) drawSectionHeader(ctx, section.section_name);
    for (const q of section.questions) {
      const t = (q.type ?? "").toLowerCase();
      const renderQ = flat
        ? { ...q, display_label: `Q - ${++qGlobal}` }
        : q;
      if (t === "mcq") {
        drawMCQRow(ctx, renderQ, hasCoPo);
      } else if (t === "descriptive_with_or") {
        drawDescriptiveWithOr(ctx, renderQ, hasCoPo);
      } else if (t === "attempt_any_one") {
        drawAttemptAnyOne(ctx, renderQ, hasCoPo);
      } else if (t === "pool") {
        drawPool(ctx, renderQ, hasCoPo);
      } else {
        drawDescriptive(ctx, renderQ, hasCoPo);
      }
      ctx.y -= 4;
    }
    if (!flat) ctx.y -= 8;
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
