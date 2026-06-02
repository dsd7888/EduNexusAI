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

export type PresetKey = "PPSU_ESE" | "CE_QUIZ" | "CUSTOM";

export interface TemplateQuestion {
  q_number: number;
  display_label: string;
  type: TemplateQuestionType;
  instruction?: string | null;
  total_marks: number;
  sub_parts?: number;
  marks_per_part?: number;
  parts?: string[];
  has_numerical?: boolean;
  attempt_logic?: string | null;
}

export interface TemplateSection {
  section_name: string;
  /** Inclusive module-number range. `[1, 999]` is the "all modules" sentinel. */
  module_range: [number, number];
  total_marks: number;
  questions: TemplateQuestion[];
}

/** Sentinel value meaning "include every module in the subject". */
export const ALL_MODULES_RANGE: [number, number] = [1, 999];

export function isAllModulesRange(r: [number, number] | null | undefined): boolean {
  if (!r) return true;
  return r[0] <= 1 && r[1] >= 999;
}

export interface TemplateStructure {
  preset_key?: PresetKey;
  sections: TemplateSection[];
}

export interface PaperTemplateRow {
  id: string;
  subject_id: string | null;
  created_by: string | null;
  name: string;
  is_default: boolean;
  university_name: string;
  exam_title: string | null;
  duration_minutes: number;
  total_marks: number;
  instructions: string[] | null;
  structure: TemplateStructure;
  created_at: string;
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
