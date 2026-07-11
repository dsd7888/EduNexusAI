// ============================================================================
// Lesson-plan Word (.docx) export — landscape course-file layout (docx v9).
//
// Structure mirrors the PDF export (pdfBuilder.ts) exactly (spec §6):
//   header block → THEORY table → PRACTICAL table → signature footer.
// Landscape orientation; table header rows repeat on page breaks; long cells
// wrap. Style conventions follow qpaper/docxBuilder.ts.
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
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from "docx";
import type { LessonPlanDoc } from "./types";
import {
  loadExportHeader,
  theoryTable,
  practicalTable,
  type ExportTable,
  type LessonPlanHeader,
} from "./exportShared";

const CELL_BORDER = {
  style: BorderStyle.SINGLE,
  size: 4,
  color: "999999",
} as const;

// Landscape US-Letter content width = 15840 − 2×720 margins = 14400 DXA.
const THEORY_WIDTHS = [620, 1600, 2900, 2900, 760, 520, 2400, 2700];
const PRACTICAL_WIDTHS = [620, 3556, 760, 1264, 4100, 4100];

function textCell(
  content: string,
  colWidth: number,
  opts: { header?: boolean } = {},
): TableCell {
  // split "\n" into separate paragraphs so multi-line cells wrap cleanly
  const lines = (content || "").split("\n");
  return new TableCell({
    width: { size: colWidth, type: WidthType.DXA },
    verticalAlign: VerticalAlign.TOP,
    shading: opts.header ? { fill: "E8E8E8" } : undefined,
    children: lines.map(
      (ln) =>
        new Paragraph({
          children: [
            new TextRun({ text: ln, bold: opts.header, size: opts.header ? 17 : 16 }),
          ],
        }),
    ),
  });
}

function buildTable(table: ExportTable, widths: number[]): Table {
  const headerRow = new TableRow({
    tableHeader: true, // repeat on every page
    children: table.headers.map((h, i) => textCell(h, widths[i] ?? 1000, { header: true })),
  });
  const bodyRows = table.rows.map(
    (r) =>
      new TableRow({
        cantSplit: true, // keep a session's row intact across a page break
        children: widths.map((w, i) => textCell(r[i] ?? "", w)),
      }),
  );
  return new Table({
    columnWidths: widths,
    layout: TableLayoutType.FIXED,
    width: { size: 14400, type: WidthType.DXA },
    borders: {
      top: CELL_BORDER,
      bottom: CELL_BORDER,
      left: CELL_BORDER,
      right: CELL_BORDER,
      insideHorizontal: CELL_BORDER,
      insideVertical: CELL_BORDER,
    },
    rows: [headerRow, ...bodyRows],
  });
}

function centered(text: string, size: number, bold = false): Paragraph {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text, bold, size })],
  });
}

function headerBlock(header: LessonPlanHeader): Paragraph[] {
  const line = (label: string, value: string) =>
    new Paragraph({
      children: [
        new TextRun({ text: `${label}: `, bold: true, size: 18 }),
        new TextRun({ text: value, size: 18 }),
      ],
    });
  return [
    centered(header.university, 30, true),
    centered(`${header.school} · ${header.department}`, 19),
    centered("Session-wise Lesson Plan / Course File", 22, true),
    new Paragraph({ text: "", spacing: { after: 80 } }),
    line("Course", `${header.courseCode} — ${header.courseName}`),
    line("Faculty", header.facultyName),
    line("Semester", header.semester),
    new Paragraph({ text: "", spacing: { after: 120 } }),
  ];
}

function sectionHeading(text: string): Paragraph {
  return new Paragraph({
    spacing: { before: 200, after: 100 },
    children: [new TextRun({ text, bold: true, size: 22 })],
  });
}

function signatureFooter(): (Paragraph | Table)[] {
  const sigCell = (label: string) =>
    new TableCell({
      borders: {
        top: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
        bottom: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
        left: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
        right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
      },
      width: { size: 4800, type: WidthType.DXA },
      children: [
        new Paragraph({ text: "", spacing: { before: 400 } }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: "____________________", size: 18 })],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: label, bold: true, size: 18 })],
        }),
      ],
    });
  return [
    new Paragraph({ text: "", spacing: { before: 300 } }),
    new Table({
      columnWidths: [4800, 4800, 4800],
      layout: TableLayoutType.FIXED,
      width: { size: 14400, type: WidthType.DXA },
      borders: {
        top: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
        bottom: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
        left: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
        right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
        insideHorizontal: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
        insideVertical: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
      },
      rows: [
        new TableRow({
          children: [sigCell("Faculty"), sigCell("HOD"), sigCell("Dean")],
        }),
      ],
    }),
  ];
}

export async function generateLessonPlanDocx(
  doc: LessonPlanDoc,
  subjectId: string,
  facultyId: string,
): Promise<Buffer> {
  const { header, moduleNames } = await loadExportHeader(subjectId, facultyId);

  const children: (Paragraph | Table)[] = [...headerBlock(header)];

  if (doc.theory.length > 0) {
    children.push(sectionHeading("A. Theory Plan (session-wise)"));
    children.push(buildTable(theoryTable(doc, moduleNames), THEORY_WIDTHS));
  }
  if (doc.practicals.length > 0) {
    children.push(sectionHeading("B. Practical Plan"));
    children.push(buildTable(practicalTable(doc), PRACTICAL_WIDTHS));
  }
  children.push(...signatureFooter());

  const document = new Document({
    styles: { default: { document: { run: { font: "Arial", size: 16 } } } },
    sections: [
      {
        properties: {
          page: {
            size: {
              orientation: PageOrientation.LANDSCAPE,
              width: 15840,
              height: 12240,
            },
            margin: { top: 720, right: 720, bottom: 720, left: 720 },
          },
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({ text: "Page ", size: 16 }),
                  new TextRun({ children: [PageNumber.CURRENT], size: 16 }),
                  new TextRun({ text: " of ", size: 16 }),
                  new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 16 }),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });

  const buffer = await Packer.toBuffer(document);
  return Buffer.from(buffer);
}
