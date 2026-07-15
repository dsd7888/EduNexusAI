// Client-side shared types + pure helpers for the lab-manual builder UI.
// Presentation-only: no server imports. Mirrors the lessonplan/qpaper
// _components/shared.ts convention.

import {
  RUBRIC_TOTAL_MARKS,
  DIFFICULTIES,
  CODE_PRACTICAL_PATTERN,
  type Difficulty,
  type ScaffoldKind,
  type LabManualDoc,
  type LabManualWarning,
  type LabManualWarningKind,
  type PracticalManualSection,
  type PracticalState,
  type LearningPath,
  type PathUnit,
  type BridgeExercise,
  type ExportVariant,
  type ExportFormat,
  type RubricRow,
} from "@/lib/labmanual/types";

export {
  RUBRIC_TOTAL_MARKS,
  DIFFICULTIES,
  type Difficulty,
  type ScaffoldKind,
  type LabManualDoc,
  type LabManualWarning,
  type LabManualWarningKind,
  type PracticalManualSection,
  type PracticalState,
  type LearningPath,
  type PathUnit,
  type BridgeExercise,
  type ExportVariant,
  type ExportFormat,
  type RubricRow,
};

/** A practical as listed by GET /api/labmanual. */
export interface UiPractical {
  practicalNo: number;
  title: string;
  hours: number;
}

export interface CacheFlag {
  fresh: boolean;
  generatedAt: string | null;
  generatedBySelf: boolean;
}

export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  guided: "Guided",
  standard: "Standard",
  challenge: "Challenge",
};

export const DIFFICULTY_HINTS: Record<Difficulty, string> = {
  guided: "Most of the artifact is given; 3-4 short gaps on the core idea.",
  standard: "The core logic is gapped; 4-6 gaps.",
  challenge: "Only the shell is given; the student builds the core.",
};

export const SCAFFOLD_KIND_LABELS: Record<ScaffoldKind, string> = {
  code_scaffold: "Code",
  procedure_scaffold: "Procedure",
  calculation_scaffold: "Calculation",
};

/**
 * Human labels for every warning class. Faculty must never be shown a raw
 * warning kind — the chip has to say what to DO about it, in a sentence a lab
 * instructor reads once and acts on.
 */
export const WARNING_LABELS: Record<LabManualWarningKind, string> = {
  co_stripped: "An invalid CO was removed",
  co_empty: "No course outcome — assign one",
  scaffold_kind_defaulted: "Scaffold type was guessed — check it fits",
  gap_count_off_contract: "Gap count is off for this difficulty",
  gap_marker_mismatch: "Scaffold blanks and the gaps table don't line up",
  gap_quality_suspect: "Scaffold gaps may be too shallow — review or regenerate",
  solution_incomplete: "Model solution is incomplete — don't mark from it yet",
  rubric_sum_adjusted: "Rubric marks were adjusted to total 10",
  url_stripped: "An external link was removed",
  list_length_adjusted: "A list was padded or trimmed to the required length",
  content_leak_suspect: "Looks like AI commentary got into the content",
  path_practical_missing: "A practical wasn't placed in a unit",
  path_practical_duplicated: "A practical appeared in two units",
  path_bridges_truncated: "Extra bridge exercises were dropped",
};

/** Warnings that mean "this is not safe to hand to a student / mark from". */
const SERIOUS_WARNINGS: LabManualWarningKind[] = [
  "solution_incomplete",
  "content_leak_suspect",
  "co_empty",
  "gap_marker_mismatch",
];

export function isSeriousWarning(kind: LabManualWarningKind): boolean {
  return SERIOUS_WARNINGS.includes(kind);
}

export function emptyDoc(): LabManualDoc {
  return { path: null, sections: [], practicalStates: {}, language: null };
}

export function rubricSum(rubric: RubricRow[]): number {
  return rubric.reduce((a, r) => a + (Number(r.marks) || 0), 0);
}

/** A practical may only be marked reviewed when its rubric totals exactly 10 (§7). */
export function canReview(section: PracticalManualSection): boolean {
  return rubricSum(section.rubric) === RUBRIC_TOTAL_MARKS;
}

/**
 * Show the language selector only when the subject actually has a coding
 * practical (§7). Uses the SAME pattern as the generator's scaffold-kind
 * heuristic, so the selector and the gate can never disagree about what counts
 * as a code practical.
 */
export function subjectNeedsLanguage(practicals: UiPractical[]): boolean {
  return practicals.some((p) => CODE_PRACTICAL_PATTERN.test(p.title));
}

export const LANGUAGE_PRESETS = ["python", "c", "java", "cpp"];

export function stateFor(
  doc: LabManualDoc,
  practicalNo: number,
): PracticalState {
  return (
    doc.practicalStates[practicalNo] ?? {
      reviewed: false,
      difficulty: "standard",
    }
  );
}

/** Warnings grouped by the practical they belong to (null = path-level). */
export function groupWarnings(
  warnings: LabManualWarning[],
): Map<number | "path", LabManualWarning[]> {
  const map = new Map<number | "path", LabManualWarning[]>();
  for (const w of warnings) {
    const key = w.practicalNo ?? "path";
    const list = map.get(key) ?? [];
    list.push(w);
    map.set(key, list);
  }
  return map;
}

/** Every practical number in the path, in unit order then within-unit order. */
export function pathOrder(path: LearningPath | null): number[] {
  if (!path) return [];
  return path.units.flatMap((u) => u.practicalNos);
}

/** Split a unit's practicals into chunks of ≤4 — the /generate request cap (§5). */
export function chunkForRequest<T>(items: T[], size = 4): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function reviewedCount(doc: LabManualDoc): number {
  return doc.sections.filter((s) => stateFor(doc, s.practicalNo).reviewed).length;
}

export function allReviewed(doc: LabManualDoc): boolean {
  return doc.sections.length > 0 && reviewedCount(doc) === doc.sections.length;
}

export function unreviewedTitles(doc: LabManualDoc): string[] {
  return doc.sections
    .filter((s) => !stateFor(doc, s.practicalNo).reviewed)
    .map((s) => `#${s.practicalNo} ${s.title}`);
}
