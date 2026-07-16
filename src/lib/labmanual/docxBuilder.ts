// ============================================================================
// Lab-manual Word (.docx) export — portrait A4 (docx v9), spec §6.
//
// Consumes the SAME Block[] as the PDF builder, so the two formats stay
// structurally identical. Monospace via Courier New; shading is ShadingType.CLEAR
// fill only. Contents page numbers render as a static "—" (acceptable v1 — only
// the PDF computes real ones, spec §6).
// ============================================================================

import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  PageNumber,
  PageOrientation,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from "docx";
import type { Block, ExportModel } from "./exportShared";
import { PAGE_PLACEHOLDER_RE } from "./exportShared";

// A4 portrait content width = 11906 − 2×1134 margins ≈ 9638 DXA.
const CONTENT_DXA = 9638;
const CELL_BORDER = { style: BorderStyle.SINGLE, size: 4, color: "AAAAAA" } as const;
const NO_BORDER = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" } as const;

function resolveCell(text: string): string {
  return PAGE_PLACEHOLDER_RE.test(text) ? "—" : text;
}

function para(runs: TextRun[], opts: { spacingBefore?: number; spacingAfter?: number; align?: (typeof AlignmentType)[keyof typeof AlignmentType] } = {}): Paragraph {
  return new Paragraph({
    alignment: opts.align,
    spacing: { before: opts.spacingBefore ?? 0, after: opts.spacingAfter ?? 60 },
    children: runs,
  });
}

function monoParagraphs(text: string): Paragraph[] {
  const lines = (text || "").replace(/\t/g, "    ").split("\n");
  return lines.map(
    (ln) =>
      new Paragraph({
        spacing: { before: 0, after: 0 },
        shading: { type: ShadingType.CLEAR, fill: "F2F2F5", color: "auto" },
        children: [new TextRun({ text: ln || " ", font: "Courier New", size: 16 })],
      }),
  );
}

function table(headers: string[], rows: string[][], fracs?: number[]): Table {
  const f = fracs ?? headers.map(() => 1 / headers.length);
  const widths = f.map((x) => Math.round(x * CONTENT_DXA));
  const cell = (text: string, w: number, header: boolean) =>
    new TableCell({
      width: { size: w, type: WidthType.DXA },
      verticalAlign: VerticalAlign.TOP,
      shading: header ? { type: ShadingType.CLEAR, fill: "E6E6EA", color: "auto" } : undefined,
      children: resolveCell(text)
        .split("\n")
        .map(
          (ln) =>
            new Paragraph({
              spacing: { before: 0, after: 0 },
              children: [new TextRun({ text: ln, bold: header, size: 16 })],
            }),
        ),
    });
  return new Table({
    columnWidths: widths,
    layout: TableLayoutType.FIXED,
    width: { size: CONTENT_DXA, type: WidthType.DXA },
    borders: {
      top: CELL_BORDER, bottom: CELL_BORDER, left: CELL_BORDER, right: CELL_BORDER,
      insideHorizontal: CELL_BORDER, insideVertical: CELL_BORDER,
    },
    rows: [
      new TableRow({ tableHeader: true, children: widths.map((w, i) => cell(headers[i] ?? "", w, true)) }),
      ...rows.map((r) => new TableRow({ children: widths.map((w, i) => cell(r[i] ?? "", w, false)) })),
    ],
  });
}

/** A bordered box of empty ruled rows for handwriting. */
function observationTable(lines: number): Table {
  return new Table({
    columnWidths: [CONTENT_DXA],
    layout: TableLayoutType.FIXED,
    width: { size: CONTENT_DXA, type: WidthType.DXA },
    borders: {
      top: CELL_BORDER, bottom: CELL_BORDER, left: CELL_BORDER, right: CELL_BORDER,
      insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: "DDDDDD" },
      insideVertical: NO_BORDER,
    },
    rows: Array.from({ length: lines }).map(
      () =>
        new TableRow({
          height: { value: 340, rule: "atLeast" as const },
          children: [new TableCell({ width: { size: CONTENT_DXA, type: WidthType.DXA }, children: [new Paragraph({ text: "" })] })],
        }),
    ),
  });
}

function blockToDocx(b: Block): (Paragraph | Table)[] {
  switch (b.kind) {
    case "pageBreak":
      return [new Paragraph({ children: [], pageBreakBefore: true })];
    case "title":
      return [para([new TextRun({ text: b.text, bold: true, size: b.size * 2 })], { align: AlignmentType.CENTER, spacingBefore: 80, spacingAfter: 80 })];
    case "subtitle":
      return [para([new TextRun({ text: b.text, size: 22, color: "555555" })], { align: AlignmentType.CENTER })];
    case "heading":
      return [
        new Paragraph({
          spacing: { before: 240, after: 100 },
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "888888", space: 2 } },
          children: [new TextRun({ text: b.text, bold: true, size: 26 })],
        }),
      ];
    case "subheading":
      return [para([new TextRun({ text: b.text, bold: true, size: 21, color: b.faculty ? "9A6600" : "000000" })], { spacingBefore: 120, spacingAfter: 40 })];
    case "para":
      return [para([new TextRun({ text: b.text || "—", size: 19 })])];
    case "labeled":
      return [para([new TextRun({ text: `${b.label}: `, bold: true, size: 19 }), new TextRun({ text: b.text || "—", size: 19 })])];
    case "bullets":
      return b.items.map((it) => new Paragraph({ bullet: { level: 0 }, spacing: { after: 20 }, children: [new TextRun({ text: it, size: 19 })] }));
    case "mono":
      return monoParagraphs(b.text);
    case "table":
      return [table(b.headers, b.rows, b.widths), new Paragraph({ text: "", spacing: { after: 60 } })];
    case "observationBox":
      return [observationTable(b.lines), new Paragraph({ text: "", spacing: { after: 60 } })];
    case "signLine":
      return [para([new TextRun({ text: "Date: ______________            Signature: ______________", size: 19, color: "555555" })], { spacingBefore: 160 })];
    case "blanks":
      return b.items.map((it) => para([new TextRun({ text: `${it}: ______________________________`, size: 22 })], { spacingBefore: 60, spacingAfter: 60 }));
    case "spacer":
      return [new Paragraph({ text: "", spacing: { after: b.h * 15 } })];
    case "rule":
      return [new Paragraph({ spacing: { before: 40, after: 40 }, border: { bottom: { style: BorderStyle.SINGLE, size: 2, color: "DDDDDD", space: 1 } }, children: [] })];
  }
}

export async function generateLabManualDocx(model: ExportModel): Promise<Buffer> {
  const children: (Paragraph | Table)[] = [];
  for (const b of model.blocks) children.push(...blockToDocx(b));

  const document = new Document({
    styles: { default: { document: { run: { font: "Calibri", size: 19 } } } },
    sections: [
      {
        properties: {
          page: {
            size: { orientation: PageOrientation.PORTRAIT, width: 11906, height: 16838 },
            margin: { top: 1134, right: 1134, bottom: 1134, left: 1134 },
          },
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({ text: "Page ", size: 16, color: "777777" }),
                  new TextRun({ children: [PageNumber.CURRENT], size: 16, color: "777777" }),
                  new TextRun({ text: " of ", size: 16, color: "777777" }),
                  new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 16, color: "777777" }),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });

  return Buffer.from(await Packer.toBuffer(document));
}
