// ============================================================================
// Lab Manual Generator — shared types
//
// Faculty generate a term-work lab manual for an assigned subject in four
// stages: LEARNING PATH (AI proposes units, faculty edits + approves) →
// CONTENT (per-practical sections, generated group-by-group) → REVIEW
// (per-practical gate + inline edit + single regen) → EXPORT (three variants).
//
// FACULTY-ONLY FIELDS: `solution` and `conductGuide` must NEVER reach a
// student-facing export. exportShared asserts this in code rather than trusting
// convention — see spec §8. Anything added to PracticalManualSection that a
// student must not see has to be added to that assertion too.
//
// The AI responseSchema mirrors ONLY the free-text fields below, maxLength-
// bounded per the comments (CLAUDE_CONTEXT §19 narrow-schema rule). Fields the
// syllabus already fixes — practicalNo, title, hours, difficulty — come from the
// skeleton/request verbatim and are never generated.
// ============================================================================

export type ScaffoldKind =
  | "code_scaffold"
  | "procedure_scaffold"
  | "calculation_scaffold";

export type Difficulty = "guided" | "standard" | "challenge";

export interface CodeGap {
  n: number;
  hint: string; // what to do, never the answer
  learn: string; // ≤100 chars: the concept mastering this gap proves
}

export interface Scaffold {
  kind: ScaffoldKind;
  /** set for code_scaffold ("python"|"c"|"java"|"cpp"|free text), null otherwise */
  language: string | null;
  /** the skeleton/procedure/calc template. TODO(n) markers mark the gaps. */
  body: string;
  /** gap count depends on difficulty — see the difficulty contract in §4b */
  gaps: CodeGap[];
}

export interface ExtensionProblem {
  level: "basic" | "intermediate" | "stretch";
  statement: string;
  expected: string;
}

export interface VivaQA {
  q: string;
  hint: string; // ≤160 chars: a nudge, not a full answer
}

export interface RubricRow {
  criterion: string;
  marks: number; // rows sum to exactly 10 (code-validated)
}

/** FACULTY-ONLY — never in a student export. */
export interface ConductGuide {
  opener: string; // ≤300 chars: 10-min demo/hook to open the slot
  hintRelease: string; // ≤300 chars: when to release which scaffold hints
  /** exactly 2 mid-lab questions, each with a minute-mark intervention trigger */
  checkpoints: string[];
  deliberateMistake: string; // ≤240 chars: the error to LET students make + the debrief
  wrapUp: string; // ≤240 chars: closing discussion prompt tying to the CO
}

export interface PracticalManualSection {
  practicalNo: number;
  title: string; // verbatim from syllabus — never AI
  hours: number;
  difficulty: Difficulty; // echo of the requested difficulty
  aim: string; // verbatim title restated as aim; casing adjustments only
  objectives: string[]; // 2-4, ≤140 each
  coCodes: string[];
  btl: number;
  prereqChecks: string[]; // 2-3 recall questions, ≤160 each
  theory: string; // ≤1800 chars, concise conceptual brief
  workedExample: string; // ≤1500 chars, dry-run/trace with real numbers
  scaffold: Scaffold;
  /** FACULTY-ONLY: the scaffold body with every TODO(n) filled; ≤ scaffold size + 50% */
  solution: string;
  expectedOutput: string; // ≤800 chars
  commonErrors: { error: string; meaning: string }[]; // exactly 3
  extensions: ExtensionProblem[]; // 2-3
  viva: VivaQA[]; // exactly 6
  rubric: RubricRow[]; // 3-5 rows, code-validated sum == 10
  conductGuide: ConductGuide; // FACULTY-ONLY
}

/** Optional micro-exercise bridging a conceptual jump between units. */
export interface BridgeExercise {
  afterPracticalNo: number;
  title: string;
  statement: string;
  expected: string;
}

export interface PathUnit {
  unitNo: number;
  name: string;
  practicalNos: number[];
  rationale: string; // ≤200 chars
}

export interface LearningPath {
  /** a partition of ALL practical numbers — code-validated */
  units: PathUnit[];
  bridges: BridgeExercise[]; // 0-2, clearly supplementary
  /** faculty must approve before content generation */
  approved: boolean;
}

export interface PracticalState {
  reviewed: boolean;
  customInstruction?: string;
  difficulty: Difficulty;
}

export interface LabManualDoc {
  path: LearningPath | null;
  sections: PracticalManualSection[];
  /** key: practicalNo */
  practicalStates: Record<number, PracticalState>;
  /** subject-level code language choice; null for non-code subjects */
  language: string | null;
}

// ── Export variants ─────────────────────────────────────────────────────────
// STUDENT never carries solution/conductGuide. INSTRUCTOR adds the conduct
// panel but still no solutions — model solutions are a separate artifact by
// design (§6), so a faculty member can hand out the instructor manual in a
// review meeting without leaking the answers.
export type ExportVariant = "student" | "instructor" | "solutions";
export type ExportFormat = "docx" | "pdf";

// ── Validation-gate warnings ────────────────────────────────────────────────
// The gate never coerces bad AI data into the doc silently: it strips/clamps/
// defaults and emits a warning the UI surfaces as an amber chip on the owning
// practical. `solution_incomplete` is the one that most needs to reach faculty —
// it means the model solution can't be trusted as a marking aid.
export type LabManualWarningKind =
  | "co_stripped" // an AI CO code failed validateCoOrNull and was dropped
  | "co_empty" // a practical ended up with no valid CO
  | "scaffold_kind_defaulted" // AI kind not in the enum — defaulted by heuristic
  | "gap_count_off_contract" // gap count outside the difficulty contract's range
  | "gap_marker_mismatch" // a TODO(n) with no gaps[] entry, or vice versa
  | "solution_incomplete" // solution still has TODO( markers, or equals the body
  | "rubric_sum_adjusted" // rubric didn't sum to 10 — largest row adjusted
  | "url_stripped" // an http(s):// URL was removed from generated text
  | "list_length_adjusted" // commonErrors/viva/checkpoints padded or truncated
  | "path_practical_missing" // a practical the AI left out of every unit
  | "path_practical_duplicated" // a practical the AI put in more than one unit
  | "path_bridges_truncated"; // more than 2 bridges proposed

export interface LabManualWarning {
  /** null = path-level (not attributable to one practical) */
  practicalNo: number | null;
  kind: LabManualWarningKind;
  message: string;
}

/** Validated payload cached in lab_manual_cache.payload (post-gate). */
export interface PracticalCachePayload {
  section: PracticalManualSection;
  warnings: LabManualWarning[];
}

// ── Difficulty contract (§4b) ───────────────────────────────────────────────
// The gap-count range each difficulty must produce. The prompt states this and
// the gate checks it (warning only, never coercion — a model that misjudges the
// gap count still produced usable content; faculty decide whether to regenerate).
export const GAP_COUNT_RANGE: Record<Difficulty, { min: number; max: number }> = {
  guided: { min: 3, max: 4 },
  standard: { min: 4, max: 6 },
  challenge: { min: 5, max: 7 },
};

export const DIFFICULTIES: Difficulty[] = ["guided", "standard", "challenge"];

export const SCAFFOLD_KINDS: ScaffoldKind[] = [
  "code_scaffold",
  "procedure_scaffold",
  "calculation_scaffold",
];

/** Rubric rows must sum to exactly this (PPSU practical CE scheme). */
export const RUBRIC_TOTAL_MARKS = 10;

/** Max practicals per /generate request (§5) — keeps the route inside its 120s budget. */
export const MAX_PRACTICALS_PER_REQUEST = 4;
