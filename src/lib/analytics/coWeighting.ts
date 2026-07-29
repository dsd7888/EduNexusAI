/**
 * How a module→CO mapping's trustworthiness becomes a number (CP-Q4 Part 2).
 *
 * CO attainment is the NAAC-facing metric — the one a Dean quotes in an
 * accreditation document. It is computed from actual student performance, and
 * every attempt inherits the COs of its module via `module_co_mapping`. But
 * those mappings are not all equally trustworthy: most were assigned by the
 * dual-pass Flash classifier (§17), some will eventually be faculty-verified.
 * Weighting them equally would let a low-confidence guess move an accreditation
 * number as much as a faculty member's explicit judgement.
 *
 * This module is the ONE place that mapping trust becomes a multiplier.
 * `computeCOAttainment` imports it; nothing else re-derives it. Recalibrate
 * HERE when live confidence distributions become reviewable — never per
 * consumer, or the number in the dashboard and the number in a report drift.
 *
 * ── SPEC-VS-REALITY, recorded rather than silently reconciled ──────────────
 *
 * CLAUDE_CONTEXT.md §5 documents `module_co_mapping.source` as
 * 'ai_classified' | 'faculty_verified'. NEITHER VALUE CAN EXIST. The migration
 * that created the table (`20260628000000_module_co_mapping.sql`) constrains
 * the column:
 *
 *   source text NOT NULL DEFAULT 'ai_inferred'
 *     CHECK (source IN ('ai_inferred','superadmin_verified'))
 *
 * So the real pair is 'ai_inferred' / 'superadmin_verified', and all 135 live
 * rows are 'ai_inferred'. The CP-Q4 spec's "faculty-verified mappings weighted
 * 1.0" maps onto `superadmin_verified` — and note that this is not a renaming
 * quibble: the table's RLS policy grants write only to superadmin/dept_admin,
 * so verification is a SUPERADMIN action in this system, not a faculty one.
 * A faculty member cannot currently verify a CO mapping at all.
 *
 * `confidence` is likewise documented as a classifier output but stored as
 * TEXT with CHECK (confidence IN ('high','medium','low')) — a band, not a
 * score.
 *
 * This module handles what is actually there. The documented-but-impossible
 * names are kept as aliases so that if the schema is ever aligned to §5, the
 * weighting does not silently fall through to the cautious default on the day
 * of the migration. Unknown sources degrade to the band rather than throwing:
 * failing closed on an unrecognised value would take the entire CO attainment
 * panel offline over a vocabulary change.
 *
 * The drift is logged in Future_plans.MD as a schema-drift AUDIT item, not an
 * urgent fix — the numbers are correct under this mapping either way.
 */

/** The confidence bands `module_co_mapping.confidence` actually holds. */
export type ConfidenceBand = "high" | "medium" | "low";

/**
 * Band → weight.
 *
 * Calibrated to what the bands MEAN under the dual-pass classifier (§17), not
 * to a generic notion of confidence:
 *
 *   high   1.0  — the two independent passes AGREED. §17's rule is that
 *                 agreement keeps the result and takes the lower of the two
 *                 confidences, so a surviving 'high' means both calls
 *                 independently arrived at this CO with high confidence. That
 *                 is close enough to a human judgement to weigh like one.
 *   medium 0.7  — agreement at a weaker confidence, or a single-pass result
 *                 that never had a disagreement to resolve. Real signal,
 *                 discounted.
 *   low    0.4  — §17: disagreement forces confidence to 'low' and takes the
 *                 UNION of both passes' answers. So 'low' does not mean "a
 *                 weak guess at one CO" — it means "the classifier could not
 *                 decide, and this mapping is one of several kept for safety."
 *                 It should still count (the module IS taught, and dropping it
 *                 would silently remove a CO from attainment entirely), but it
 *                 must not carry the same weight as a settled mapping.
 *
 * Non-zero at every band on purpose: a CO whose only mappings are low-confidence
 * would otherwise vanish from the attainment table, and an absent CO reads as
 * "not assessed" rather than "assessed on shaky mappings" — the more misleading
 * of the two on an accreditation surface.
 */
export const CONFIDENCE_WEIGHTS: Record<ConfidenceBand, number> = {
  high: 1.0,
  medium: 0.7,
  low: 0.4,
};

/** Weight applied when `confidence` is null, absent, or an unrecognised string. */
export const UNKNOWN_CONFIDENCE_WEIGHT = CONFIDENCE_WEIGHTS.low;

/**
 * Source → trust.
 *
 * A VERIFIED mapping is a flat 1.0 REGARDLESS of the confidence the AI
 * originally recorded. Someone has looked at the mapping and confirmed it,
 * which supersedes the classifier; continuing to discount that judgement by a
 * stale 'low' would mean verification never fully counted, and the whole point
 * of a verify affordance is that it settles the question.
 *
 * `USE_BAND` defers to CONFIDENCE_WEIGHTS above.
 *
 * The first two keys are the values the DB CHECK constraint actually permits.
 * The last two are the §5-documented names, kept as aliases so a future schema
 * alignment does not silently demote every verified mapping on migration day.
 */
export const USE_BAND = "USE_BAND" as const;

export const SOURCE_TRUST: Record<string, number | typeof USE_BAND> = {
  // ── real values (CHECK constraint, 20260628000000_module_co_mapping.sql) ──
  superadmin_verified: 1.0,
  ai_inferred: USE_BAND,
  // ── §5-documented aliases; not currently representable in the DB ──
  faculty_verified: 1.0,
  ai_classified: USE_BAND,
};

/**
 * The weight one module→CO mapping contributes to CO attainment.
 *
 * Returns a multiplier in (0, 1]. Never 0 — see CONFIDENCE_WEIGHTS on why a
 * mapping is discounted rather than dropped.
 */
export function mappingWeight(mapping: {
  source: string | null;
  confidence: string | null;
}): number {
  const trust = mapping.source ? SOURCE_TRUST[mapping.source] : undefined;
  if (typeof trust === "number") return trust;

  // USE_BAND, or an unrecognised/absent source → fall through to the band.
  const band = mapping.confidence as ConfidenceBand | null;
  if (band && band in CONFIDENCE_WEIGHTS) return CONFIDENCE_WEIGHTS[band];
  return UNKNOWN_CONFIDENCE_WEIGHT;
}
