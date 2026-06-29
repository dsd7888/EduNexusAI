"use client";

/**
 * Shared types, constants, and pure helpers for the Q-paper builder stages.
 * The page (page.tsx) owns the live builder state; the stage components under
 * this directory consume these types/helpers and receive state via props.
 *
 * Everything here is pure (no React, no I/O) so it can be reused freely across
 * the stage components and the parent orchestrator.
 */

import type { CustomBtlWeights } from "@/lib/qpaper/moduleAssignment";

// ─── Types ──────────────────────────────────────────────────────────────────

export type ContentType = "mcq" | "truefalse" | "short" | "long" | "numerical" | "pool";

/** Per-item types that can be composed into a pool question block. */
export type QuestionType =
  | "mcq"
  | "true_false"
  | "short"
  | "long"
  | "numerical"
  | "fill_blank";

export interface BuilderPoolCompositionRow {
  id: string;
  itemType: QuestionType;
  count: number;
}

export interface BuilderQuestion {
  id: string;
  displayLabel: string;
  contentType: ContentType;
  instruction: string;
  /** MCQ/True-False: number of sub-part rows (e.g. 6 mini MCQs). */
  subPartsCount: number;
  /** MCQ: marks per sub-part. Other types: ignored. */
  marksPerPart: number;
  /** Total marks for a single descriptive question. */
  marks: number;
  /** Has "OR" alternative — adds a mirrored block. */
  hasOr: boolean;
  /** Primary parts count (1 = single, 2 = a+b, etc.). Used with hasOr. */
  partsCount: number;
  /** Marks per part (descriptive_with_or / multi-part). */
  marksPerSubPart: number;
  /** "Attempt any N of M" modifier. */
  hasAttemptAny: boolean;
  attemptAnyTake: number;
  attemptAnyOfTotal: number;
  /** Per option marks for attempt-any. */
  attemptAnyMarks: number;
  /** Pool-only: mixed-type composition rows. */
  poolComposition: BuilderPoolCompositionRow[];
  /** Pool-only: K — how many items the student must attempt. */
  poolAttemptCount: number;
  /** Pool-only: marks awarded per attempted item. */
  poolMarksPerItem: number;
}

export interface BuilderSection {
  id: string;
  name: string;
  questions: BuilderQuestion[];
}

export interface InstructionItem {
  id: string;
  text: string;
}

export interface PaperMetadata {
  examTitle: string;
  semester: string;
  date: string;
  time: string;
  universityName: string;
  instructions: InstructionItem[];
}

/** Sourcing categories for the question mix (mirrors lib/qpaper/sourcing). */
export type SourceCategory = "fresh" | "pyq_style" | "bank";

/** Editable per-category percentages; should total 100 before generating. */
export interface SourcingMixState {
  fresh: number;
  pyq_style: number;
  bank: number;
}

/** Row metadata for rendering the mix editor, in display order. */
export const SOURCE_CATEGORY_META: ReadonlyArray<{
  key: SourceCategory;
  label: string;
  hint: string;
}> = [
  {
    key: "fresh",
    label: "Fresh",
    hint: "Original AI questions written from the syllabus",
  },
  {
    key: "pyq_style",
    label: "PYQ-style",
    hint: "AI questions mirroring past-paper phrasing & difficulty",
  },
  {
    key: "bank",
    label: "Bank",
    hint: "Pulled from your verified Q Bank (by module/CO/BTL)",
  },
];

export function defaultSourcingMix(): SourcingMixState {
  return { fresh: 80, pyq_style: 20, bank: 0 };
}

/** Starting point for the "Custom" difficulty allocator (mirrors Balanced). */
export function defaultCustomBtlWeights(): CustomBtlWeights {
  return { tier1: 25, tier2: 50, tier3: 25 };
}

export function sourcingMixTotal(m: SourcingMixState): number {
  return m.fresh + m.pyq_style + m.bank;
}

/** Convert UI state to the API array, dropping zero-weight categories. */
export function sourcingMixToApi(
  m: SourcingMixState
): Array<{ category: SourceCategory; percent: number }> {
  return SOURCE_CATEGORY_META.map(({ key }) => ({
    category: key,
    percent: m[key],
  })).filter((x) => x.percent > 0);
}

/** Draft state for the inline question editor. */
export interface EditDraft {
  question: string;
  options?: Record<string, string>; // keys a,b,c,d
  correct_option?: string;
  model_answer: string;
}

export interface ModuleRow {
  id: string;
  name: string;
  module_number: number;
  section_number: number | null;
  weightage_percent: number | null;
  /** Numeric levels (1..6) or text labels ("Remember", …). Drives the BTL preview. */
  btl_levels: string[] | number[] | null;
}

// ─── Server payload (returned from /api/generate/qpaper) ────────────────────

/** CO/BTL tag-validation verdict; present on a sub-part/part only on a mismatch. */
export interface TagValidation {
  matches: boolean;
  suggestedCO?: string;
  suggestedBTL?: number;
  reasoning: string;
}

export interface SubQuestion {
  label: string;
  question: string;
  options?: Record<string, string>;
  correct_option?: string;
  co?: string | null;
  btl?: number | null;
  po?: string | null;
  from_bank?: boolean;
  bank_id?: string;
  model_answer?: string | null;
  image_path?: string | null;
  image_url?: string | null;
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
  from_bank?: boolean;
  bank_id?: string;
  model_answer?: string | null;
  image_path?: string | null;
  image_url?: string | null;
  validation?: TagValidation;
}

export interface GeneratedQuestion {
  q_number: number;
  display_label?: string;
  type: string;
  instruction?: string | null;
  total_marks: number;
  attempt_logic?: string | null;
  sub_parts?: SubQuestion[];
  parts?: QuestionPart[];
  /** Populated on pool blocks after generation. */
  items?: PoolItem[];
  from_bank?: boolean;
}

export interface GeneratedSection {
  section_name: string;
  module_range?: [number, number];
  total_marks?: number;
  questions: GeneratedQuestion[];
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
  courseOutcomes?: Array<{ co_code: string; description: string }>;
  hasCoPoData?: boolean;
  /** When true: section headers suppressed, questions numbered Q-1, Q-2 … globally. */
  flatLayout?: boolean;
}

// ─── Template payload (sent to /api/qpaper/templates) ───────────────────────

export interface PoolCompositionEntry {
  itemType: QuestionType;
  count: number;
}

/** One generated item inside a pool block (populated after generation). */
export interface PoolItem {
  itemType: QuestionType;
  question_text: string;
  /** Present for mcq-like item types (mcq, true_false). */
  options?: Record<string, string>;
  model_answer?: string | null;
  co?: string | null;
  btl?: number | null;
  po?: string | null;
  image_path?: string | null;
  image_url?: string | null;
}

export interface TemplateQuestionPayload {
  q_number: number;
  display_label: string;
  type: "mcq" | "descriptive" | "descriptive_with_or" | "attempt_any_one";
  instruction: string | null;
  total_marks: number;
  sub_parts?: number;
  marks_per_part?: number;
  parts?: string[];
  has_numerical?: boolean;
  attempt_logic: string | null;
}

/**
 * Mixed-type pool block: N items of various types, student attempts K of them.
 * Default instruction (when omitted): "Attempt any {attemptCount} of the following {N} questions."
 */
export interface TemplatePoolQuestionPayload {
  q_number: number;
  display_label: string;
  type: "pool";
  total_marks: number;
  composition: PoolCompositionEntry[];
  /** K — how many of the total items must be attempted. */
  attemptCount: number;
  /** Single mark value applied to every item regardless of itemType. */
  marksPerItem: number;
  instruction?: string;
  /** Populated after generation. */
  items?: PoolItem[];
}

export type TemplateQuestionBlockPayload =
  | TemplateQuestionPayload
  | TemplatePoolQuestionPayload;

export interface TemplateSectionPayload {
  section_name: string;
  module_range: [number, number];
  total_marks: number;
  questions: TemplateQuestionBlockPayload[];
}

// ─── Constants ──────────────────────────────────────────────────────────────

export const CONTENT_TYPE_LABELS: Record<ContentType, string> = {
  mcq: "MCQ",
  truefalse: "True / False",
  short: "Short Answer",
  long: "Long Answer",
  numerical: "Numerical",
  pool: "Question Pool",
};

/** Pool composition row item types shown in the builder dropdown. */
export const POOL_ITEM_TYPES = [
  "mcq",
  "true_false",
  "short",
  "long",
  "numerical",
] as const satisfies readonly QuestionType[];

export type PoolItemType = (typeof POOL_ITEM_TYPES)[number];

export const POOL_ITEM_TYPE_LABELS: Record<PoolItemType, string> = {
  mcq: "MCQ",
  true_false: "True / False",
  short: "Short Answer",
  long: "Long Answer",
  numerical: "Numerical",
};

export const DEFAULT_INSTRUCTIONS = [
  "All questions of Section I and Section II must be attempted in separate answer sheets.",
  "Make suitable assumptions and draw neat figures wherever required.",
  "Use of scientific calculator is allowed.",
  "Figures to the right indicate full marks.",
];

export const QUIZ_INSTRUCTIONS = [
  "All questions are compulsory.",
  "Each question carries 1 mark.",
  "No negative marking.",
];

export const PART_LETTERS = "abcdefghijklmnopqrstuvwxyz";

// ─── Helpers ────────────────────────────────────────────────────────────────

export function uid() {
  return Math.random().toString(36).slice(2, 10);
}

export function makeInstruction(text = ""): InstructionItem {
  return { id: uid(), text };
}

export function defaultMetadata(): PaperMetadata {
  return {
    examTitle: "",
    semester: "",
    date: "",
    time: "150 Minutes",
    universityName: "P P Savani University",
    instructions: DEFAULT_INSTRUCTIONS.map(makeInstruction),
  };
}

export function defaultPoolInstruction(k: number, n: number): string {
  return `Attempt any ${k} of the following ${n} questions.`;
}

export function poolTotalCount(composition: PoolCompositionEntry[]): number {
  return composition.reduce((sum, row) => sum + row.count, 0);
}

export function defaultPoolComposition(): BuilderPoolCompositionRow[] {
  return [{ id: uid(), itemType: "mcq", count: 5 }];
}

export function newQuestion(
  contentType: ContentType = "long",
  patch: Partial<BuilderQuestion> = {}
): BuilderQuestion {
  const defaults: Record<ContentType, Partial<BuilderQuestion>> = {
    mcq: { subPartsCount: 5, marksPerPart: 1, marks: 5 },
    truefalse: { subPartsCount: 5, marksPerPart: 1, marks: 5 },
    short: { subPartsCount: 1, marksPerPart: 1, marks: 3 },
    long: { subPartsCount: 1, marksPerPart: 1, marks: 5 },
    numerical: { subPartsCount: 1, marksPerPart: 1, marks: 5 },
    pool: {
      poolComposition: defaultPoolComposition(),
      poolAttemptCount: 3,
      poolMarksPerItem: 1,
    },
  };
  const poolComposition =
    patch.poolComposition ??
    defaults[contentType]?.poolComposition ??
    defaultPoolComposition();
  const poolN = poolTotalCount(poolComposition);
  const poolK =
    patch.poolAttemptCount ??
    defaults[contentType]?.poolAttemptCount ??
    Math.min(3, Math.max(1, poolN));
  const base: BuilderQuestion = {
    id: uid(),
    displayLabel: "Q - ?",
    contentType,
    instruction:
      contentType === "pool"
        ? defaultPoolInstruction(poolK, poolN)
        : "",
    subPartsCount: 1,
    marksPerPart: 1,
    marks: 5,
    hasOr: false,
    partsCount: 1,
    marksPerSubPart: 6,
    hasAttemptAny: false,
    attemptAnyTake: 1,
    attemptAnyOfTotal: 2,
    attemptAnyMarks: 6,
    poolComposition,
    poolAttemptCount: poolK,
    poolMarksPerItem: 1,
    ...defaults[contentType],
    ...patch,
  };
  return base;
}

export function qbankTypeToContentType(t: string): ContentType {
  if (t === "mcq") return "mcq";
  if (t === "short_answer" || t === "fill_blank") return "short";
  if (t === "numerical") return "numerical";
  return "long";
}

export function effectiveMarks(q: BuilderQuestion): number {
  if (q.contentType === "pool") {
    return q.poolAttemptCount * q.poolMarksPerItem;
  }
  if (q.contentType === "mcq" || q.contentType === "truefalse") {
    return q.subPartsCount * q.marksPerPart;
  }
  if (q.hasAttemptAny) {
    return q.attemptAnyTake * q.attemptAnyMarks;
  }
  if (q.hasOr) {
    return q.partsCount * q.marksPerSubPart;
  }
  return q.marks;
}

export function sectionTotal(s: BuilderSection): number {
  return s.questions.reduce((sum, q) => sum + effectiveMarks(q), 0);
}

export function paperTotal(sections: BuilderSection[]): number {
  return sections.reduce((sum, s) => sum + sectionTotal(s), 0);
}

export function toTemplateQuestion(
  q: BuilderQuestion,
  qNumber: number
): TemplateQuestionBlockPayload {
  const display_label = q.displayLabel?.trim() || `Q - ${qNumber}`;
  const instruction = q.instruction.trim() ? q.instruction.trim() : null;

  if (q.contentType === "pool") {
    const n = poolTotalCount(q.poolComposition);
    return {
      q_number: qNumber,
      display_label,
      type: "pool",
      total_marks: q.poolAttemptCount * q.poolMarksPerItem,
      composition: q.poolComposition.map(({ itemType, count }) => ({
        itemType,
        count,
      })),
      attemptCount: q.poolAttemptCount,
      marksPerItem: q.poolMarksPerItem,
      instruction:
        instruction ?? defaultPoolInstruction(q.poolAttemptCount, n),
    };
  }

  if (q.contentType === "mcq" || q.contentType === "truefalse") {
    return {
      q_number: qNumber,
      display_label,
      type: "mcq",
      instruction:
        instruction ??
        (q.contentType === "truefalse"
          ? "True / False"
          : "MCQ/Short Question/Fill in the Blanks"),
      total_marks: q.subPartsCount * q.marksPerPart,
      sub_parts: q.subPartsCount,
      marks_per_part: q.marksPerPart,
      attempt_logic: null,
    };
  }

  if (q.hasAttemptAny) {
    return {
      q_number: qNumber,
      display_label,
      type: "attempt_any_one",
      instruction:
        instruction ?? `Attempt any ${q.attemptAnyTake} of ${q.attemptAnyOfTotal}.`,
      total_marks: q.attemptAnyTake * q.attemptAnyMarks,
      sub_parts: q.attemptAnyOfTotal,
      attempt_logic:
        q.attemptAnyTake === 1 ? "any_one" : `any_${q.attemptAnyTake}`,
    };
  }

  if (q.hasOr) {
    return {
      q_number: qNumber,
      display_label,
      type: "descriptive_with_or",
      instruction,
      total_marks: q.partsCount * q.marksPerSubPart,
      marks_per_part: q.marksPerSubPart,
      parts: Array.from({ length: q.partsCount }, (_, i) => PART_LETTERS[i]),
      attempt_logic: null,
    };
  }

  return {
    q_number: qNumber,
    display_label,
    type: "descriptive",
    instruction,
    total_marks: q.marks,
    has_numerical: q.contentType === "numerical",
    attempt_logic: null,
  };
}

export function moduleRangeForSection(
  sectionIdx: number,
  modules: ModuleRow[],
  selectedModuleIds: string[]
): [number, number] {
  const sectionNumber = sectionIdx + 1;
  const inSection = modules.filter(
    (m) =>
      selectedModuleIds.includes(m.id) &&
      (m.section_number == null || m.section_number === sectionNumber)
  );
  if (inSection.length === 0) {
    const all = modules.filter((m) => selectedModuleIds.includes(m.id));
    if (all.length === 0) return [0, 0];
    return [
      Math.min(...all.map((m) => m.module_number)),
      Math.max(...all.map((m) => m.module_number)),
    ];
  }
  return [
    Math.min(...inSection.map((m) => m.module_number)),
    Math.max(...inSection.map((m) => m.module_number)),
  ];
}

// ─── Prefill templates ──────────────────────────────────────────────────────

export function eseStandardSections(): BuilderSection[] {
  const build = (name: string): BuilderSection => ({
    id: uid(),
    name,
    questions: [
      newQuestion("mcq", {
        displayLabel: "Q - 1",
        instruction: "MCQ/Short Question/Fill in the Blanks",
        subPartsCount: 6,
        marksPerPart: 1,
      }),
      newQuestion("numerical", {
        displayLabel: "Q - 2",
        marks: 6,
      }),
      newQuestion("long", {
        displayLabel: "Q - 3",
        hasOr: true,
        partsCount: 2,
        marksPerSubPart: 6,
      }),
      newQuestion("long", {
        displayLabel: "Q - 4",
        instruction: "Attempt any one.",
        hasAttemptAny: true,
        attemptAnyTake: 1,
        attemptAnyOfTotal: 2,
        attemptAnyMarks: 6,
      }),
    ],
  });
  return [build("Section I"), build("Section II")];
}

export function quizSection(): BuilderSection[] {
  return [
    {
      id: uid(),
      name: "Section A",
      questions: [
        newQuestion("mcq", {
          displayLabel: "Q - 1",
          instruction: "Answer all questions.",
          subPartsCount: 10,
          marksPerPart: 1,
        }),
      ],
    },
  ];
}

export function eseMetadata(): PaperMetadata {
  return {
    examTitle: "Fifth Semester of B. Tech. Examination",
    semester: "Fifth Semester of B. Tech. Examination",
    date: "",
    time: "150 Minutes",
    universityName: "P P Savani University",
    instructions: DEFAULT_INSTRUCTIONS.map(makeInstruction),
  };
}

export function quizMetadata(): PaperMetadata {
  return {
    examTitle: "Continuous Evaluation Quiz",
    semester: "",
    date: "",
    time: "20 Minutes",
    universityName: "P P Savani University",
    instructions: QUIZ_INSTRUCTIONS.map(makeInstruction),
  };
}

// ─── Template payload assembly ──────────────────────────────────────────────

/** Inputs needed to assemble the /api/qpaper/templates POST body. */
export interface TemplatePayloadContext {
  sections: BuilderSection[];
  modules: ModuleRow[];
  selectedModuleIds: string[];
  meta: PaperMetadata;
  totalMarksLive: number;
  selectedSubjectId: string;
  flatLayout?: boolean;
}

export function buildTemplatePayload(name: string, ctx: TemplatePayloadContext) {
  const { sections, modules, selectedModuleIds, meta, totalMarksLive, selectedSubjectId, flatLayout } =
    ctx;
  let qCounter = 0;
  const apiSections: TemplateSectionPayload[] = sections.map((s, sIdx) => {
    const range = moduleRangeForSection(sIdx, modules, selectedModuleIds);
    const apiQuestions = s.questions.map((q) => {
      qCounter += 1;
      return toTemplateQuestion(q, qCounter);
    });
    return {
      section_name: s.name,
      module_range: range,
      total_marks: sectionTotal(s),
      questions: apiQuestions,
    };
  });

  return {
    subject_id: selectedSubjectId,
    name,
    university_name: meta.universityName,
    exam_title: meta.examTitle || meta.semester || null,
    duration_minutes: Number(meta.time.replace(/\D+/g, "")) || 150,
    total_marks: totalMarksLive,
    instructions: meta.instructions.map((i) => i.text.trim()).filter(Boolean),
    structure: { sections: apiSections, ...(flatLayout ? { flatLayout: true } : {}) },
    is_default: false,
  };
}

// ─── Template reverse (stored DB row → builder state) ───────────────────────

function fromTemplateQuestion(q: TemplateQuestionBlockPayload): BuilderQuestion {
  if (q.type === "pool") {
    const pool = q as TemplatePoolQuestionPayload;
    const n = poolTotalCount(pool.composition);
    return newQuestion("pool", {
      displayLabel: pool.display_label,
      instruction: pool.instruction ?? defaultPoolInstruction(pool.attemptCount, n),
      poolComposition: pool.composition.map((r) => ({ ...r, id: uid() })),
      poolAttemptCount: pool.attemptCount,
      poolMarksPerItem: pool.marksPerItem,
    });
  }

  const tq = q as TemplateQuestionPayload;

  if (tq.type === "mcq") {
    return newQuestion("mcq", {
      displayLabel: tq.display_label,
      instruction: tq.instruction ?? "",
      subPartsCount: tq.sub_parts ?? 5,
      marksPerPart: tq.marks_per_part ?? 1,
    });
  }

  if (tq.type === "descriptive_with_or") {
    const parts = tq.parts ?? ["a", "b"];
    const marksPerSub = tq.marks_per_part ?? Math.round(tq.total_marks / parts.length);
    return newQuestion("long", {
      displayLabel: tq.display_label,
      instruction: tq.instruction ?? "",
      hasOr: true,
      partsCount: parts.length,
      marksPerSubPart: marksPerSub,
    });
  }

  if (tq.type === "attempt_any_one") {
    const logic = tq.attempt_logic ?? "any_one";
    const take = logic === "any_one" ? 1 : (parseInt(logic.replace("any_", ""), 10) || 1);
    const ofTotal = tq.sub_parts ?? 2;
    const marksEach = take > 0 ? Math.round(tq.total_marks / take) : tq.total_marks;
    return newQuestion("long", {
      displayLabel: tq.display_label,
      instruction: tq.instruction ?? `Attempt any ${take} of ${ofTotal}.`,
      hasAttemptAny: true,
      attemptAnyTake: take,
      attemptAnyOfTotal: ofTotal,
      attemptAnyMarks: marksEach,
    });
  }

  // "descriptive" (and any unknown future type)
  return newQuestion(tq.has_numerical ? "numerical" : "long", {
    displayLabel: tq.display_label,
    instruction: tq.instruction ?? "",
    marks: tq.total_marks,
  });
}

/**
 * Reverse of buildTemplatePayload: reconstruct builder state from a stored
 * template row's `structure` jsonb and top-level header fields.
 * Pass `structure` as the raw JSON value from the DB row (typed as unknown here
 * so callers don't need to import the DB-side TemplateStructure type).
 */
export function fromTemplateStructure(
  structure: Record<string, unknown>,
  headers: {
    university_name: string;
    exam_title: string | null;
    duration_minutes: number;
    total_marks: number;
    instructions: string[] | null;
  }
): { sections: BuilderSection[]; meta: PaperMetadata; flatLayout: boolean; targetMarks: number } {
  const rawSections = (structure.sections as TemplateSectionPayload[] | undefined) ?? [];
  const flatLayout = Boolean(structure.flatLayout);

  const sections: BuilderSection[] = rawSections.map((s) => ({
    id: uid(),
    name: s.section_name,
    questions: s.questions.map(fromTemplateQuestion),
  }));

  const meta: PaperMetadata = {
    examTitle: headers.exam_title ?? "",
    semester: headers.exam_title ?? "",
    date: "",
    time: `${headers.duration_minutes} Minutes`,
    universityName: headers.university_name,
    instructions: (headers.instructions ?? []).map(makeInstruction),
  };

  return { sections, meta, flatLayout, targetMarks: headers.total_marks };
}
