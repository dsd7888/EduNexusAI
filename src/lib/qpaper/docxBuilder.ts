/**
 * Word (.docx) renderer for a generated question paper.
 *
 * Mirrors the PDF layout (src/lib/qpaper/builder.ts): per-page header
 * (subject | exam | date), centered title block with a horizontal rule,
 * instructions, then sections of questions with [marks]/[CO]/[BTL] tags.
 *
 * Two modes:
 *   - student copy (default): CO/BTL tags kept, no answers
 *   - answer key (`answerKey: true`): an "ANSWER KEY – CONFIDENTIAL" band in
 *     the header, plus model answers after each question in green. Model
 *     answers only render for questions that carry one (bank-sourced or
 *     faculty-edited); MCQ sub-parts also show the correct option.
 */

import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  LevelFormat,
  Packer,
  PageNumber,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TabStopPosition,
  TabStopType,
  TextRun,
  WidthType,
} from "docx";
import { parseInline, parseMarkdownLite, type Segment } from "@/lib/text/markdownLite";
import type {
  AssembledPaper,
  GeneratedQuestion,
  QuestionPart,
  SubQuestion,
} from "./builder";
import {
  isPoolItemMcqLike,
  poolAttemptCount,
  poolItemLabel,
  poolItemToPart,
  poolItemToSubQuestion,
  poolMarksPerItem,
} from "./poolRender";

/** Block-level docx node: a paragraph or a table. */
type Block = Paragraph | Table;

const ORDERED_LIST_REF = "rich-ordered";
// Each ordered list needs its own numbering instance so it restarts at 1.
let orderedInstanceSeq = 0;

const GREEN = "1B7F3A";
const RED = "B00020";
const RULE = {
  bottom: { style: BorderStyle.SINGLE, size: 6, color: "000000", space: 1 },
};

export interface DocxOptions {
  answerKey?: boolean;
  department?: string;
}

// ─── small helpers ──────────────────────────────────────────────────────────

function tag(part: { marks?: number; co?: string | null; btl?: number | null; po?: string | null }): string {
  const bits: string[] = [];
  if (part.marks != null) bits.push(`[${part.marks}M]`);
  if (part.co) bits.push(`[CO${String(part.co).replace(/^CO/i, "")}]`);
  if (part.btl != null) bits.push(`[BTL${part.btl}]`);
  if (part.po) bits.push(`[PO${String(part.po).replace(/^PO/i, "")}]`);
  return bits.join(" ");
}

function cleanLabel(raw: string | null | undefined): string {
  if (!raw) return "";
  return `(${String(raw).replace(/^\(/, "").replace(/\)$/, "")})`;
}

function questionLine(label: string, tags: string): Paragraph {
  // Label left, tags right via a right tab stop.
  return new Paragraph({
    tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
    spacing: { before: 120 },
    children: [
      new TextRun({ text: label, bold: true, size: 22 }),
      ...(tags ? [new TextRun({ text: `\t${tags}`, size: 20, color: "555555" })] : []),
    ],
  });
}

function answerPara(text: string, indent = 360): Paragraph {
  return new Paragraph({
    indent: { left: indent },
    spacing: { after: 60 },
    children: [
      new TextRun({ text: "Answer: ", bold: true, color: GREEN, size: 20 }),
      ...inlineRuns(text, { color: GREEN, size: 20 }),
    ],
  });
}

function blank(): Paragraph {
  return new Paragraph({ children: [new TextRun({ text: "", size: 12 })] });
}

/** Italic question-level instruction line (e.g. "Answer any two parts"). */
function questionInstructionLine(instruction: string): Paragraph {
  return new Paragraph({
    spacing: { before: 120, after: 40 },
    children: [new TextRun({ text: instruction, italics: true, size: 20 })],
  });
}

// ─── rich text (tables / lists / inline markdown) ────────────────────────────

interface RunStyle {
  size: number;
  color?: string;
  bold?: boolean;
}

/** Turn an inline run into docx TextRuns, honouring **bold** and `code`. */
function inlineRuns(text: string, style: RunStyle): TextRun[] {
  const tokens = parseInline(text);
  if (tokens.length === 0) return [new TextRun({ text: "", size: style.size })];
  return tokens.map(
    (tok) =>
      new TextRun({
        text: tok.value,
        size: style.size,
        color: style.color,
        bold: style.bold || tok.type === "bold",
        font: tok.type === "code" ? "Consolas" : undefined,
      })
  );
}

const CELL_BORDER = { style: BorderStyle.SINGLE, size: 4, color: "999999" };

/** Build a real docx Table with a shaded header row and bordered cells. */
function buildTable(
  headers: string[],
  rows: string[][],
  style: RunStyle,
  indent: number
): Table {
  const nCols = Math.max(1, headers.length);
  const cell = (text: string, header: boolean) =>
    new TableCell({
      shading: header ? { fill: "EDEDED" } : undefined,
      children: [
        new Paragraph({
          children: inlineRuns(text, { ...style, bold: header || style.bold }),
        }),
      ],
    });

  const headerRow = new TableRow({
    tableHeader: true,
    children: headers.map((h) => cell(h, true)),
  });
  const bodyRows = rows.map(
    (r) =>
      new TableRow({
        children: Array.from({ length: nCols }, (_, c) => cell(r[c] ?? "", false)),
      })
  );

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    indent: indent ? { size: indent, type: WidthType.DXA } : undefined,
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

/** Render parsed segments into docx blocks (paragraphs + tables + lists). */
function blocksFromSegments(
  segments: Segment[],
  style: RunStyle,
  indent: number
): Block[] {
  const out: Block[] = [];
  for (const seg of segments) {
    if (seg.type === "table") {
      out.push(buildTable(seg.headers, seg.rows, style, indent));
      continue;
    }
    if (seg.type === "list") {
      const instance = seg.ordered ? orderedInstanceSeq++ : undefined;
      for (const item of seg.items) {
        out.push(
          new Paragraph({
            spacing: { after: 20 },
            indent: { left: indent + 360 },
            ...(seg.ordered
              ? { numbering: { reference: ORDERED_LIST_REF, level: 0, instance } }
              : { bullet: { level: 0 } }),
            children: inlineRuns(item, style),
          })
        );
      }
      continue;
    }
    // text — one paragraph per line (blank lines collapse).
    for (const line of seg.content.split(/\n+/)) {
      if (!line.trim()) continue;
      out.push(
        new Paragraph({
          indent: { left: indent },
          spacing: { after: 40 },
          children: inlineRuns(line, style),
        })
      );
    }
  }
  return out;
}

/** Parse raw question/answer text and render it as docx blocks. */
function richBody(text: string, style: RunStyle, indent = 360): Block[] {
  return blocksFromSegments(parseMarkdownLite(text ?? ""), style, indent);
}

/** True when the text is a single plain line (no tables/lists/newlines). */
function isSimpleLine(text: string): boolean {
  const segs = parseMarkdownLite(text ?? "");
  return (
    segs.length <= 1 &&
    (segs[0]?.type ?? "text") === "text" &&
    !/\n/.test(segs[0]?.type === "text" ? segs[0].content : "")
  );
}

/** Model answer that may contain tables/lists; falls back to the inline form. */
function richAnswer(text: string, indent = 360): Block[] {
  if (!text || isSimpleLine(text)) return [answerPara(text, indent)];
  return [
    new Paragraph({
      indent: { left: indent },
      spacing: { after: 20 },
      children: [new TextRun({ text: "Answer:", bold: true, color: GREEN, size: 20 })],
    }),
    ...richBody(text, { size: 20, color: GREEN }, indent),
  ];
}

// ─── question renderers ─────────────────────────────────────────────────────

function renderSubPart(
  sub: SubQuestion,
  answerKey: boolean
): Block[] {
  const out: Block[] = [];
  // Keep the label + first line of the question inline (with the CO/BTL tag);
  // any tables/lists/extra lines follow as their own blocks.
  const segs = parseMarkdownLite(sub.question ?? "");
  const firstText = segs[0]?.type === "text" ? segs[0].content : "";
  const headLine = firstText.split("\n")[0] ?? "";
  out.push(
    new Paragraph({
      indent: { left: 360 },
      spacing: { before: 60 },
      children: [
        new TextRun({ text: `${sub.label} `, bold: true, size: 22 }),
        ...inlineRuns(headLine, { size: 22 }),
        ...(tag({ co: sub.co, btl: sub.btl, po: sub.po })
          ? [new TextRun({ text: `  ${tag({ co: sub.co, btl: sub.btl, po: sub.po })}`, size: 18, color: "555555" })]
          : []),
      ],
    })
  );
  // Remaining content (rest of the first paragraph + any tables/lists).
  const restFirst = firstText.split("\n").slice(1).join("\n");
  const tail: Segment[] = [
    ...(restFirst.trim() ? [{ type: "text" as const, content: restFirst }] : []),
    ...segs.slice(1),
  ];
  out.push(...blocksFromSegments(tail, { size: 22 }, 360));
  if (sub.options) {
    for (const k of ["a", "b", "c", "d"] as const) {
      const v = sub.options[k];
      if (!v) continue;
      out.push(
        new Paragraph({
          indent: { left: 720 },
          children: [new TextRun({ text: `(${k}) ${v}`, size: 20 })],
        })
      );
    }
  }
  if (answerKey) {
    const correct = sub.correct_option
      ? `(${String(sub.correct_option).toLowerCase()})${
          sub.options?.[String(sub.correct_option).toLowerCase()]
            ? ` ${sub.options[String(sub.correct_option).toLowerCase()]}`
            : ""
        }`
      : sub.model_answer ?? null;
    if (correct) out.push(...richAnswer(correct, 720));
  }
  return out;
}

function renderPart(
  label: string,
  part: QuestionPart,
  answerKey: boolean
): Block[] {
  const out: Block[] = [];
  out.push(questionLine(label, tag({ marks: part.marks, co: part.co, btl: part.btl, po: part.po })));
  out.push(...richBody(part.question, { size: 22 }, 360));
  if (answerKey && part.model_answer) out.push(...richAnswer(part.model_answer));
  return out;
}

/** Attempt-any-one option row (roman label + text + CO/BTL/PO tag). */
function renderTaggedOption(
  part: QuestionPart,
  idx: number,
  answerKey: boolean
): Block[] {
  const out: Block[] = [];
  const lbl = cleanLabel(part.label ?? poolItemLabel(idx));
  const segs = parseMarkdownLite(part.question ?? "");
  const firstText = segs[0]?.type === "text" ? segs[0].content : "";
  const headLine = firstText.split("\n")[0] ?? "";
  out.push(
    new Paragraph({
      indent: { left: 360 },
      spacing: { before: 60 },
      tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
      children: [
        new TextRun({ text: `${lbl} `, bold: true, size: 22 }),
        ...inlineRuns(headLine, { size: 22 }),
        ...(tag({ co: part.co, btl: part.btl, po: part.po })
          ? [new TextRun({ text: `\t${tag({ co: part.co, btl: part.btl, po: part.po })}`, size: 18, color: "555555" })]
          : []),
      ],
    })
  );
  const restFirst = firstText.split("\n").slice(1).join("\n");
  const tail: Segment[] = [
    ...(restFirst.trim() ? [{ type: "text" as const, content: restFirst }] : []),
    ...segs.slice(1),
  ];
  out.push(...blocksFromSegments(tail, { size: 22 }, 360));
  if (answerKey && part.model_answer) out.push(...richAnswer(part.model_answer, 720));
  return out;
}

function renderQuestion(
  q: GeneratedQuestion,
  answerKey: boolean
): Block[] {
  const out: Block[] = [];
  const label = q.display_label ?? `Q.${q.q_number}`;
  const type = (q.type ?? "").toLowerCase();

  if (type === "mcq") {
    out.push(
      new Paragraph({
        tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
        spacing: { before: 120 },
        children: [
          new TextRun({ text: label, bold: true, size: 22 }),
          ...(q.instruction ? [new TextRun({ text: `  ${q.instruction}`, size: 20 })] : []),
          new TextRun({ text: `\t[${q.total_marks}M]`, size: 20, color: "555555" }),
        ],
      })
    );
    for (const sub of q.sub_parts ?? []) out.push(...renderSubPart(sub, answerKey));
    out.push(blank());
    return out;
  }

  if (type === "descriptive_with_or") {
    const primary = (q.parts ?? []).filter((p) => !p.is_or_alternative);
    const alts = (q.parts ?? []).filter((p) => p.is_or_alternative);
    // Question-level instruction — the on-screen preview and the PDF both show
    // this for every question type; render it here so descriptive blocks don't
    // silently drop a faculty-set instruction in the Word export.
    if (q.instruction) out.push(questionInstructionLine(q.instruction));
    primary.forEach((p) => {
      const lbl = p.label ? `${label} ${cleanLabel(p.label)}` : label;
      out.push(...renderPart(lbl, p, answerKey));
    });
    if (alts.length > 0) {
      out.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 60, after: 60 },
          children: [new TextRun({ text: "OR", italics: true, bold: true, size: 22 })],
        })
      );
      alts.forEach((p) => {
        const lbl = p.label ? `${label} ${cleanLabel(p.label)}` : label;
        out.push(...renderPart(lbl, p, answerKey));
      });
    }
    out.push(blank());
    return out;
  }

  if (type === "attempt_any_one") {
    out.push(
      new Paragraph({
        tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
        spacing: { before: 120 },
        children: [
          new TextRun({ text: label, bold: true, size: 22 }),
          new TextRun({ text: `  ${q.instruction ?? "Attempt any one."}`, italics: true, size: 20 }),
          new TextRun({ text: `\t[${q.total_marks}M]`, size: 20, color: "555555" }),
        ],
      })
    );
    (q.parts ?? []).forEach((p, i) => {
      out.push(...renderTaggedOption(p, i, answerKey));
    });
    out.push(blank());
    return out;
  }

  if (type === "pool") {
    const instruction =
      q.instruction ??
      `Attempt any ${poolAttemptCount(q)} of the following ${q.items?.length ?? 0} questions.`;
    out.push(
      new Paragraph({
        tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
        spacing: { before: 120 },
        children: [
          new TextRun({ text: label, bold: true, size: 22 }),
          new TextRun({ text: `  ${instruction}`, italics: true, size: 20 }),
          new TextRun({ text: `\t[${q.total_marks}M]`, size: 20, color: "555555" }),
        ],
      })
    );
    const marksPer = poolMarksPerItem(q);
    (q.items ?? []).forEach((item, i) => {
      if (isPoolItemMcqLike(item.itemType)) {
        out.push(...renderSubPart(poolItemToSubQuestion(item, i), answerKey));
      } else {
        out.push(...renderTaggedOption(poolItemToPart(item, i, marksPer), i, answerKey));
      }
    });
    out.push(blank());
    return out;
  }

  // descriptive (single / multi part)
  const parts = q.parts ?? [];
  if (q.instruction) out.push(questionInstructionLine(q.instruction));
  if (parts.length <= 1) {
    const p = parts[0];
    if (p) out.push(...renderPart(label, p, answerKey));
    else out.push(questionLine(label, `[${q.total_marks}M]`));
  } else {
    parts.forEach((p) => {
      const lbl = p.label ? `${label} ${cleanLabel(p.label)}` : label;
      out.push(...renderPart(lbl, p, answerKey));
    });
  }
  out.push(blank());
  return out;
}

// ─── document assembly ──────────────────────────────────────────────────────

export async function generateQpaperDocx(
  paper: AssembledPaper,
  options: DocxOptions = {}
): Promise<Buffer> {
  const answerKey = options.answerKey === true;
  const department = options.department ?? "Engineering";
  const examType = paper.examTitle ?? "Examination";
  const dateStr = paper.date ?? "____________";
  orderedInstanceSeq = 0; // restart ordered-list numbering per document

  // ── per-page header: Subject | Exam | Date ────────────────────────────
  const headerChildren: Paragraph[] = [];
  if (answerKey) {
    headerChildren.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({
            text: "ANSWER KEY – CONFIDENTIAL",
            bold: true,
            color: RED,
            size: 20,
          }),
        ],
      })
    );
  }
  headerChildren.push(
    new Paragraph({
      tabStops: [
        { type: TabStopType.CENTER, position: 4680 },
        { type: TabStopType.RIGHT, position: TabStopPosition.MAX },
      ],
      children: [
        new TextRun({ text: `${paper.courseName}`, size: 16, color: "666666" }),
        new TextRun({ text: `\t${examType}`, size: 16, color: "666666" }),
        new TextRun({ text: `\t${dateStr}`, size: 16, color: "666666" }),
      ],
    })
  );

  // ── title block ───────────────────────────────────────────────────────
  const title: Paragraph[] = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 120 },
      children: [new TextRun({ text: paper.universityName, bold: true, size: 28 })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: `Department of ${department}`, size: 24 })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: `${paper.courseCode} – ${paper.courseName}`,
          size: 24,
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({ text: examType, size: 22 }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 40 },
      tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
      children: [
        new TextRun({ text: `Date: ${dateStr}    Time: ${paper.duration} Minutes`, size: 22 }),
        new TextRun({ text: `\tMax Marks: ${paper.totalMarks}`, size: 22, bold: true }),
      ],
    }),
    new Paragraph({ border: RULE, spacing: { after: 120 }, children: [] }),
  ];

  // ── instructions ──────────────────────────────────────────────────────
  const instructions: Paragraph[] = [];
  if (paper.instructions && paper.instructions.length > 0) {
    instructions.push(
      new Paragraph({
        spacing: { after: 40 },
        children: [new TextRun({ text: "Instructions:", bold: true, italics: true, size: 20 })],
      })
    );
    paper.instructions.forEach((ins, i) => {
      instructions.push(
        new Paragraph({
          indent: { left: 360 },
          children: [new TextRun({ text: `${i + 1}. ${ins}`, italics: true, size: 20 })],
        })
      );
    });
    instructions.push(blank());
  }

  // ── sections ──────────────────────────────────────────────────────────
  const sectionParas: Block[] = [];
  const flat = paper.flatLayout === true;
  let qGlobal = 0;
  for (const section of paper.sections) {
    if (!flat) {
      sectionParas.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 160, after: 40 },
          children: [
            new TextRun({ text: section.section_name.toUpperCase(), bold: true, size: 24 }),
          ],
        })
      );
      sectionParas.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 80 },
          children: [
            new TextRun({ text: "Attempt all questions.", italics: true, size: 20 }),
          ],
        })
      );
    }
    for (const q of section.questions) {
      const renderQ = flat
        ? { ...q, display_label: `Q.${++qGlobal}` }
        : q;
      sectionParas.push(...renderQuestion(renderQ, answerKey));
    }
  }

  const doc = new Document({
    styles: { default: { document: { run: { font: "Arial", size: 22 } } } },
    numbering: {
      config: [
        {
          reference: ORDERED_LIST_REF,
          levels: [
            {
              level: 0,
              format: LevelFormat.DECIMAL,
              text: "%1.",
              alignment: AlignmentType.START,
              style: { paragraph: { indent: { left: 720, hanging: 360 } } },
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: 12240, height: 15840 }, // US Letter
            margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
          },
        },
        headers: { default: new Header({ children: headerChildren }) },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({ text: "Page ", size: 18 }),
                  new TextRun({ children: [PageNumber.CURRENT], size: 18 }),
                  new TextRun({ text: " of ", size: 18 }),
                  new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 18 }),
                ],
              }),
            ],
          }),
        },
        children: [...title, ...instructions, ...sectionParas],
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  return Buffer.from(buffer);
}
