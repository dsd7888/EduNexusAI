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
import { extractLatexSegments, hasLatex } from "@/lib/text/latexSegments";
import { mathKey, mathSizePt, type MathRenderMap } from "./paperMath";
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
  /** Pool blocks only: the template's originally requested item count — the
   *  paper's instruction text and marks split must always derive from this,
   *  never from items.length (which is padded to this same count even when
   *  the AI under-delivered). */
  pool_expected_count?: number;
  /** Pool blocks only: how many items the AI actually returned before padding
   *  filled the rest with blanks. Used to detect and warn on shortfall. */
  pool_returned_count?: number;
  /** attempt_any_one only: the template's configured option count (M). The
   *  paper's instruction text and per-option marks always derive from this,
   *  never from parts.length (which is padded to M on AI shortfall). */
  attempt_expected_count?: number;
  /** attempt_any_one only: how many options the AI actually returned before
   *  padding filled the rest with blanks. Used to detect and warn on shortfall. */
  attempt_returned_count?: number;
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

/** A rasterised math/chemistry span embedded up-front. Geometry is intrinsic px
 *  at the reference size; scaled to the drawing font via {@link mathSizePt}. */
interface EmbeddedMath {
  img: PDFImage;
  width: number;
  height: number;
  baseline: number;
  displayMode: boolean;
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
  /** Rasterised math spans embedded up-front, keyed by {@link mathKey}. */
  math: Map<string, EmbeddedMath>;
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

/**
 * Math-aware wrapped-text run. Splits the text into plain and math/chemistry
 * spans; plain runs draw exactly as {@link drawTextLines} (word-wrapped Times),
 * inline math draws as a baseline-aligned image mid-line, and block/display math
 * draws centred on its own line. Pagination uses the same {@link ensureSpace}
 * page-break the rest of the engine uses, so a tall equation triggers a break
 * like any other block.
 *
 * Fast path: when the text contains no math at all, this is byte-identical to
 * {@link drawTextLines} — the non-math rendering path is untouched.
 *
 * Math is extracted from the RAW text (matching how renderPaperMath keyed the
 * pre-rendered images); only the plain-text runs go through `sanitize`.
 */
function drawMathText(
  ctx: Ctx,
  text: string,
  indentX: number,
  size: number,
  textColor = rgb(0, 0, 0)
) {
  const segments = extractLatexSegments(text ?? "");
  if (!segments.some((s) => s.type === "math")) {
    drawTextLines(ctx, text ?? "", indentX, size);
    return;
  }

  const { regular } = ctx.fonts;
  const maxWidth = COL_MARKS_X - indentX - 12;
  const spaceW = regular.widthOfTextAtSize(" ", size);
  const textAscent = size * 0.75;
  const textDescent = size * 0.25;
  const lineGap = 3;

  type Tok =
    | { kind: "word"; text: string; w: number; spaceBefore: boolean }
    | {
        kind: "imath";
        e: EmbeddedMath;
        w: number;
        h: number;
        b: number;
        spaceBefore: boolean;
      }
    | { kind: "block"; latex: string };
  // Only inline tokens ever enter a line; block math is drawn between lines.
  type InlineTok = Exclude<Tok, { kind: "block" }>;

  // ── Build the inline token stream, honouring real whitespace boundaries ────
  const tokens: Tok[] = [];
  let pendingSpace = false;
  const lookupMath = (latex: string, displayMode: boolean) =>
    ctx.math.get(mathKey(latex, displayMode));

  const drawBlockMath = (latex: string) => {
    const e = lookupMath(latex, true) ?? lookupMath(latex, false);
    if (!e) {
      // Fallback: the literal source as plain text (never crash generation).
      drawTextLines(ctx, latex, indentX, size);
      return;
    }
    let { width: w, height: h } = mathSizePt(e, size + 1);
    if (w > maxWidth) {
      const s = maxWidth / w;
      w *= s;
      h *= s;
    }
    ctx.y -= 4;
    const c = ensureSpace(ctx, h + 6);
    const cx = indentX + Math.max(0, (maxWidth - w) / 2);
    c.page.drawImage(e.img, { x: cx, y: c.y - h, width: w, height: h });
    c.y -= h + 6;
  };

  for (const seg of segments) {
    if (seg.type === "text") {
      // Split keeping whitespace so spacing across math boundaries is faithful.
      for (const piece of sanitize(seg.value).split(/(\s+)/)) {
        if (piece === "") continue;
        if (/^\s+$/.test(piece)) {
          pendingSpace = true;
          continue;
        }
        tokens.push({
          kind: "word",
          text: piece,
          w: regular.widthOfTextAtSize(piece, size),
          spaceBefore: pendingSpace,
        });
        pendingSpace = false;
      }
      continue;
    }
    // math segment
    if (seg.displayMode) {
      tokens.push({ kind: "block", latex: seg.latex });
      pendingSpace = false;
      continue;
    }
    const e = lookupMath(seg.latex, false);
    if (!e) {
      // Literal fallback for a failed inline span.
      for (const piece of sanitize(seg.latex).split(/(\s+)/)) {
        if (piece === "" || /^\s+$/.test(piece)) {
          if (/^\s+$/.test(piece)) pendingSpace = true;
          continue;
        }
        tokens.push({
          kind: "word",
          text: piece,
          w: regular.widthOfTextAtSize(piece, size),
          spaceBefore: pendingSpace,
        });
        pendingSpace = false;
      }
      continue;
    }
    const { width: w, height: h, baseline: b } = mathSizePt(e, size);
    tokens.push({ kind: "imath", e, w, h, b, spaceBefore: pendingSpace });
    pendingSpace = false;
  }

  // ── Line-break and draw ────────────────────────────────────────────────────
  let line: InlineTok[] = [];
  let lineW = 0;

  const flushLine = () => {
    if (line.length === 0) return;
    let asc = textAscent;
    let desc = textDescent;
    for (const t of line) {
      if (t.kind === "imath") {
        asc = Math.max(asc, t.h - t.b);
        desc = Math.max(desc, t.b);
      }
    }
    const c = ensureSpace(ctx, asc + desc + lineGap);
    const baseline = c.y - asc;
    let x = indentX;
    let first = true;
    for (const t of line) {
      if (!first && t.spaceBefore) x += spaceW;
      if (t.kind === "word") {
        c.page.drawText(t.text, {
          x,
          y: baseline,
          size,
          font: regular,
          color: textColor,
        });
        x += t.w;
      } else if (t.kind === "imath") {
        c.page.drawImage(t.e.img, {
          x,
          y: baseline - t.b,
          width: t.w,
          height: t.h,
        });
        x += t.w;
      }
      first = false;
    }
    c.y = baseline - desc - lineGap;
    line = [];
    lineW = 0;
  };

  for (const t of tokens) {
    // Block-math: flush the current line, draw centred, continue.
    if (t.kind === "block") {
      flushLine();
      drawBlockMath(t.latex);
      continue;
    }
    const gap = line.length > 0 && t.spaceBefore ? spaceW : 0;
    const cand = line.length === 0 ? t.w : lineW + gap + t.w;
    if (cand > maxWidth && line.length > 0) {
      flushLine();
      line.push(t);
      lineW = t.w;
    } else {
      line.push(t);
      lineW = cand;
    }
  }
  flushLine();
}

// Bordered, even-column table ported from pdf/builder.ts drawTable() into this
// engine's bottom-anchored ctx/cursor model: shaded+bold header row, wrapped
// cell text, whole-table page-break when it would otherwise be split, and a
// per-row break with header repeat for tables taller than a page.
// Dispatcher: math-free tables use the original byte-identical renderer; only a
// table that actually contains a math/chemistry span takes the math-aware path.
function drawMarkdownTable(
  ctx: Ctx,
  headers: string[],
  rows: string[][],
  indentX: number,
  baseSize: number
) {
  const anyMath =
    headers.some((h) => hasLatex(h)) ||
    rows.some((r) => r.some((c) => hasLatex(c)));
  if (anyMath) {
    drawMarkdownTableMath(ctx, headers, rows, indentX, baseSize);
  } else {
    drawMarkdownTablePlain(ctx, headers, rows, indentX, baseSize);
  }
}

function drawMarkdownTablePlain(
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

// ── Math-aware table cells ───────────────────────────────────────────────────
// One wrapped line inside a cell: a mix of word tokens and inline-math image
// tokens, with the line's ascent/descent (so rows size to the tallest image).
type CellTok =
  | { kind: "word"; text: string; w: number; sb: boolean }
  | { kind: "imath"; e: EmbeddedMath; w: number; h: number; b: number; sb: boolean };
interface CellLine {
  toks: CellTok[];
  asc: number;
  desc: number;
}

/** Wrap a cell's text (with inline math) into rich lines within `innerW`. */
function layoutCellLines(
  ctx: Ctx,
  txt: string,
  size: number,
  innerW: number
): CellLine[] {
  const { regular } = ctx.fonts;
  const spaceW = regular.widthOfTextAtSize(" ", size);
  const toks: CellTok[] = [];
  let pending = false;
  const pushWords = (s: string) => {
    for (const p of sanitize(s).split(/(\s+)/)) {
      if (p === "") continue;
      if (/^\s+$/.test(p)) {
        pending = true;
        continue;
      }
      toks.push({
        kind: "word",
        text: p,
        w: regular.widthOfTextAtSize(p, size),
        sb: pending,
      });
      pending = false;
    }
  };
  for (const seg of extractLatexSegments(txt ?? "")) {
    if (seg.type === "text") {
      pushWords(seg.value);
      continue;
    }
    const e =
      ctx.math.get(mathKey(seg.latex, seg.displayMode)) ??
      ctx.math.get(mathKey(seg.latex, !seg.displayMode));
    if (!e) {
      pushWords(seg.latex); // literal fallback for a failed span
      continue;
    }
    let { width: w, height: h, baseline: b } = mathSizePt(e, size);
    if (w > innerW) {
      const s = innerW / w;
      w *= s;
      h *= s;
      b *= s;
    }
    toks.push({ kind: "imath", e, w, h, b, sb: pending });
    pending = false;
  }

  const lines: CellLine[] = [];
  let cur: CellTok[] = [];
  let curW = 0;
  const flush = () => {
    if (cur.length === 0) return;
    let asc = size;
    let desc = size * 0.22;
    for (const t of cur) {
      if (t.kind === "imath") {
        asc = Math.max(asc, t.h - t.b);
        desc = Math.max(desc, t.b);
      }
    }
    lines.push({ toks: cur, asc, desc });
    cur = [];
    curW = 0;
  };
  for (const t of toks) {
    const gap = cur.length > 0 && t.sb ? spaceW : 0;
    const cand = cur.length === 0 ? t.w : curW + gap + t.w;
    if (cand > innerW && cur.length > 0) {
      flush();
      cur.push(t);
      curW = t.w;
    } else {
      cur.push(t);
      curW = cand;
    }
  }
  flush();
  if (lines.length === 0) lines.push({ toks: [], asc: size, desc: size * 0.22 });
  return lines;
}

/**
 * Math-aware sibling of {@link drawMarkdownTablePlain}: identical bordered layout,
 * header repeat and page-break behaviour, but each cell is laid out with
 * {@link layoutCellLines} so inline math/chemistry renders as baseline-aligned
 * images and rows grow to fit the tallest image. Only reached when a table
 * actually contains a math span.
 */
function drawMarkdownTableMath(
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
  const lineGap = size * 0.3;
  const innerW = colW - padX * 2;
  const bottomLimit = MARGIN_BOTTOM + 30;
  const pageTopY = PAGE_HEIGHT - MARGIN_TOP;

  const cellH = (lines: CellLine[]) =>
    lines.reduce((s, l) => s + l.asc + l.desc, 0) +
    Math.max(0, lines.length - 1) * lineGap;
  const cellLayouts = (cells: string[]) =>
    Array.from({ length: nCols }, (_, c) =>
      layoutCellLines(ctx, cells[c] ?? "", size, innerW)
    );
  const rowHeight = (cells: string[]) => {
    const layouts = cellLayouts(cells);
    return Math.max(...layouts.map(cellH), 0) + padY * 2;
  };

  const headerH = rowHeight(headers);
  const totalH = headerH + rows.reduce((s, r) => s + rowHeight(r), 0);
  const remaining = ctx.y - bottomLimit;
  const pageInnerH = pageTopY - bottomLimit;
  if (totalH > remaining && totalH <= pageInnerH) newPage(ctx);

  const drawRow = (cells: string[], font: PDFFont, fill: boolean) => {
    const layouts = cellLayouts(cells);
    const h = Math.max(...layouts.map(cellH), 0) + padY * 2;
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
      const lines = layouts[c];
      let baseline = topY - padY - (lines[0]?.asc ?? size);
      lines.forEach((ln, li) => {
        if (li > 0) baseline -= lines[li - 1].desc + lineGap + ln.asc;
        let x = cx + padX;
        let first = true;
        for (const t of ln.toks) {
          if (!first && t.sb) x += regular.widthOfTextAtSize(" ", size);
          if (t.kind === "word") {
            ctx.page.drawText(t.text, {
              x,
              y: baseline,
              size,
              font,
              color: rgb(0, 0, 0),
            });
          } else {
            ctx.page.drawImage(t.e.img, {
              x,
              y: baseline - t.b,
              width: t.w,
              height: t.h,
            });
          }
          x += t.w;
          first = false;
        }
      });
    }
    ctx.y = topY - h;
  };

  ctx.y -= 2;
  drawRow(headers, bold, true);
  for (const r of rows) drawRow(r, regular, false);
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
  // Common case (no embedded table/list): render as text, math-aware. When the
  // text also has no math, drawMathText delegates to drawTextLines unchanged.
  if (!segments.some((s) => s.type !== "text")) {
    drawMathText(ctx, text ?? "", indentX, size);
  } else {
    for (const seg of segments) {
      if (seg.type === "table") {
        drawMarkdownTable(ctx, seg.headers, seg.rows, indentX, size);
      } else if (seg.type === "list") {
        drawMarkdownList(ctx, seg, indentX, size);
      } else {
        drawMathText(ctx, seg.content, indentX, size);
      }
    }
  }
  // Header-overlap guard: the body is drawn side-by-side with (and starting on
  // the same baseline as) the caller's header label. When the AI returned an
  // empty slot the body draws nothing and ctx.y never leaves the label's
  // baseline, so the next question's header prints on top of it. Force the
  // cursor one line below the header — the same "advance past the header even
  // when the body is empty" principle as BUG 1, for the empty-body case that
  // fix didn't reach.
  if (ctx.y === startY) ctx.y -= LINE_H;
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
    const OPT_GRAY = rgb(0.2, 0.2, 0.2);
    for (const k of ["a", "b", "c", "d"]) {
      const v = (opts as Record<string, string>)[k];
      if (!v) continue;
      ctx = ensureSpace(ctx, LINE_H);
      const raw = `${k}) ${v}`;
      // Math-bearing options flow through the math-aware layout (raw, so the
      // latex keys match); plain options keep the exact original gray path.
      if (hasLatex(raw)) {
        drawMathText(ctx, raw, MARGIN_LEFT + 36, 9.5, OPT_GRAY);
        continue;
      }
      const lines = wrapWords(
        sanitize(raw),
        regular,
        9.5,
        COL_MARKS_X - MARGIN_LEFT - 36
      );
      for (const ln of lines) {
        ctx = ensureSpace(ctx, LINE_H);
        ctx.page.drawText(ln, {
          x: MARGIN_LEFT + 36,
          y: ctx.y,
          size: 9.5,
          font: regular,
          color: OPT_GRAY,
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
  const instruction = sanitize(
    q.instruction ??
      `Attempt any ${poolAttemptCount(q)} of ${q.attempt_expected_count ?? q.parts?.length ?? 2}.`
  );

  const instructionMaxWidth = COL_MARKS_X - (MARGIN_LEFT + 50) - 12;

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
    maxWidth: instructionMaxWidth,
  });
  drawRightCols(ctx, ctx.y, q.total_marks, null, null, null, false);
  const instructionLines = wrapWords(instruction, regular, 10, instructionMaxWidth);
  ctx.y -= LINE_H * Math.max(instructionLines.length, 1);

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
    q.instruction ??
      `Attempt any ${poolAttemptCount(q)} of the following ${q.pool_expected_count ?? q.items?.length ?? 0} questions.`
  );

  const instructionMaxWidth = COL_MARKS_X - (MARGIN_LEFT + 50) - 12;

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
    maxWidth: instructionMaxWidth,
  });
  drawRightCols(ctx, ctx.y, q.total_marks, null, null, null, false);
  const instructionLines = wrapWords(instruction, regular, 10, instructionMaxWidth);
  ctx.y -= LINE_H * Math.max(instructionLines.length, 1);

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
  /** Rasterised math/chemistry spans (from renderPaperMath). */
  math?: MathRenderMap;
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

  // Same up-front-embed strategy for rasterised math spans: the draw helpers are
  // synchronous, so every PNG is embedded here and looked up by mathKey.
  const math = new Map<string, EmbeddedMath>();
  for (const [key, asset] of options.math ?? []) {
    if (!asset) continue; // failed render → drawMathText falls back to literal
    try {
      const img = await doc.embedPng(asset.buffer);
      math.set(key, {
        img,
        width: asset.width,
        height: asset.height,
        baseline: asset.baseline,
        displayMode: asset.displayMode,
      });
    } catch (err) {
      console.warn(
        `[qpaper/builder] could not embed math ${key}: ${
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
    math,
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
