// ============================================================================
// Lesson Plan — deterministic session skeleton (NO AI)
//
// The session budget is computed in code, never by the model (mirrors the
// Q-paper "module assignment computed in code" decision in CLAUDE_CONTEXT §19).
// A module with H teaching hours yields H theory session stubs; session numbers
// run continuously across modules in module_number order. AI later fills the
// pedagogical content into these stubs — it never decides how many there are.
//
// Pure functions, zero imports from the AI layer, fully unit-testable.
// ============================================================================

/** Fallback session count for a module whose syllabus hours are null/0. */
export const DEFAULT_MODULE_HOURS = 4;

/** Only the module fields the skeleton needs (subset of the `modules` row). */
export interface SkeletonModule {
  module_number: number;
  hours: number | null;
}

/** A theory session stub: numbering + owning module, no content yet. */
export interface TheorySessionStub {
  sessionNo: number;
  moduleNumber: number;
}

export interface TheorySkeletonResult {
  sessions: TheorySessionStub[];
  /** moduleNumber -> number of sessions allocated. */
  sessionCountByModule: Record<number, number>;
  /** total theory sessions across all modules. */
  totalSessions: number;
  /** moduleNumbers whose hours were null/0 and fell back to DEFAULT_MODULE_HOURS. */
  defaultedModules: number[];
}

/** Only the practical fields the skeleton needs (subset of ExtractedPractical). */
export interface SkeletonPractical {
  sr_no: number;
  name: string;
  hours: number | null;
}

export interface PracticalSessionStub {
  practicalNo: number;
  title: string;
  hours: number;
}

export interface PracticalSkeletonResult {
  practicals: PracticalSessionStub[];
  totalPracticals: number;
}

/**
 * Resolve the session count for a single module.
 * Precedence: explicit faculty override (if a positive integer) → syllabus
 * hours (if > 0) → DEFAULT_MODULE_HOURS. Returns whether the default was used.
 */
function resolveModuleSessionCount(
  module: SkeletonModule,
  override: number | undefined,
): { count: number; defaulted: boolean } {
  if (typeof override === "number" && Number.isFinite(override)) {
    const clamped = Math.max(1, Math.floor(override));
    return { count: clamped, defaulted: false };
  }
  const hours = module.hours;
  if (typeof hours === "number" && Number.isFinite(hours) && hours >= 1) {
    return { count: Math.floor(hours), defaulted: false };
  }
  return { count: DEFAULT_MODULE_HOURS, defaulted: true };
}

/**
 * Build the theory session skeleton.
 *
 * @param modules        module rows (any order; sorted by module_number here)
 * @param hoursOverride  faculty-edited session budget (moduleNumber -> hours);
 *                       null/undefined = use syllabus hours with null-guard.
 */
export function buildTheorySkeleton(
  modules: SkeletonModule[],
  hoursOverride?: Record<number, number> | null,
): TheorySkeletonResult {
  const sorted = [...modules].sort(
    (a, b) => a.module_number - b.module_number,
  );

  const sessions: TheorySessionStub[] = [];
  const sessionCountByModule: Record<number, number> = {};
  const defaultedModules: number[] = [];

  let sessionNo = 1;
  for (const mod of sorted) {
    const override = hoursOverride?.[mod.module_number];
    const { count, defaulted } = resolveModuleSessionCount(mod, override);
    if (defaulted) defaultedModules.push(mod.module_number);
    sessionCountByModule[mod.module_number] = count;
    for (let i = 0; i < count; i++) {
      sessions.push({ sessionNo, moduleNumber: mod.module_number });
      sessionNo++;
    }
  }

  return {
    sessions,
    sessionCountByModule,
    totalSessions: sessions.length,
    defaultedModules,
  };
}

/**
 * Build the practical skeleton — one stub per practical row, in sr_no order.
 * Practical hours default to 2 (the common lab-slot length) when null/0; the
 * value is informational only (practicals are not expanded into per-hour rows).
 */
export function buildPracticalSkeleton(
  practicals: SkeletonPractical[],
): PracticalSkeletonResult {
  const sorted = [...practicals].sort((a, b) => a.sr_no - b.sr_no);
  const stubs: PracticalSessionStub[] = sorted.map((p) => ({
    practicalNo: p.sr_no,
    title: p.name,
    hours:
      typeof p.hours === "number" && Number.isFinite(p.hours) && p.hours >= 1
        ? Math.floor(p.hours)
        : 2,
  }));
  return { practicals: stubs, totalPracticals: stubs.length };
}
