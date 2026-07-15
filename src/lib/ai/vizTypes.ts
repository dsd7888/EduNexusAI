/**
 * Chat "Visualize" taxonomy — the client-safe half.
 *
 * This module is imported by BOTH the server pipeline (lib/ai/vizPrompts.ts)
 * and the browser panel (chat/_components/VisualizationPanel.tsx), so it must
 * stay free of prompt text: vizPrompts.ts carries an ~85-line worked example
 * and four full prompts, and importing that into a client component would ship
 * all of it in the page bundle for no benefit.
 *
 * The split is by RUNTIME, not by concern: everything here is what both sides
 * need to agree on; everything in vizPrompts.ts is what only the server needs.
 * A fourth vizType (e.g. "illustration") adds one entry to VIZ_TYPES, one line
 * to each map here, and one VIZ_REGISTRY entry there — the route still never
 * branches on vizType.
 */

export const VIZ_TYPES = ["interactive", "diagram", "plot"] as const;
export type VizType = (typeof VIZ_TYPES)[number];

/** What the generation call returns, and therefore how the client renders it. */
export type VizPayloadKind = "html" | "mermaid";

export interface VizClassification {
  vizType: VizType;
  rationale: string;
  coreConcept: string;
  /**
   * True when the source answer had no real visual content and the classifier
   * fell back to "diagram" to satisfy the always-produce-something contract.
   * The panel frames the result honestly instead of passing a box-arrow map of
   * prose off as the concept's natural picture.
   */
  conceptualFallback: boolean;
}

/**
 * Shown while call 2 runs. Only reachable once vizType is known — i.e. on
 * Regenerate, which reuses the stored classification. The first click cannot
 * know the type yet (one round-trip covers both calls) and uses the generic
 * VIZ_LOADING_COPY_GENERIC instead.
 */
export const VIZ_LOADING_COPY: Record<VizType, string> = {
  interactive: "Building an interactive walkthrough…",
  diagram: "Drawing the structure…",
  plot: "Computing the curve…",
};

export const VIZ_LOADING_COPY_GENERIC = "Building your visualization…";

/** Panel header label. */
export const VIZ_LABEL: Record<VizType, string> = {
  interactive: "Interactive walkthrough",
  diagram: "Structure map",
  plot: "Plot",
};

/**
 * Shown above a diagram that exists only because the source answer was prose.
 * Framing a weak-by-construction visual honestly beats presenting a box-arrow
 * map of a verbal explanation as if the concept naturally had that shape.
 */
export const VIZ_CONCEPTUAL_FALLBACK_NOTE =
  "This topic is mostly conceptual — here's a structural map of the ideas.";
