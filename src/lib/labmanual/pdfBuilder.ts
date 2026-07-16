// ============================================================================
// Lab-manual PDF export — portrait A4 flowing document (pdf-lib), spec §6.
//
// Self-contained (the shared PDFBuilder is markdown-oriented and not suited to
// this block model). Helvetica for prose, Courier for code; sanitize() maps the
// few unicode glyphs latexToReadable() emits down to Helvetica's WinAnsi set.
// Code lines hard-wrap at a column width, never mid-token where avoidable.
//
// Two-pass page numbers (spec §6): pass 1 records the page each practical lands
// on; pass 2 renders the contents with those real numbers resolved.
// ============================================================================

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { Block, ExportModel } from "./exportShared";
import { PAGE_PLACEHOLDER_RE } from "./exportShared";

const PAGE_W = 595;
const PAGE_H = 842;
const MARGIN = 42;
const CONTENT_W = PAGE_W - MARGIN * 2; // 511

const INK = rgb(0.12, 0.12, 0.14);
const MUTED = rgb(0.42, 0.42, 0.46);
const BORDER = rgb(0.72, 0.72, 0.75);
const SHADE = rgb(0.95, 0.95, 0.965);
const HEADER_FILL = rgb(0.9, 0.9, 0.93);
const RULE = rgb(0.85, 0.85, 0.88);

function sanitize(text: string): string {
  return (text ?? "")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/→/g, "->")
    .replace(/⇌/g, "<=>")
    .replace(/≤/g, "<=")
    .replace(/≥/g, ">=")
    .replace(/≠/g, "!=")
    .replace(/≈/g, "~")
    .replace(/×/g, "x")
    .replace(/·/g, ".")
    .replace(/÷/g, "/")
    .replace(/±/g, "+/-")
    .replace(/…/g, "...")
    .replace(/•/g, "-")
    // superscripts / subscripts → ^x / _x so nothing is silently dropped
    .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹ⁿⁱ⁺⁻]/g, (c) => "^" + "0123456789ni+-"["⁰¹²³⁴⁵⁶⁷⁸⁹ⁿⁱ⁺⁻".indexOf(c)])
    .replace(/[₀₁₂₃₄₅₆₇₈₉ᵢⱼₙ₊₋]/g, (c) => "_" + "0123456789ijn+-"["₀₁₂₃₄₅₆₇₈₉ᵢⱼₙ₊₋".indexOf(c)])
    .replace(/[^\x20-\xff]/g, "");
}

interface St {
  doc: PDFDocument;
  page: PDFPage;
  pageIdx: number;
  y: number; // from top
  reg: PDFFont;
  bold: PDFFont;
  mono: PDFFont;
  /** practicalNo → 1-based page number, filled during pass 1. */
  pageOf: Record<number, number>;
  resolvePage: Record<number, number> | null; // set in pass 2
}

function newPage(st: St) {
  st.page = st.doc.addPage([PAGE_W, PAGE_H]);
  st.pageIdx++;
  st.y = MARGIN;
}

function need(st: St, h: number) {
  if (st.y + h > PAGE_H - MARGIN) newPage(st);
}

function wrap(text: string, font: PDFFont, size: number, maxW: number): string[] {
  const out: string[] = [];
  for (const hard of sanitize(text).split("\n")) {
    if (hard === "") {
      out.push("");
      continue;
    }
    let line = "";
    for (const word of hard.split(/(\s+)/)) {
      const trial = line + word;
      if (font.widthOfTextAtSize(trial, size) <= maxW || !line.trim()) {
        if (!line.trim() && font.widthOfTextAtSize(word, size) > maxW) {
          // a single token wider than the column — hard-break it by char
          let chunk = "";
          for (const ch of word) {
            if (font.widthOfTextAtSize(chunk + ch, size) > maxW && chunk) {
              out.push(chunk);
              chunk = ch;
            } else chunk += ch;
          }
          line = chunk;
        } else line = trial;
      } else {
        out.push(line.replace(/\s+$/, ""));
        line = word.trim();
      }
    }
    if (line.trim() || out.length === 0) out.push(line.replace(/\s+$/, ""));
  }
  return out.length ? out : [""];
}

function drawText(st: St, text: string, x: number, size: number, font: PDFFont, color = INK) {
  st.page.drawText(text, { x, y: PAGE_H - (st.y + size), size, font, color });
}

function paragraph(st: St, text: string, font: PDFFont, size: number, x = MARGIN, maxW = CONTENT_W, color = INK, lineH?: number) {
  const lh = lineH ?? size + 3.5;
  for (const ln of wrap(text, font, size, maxW)) {
    need(st, lh);
    drawText(st, ln, x, size, font, color);
    st.y += lh;
  }
}

function centered(st: St, text: string, size: number, font: PDFFont, color = INK) {
  for (const ln of wrap(text, font, size, CONTENT_W)) {
    need(st, size + 5);
    const w = font.widthOfTextAtSize(ln, size);
    st.page.drawText(ln, { x: (PAGE_W - w) / 2, y: PAGE_H - (st.y + size), size, font, color });
    st.y += size + 5;
  }
}

function monoBox(st: St, text: string) {
  const size = 7.8;
  const lh = size + 3;
  const pad = 6;
  const maxW = CONTENT_W - pad * 2;
  const lines = wrap(text.replace(/\t/g, "    "), st.mono, size, maxW);
  // draw in page-sized chunks so a long scaffold flows across pages
  let i = 0;
  while (i < lines.length) {
    const avail = PAGE_H - MARGIN - st.y - pad * 2;
    const fit = Math.max(1, Math.floor(avail / lh));
    if (fit <= 0) {
      newPage(st);
      continue;
    }
    const chunk = lines.slice(i, i + fit);
    const boxH = chunk.length * lh + pad * 2;
    st.page.drawRectangle({ x: MARGIN, y: PAGE_H - (st.y + boxH), width: CONTENT_W, height: boxH, color: SHADE, borderColor: BORDER, borderWidth: 0.5 });
    let ly = st.y + pad;
    for (const ln of chunk) {
      st.page.drawText(ln, { x: MARGIN + pad, y: PAGE_H - (ly + size), size, font: st.mono, color: INK });
      ly += lh;
    }
    st.y += boxH;
    i += fit;
    if (i < lines.length) newPage(st);
  }
  st.y += 4;
}

function drawTable(st: St, headers: string[], rows: string[][], widthFracs?: number[]) {
  const size = 8;
  const lh = size + 3;
  const pad = 4;
  const fracs = widthFracs ?? headers.map(() => 1 / headers.length);
  const widths = fracs.map((f) => f * CONTENT_W);

  const cellText = (s: string) => {
    const m = PAGE_PLACEHOLDER_RE.exec(s);
    if (m) return st.resolvePage ? String(st.resolvePage[Number(m[1])] ?? "—") : "";
    return s;
  };

  const rowH = (cells: string[], font: PDFFont) => {
    let max = 1;
    cells.forEach((c, i) => {
      const n = wrap(cellText(c), font, size, widths[i] - pad * 2).length;
      if (n > max) max = n;
    });
    return max * lh + pad * 2;
  };

  const drawRow = (cells: string[], header: boolean) => {
    const font = header ? st.bold : st.reg;
    const h = rowH(cells, font);
    need(st, h);
    let x = MARGIN;
    widths.forEach((w, i) => {
      if (header) st.page.drawRectangle({ x, y: PAGE_H - (st.y + h), width: w, height: h, color: HEADER_FILL });
      st.page.drawRectangle({ x, y: PAGE_H - (st.y + h), width: w, height: h, borderColor: BORDER, borderWidth: 0.5 });
      let ly = st.y + pad;
      for (const ln of wrap(cellText(cells[i] ?? ""), font, size, w - pad * 2)) {
        st.page.drawText(ln, { x: x + pad, y: PAGE_H - (ly + size), size, font, color: INK });
        ly += lh;
      }
      x += w;
    });
    st.y += h;
  };

  drawRow(headers, true);
  for (const r of rows) {
    if (st.y + rowH(r, st.reg) > PAGE_H - MARGIN) {
      newPage(st);
      drawRow(headers, true);
    }
    drawRow(r, false);
  }
  st.y += 4;
}

function observationBox(st: St, lines: number) {
  const lh = 16;
  const boxH = lines * lh + 8;
  need(st, Math.min(boxH, 120)); // ensure some room; box may flow
  const drawChunk = (h: number) => {
    st.page.drawRectangle({ x: MARGIN, y: PAGE_H - (st.y + h), width: CONTENT_W, height: h, borderColor: BORDER, borderWidth: 0.5 });
    let ly = st.y + lh;
    while (ly < st.y + h - 4) {
      st.page.drawLine({ start: { x: MARGIN + 6, y: PAGE_H - ly }, end: { x: MARGIN + CONTENT_W - 6, y: PAGE_H - ly }, thickness: 0.4, color: RULE });
      ly += lh;
    }
    st.y += h;
  };
  let remaining = boxH;
  while (remaining > 0) {
    const avail = PAGE_H - MARGIN - st.y;
    const h = Math.min(remaining, avail);
    if (h < lh) {
      newPage(st);
      continue;
    }
    drawChunk(h);
    remaining -= h;
    if (remaining > 0) newPage(st);
  }
  st.y += 4;
}

function renderBlock(st: St, b: Block) {
  switch (b.kind) {
    case "pageBreak":
      newPage(st);
      break;
    case "title":
      st.y += 4;
      centered(st, b.text, b.size, st.bold);
      break;
    case "subtitle":
      centered(st, b.text, 11, st.reg, MUTED);
      break;
    case "heading": {
      st.y += 8;
      need(st, 22);
      // record the page this practical begins on (pass 1)
      const m = /^PRACTICAL\s+(\d+):/.exec(b.text);
      if (m && st.resolvePage === null) st.pageOf[Number(m[1])] = st.pageIdx + 1;
      drawText(st, b.text, MARGIN, 13, st.bold);
      st.y += 17;
      st.page.drawLine({ start: { x: MARGIN, y: PAGE_H - st.y }, end: { x: PAGE_W - MARGIN, y: PAGE_H - st.y }, thickness: 0.8, color: BORDER });
      st.y += 8;
      break;
    }
    case "subheading":
      st.y += 5;
      need(st, 15);
      drawText(st, b.text, MARGIN, 10.5, st.bold, b.faculty ? rgb(0.6, 0.4, 0.05) : INK);
      st.y += 14;
      break;
    case "para":
      paragraph(st, b.text || "—", st.reg, 9.5);
      break;
    case "labeled": {
      const label = `${b.label}: `;
      const lw = st.bold.widthOfTextAtSize(sanitize(label), 9.5);
      need(st, 13);
      drawText(st, sanitize(label), MARGIN, 9.5, st.bold);
      // first line beside the label, remainder full width
      const lines = wrap(b.text || "—", st.reg, 9.5, CONTENT_W - lw);
      drawText(st, lines[0] ?? "", MARGIN + lw, 9.5, st.reg);
      st.y += 13;
      if (lines.length > 1) paragraph(st, lines.slice(1).join(" "), st.reg, 9.5);
      break;
    }
    case "bullets":
      for (const item of b.items) {
        const lines = wrap(item, st.reg, 9.5, CONTENT_W - 12);
        lines.forEach((ln, i) => {
          need(st, 13);
          if (i === 0) drawText(st, "-", MARGIN, 9.5, st.reg, MUTED);
          drawText(st, ln, MARGIN + 12, 9.5, st.reg);
          st.y += 13;
        });
      }
      break;
    case "mono":
      monoBox(st, b.text || "");
      break;
    case "table":
      drawTable(st, b.headers, b.rows, b.widths);
      break;
    case "observationBox":
      observationBox(st, b.lines);
      break;
    case "signLine":
      st.y += 18;
      need(st, 16);
      drawText(st, "Date: ______________", MARGIN, 9.5, st.reg, MUTED);
      drawText(st, "Signature: ______________", MARGIN + CONTENT_W - 150, 9.5, st.reg, MUTED);
      st.y += 16;
      break;
    case "blanks":
      for (const item of b.items) {
        need(st, 20);
        drawText(st, `${sanitize(item)}: ______________________________`, MARGIN, 11, st.reg);
        st.y += 22;
      }
      break;
    case "spacer":
      st.y += b.h;
      break;
    case "rule":
      st.y += 4;
      need(st, 6);
      st.page.drawLine({ start: { x: MARGIN, y: PAGE_H - st.y }, end: { x: PAGE_W - MARGIN, y: PAGE_H - st.y }, thickness: 0.4, color: RULE });
      st.y += 6;
      break;
  }
}

async function renderPass(model: ExportModel, resolvePage: Record<number, number> | null): Promise<{ bytes: Uint8Array; pageOf: Record<number, number>; totalPages: number }> {
  const doc = await PDFDocument.create();
  const st: St = {
    doc,
    page: doc.addPage([PAGE_W, PAGE_H]),
    pageIdx: 0,
    y: MARGIN,
    reg: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    mono: await doc.embedFont(StandardFonts.Courier),
    pageOf: {},
    resolvePage,
  };

  for (const b of model.blocks) renderBlock(st, b);

  // footer page numbers
  const pages = doc.getPages();
  pages.forEach((p, i) => {
    const label = `Page ${i + 1} of ${pages.length}`;
    const w = st.reg.widthOfTextAtSize(label, 8);
    p.drawText(label, { x: (PAGE_W - w) / 2, y: 20, size: 8, font: st.reg, color: MUTED });
  });

  return { bytes: await doc.save(), pageOf: st.pageOf, totalPages: pages.length };
}

export async function generateLabManualPdf(model: ExportModel): Promise<Buffer> {
  // Pass 1 — discover which page each practical lands on.
  const pass1 = await renderPass(model, null);
  // Pass 2 — resolve the contents page numbers. Layout is deterministic, so the
  // practical pages are unchanged; only the (short) contents cells differ.
  const pass2 = await renderPass(model, pass1.pageOf);
  return Buffer.from(pass2.bytes);
}
