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
  | "btl_defaulted" // AI btl outside 1-6 — defaulted (compliance-relevant metadata)
  | "gap_count_off_contract" // gap count outside the difficulty contract's range
  | "gap_marker_mismatch" // a TODO(n) with no gaps[] entry, or vice versa
  | "gap_quality_suspect" // a gap that teaches boilerplate, not the conceptual core
  | "content_leak_suspect" // model meta-commentary leaked into a student-facing artifact
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

export const RUBRIC_MIN_ROWS = 3;
export const RUBRIC_MAX_ROWS = 5;

export const COMMON_ERRORS_COUNT = 3;
export const VIVA_COUNT = 6;
export const CHECKPOINT_COUNT = 2;

/**
 * A practical whose title reads like a programming task. SINGLE SOURCE OF
 * TRUTH — the setup UI uses it to decide whether to offer the language selector
 * (§7), and the generator gate uses it as the code_scaffold arm of its
 * scaffold-kind fallback heuristic (§4b). If those two ever disagree, a faculty
 * could pick "python" for a practical the gate then defaults to a procedure
 * scaffold. Client-safe: this module imports nothing server-only.
 */
export const CODE_PRACTICAL_PATTERN =
  /implement|program|write a program|algorithm|code/i;

/** A practical whose title reads like a numerical/calculation task. */
export const CALC_PRACTICAL_PATTERN =
  /calculat|comput|numerical|solve|determine|estimate|evaluate the|design a .*(circuit|beam|column)/i;

/** Matches any http(s) URL — stripped from every generated string (§8, MANDATORY). */
export const URL_PATTERN = /https?:\/\/[^\s)"'\]]+/gi;

/** Matches the TODO(n) gap markers inside a scaffold body. */
export const TODO_MARKER_PATTERN = /TODO\(\s*(\d+)\s*\)/g;

/**
 * A gap whose OWN `learn` field admits it teaches boilerplate.
 *
 * Matched against `learn` — the concept the model claims the gap proves — not
 * against `hint`. That's deliberate: a hint may legitimately say "call the
 * recursive function on the left subtree" (recursion IS the concept), whereas a
 * `learn` of "function invocation" is the model self-reporting that the gap
 * teaches nothing. High precision, few false positives.
 *
 * Exists because the prompt alone does not hold: even with an explicit ban and a
 * worked example, Flash intermittently pads gaps with function calls to reach
 * the difficulty's gap-count target — it did so on one run and not the next with
 * an identical prompt. CLAUDE_CONTEXT §17: back a prompt-level rule with a code
 * check wherever the failure would otherwise be invisible. This only warns; it
 * cannot rewrite a scaffold, and faculty decide whether to regenerate.
 */
export const BOILERPLATE_LEARN_PATTERN =
  /\b(invocation|invoking|function call|calling the|method call|print(ing)? (the )?(result|output)|import|variable declaration|declaring|syntax of)\b/i;

/**
 * Model meta-commentary leaking into an artifact the student will read.
 *
 * One run emitted "This is not helpful as A'B + AB is not a standard
 * simplification." straight into a scaffold body — the model reasoning about its
 * own draft, mid-artifact. It did not reproduce, which is exactly why it needs a
 * detector rather than a re-run: a non-reproducing one-off is invisible to CP5
 * visual inspection, which only sees the practicals someone happens to render.
 *
 * Scanned against scaffold.body and solution ONLY — prose fields (theory, viva
 * hints) can legitimately contain "note that" or "let me". Inside code, a
 * procedure, or a calculation these phrases have near-zero legitimate use, so
 * the precision is high. Warning-only: it cannot know which line is the leak.
 */
export const META_COMMENTARY_PATTERN =
  /\b(this is not helpful|as an AI|I cannot|I'm sorry|I apologize|note that I|let me (know|clarify|explain|rewrite)|as requested|here('s| is) the (corrected|revised|updated)|I've (added|changed|updated)|my previous (answer|response))\b/i;

/** Max practicals per /generate request (§5) — keeps the route inside its 120s budget. */
export const MAX_PRACTICALS_PER_REQUEST = 4;
