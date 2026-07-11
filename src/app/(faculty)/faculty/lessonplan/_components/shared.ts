// Client-side shared types + pure helpers for the lesson-plan builder UI.
// Presentation-only: no server imports. Mirrors the qpaper _components/shared.ts
// convention.

import {
  theoryModuleStateKey,
  PRACTICALS_STATE_KEY,
  type TheorySession,
  type PracticalSession,
  type TeachingMethod,
  type LessonPlanDoc,
  type LessonPlanWarning,
  type ModulePlanState,
} from "@/lib/lessonplan/types";

export {
  theoryModuleStateKey,
  PRACTICALS_STATE_KEY,
  type TheorySession,
  type PracticalSession,
  type TeachingMethod,
  type LessonPlanDoc,
  type LessonPlanWarning,
  type ModulePlanState,
};

export type SectionTab = "theory" | "practical";

// Modules/COs/practicals as fetched client-side for the setup + review UI.
export interface UiModule {
  id: string;
  module_number: number;
  name: string;
  description: string;
  hours: number | null;
  weightage_percent: number | null;
  btl_levels: number[];
  coCodes: string[];
}

export interface UiCourseOutcome {
  co_code: string;
  description: string;
}

export interface UiPractical {
  sr_no: number;
  name: string;
  hours: number | null;
}

export const METHOD_LABELS: Record<TeachingMethod, string> = {
  lecture_board: "Lecture + Board",
  demo: "Demonstration",
  problem_solving: "Problem Solving",
  activity: "Activity",
  flipped: "Flipped",
  discussion: "Discussion",
};

export const ALL_METHODS: TeachingMethod[] = [
  "lecture_board",
  "demo",
  "problem_solving",
  "activity",
  "flipped",
  "discussion",
];

export const DEFAULT_MODULE_HOURS = 4;

const DEFAULT_BTL_LEVELS = [1, 2, 3];
const BTL_LABEL_TO_LEVEL: Record<string, number> = {
  remember: 1,
  understand: 2,
  apply: 3,
  analyze: 4,
  analyse: 4,
  evaluate: 5,
  create: 6,
};

/** Parse a modules.btl_levels text[] (client-side mirror of the generator). */
export function parseBtlLevels(raw: unknown): number[] {
  if (!Array.isArray(raw) || raw.length === 0) return [...DEFAULT_BTL_LEVELS];
  const out = new Set<number>();
  for (const item of raw as Array<string | number>) {
    if (typeof item === "number" && item >= 1 && item <= 6) {
      out.add(Math.trunc(item));
      continue;
    }
    const s = String(item).trim().toLowerCase();
    const n = Number(s.replace(/[^0-9]/g, ""));
    if (Number.isFinite(n) && n >= 1 && n <= 6) {
      out.add(n);
      continue;
    }
    if (BTL_LABEL_TO_LEVEL[s] != null) out.add(BTL_LABEL_TO_LEVEL[s]);
  }
  return out.size > 0 ? Array.from(out).sort((a, b) => a - b) : [...DEFAULT_BTL_LEVELS];
}

/** Session count for one module given an optional hours override. */
export function sessionCountFor(
  module: Pick<UiModule, "module_number" | "hours">,
  hoursOverride: Record<number, number> | null,
): number {
  const ov = hoursOverride?.[module.module_number];
  if (typeof ov === "number" && Number.isFinite(ov)) return Math.max(1, Math.floor(ov));
  const h = module.hours;
  if (typeof h === "number" && Number.isFinite(h) && h >= 1) return Math.floor(h);
  return DEFAULT_MODULE_HOURS;
}

/** Total theory sessions across all modules for the current override. */
export function totalTheorySessions(
  modules: UiModule[],
  hoursOverride: Record<number, number> | null,
): number {
  return modules.reduce((acc, m) => acc + sessionCountFor(m, hoursOverride), 0);
}

/** Group theory sessions by module number, preserving array order within each. */
export function groupByModule(
  sessions: TheorySession[],
): Map<number, TheorySession[]> {
  const map = new Map<number, TheorySession[]>();
  for (const s of sessions) {
    const list = map.get(s.moduleNumber) ?? [];
    list.push(s);
    map.set(s.moduleNumber, list);
  }
  return map;
}

/**
 * Renumber sessions globally (continuous 1..N) in module_number order, keeping
 * each module's internal ordering as the faculty arranged it. Call after any
 * within-module drag reorder or session add/remove.
 */
export function renumberTheory(
  sessions: TheorySession[],
  moduleNumbersInOrder: number[],
): TheorySession[] {
  const byModule = groupByModule(sessions);
  const seen = new Set<number>();
  const out: TheorySession[] = [];
  let n = 1;
  for (const mn of moduleNumbersInOrder) {
    for (const s of byModule.get(mn) ?? []) out.push({ ...s, sessionNo: n++ });
    seen.add(mn);
  }
  // Safety: include any module not present in the ordering list.
  for (const [mn, list] of byModule) {
    if (seen.has(mn)) continue;
    for (const s of list) out.push({ ...s, sessionNo: n++ });
  }
  return out;
}

/** Warnings grouped by module number (null bucket = practicals). */
export function groupWarnings(
  warnings: LessonPlanWarning[],
): Map<number | "practicals", LessonPlanWarning[]> {
  const map = new Map<number | "practicals", LessonPlanWarning[]>();
  for (const w of warnings) {
    const key = w.moduleNumber ?? "practicals";
    const list = map.get(key) ?? [];
    list.push(w);
    map.set(key, list);
  }
  return map;
}

export function emptyDoc(): LessonPlanDoc {
  return { theory: [], practicals: [], moduleStates: {}, hoursOverride: null };
}

/** Human label for a moduleStates key. */
export function stateKeyLabel(key: string): string {
  if (key === PRACTICALS_STATE_KEY) return "Practicals";
  const m = /^m(\d+)$/.exec(key);
  return m ? `Module ${m[1]}` : key;
}
