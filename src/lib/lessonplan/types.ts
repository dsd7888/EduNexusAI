// ============================================================================
// Lesson Plan / Course File Generator — shared types
//
// A lesson plan has two sections that live in ONE document (LessonPlanDoc):
//   THEORY    — one row per teaching hour (session), derived from modules.hours
//   PRACTICAL — one row per practical in subject_content.practicals
//
// The session *skeleton* (how many sessions, their numbers) is computed
// deterministically in skeleton.ts (NO AI). AI only fills pedagogical content
// into the stubs. See CLAUDE_CONTEXT §19 (narrow-schema rule) — the AI
// responseSchema must mirror ONLY the free-text fields below, with the exact
// maxLength bounds noted in each comment.
// ============================================================================

export type TeachingMethod =
  | "lecture_board"
  | "demo"
  | "problem_solving"
  | "activity"
  | "flipped"
  | "discussion";

export interface TheorySession {
  sessionNo: number; // 1..N continuous across modules (module_number order)
  moduleNumber: number;
  topics: string[]; // 1-3 topic fragments from the module description
  objective: string; // one sentence, student-outcome phrased
  coCodes: string[]; // from module_co_mapping (validated against subject COs)
  btl: number; // within the module's btl_levels
  method: TeachingMethod;
  methodNote: string; // ≤120 chars: HOW to run this session
  misconception: string; // ≤140 chars: one specific student misconception
  examNote: string | null; // ≤120 chars: PYQ/exam-weightage note, null if none
}

export interface PracticalSession {
  practicalNo: number;
  title: string; // verbatim from subject_content.practicals
  hours: number;
  coCodes: string[];
  prepNote: string; // ≤140 chars: setup/dataset/pitfall for the lab
  assessmentHint: string; // ≤120 chars: what to evaluate in the 10-mark rubric
  vivaSeed: string; // one representative viva question
}

export interface ModulePlanState {
  reviewed: boolean;
  customInstruction?: string;
}

export interface LessonPlanDoc {
  theory: TheorySession[];
  practicals: PracticalSession[];
  // key: "m<moduleNumber>" for theory modules, and "practicals" for the lab set
  moduleStates: Record<string, ModulePlanState>;
  // faculty-edited session budget: moduleNumber -> hours. null = use skeleton default.
  hoursOverride: Record<number, number> | null;
}

export type LessonPlanSection = "theory" | "practical";

// ── Validation-gate warnings ────────────────────────────────────────────────
// The validation gate (generator.ts) never coerces bad data into the plan; it
// strips/clamps and emits a warning the UI surfaces. `uncovered_topic` warnings
// carry the fragment text so the ReviewStage can render a clickable amber chip.
export type LessonPlanWarningKind =
  | "co_stripped" // an AI CO code failed validateCoOrNull and was dropped
  | "co_empty" // a session/practical ended up with no valid CO
  | "btl_clamped" // BTL out of the module's allowed levels, clamped
  | "method_defaulted" // AI method not one of the allowed values
  | "session_missing" // skeleton expected a session the AI didn't return
  | "session_dropped" // AI returned a session not in the skeleton
  | "uncovered_topic"; // a module description fragment not in any session's topics

export interface LessonPlanWarning {
  moduleNumber: number | null; // null = practicals section
  kind: LessonPlanWarningKind;
  message: string;
  fragment?: string; // set for uncovered_topic — the unscheduled topic text
}

// Validated payloads cached in lesson_plan_cache.payload (post-validation).
export interface TheoryCachePayload {
  sessions: TheorySession[];
  warnings: LessonPlanWarning[];
  defaultedModules: number[]; // modules whose hours were null/0 (skeleton default)
}

export interface PracticalCachePayload {
  practicals: PracticalSession[];
  warnings: LessonPlanWarning[];
}

// moduleStates key helpers — keep key derivation in one place so UI, generator,
// and export never drift on the "m<n>" / "practicals" convention.
export const theoryModuleStateKey = (moduleNumber: number): string =>
  `m${moduleNumber}`;
export const PRACTICALS_STATE_KEY = "practicals" as const;
