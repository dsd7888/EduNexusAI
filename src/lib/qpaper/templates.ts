/**
 * Paper template shapes (the `structure` jsonb on `qpaper_templates`).
 *
 * Three preset templates ship with every subject:
 *   - PPSU_ESE: standard end-semester exam (60 marks, 2 sections of 30M)
 *   - CE_QUIZ: continuous-evaluation quiz (10 MCQs, 10 marks, single section)
 *   - CUSTOM:  empty starting point — the faculty builds the structure
 *
 * The preset identity is stored INSIDE the `structure` jsonb as `preset_key`
 * so the existing migration schema (no extra column) keeps working.
 */

export type TemplateQuestionType =
  | "mcq"
  | "descriptive"
  | "descriptive_with_or"
  | "attempt_any_one";

/** Per-item types that can be composed into a pool question block. */
export type QuestionType =
  | "mcq"
  | "true_false"
  | "short"
  | "long"
  | "numerical"
  | "fill_blank";

export interface PoolCompositionEntry {
  itemType: QuestionType;
  count: number;
  /** Pinned module id for this composition row. null/absent = auto. */
  pinnedModuleId?: string | null;
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
  /** Storage path of an attached image (bank-sourced); used by PDF/Word export. */
  image_path?: string | null;
  /** Signed URL for the attached image; minted server-side for the web preview. */
  image_url?: string | null;
}

export type PresetKey = "PPSU_ESE" | "CE_QUIZ" | "CUSTOM";

/** Fields shared by every question block in a template section. */
interface TemplateQuestionBlockShared {
  q_number: number;
  display_label: string;
  total_marks: number;
  instruction?: string | null;
  sub_parts?: number;
  marks_per_part?: number;
  parts?: string[];
  has_numerical?: boolean;
  attempt_logic?: string | null;
}

export interface TemplateQuestion extends TemplateQuestionBlockShared {
  type: TemplateQuestionType;
  /** Pinned module id — basic mcq/descriptive rows only. When set,
   *  assignModulesToSlots uses this module directly instead of pickModule.
   *  null/absent = automatic weightage-based assignment (default). */
  pinnedModuleId?: string | null;
  /** attempt_any_one only: K — how many of the `sub_parts` options the student
   *  must attempt. `sub_parts` carries M (total options) and `marks_per_part`
   *  carries the per-option mark value. Absent on old templates — derive from
   *  `attempt_logic` ("any_2" → 2) via {@link attemptAnyCount}. */
  attemptCount?: number;
}

/**
 * Mixed-type pool block: N items of various types, student attempts K of them.
 * Default instruction (when omitted): "Attempt any {attemptCount} of the following {N} questions."
 */
export interface TemplatePoolQuestion extends TemplateQuestionBlockShared {
  type: "pool";
  composition: PoolCompositionEntry[];
  /** K — how many of the total items must be attempted. */
  attemptCount: number;
  /** Single mark value applied to every item regardless of itemType. */
  marksPerItem: number;
  /** Populated after generation. */
  items?: PoolItem[];
}

export type TemplateQuestionBlock = TemplateQuestion | TemplatePoolQuestion;

/** MCQ-like pool items share the mcq assignment / options path. */
export function isPoolItemMcqLike(itemType: QuestionType): boolean {
  return itemType === "mcq" || itemType === "true_false";
}

/** Maps a pool item type to the module-assignment qType (TYPE_BTL_RANGE key). */
export function poolItemAssignmentQType(itemType: QuestionType): string {
  if (isPoolItemMcqLike(itemType)) return "mcq";
  if (itemType === "numerical") return "numerical";
  return "descriptive";
}

/** Maps a pool item type to token-budget generation profile keys. */
export function poolItemTokenBudgetType(itemType: QuestionType): string {
  if (isPoolItemMcqLike(itemType)) return "mcq";
  if (itemType === "numerical") return "numerical";
  if (itemType === "long") return "long_answer";
  if (itemType === "fill_blank") return "fill_blank";
  return "short_answer";
}

export function poolTotalItems(composition: PoolCompositionEntry[]): number {
  return composition.reduce((sum, row) => sum + row.count, 0);
}

// ─── attempt_any_one config (faculty-configured N of M) ─────────────────────
// These read the faculty-configured "Attempt any K of M, marks/option" values
// off a template block, tolerating old templates that only stored
// `attempt_logic` + `sub_parts`. They are the single source of truth for the
// standalone attempt-any block — never infer N/M/marks from AI output shape.

/** Minimal structural shape shared by attempt_any_one template blocks. */
type AttemptAnyLike = {
  sub_parts?: number;
  marks_per_part?: number;
  attemptCount?: number;
  attempt_logic?: string | null;
  total_marks: number;
};

/** M — total number of options offered by an attempt_any_one block. */
export function attemptAnyTotalOptions(t: AttemptAnyLike): number {
  return Math.max(2, t.sub_parts ?? 2);
}

/** K — how many options the student must attempt. */
export function attemptAnyCount(t: AttemptAnyLike): number {
  if (typeof t.attemptCount === "number" && t.attemptCount > 0) {
    return t.attemptCount;
  }
  const logic = t.attempt_logic ?? "";
  if (logic === "any_one") return 1;
  const m = /^any_(\d+)$/.exec(logic);
  if (m) return Math.max(1, Number(m[1]) || 1);
  return 1;
}

/** Faculty-configured marks awarded per attempted option. */
export function attemptAnyMarksPerOption(t: AttemptAnyLike): number {
  if (typeof t.marks_per_part === "number" && t.marks_per_part > 0) {
    return t.marks_per_part;
  }
  const k = attemptAnyCount(t);
  return k > 0 ? Math.round(t.total_marks / k) : t.total_marks;
}

/** Canonical "Attempt any K of M." instruction for an attempt_any_one block. */
export function attemptAnyDefaultInstruction(t: AttemptAnyLike): string {
  return `Attempt any ${attemptAnyCount(t)} of ${attemptAnyTotalOptions(t)}.`;
}

/** attempt_logic string for a given attempt count ("any_one" / "any_2" …). */
export function attemptAnyLogic(k: number): string {
  return k === 1 ? "any_one" : `any_${k}`;
}

/** Resolve the expected itemType for pool item index `idx` from the template composition. */
export function poolItemTypeAtIndex(
  composition: PoolCompositionEntry[],
  idx: number
): QuestionType {
  let cursor = 0;
  for (const row of composition) {
    for (let i = 0; i < row.count; i++) {
      if (cursor === idx) return row.itemType;
      cursor++;
    }
  }
  return "mcq";
}

/** Human-readable directive for the AI prompt — one line per pool item type. */
export function poolItemPromptDirective(itemType: QuestionType): string {
  switch (itemType) {
    case "mcq":
      return "MCQ — provide exactly four options (a–d) and correct_option";
    case "true_false":
      return 'True/False — options MUST be { "a": "True", "b": "False" } only; correct_option is a or b';
    case "short":
      return "Short answer — question_text only; do NOT include options or correct_option";
    case "long":
      return "Long answer — question_text only; do NOT include options or correct_option";
    case "numerical":
      return "Numerical — question_text with concrete solvable data; do NOT include options or correct_option";
    case "fill_blank":
      return "Fill in the blank — question_text with blank(s); do NOT include options or correct_option";
  }
}

/** JSON schema fragment for one pool item (Part G of the generation prompt). */
export function poolItemSchemaFragment(
  itemType: QuestionType,
  slotKey: string,
  label: string,
  marks: number
): string {
  const tags = `"co": "<co code>", "btl": <integer 1-6>, "po": "<po code>"`;
  const head = `{
      "slotKey": "${slotKey}",
      "label": "${label}",
      "itemType": "${itemType}",
      "question_text": string,
      "marks": ${marks}`;
  if (itemType === "mcq") {
    return `${head},
      "options": { "a": string, "b": string, "c": string, "d": string },
      "correct_option": "a"|"b"|"c"|"d",
      ${tags}
    }`;
  }
  if (itemType === "true_false") {
    return `${head},
      "options": { "a": "True", "b": "False" },
      "correct_option": "a"|"b",
      ${tags}
    }`;
  }
  return `${head},
      ${tags}
    }`;
}

export interface TemplateSection {
  section_name: string;
  /** Inclusive module-number range. `[1, 999]` is the "all modules" sentinel. */
  module_range: [number, number];
  total_marks: number;
  questions: TemplateQuestionBlock[];
}

/** Sentinel value meaning "include every module in the subject". */
export const ALL_MODULES_RANGE: [number, number] = [1, 999];

export function isAllModulesRange(r: [number, number] | null | undefined): boolean {
  if (!r) return true;
  return r[0] <= 1 && r[1] >= 999;
}

export interface TemplateStructure {
  preset_key?: PresetKey;
  /** When true: one implicit section, all section headers suppressed everywhere. */
  flatLayout?: boolean;
  sections: TemplateSection[];
}

export interface PaperTemplateRow {
  id: string;
  subject_id: string | null;
  created_by: string | null;
  name: string;
  is_default: boolean;
  is_snapshot: boolean;
  is_preset: boolean;
  /** Computed server-side: true when created_by === the requesting user's id. */
  is_owner: boolean;
  scope: "personal" | "school" | "department";
  university_name: string;
  exam_title: string | null;
  duration_minutes: number;
  total_marks: number;
  instructions: string[] | null;
  structure: TemplateStructure;
  created_at: string;
}

/** Shared template row — like PaperTemplateRow but with the creator's display name joined in. */
export interface SharedTemplateRow extends PaperTemplateRow {
  /** null when created_by IS NULL (built-in preset rows). Display as "Built-in". */
  creator_name: string | null;
}

export const PPSU_DEFAULT_INSTRUCTIONS: string[] = [
  "All questions of Section I and Section II must be attempted in separate answer sheets.",
  "Make suitable assumptions and draw neat figures wherever required.",
  "Use of scientific calculator is allowed.",
  "Figures to the right indicate full marks.",
];

const CE_QUIZ_INSTRUCTIONS: string[] = [
  "All questions are compulsory.",
  "Each question carries 1 mark.",
  "No negative marking.",
];

function buildPPSUSection(
  sectionName: string,
  moduleRange: [number, number]
): TemplateSection {
  return {
    section_name: sectionName,
    module_range: moduleRange,
    total_marks: 30,
    questions: [
      {
        q_number: 1,
        display_label: "Q - 1",
        type: "mcq",
        instruction: "MCQ/Short Question/Fill in the Blanks",
        total_marks: 6,
        sub_parts: 6,
        marks_per_part: 1,
        attempt_logic: null,
      },
      {
        q_number: 2,
        display_label: "Q - 2",
        type: "descriptive",
        total_marks: 6,
        has_numerical: true,
        attempt_logic: null,
      },
      {
        q_number: 3,
        display_label: "Q - 3",
        type: "descriptive_with_or",
        total_marks: 12,
        marks_per_part: 6,
        parts: ["a", "b"],
        attempt_logic: null,
      },
      {
        q_number: 4,
        display_label: "Q - 4",
        type: "attempt_any_one",
        instruction: "Attempt any one.",
        total_marks: 6,
        sub_parts: 2,
        attempt_logic: "any_one",
      },
    ],
  };
}

export const PPSU_DEFAULT_STRUCTURE: TemplateStructure = {
  preset_key: "PPSU_ESE",
  sections: [
    buildPPSUSection("Section I", [1, 4]),
    buildPPSUSection("Section II", [5, 8]),
  ],
};

const CE_QUIZ_STRUCTURE: TemplateStructure = {
  preset_key: "CE_QUIZ",
  flatLayout: true,
  sections: [
    {
      section_name: "Section A",
      module_range: ALL_MODULES_RANGE,
      total_marks: 10,
      questions: [
        {
          q_number: 1,
          display_label: "Q - 1",
          type: "mcq",
          instruction: "Answer all questions.",
          total_marks: 10,
          sub_parts: 10,
          marks_per_part: 1,
          attempt_logic: null,
        },
      ],
    },
  ],
};

const CUSTOM_STRUCTURE: TemplateStructure = {
  preset_key: "CUSTOM",
  sections: [],
};

/** Shape of a preset definition used both for seeding and the UI cards. */
export interface PresetDefinition {
  preset_key: PresetKey;
  name: string;
  description: string;
  is_default: boolean;
  university_name: string;
  exam_title: string | null;
  duration_minutes: number;
  total_marks: number;
  instructions: string[];
  structure: TemplateStructure;
}

export const PRESET_TEMPLATES: Record<PresetKey, PresetDefinition> = {
  PPSU_ESE: {
    preset_key: "PPSU_ESE",
    name: "PPSU ESE — 60 Marks",
    description: "Standard end-semester exam. Two sections, 30M each.",
    is_default: true,
    university_name: "P P Savani University",
    exam_title: "Fifth Semester of B. Tech. Examination",
    duration_minutes: 150,
    total_marks: 60,
    instructions: PPSU_DEFAULT_INSTRUCTIONS,
    structure: PPSU_DEFAULT_STRUCTURE,
  },
  CE_QUIZ: {
    preset_key: "CE_QUIZ",
    name: "CE Quiz — 10 Marks",
    description: "10 MCQs, 1 mark each. Single section.",
    is_default: true,
    university_name: "P P Savani University",
    exam_title: "Continuous Evaluation Quiz",
    duration_minutes: 20,
    total_marks: 10,
    instructions: CE_QUIZ_INSTRUCTIONS,
    structure: CE_QUIZ_STRUCTURE,
  },
  CUSTOM: {
    preset_key: "CUSTOM",
    name: "Custom Template",
    description: "Build your own structure.",
    is_default: true,
    university_name: "P P Savani University",
    exam_title: null,
    duration_minutes: 60,
    total_marks: 0,
    instructions: [],
    structure: CUSTOM_STRUCTURE,
  },
};

export const PRESET_ORDER: PresetKey[] = ["PPSU_ESE", "CE_QUIZ", "CUSTOM"];

/** Kept for backwards compatibility — points at the PPSU ESE preset. */
export const PPSU_DEFAULT_TEMPLATE = PRESET_TEMPLATES.PPSU_ESE;

export const BLOOMS_LEGEND: Array<{ level: number; name: string }> = [
  { level: 1, name: "Remember" },
  { level: 2, name: "Understand" },
  { level: 3, name: "Apply" },
  { level: 4, name: "Analyze" },
  { level: 5, name: "Evaluate" },
  { level: 6, name: "Create" },
];
