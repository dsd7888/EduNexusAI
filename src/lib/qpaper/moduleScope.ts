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
  /**
   * Explicit module numbers — authoritative when present and non-empty.
   * See TemplateSection.module_numbers for why a range alone is not enough.
   */
  module_numbers?: number[] | null;
  /** Inclusive [lo, hi] module-number range. Absent/null = every module. */
  module_range?: [number, number] | null;
}

/**
 * Returns the modules belonging to `section`, preserving the input order.
 *
 * Resolution order:
 *   1. `module_numbers` when present and non-empty — the only encoding that can
 *      express a non-contiguous selection such as {1, 2, 5}.
 *   2. `module_range` otherwise — templates saved before module_numbers existed.
 *   3. Every module, when neither is set.
 *
 * An empty `module_numbers` array falls through to the range rather than
 * yielding nothing: "no modules" is never a useful generation scope, and a
 * section with zero modules silently produces zero questions.
 */
export function selectModulesForSection<T extends ModuleScopeRow>(
  modules: readonly T[],
  section: SectionScope
): T[] {
  const explicit = section.module_numbers;
  if (explicit && explicit.length > 0) {
    // Set lookup: sections are re-scoped per question during generation, so
    // this runs far more often than the list length suggests.
    const wanted = new Set(explicit);
    return modules.filter((m) => wanted.has(m.module_number));
  }
  const range = section.module_range;
  if (!range) return [...modules];
  const [lo, hi] = range;
  return modules.filter((m) => m.module_number >= lo && m.module_number <= hi);
}
