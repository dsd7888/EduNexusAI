/**
 * Which modules a paper section draws from — the single source of truth.
 *
 * This predicate previously existed as two independent copies: one in
 * `/api/generate/qpaper/route.ts` and one in
 * `/api/generate/qpaper/answer-key/route.ts`. They had already drifted (the
 * answer-key copy tolerated a missing range, the generation copy would have
 * thrown on one), and any future divergence shows up as an answer key whose
 * module scope disagrees with the paper it answers — a silent correctness bug
 * that no type error would catch.
 *
 * Only the *filtering* is shared here. Each caller still projects the filtered
 * rows into its own shape, because those shapes legitimately differ (the
 * generation path needs BTL levels and weightage; the answer key needs only
 * name + description).
 */

/** The minimum a row must expose to be scoped to a section. */
export interface ModuleScopeRow {
  module_number: number;
}

/** The minimum a section must expose to scope modules. */
export interface SectionScope {
  /** Inclusive [lo, hi] module-number range. Absent/null = every module. */
  module_range?: [number, number] | null;
}

/**
 * Returns the modules belonging to `section`, preserving the input order.
 *
 * An absent or null `module_range` means "every module" — the historical
 * answer-key behaviour, and strictly safer than the generation path's previous
 * destructure-and-throw.
 */
export function selectModulesForSection<T extends ModuleScopeRow>(
  modules: readonly T[],
  section: SectionScope
): T[] {
  const range = section.module_range;
  if (!range) return [...modules];
  const [lo, hi] = range;
  return modules.filter((m) => m.module_number >= lo && m.module_number <= hi);
}
