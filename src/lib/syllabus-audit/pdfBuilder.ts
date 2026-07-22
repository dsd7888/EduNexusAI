// ============================================================================
// Syllabus compliance report — portrait A4 (pdf-lib).
//
// A snapshot of the deterministic audit, formatted for the reader it is
// actually for: an HOD or NBA panel skimming one page per subject. So the
// ordering is verdict-first (score, then per-dimension, then evidence), and
// every section is a table or a grid rather than prose.
//
// Like lessonplan/pdfBuilder.ts, this does NOT use the shared PDFBuilder
// (src/lib/pdf/builder.ts): that class is markdown-oriented with even-width
// table columns, and this report needs a score ring, a per-column findings
// table, and a CO x Module matrix whose width depends on the module count.
//
// "One page" is the target, not a guarantee — a subject with 25 findings gets
// a second page rather than a truncated table. Silently dropping findings from
// a COMPLIANCE report would be the worst possible failure mode for this file,
// so the layout paginates and repeats table headers instead.
// ============================================================================

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { SubjectContext } from "@/lib/subjectContext";
import type { LessonPlanHeader } from "@/lib/lessonplan/exportShared";
import {
  ALL_DIMENSIONS,
  DIMENSION_LABELS,
  type AuditResult,
  type Dimension,
  type Severity,
} from "./types";

// A4 portrait
const PAGE_W = 595;
const PAGE_H = 842;
const MARGIN = 40;
const CONTENT_W = PAGE_W - MARGIN * 2; // 515

const INK = rgb(0.1, 0.1, 0.1);
const MUTED = rgb(0.42, 0.42, 0.42);
const BORDER = rgb(0.72, 0.72, 0.72);
const HEADER_FILL = rgb(0.93, 0.93, 0.93);
const ZEBRA = rgb(0.975, 0.975, 0.975);

// Print-safe severity colours. Deliberately darker than the on-screen palette:
// the screen tones are tuned for a dark UI and wash out on white paper.
const SEVERITY_INK: Record<Severity, ReturnType<typeof rgb>> = {
  critical: rgb(0.72, 0.11, 0.15),
  warning: rgb(0.72, 0.45, 0.05),
  info: rgb(0.15, 0.4, 0.65),
};

function scoreInk(score: number): ReturnType<typeof rgb> {
  if (score >= 90) return rgb(0.06, 0.5, 0.31);
  if (score >= 60) return rgb(0.72, 0.45, 0.05);
  return rgb(0.72, 0.11, 0.15);
}

/** Helvetica's WinAnsi encoding can't represent these; pdf-lib throws if sent. */
function sanitize(text: string): string {
  return (text ?? "")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/→/g, "->")
    .replace(/↔/g, "<->")
    .replace(/≤/g, "<=")
    .replace(/≥/g, ">=")
    .replace(/≈/g, "~")
    .replace(/×/g, "x")
    .replace(/…/g, "...")
    .replace(/•/g, "-")
    .replace(/·/g, "-")
    .replace(/[^ -ÿ]/g, "");
}

interface State {
  doc: PDFDocument;
  page: PDFPage;
  y: number; // distance from TOP of page
  regular: PDFFont;
  bold: PDFFont;
}

function newPage(st: State): void {
  st.page = st.doc.addPage([PAGE_W, PAGE_H]);
  st.y = MARGIN;
}

function ensure(st: State, needed: number): void {
  if (st.y + needed > PAGE_H - MARGIN) newPage(st);
}

/** pdf-lib's origin is bottom-left; this file tracks y from the top. */
function yAt(st: State, fromTop: number): number {
  return PAGE_H - fromTop;
}

function text(
  st: State,
  s: string,
  opts: {
    x?: number;
    size?: number;
    bold?: boolean;
    color?: ReturnType<typeof rgb>;
    dy?: number;
  } = {},
): void {
  const size = opts.size ?? 9;
  st.page.drawText(sanitize(s), {
    x: opts.x ?? MARGIN,
    y: yAt(st, st.y + size),
    size,
    font: opts.bold ? st.bold : st.regular,
    color: opts.color ?? INK,
  });
  st.y += size + (opts.dy ?? 3);
}

function centered(st: State, s: string, size: number, bold: boolean, color = INK): void {
  const font = bold ? st.bold : st.regular;
  const t = sanitize(s);
  st.page.drawText(t, {
    x: (PAGE_W - font.widthOfTextAtSize(t, size)) / 2,
    y: yAt(st, st.y + size),
    size,
    font,
    color,
  });
  st.y += size + 4;
}

function wrap(s: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const out: string[] = [];
  // Split on hard breaks BEFORE sanitizing. sanitize()'s final catch-all strips
  // everything below the space character, and "\n" is one of them — sanitizing
  // first silently deletes every hard break, so a two-line cell renders as
  // "1Remember". Caught by looking at the rendered PDF; the text extracts fine
  // either way, which is precisely the §17 trap about trusting extracted text.
  for (const hard of String(s ?? "").split("\n")) {
    const words = sanitize(hard).split(/\s+/).filter(Boolean);
    let line = "";
    for (const w of words) {
      const trial = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(trial, size) <= maxWidth || !line) line = trial;
      else {
        out.push(line);
        line = w;
      }
    }
    out.push(line);
  }
  return out.length ? out : [""];
}

function rule(st: State, gap = 6): void {
  st.page.drawLine({
    start: { x: MARGIN, y: yAt(st, st.y) },
    end: { x: PAGE_W - MARGIN, y: yAt(st, st.y) },
    thickness: 0.7,
    color: BORDER,
  });
  st.y += gap;
}

function sectionHeading(st: State, s: string): void {
  ensure(st, 26);
  st.y += 3;
  text(st, s, { size: 10.5, bold: true, dy: 1 });
  rule(st, 4);
}

// ─── Table ───────────────────────────────────────────────────────────────────

const CELL_PAD = 3;
const T_SIZE = 7.5;
const T_LINE = 9;

interface Column {
  header: string;
  width: number;
  /** Per-row ink, e.g. severity colouring. */
  color?: (row: string[]) => ReturnType<typeof rgb>;
}

function rowHeight(cells: string[], cols: Column[], font: PDFFont): number {
  let maxLines = 1;
  cells.forEach((c, i) => {
    const n = wrap(c, font, T_SIZE, cols[i].width - CELL_PAD * 2).length;
    if (n > maxLines) maxLines = n;
  });
  return maxLines * T_LINE + CELL_PAD * 2;
}

function drawRow(
  st: State,
  cells: string[],
  cols: Column[],
  isHeader: boolean,
  zebra: boolean,
): void {
  const font = isHeader ? st.bold : st.regular;
  const h = rowHeight(cells, cols, font);
  const top = yAt(st, st.y);
  let x = MARGIN;

  for (const [i, col] of cols.entries()) {
    if (isHeader || zebra) {
      st.page.drawRectangle({
        x,
        y: top - h,
        width: col.width,
        height: h,
        color: isHeader ? HEADER_FILL : ZEBRA,
      });
    }
    st.page.drawRectangle({
      x,
      y: top - h,
      width: col.width,
      height: h,
      borderColor: BORDER,
      borderWidth: 0.5,
    });
    const ink = isHeader ? INK : col.color?.(cells) ?? INK;
    let ly = st.y + CELL_PAD + T_SIZE;
    for (const ln of wrap(cells[i] ?? "", font, T_SIZE, col.width - CELL_PAD * 2)) {
      st.page.drawText(ln, {
        x: x + CELL_PAD,
        y: yAt(st, ly),
        size: T_SIZE,
        font,
        color: ink,
      });
      ly += T_LINE;
    }
    x += col.width;
  }
  st.y += h;
}

function drawTable(st: State, cols: Column[], rows: string[][]): void {
  const headers = cols.map((c) => c.header);
  ensure(st, rowHeight(headers, cols, st.bold) + 20);
  drawRow(st, headers, cols, true, false);
  rows.forEach((row, i) => {
    const h = rowHeight(row, cols, st.regular);
    if (st.y + h > PAGE_H - MARGIN) {
      newPage(st);
      drawRow(st, headers, cols, true, false); // repeat header on every page
    }
    drawRow(st, row, cols, false, i % 2 === 1);
  });
}

// ─── Sections ────────────────────────────────────────────────────────────────

function drawHeaderBlock(st: State, header: LessonPlanHeader): void {
  centered(st, header.university.toUpperCase(), 13, true);
  centered(st, `${header.school}  |  ${header.department}`, 8.5, false, MUTED);
  st.y += 2;
  centered(st, "SYLLABUS COMPLIANCE REPORT", 11, true);
  st.y += 4;
  centered(
    st,
    `${header.courseCode} - ${header.courseName}  |  ${header.semester}`,
    9,
    true,
  );
  centered(
    st,
    `Faculty: ${header.facultyName}   Generated: ${new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}`,
    8,
    false,
    MUTED,
  );
  st.y += 2;
  rule(st, 8);
}

/** Score ring + verdict, mirroring the on-screen dashboard. */
function drawScoreBlock(st: State, audit: AuditResult, assessed: number): void {
  ensure(st, 64);
  const cx = MARGIN + 42;
  const cy = yAt(st, st.y + 31);
  const r = 24;
  const ink = scoreInk(audit.overallHealth);

  // pdf-lib has no arc primitive; the ring is drawn as short segments so the
  // filled proportion reads correctly in print.
  st.page.drawCircle({ x: cx, y: cy, size: r, borderColor: rgb(0.88, 0.88, 0.88), borderWidth: 7 });
  const pct = Math.max(0, Math.min(100, audit.overallHealth)) / 100;
  const steps = Math.max(1, Math.round(64 * pct));
  for (let i = 0; i < steps; i++) {
    const a0 = Math.PI / 2 - (i / 64) * Math.PI * 2;
    st.page.drawCircle({
      x: cx + r * Math.cos(a0),
      y: cy + r * Math.sin(a0),
      size: 3.5,
      color: ink,
    });
  }
  const label = String(audit.overallHealth);
  const lw = st.bold.widthOfTextAtSize(label, 20);
  st.page.drawText(label, { x: cx - lw / 2, y: cy - 5, size: 20, font: st.bold, color: ink });
  const sub = "/100";
  const sw = st.regular.widthOfTextAtSize(sub, 7);
  st.page.drawText(sub, { x: cx - sw / 2, y: cy - 15, size: 7, font: st.regular, color: MUTED });

  const tx = MARGIN + 96;
  let ty = st.y + 8;
  st.page.drawText(sanitize("Overall syllabus health"), {
    x: tx, y: yAt(st, ty + 11), size: 11, font: st.bold, color: INK,
  });
  ty += 17;
  const counts = {
    critical: audit.findings.filter((f) => f.severity === "critical").length,
    warning: audit.findings.filter((f) => f.severity === "warning").length,
    info: audit.findings.filter((f) => f.severity === "info").length,
  };
  for (const line of [
    `${audit.findings.length} finding(s): ${counts.critical} critical, ${counts.warning} warning, ${counts.info} informational.`,
    `Weighted across the ${assessed} dimension(s) assessable from this syllabus.`,
    "Dimensions with no underlying data are excluded rather than scored as compliant.",
  ]) {
    for (const ln of wrap(line, st.regular, 8, CONTENT_W - 100)) {
      st.page.drawText(ln, { x: tx, y: yAt(st, ty + 8), size: 8, font: st.regular, color: MUTED });
      ty += 11;
    }
  }
  st.y = Math.max(st.y + 64, ty + 4);
}

function drawDimensionGrid(st: State, audit: AuditResult): void {
  sectionHeading(st, "Dimension scores");
  const COLS = 3;
  const CELL_W = CONTENT_W / COLS;
  const CELL_H = 24;

  let col = 0;
  for (const d of ALL_DIMENSIONS) {
    const s = audit.scores[d];
    if (!s) continue;
    if (col === 0) ensure(st, CELL_H + 2);
    const x = MARGIN + col * CELL_W;
    const top = yAt(st, st.y);

    st.page.drawRectangle({
      x, y: top - CELL_H, width: CELL_W, height: CELL_H,
      borderColor: BORDER, borderWidth: 0.5,
    });
    st.page.drawText(sanitize(DIMENSION_LABELS[d]), {
      x: x + 5, y: yAt(st, st.y + 11), size: 7.5, font: st.bold, color: INK,
    });
    const detail = s.assessed
      ? `${s.score}/100  -  ${s.total === 0 ? "no issues" : `${s.total} finding(s)`}`
      : "not assessed";
    st.page.drawText(sanitize(detail), {
      x: x + 5, y: yAt(st, st.y + 23), size: 7.5, font: st.regular,
      color: s.assessed ? scoreInk(s.score) : MUTED,
    });

    col++;
    if (col === COLS) {
      col = 0;
      st.y += CELL_H;
    }
  }
  if (col !== 0) st.y += CELL_H;
  st.y += 4;
}

function drawFindingsTable(st: State, audit: AuditResult): void {
  sectionHeading(st, "Findings");
  if (audit.findings.length === 0) {
    text(st, "No findings - this syllabus passes every check that could be run against it.", {
      size: 8, color: MUTED,
    });
    return;
  }
  const cols: Column[] = [
    { header: "Dimension", width: 95 },
    {
      header: "Severity",
      width: 52,
      color: (row) => SEVERITY_INK[(row[1].toLowerCase() as Severity)] ?? INK,
    },
    { header: "Entity", width: 58 },
    { header: "Diagnosis", width: CONTENT_W - 95 - 52 - 58 },
  ];
  drawTable(
    st,
    cols,
    audit.findings.map((f) => [
      DIMENSION_LABELS[f.dimension],
      f.severity,
      f.entity,
      f.diagnosis,
    ]),
  );
  st.y += 4;
}

/**
 * CO x Module coverage matrix — the single most-requested artifact in an NBA
 * file, and the reason an auditor opens this report at all.
 */
function drawCoverageMatrix(st: State, ctx: SubjectContext): void {
  sectionHeading(st, "CO / Module coverage matrix");
  if (ctx.courseOutcomes.length === 0 || ctx.modules.length === 0) {
    text(st, "Not available - this subject has no course outcomes or no modules recorded.", {
      size: 8, color: MUTED,
    });
    return;
  }

  const modules = [...ctx.modules].sort((a, b) => a.module_number - b.module_number);
  const CO_W = 46;
  const cellW = Math.min(34, (CONTENT_W - CO_W - 40) / modules.length);
  const cols: Column[] = [
    { header: "CO", width: CO_W },
    ...modules.map((m) => ({ header: `M${m.module_number}`, width: cellW })),
    { header: "Total", width: 40 },
  ];

  const rows = ctx.courseOutcomes
    .slice()
    .sort((a, b) => a.co_code.localeCompare(b.co_code, undefined, { numeric: true }))
    .map((co) => {
      const hits = modules.map((m) => (m.coCodes.includes(co.co_code) ? "X" : ""));
      const total = hits.filter(Boolean).length;
      // A zero row is the finding an auditor is looking for; mark it, don't
      // leave them to count blanks across a wide table.
      return [co.co_code, ...hits, total === 0 ? "0 (!)" : String(total)];
    });

  // Column totals: how many COs each module carries.
  rows.push([
    "Total",
    ...modules.map((m) =>
      String(ctx.courseOutcomes.filter((c) => m.coCodes.includes(c.co_code)).length),
    ),
    "",
  ]);

  drawTable(st, cols, rows);
  text(st, "X = the module addresses that course outcome. (!) = outcome not assessable.", {
    size: 7, color: MUTED, dy: 2,
  });
  st.y += 4;
}

function drawBtlSummary(st: State, ctx: SubjectContext): void {
  sectionHeading(st, "Bloom's taxonomy distribution");
  if (ctx.modules.length === 0) {
    text(st, "Not available - no modules recorded.", { size: 8, color: MUTED });
    return;
  }
  const LEVELS = [1, 2, 3, 4, 5, 6];
  const NAMES = ["Remember", "Understand", "Apply", "Analyze", "Evaluate", "Create"];

  const cols: Column[] = [
    { header: "Module", width: 46 },
    ...LEVELS.map((l, i) => ({ header: `${l} ${NAMES[i]}`, width: 56 })),
    { header: "Max", width: CONTENT_W - 46 - 56 * 6 },
  ];

  const modules = [...ctx.modules].sort((a, b) => a.module_number - b.module_number);
  const rows = modules.map((m) => [
    `M${m.module_number}`,
    ...LEVELS.map((l) => (m.btl_levels.includes(l) ? "X" : "")),
    m.btl_levels.length ? String(Math.max(...m.btl_levels)) : "-",
  ]);
  rows.push([
    "Modules",
    ...LEVELS.map((l) => String(modules.filter((m) => m.btl_levels.includes(l)).length)),
    "",
  ]);

  drawTable(st, cols, rows);

  const all = new Set<number>();
  for (const m of modules) for (const b of m.btl_levels) all.add(b);
  const highest = all.size ? Math.max(...all) : 0;
  text(
    st,
    highest >= 4
      ? `Highest level reached: BTL ${highest} (${NAMES[highest - 1]}). Higher-order thinking is represented.`
      : `Highest level reached: BTL ${highest || "-"}. NBA expects at least one module at BTL 4 (Analyze) or above.`,
    { size: 7.5, color: highest >= 4 ? MUTED : SEVERITY_INK.warning, dy: 2 },
  );
}

// ─── Entry point ─────────────────────────────────────────────────────────────

export async function buildComplianceReportPdf(args: {
  ctx: SubjectContext;
  audit: AuditResult;
  header: LessonPlanHeader;
}): Promise<Uint8Array> {
  const { ctx, audit, header } = args;

  const doc = await PDFDocument.create();
  const st: State = {
    doc,
    page: doc.addPage([PAGE_W, PAGE_H]),
    y: MARGIN,
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
  };

  const assessed = ALL_DIMENSIONS.filter(
    (d: Dimension) => audit.scores[d]?.assessed,
  ).length;

  drawHeaderBlock(st, header);
  drawScoreBlock(st, audit, assessed);
  drawDimensionGrid(st, audit);
  drawFindingsTable(st, audit);
  drawCoverageMatrix(st, ctx);
  drawBtlSummary(st, ctx);

  // Footer on every page: this is a point-in-time snapshot, and a reader who
  // finds it in a file six months from now must not mistake it for current.
  const pages = doc.getPages();
  pages.forEach((p, i) => {
    const note = sanitize(
      `Generated by EduNexus AI on ${new Date().toLocaleString("en-IN")} - a point-in-time snapshot of the syllabus as recorded.`,
    );
    p.drawText(note, { x: MARGIN, y: 22, size: 6.5, font: st.regular, color: MUTED });
    const pg = `Page ${i + 1} of ${pages.length}`;
    p.drawText(pg, {
      x: PAGE_W - MARGIN - st.regular.widthOfTextAtSize(pg, 6.5),
      y: 22,
      size: 6.5,
      font: st.regular,
      color: MUTED,
    });
  });

  return doc.save();
}
