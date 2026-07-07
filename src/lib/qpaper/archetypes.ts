/**
 * Subject-family archetype hints — a small, shared prompt fragment that grounds
 * question SHAPE when PYQ (previous-year-question) coverage for a module is thin
 * or absent.
 *
 * Why this exists: PYQ-mirroring is the proven style anchor in both `sectionGen`
 * and `qbank/generator`, but only where PYQs exist. `reference_books` is
 * title-only (confirmed earlier) and cannot serve as a style source. When a
 * module has little/no PYQ signal, the model otherwise drifts toward generic,
 * abstract prompts. These canonical problem-shape bullets keep it anchored to
 * how the subject family is actually examined.
 *
 * This is a SUPPLEMENT ONLY: callers inject it exclusively when PYQ context is
 * thin/absent, and it never overrides PYQ mirroring where PYQs exist.
 *
 * Single source of truth: both generators import the SAME fragment from here
 * (same anti-drift discipline as MATH_CHEM_NOTATION_GUIDE), never a second copy.
 */

export type SubjectFamily = "math" | "chemistry";

/**
 * Infer the subject family from existing metadata (subject name / code) — no new
 * manual classification field. Returns null for families we have no archetype
 * for, in which case callers inject nothing (a no-op for CSE and every other
 * subject, preserving current behaviour exactly).
 */
export function classifySubjectFamily(
  subjectName: string,
  subjectCode?: string,
): SubjectFamily | null {
  const s = `${subjectName} ${subjectCode ?? ""}`.toLowerCase();
  // Chemistry checked first: a "chemistry" signal is unambiguous, whereas some
  // chemistry courses still mention "math"-adjacent words.
  if (/\bchemistry\b|chemical|organic\s+chem|inorganic|biochem|electrochem/.test(s)) {
    return "chemistry";
  }
  if (
    /\bmath|calculus|algebra|trigonometr|geometr|statistic|probabilit|discrete\s+math|numerical\s+method|differential\s+equation|linear\s+algebra|number\s+theory|\bmaths\b/.test(
      s,
    )
  ) {
    return "math";
  }
  return null;
}

const MATH_ARCHETYPES = `- Derive or prove a result with every intermediate step shown (state the given, the method, and each transformation to the result).
- Solve using a NAMED method with specific given coefficients/values (e.g., "solve the following system by Gauss elimination", "evaluate this integral by parts") — supply the concrete numbers.
- Compute by running an algorithm/procedure on a CONCRETE numeric instance — a real worked instance with actual values, never a generic or purely abstract prompt.`;

const CHEM_ARCHETYPES = `- Balance a given chemical reaction and classify its reaction type.
- Predict the product(s) from GIVEN reactants and stated conditions (temperature, catalyst, medium).
- Perform a stoichiometric calculation from given quantities (moles / mass / volume), showing the mole-ratio working.`;

/**
 * The archetype hint block for a family, or "" when there is no family match (so
 * the caller adds nothing). Wrapped in an XML-ish tag to match the surrounding
 * prompt structure in both generators.
 */
export function buildArchetypeHint(family: SubjectFamily | null): string {
  if (!family) return "";
  const bullets = family === "math" ? MATH_ARCHETYPES : CHEM_ARCHETYPES;
  const label = family === "math" ? "mathematics" : "chemistry";
  return `<subject_archetype_hint>
PYQ coverage for this module is thin or absent. Ground each question's SHAPE in these canonical ${label} problem archetypes (this is a SUPPLEMENT — where PYQ examples exist above, mirror them and treat this only as a fallback, never an override):
${bullets}
Prefer concrete, fully-specified instances over generic or abstract phrasing.
</subject_archetype_hint>`;
}

/**
 * Convenience: resolve the family from subject metadata and return the hint,
 * or "" when the subject isn't a family we ground (no-op for other subjects).
 */
export function archetypeHintForSubject(
  subjectName: string,
  subjectCode?: string,
): string {
  return buildArchetypeHint(classifySubjectFamily(subjectName, subjectCode));
}
