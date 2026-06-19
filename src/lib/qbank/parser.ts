/**
 * Lenient parsing + normalisation for Q Bank imports (CSV / TXT) and the
 * shared fuzzy module matcher used by both import and generation.
 *
 * No external CSV dependency — a small RFC-4180-ish reader handles quoted
 * fields, embedded commas, and escaped quotes ("") so faculty spreadsheets
 * (which routinely contain commas inside question text) parse correctly.
 */

import type { Difficulty, ImportedQuestion, QuestionType } from "./types";

// ─── Value normalisation ───────────────────────────────────────────────────

const QUESTION_TYPE_ALIASES: Record<string, QuestionType> = {
  mcq: "mcq",
  "multiple choice": "mcq",
  "multiple-choice": "mcq",
  objective: "mcq",
  short: "short_answer",
  "short answer": "short_answer",
  short_answer: "short_answer",
  sa: "short_answer",
  long: "long_answer",
  "long answer": "long_answer",
  long_answer: "long_answer",
  la: "long_answer",
  essay: "long_answer",
  descriptive: "long_answer",
  numerical: "numerical",
  num: "numerical",
  numeric: "numerical",
  calculation: "numerical",
  problem: "numerical",
  fill_blank: "fill_blank",
  "fill in the blank": "fill_blank",
  "fill in the blanks": "fill_blank",
  "fill blank": "fill_blank",
  blank: "fill_blank",
};

const BTL_NAME_TO_LEVEL: Record<string, number> = {
  remember: 1,
  understand: 2,
  apply: 3,
  analyze: 4,
  analyse: 4,
  evaluate: 5,
  create: 6,
};

const DIFFICULTIES: ReadonlySet<string> = new Set(["easy", "medium", "hard"]);

/**
 * Normalise a question-type string. "2M"/"3M" → short_answer, "5M"/"10M" →
 * long_answer (a marks-only hint). Returns null if unrecognised.
 */
export function normaliseQuestionType(raw: string): QuestionType | null {
  const s = raw.toLowerCase().trim();
  if (!s) return null;
  if (QUESTION_TYPE_ALIASES[s]) return QUESTION_TYPE_ALIASES[s];

  // Marks-only hints sometimes appear in a type column.
  const marksHint = /^(\d+)\s*m(arks?)?$/.exec(s);
  if (marksHint) {
    return Number(marksHint[1]) >= 5 ? "long_answer" : "short_answer";
  }
  return null;
}

/** Parse "1M", "3 marks", "5" → 1, 3, 5. Returns null if no positive number. */
export function parseMarks(raw: string): number | null {
  const match = /(\d+(?:\.\d+)?)/.exec(raw);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Accept an integer 1–6 or a Bloom level name. Returns null if unparseable. */
export function parseBtlLevel(raw: string): number | null {
  const s = raw.toLowerCase().trim();
  if (!s) return null;
  if (BTL_NAME_TO_LEVEL[s]) return BTL_NAME_TO_LEVEL[s];
  const n = Number(s);
  return Number.isInteger(n) && n >= 1 && n <= 6 ? n : null;
}

export function parseDifficulty(raw: string): Difficulty | null {
  const s = raw.toLowerCase().trim();
  return DIFFICULTIES.has(s) ? (s as Difficulty) : null;
}

function parseCorrectOption(raw: string): "A" | "B" | "C" | "D" | undefined {
  const s = raw.toUpperCase().trim();
  return s === "A" || s === "B" || s === "C" || s === "D" ? s : undefined;
}

// ─── Fuzzy module matching ─────────────────────────────────────────────────

export interface ModuleRef {
  id: string;
  name: string;
}

function normaliseForMatch(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Best-effort match of a free-text module name to a module id.
 *   1. exact (normalised) name match
 *   2. one name contained in the other
 *   3. highest token-overlap (Jaccard) above a small threshold
 * Returns null if nothing is confidently close.
 */
export function matchModuleId(
  moduleName: string | undefined | null,
  modules: ModuleRef[]
): string | null {
  if (!moduleName) return null;
  const target = normaliseForMatch(moduleName);
  if (!target) return null;

  let best: { id: string; score: number } | null = null;
  const targetTokens = new Set(target.split(" ").filter(Boolean));

  for (const m of modules) {
    const cand = normaliseForMatch(m.name);
    if (!cand) continue;
    if (cand === target) return m.id; // exact wins immediately
    if (cand.includes(target) || target.includes(cand)) {
      if (!best || best.score < 0.9) best = { id: m.id, score: 0.9 };
      continue;
    }
    const candTokens = new Set(cand.split(" ").filter(Boolean));
    let overlap = 0;
    for (const t of targetTokens) if (candTokens.has(t)) overlap++;
    const union = new Set([...targetTokens, ...candTokens]).size;
    const score = union > 0 ? overlap / union : 0;
    if (score > 0 && (!best || score > best.score)) {
      best = { id: m.id, score };
    }
  }

  return best && best.score >= 0.34 ? best.id : null;
}

// ─── CSV reader ────────────────────────────────────────────────────────────

/** Parse CSV text into rows of cells. Handles quoted fields with commas/newlines. */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  // Strip BOM and normalise newlines.
  const src = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  // Flush trailing field/row (no final newline).
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // Drop fully-empty rows.
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

export interface ParseResult {
  questions: ImportedQuestion[];
  errors: string[]; // one per skipped row, with reason
  totalRows: number; // data rows seen (excludes header)
}

const HEADER_SYNONYMS: Record<string, string> = {
  question: "question_text",
  question_text: "question_text",
  "question text": "question_text",
  text: "question_text",
  type: "question_type",
  question_type: "question_type",
  "question type": "question_type",
  marks: "marks",
  mark: "marks",
  model_answer: "model_answer",
  answer: "model_answer",
  "model answer": "model_answer",
  option_a: "option_a",
  "option a": "option_a",
  a: "option_a",
  option_b: "option_b",
  "option b": "option_b",
  b: "option_b",
  option_c: "option_c",
  "option c": "option_c",
  c: "option_c",
  option_d: "option_d",
  "option d": "option_d",
  d: "option_d",
  correct_option: "correct_option",
  "correct option": "correct_option",
  correct: "correct_option",
  co_code: "co_code",
  co: "co_code",
  "co code": "co_code",
  btl_level: "btl_level",
  btl: "btl_level",
  "btl level": "btl_level",
  bloom: "btl_level",
  module_name: "module_name",
  module: "module_name",
  "module name": "module_name",
  difficulty: "difficulty",
  level: "difficulty",
};

/**
 * Parse CSV import text. Headers are case-insensitive and order-independent;
 * unknown columns are ignored. Rows missing required fields are recorded in
 * `errors` (with a 1-based row number) and skipped.
 */
export function parseImportCsv(text: string): ParseResult {
  const rows = parseCsvRows(text);
  const errors: string[] = [];
  if (rows.length === 0) {
    return { questions: [], errors: ["Empty file"], totalRows: 0 };
  }

  const header = rows[0].map((h) => HEADER_SYNONYMS[h.toLowerCase().trim()] ?? "");
  const col = (name: string) => header.indexOf(name);

  const idxText = col("question_text");
  const idxType = col("question_type");
  const idxMarks = col("marks");
  if (idxText === -1 || idxType === -1 || idxMarks === -1) {
    return {
      questions: [],
      errors: [
        "Missing required column(s): question_text, question_type, and marks are all required",
      ],
      totalRows: 0,
    };
  }

  const cell = (r: string[], i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");
  const questions: ImportedQuestion[] = [];
  const dataRows = rows.slice(1);

  dataRows.forEach((r, i) => {
    const rowNum = i + 2; // 1-based, +1 for header
    const questionText = cell(r, idxText);
    if (!questionText) {
      errors.push(`Row ${rowNum}: empty question_text — skipped`);
      return;
    }
    const marks = parseMarks(cell(r, idxMarks));
    if (marks === null) {
      errors.push(
        `Row ${rowNum}: marks "${cell(r, idxMarks)}" is not a positive number — skipped`
      );
      return;
    }
    const qType = normaliseQuestionType(cell(r, idxType)) ?? "short_answer";

    const q: ImportedQuestion = {
      question_text: questionText,
      question_type: qType,
      marks,
    };
    const modelAnswer = cell(r, col("model_answer"));
    if (modelAnswer) q.model_answer = modelAnswer;
    const oa = cell(r, col("option_a"));
    const ob = cell(r, col("option_b"));
    const oc = cell(r, col("option_c"));
    const od = cell(r, col("option_d"));
    if (oa) q.option_a = oa;
    if (ob) q.option_b = ob;
    if (oc) q.option_c = oc;
    if (od) q.option_d = od;
    const correct = parseCorrectOption(cell(r, col("correct_option")));
    if (correct) q.correct_option = correct;
    const co = cell(r, col("co_code"));
    if (co) q.co_code = co;
    const btl = parseBtlLevel(cell(r, col("btl_level")));
    if (btl !== null) q.btl_level = btl;
    const moduleName = cell(r, col("module_name"));
    if (moduleName) q.module_name = moduleName;
    const difficulty = parseDifficulty(cell(r, col("difficulty")));
    if (difficulty) q.difficulty = difficulty;

    questions.push(q);
  });

  return { questions, errors, totalRows: dataRows.length };
}

/**
 * Parse a plain-text import: one question per line, optional numbering and
 * inline [NM] (marks) / [CON] (CO) tags. Everything defaults to short_answer.
 *   "1. What is an algorithm? [1M] [CO1]"
 */
export function parseImportTxt(text: string): ParseResult {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const errors: string[] = [];
  const questions: ImportedQuestion[] = [];
  let dataRows = 0;

  lines.forEach((rawLine, i) => {
    const line = rawLine.trim();
    if (!line) return;
    dataRows++;
    const rowNum = i + 1;

    // Pull tags first, then strip them + any leading list numbering.
    const marksTag = /\[(\d+(?:\.\d+)?)\s*m(?:arks?)?\]/i.exec(line);
    const coTag = /\[(CO\s*\d+)\]/i.exec(line);
    const marks = marksTag ? Number(marksTag[1]) : 1;

    const questionText = line
      .replace(/\[(\d+(?:\.\d+)?)\s*m(?:arks?)?\]/gi, "")
      .replace(/\[(CO\s*\d+)\]/gi, "")
      .replace(/\[[^\]]*\]/g, "") // drop any other bracket tags
      .replace(/^\s*\d+[.)]\s*/, "") // leading "1." / "1)"
      .replace(/^\s*[-*]\s*/, "") // leading bullet
      .trim();

    if (!questionText) {
      errors.push(`Line ${rowNum}: empty after tag removal — skipped`);
      return;
    }
    if (!(marks > 0)) {
      errors.push(`Line ${rowNum}: invalid marks — skipped`);
      return;
    }

    const q: ImportedQuestion = {
      question_text: questionText,
      question_type: "short_answer",
      marks,
    };
    if (coTag) q.co_code = coTag[1].replace(/\s+/g, "").toUpperCase();
    questions.push(q);
  });

  return { questions, errors, totalRows: dataRows };
}
