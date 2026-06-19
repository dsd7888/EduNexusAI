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
  Packer,
  PageNumber,
  Paragraph,
  TabStopPosition,
  TabStopType,
  TextRun,
} from "docx";
import type {
  AssembledPaper,
  GeneratedQuestion,
  QuestionPart,
  SubQuestion,
} from "./builder";

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

function tag(part: { marks?: number; co?: string | null; btl?: number | null }): string {
  const bits: string[] = [];
  if (part.marks != null) bits.push(`[${part.marks}M]`);
  if (part.co) bits.push(`[CO${String(part.co).replace(/^CO/i, "")}]`);
  if (part.btl != null) bits.push(`[BTL${part.btl}]`);
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

function bodyText(text: string, indent = 360): Paragraph {
  return new Paragraph({
    indent: { left: indent },
    spacing: { after: 40 },
    children: [new TextRun({ text, size: 22 })],
  });
}

function answerPara(text: string, indent = 360): Paragraph {
  return new Paragraph({
    indent: { left: indent },
    spacing: { after: 60 },
    children: [
      new TextRun({ text: "Answer: ", bold: true, color: GREEN, size: 20 }),
      new TextRun({ text, color: GREEN, size: 20 }),
    ],
  });
}

function blank(): Paragraph {
  return new Paragraph({ children: [new TextRun({ text: "", size: 12 })] });
}

// ─── question renderers ─────────────────────────────────────────────────────

function renderSubPart(
  sub: SubQuestion,
  answerKey: boolean
): Paragraph[] {
  const out: Paragraph[] = [];
  out.push(
    new Paragraph({
      indent: { left: 360 },
      spacing: { before: 60 },
      children: [
        new TextRun({ text: `${sub.label} `, bold: true, size: 22 }),
        new TextRun({ text: sub.question, size: 22 }),
        ...(tag({ co: sub.co, btl: sub.btl })
          ? [new TextRun({ text: `  ${tag({ co: sub.co, btl: sub.btl })}`, size: 18, color: "555555" })]
          : []),
      ],
    })
  );
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
    if (correct) out.push(answerPara(correct, 720));
  }
  return out;
}

function renderPart(
  label: string,
  part: QuestionPart,
  answerKey: boolean
): Paragraph[] {
  const out: Paragraph[] = [];
  out.push(questionLine(label, tag({ marks: part.marks, co: part.co, btl: part.btl })));
  out.push(bodyText(part.question));
  if (answerKey && part.model_answer) out.push(answerPara(part.model_answer));
  return out;
}

function renderQuestion(
  q: GeneratedQuestion,
  answerKey: boolean
): Paragraph[] {
  const out: Paragraph[] = [];
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
      const lbl = cleanLabel(p.label ?? `${["i", "ii", "iii", "iv"][i] ?? i + 1}`);
      out.push(
        new Paragraph({
          indent: { left: 360 },
          spacing: { before: 60 },
          tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
          children: [
            new TextRun({ text: `${lbl} `, bold: true, size: 22 }),
            new TextRun({ text: p.question, size: 22 }),
            ...(tag({ co: p.co, btl: p.btl })
              ? [new TextRun({ text: `\t${tag({ co: p.co, btl: p.btl })}`, size: 18, color: "555555" })]
              : []),
          ],
        })
      );
      if (answerKey && p.model_answer) out.push(answerPara(p.model_answer, 720));
    });
    out.push(blank());
    return out;
  }

  // descriptive (single / multi part)
  const parts = q.parts ?? [];
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
        new TextRun({
          text: `${examType}    Max Marks: ${paper.totalMarks}    Duration: ${paper.duration} Minutes`,
          size: 22,
        }),
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
  const sectionParas: Paragraph[] = [];
  for (const section of paper.sections) {
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
    for (const q of section.questions) {
      sectionParas.push(...renderQuestion(q, answerKey));
    }
  }

  const doc = new Document({
    styles: { default: { document: { run: { font: "Arial", size: 22 } } } },
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
