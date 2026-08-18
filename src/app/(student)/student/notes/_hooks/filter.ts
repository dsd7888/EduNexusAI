/**
 * Module slicing and search over a subject's flat block array.
 *
 * Pure functions, no React — the reading view and the flashcard page must slice
 * to a module IDENTICALLY (a card deck that disagrees with the list it was
 * launched from is worse than no deck), and a pure module is also the only
 * version a harness can assert without a DOM.
 *
 * ORIGINAL INDEX IS CARRIED THROUGH EVERY FILTER. Section headers are keyed to a
 * block's position in the FULL array, because that is what moduleBreakpoints
 * indexes. Once a filter drops a block, position in the filtered array no longer
 * means anything, so the original index travels with the block rather than being
 * recomputed from something that has moved.
 */
import type { EnrichedNoteBlock } from "@/lib/notes/pyq-frequency";
import type { ModuleBreakpoint } from "@/lib/notes/subject-assembler";

/** Sentinel for the module filter's default. Not a module id. */
export const ALL_MODULES = "all";

export type PositionedBlock = {
  block: EnrichedNoteBlock;
  /** Index in the untouched, unfiltered blocks array. */
  originalIndex: number;
};

/** Pair every block with its position, once, before anything filters. */
export function positionBlocks(blocks: EnrichedNoteBlock[]): PositionedBlock[] {
  return blocks.map((block, originalIndex) => ({ block, originalIndex }));
}

/**
 * Slice to one module's run.
 *
 * A moduleId with no matching breakpoint yields EVERYTHING rather than nothing.
 * That case is reachable — a bookmarked `?moduleId=` for a module that has since
 * been regenerated away, or a hand-edited URL — and showing the student the whole
 * subject is a recoverable state, where showing them an empty page is a dead end
 * they cannot diagnose.
 */
export function sliceToModule(
  positioned: PositionedBlock[],
  breakpoints: ModuleBreakpoint[],
  moduleId: string
): PositionedBlock[] {
  if (moduleId === ALL_MODULES) return positioned;
  const bp = breakpoints.find((b) => b.moduleId === moduleId);
  if (!bp) return positioned;
  return positioned.filter(
    (p) => p.originalIndex >= bp.startIndex && p.originalIndex < bp.startIndex + bp.count
  );
}

/** Every string on a block a student might plausibly search for. */
function searchableText(block: EnrichedNoteBlock): string {
  if (block.kind === "concept") {
    return [
      block.title,
      block.plainExplanation,
      block.formalStatement ?? "",
      ...(block.relatedTerms ?? []),
    ].join(" ");
  }
  if (block.kind === "formula") {
    return [
      block.name,
      block.formula,
      ...block.symbols.map((s) => s.meaning),
    ].join(" ");
  }
  return [
    block.title,
    ...block.axes,
    ...block.items.map((i) => i.name),
  ].join(" ");
}

/**
 * Case-insensitive substring filter. No fuzzy matching, no ranking, no
 * embeddings — the array is at most ~96 blocks and already in memory, and a
 * student searching their own notes is looking for a word they know is there.
 *
 * Title/name is searched alongside the body rather than exclusively: a student
 * who remembers "the one about eddy currents" should find it whether or not the
 * author put that phrase in the heading.
 */
export function filterBySearch(
  positioned: PositionedBlock[],
  query: string
): PositionedBlock[] {
  const q = query.trim().toLowerCase();
  if (!q) return positioned;
  return positioned.filter((p) => searchableText(p.block).toLowerCase().includes(q));
}

/** Which module a block at this index belongs to, or null if untracked. */
export function breakpointForIndex(
  breakpoints: ModuleBreakpoint[],
  originalIndex: number
): ModuleBreakpoint | null {
  return (
    breakpoints.find(
      (b) => originalIndex >= b.startIndex && originalIndex < b.startIndex + b.count
    ) ?? null
  );
}

/** Module name for a block, for the chat handoff's grounding line. */
export function moduleNameForIndex(
  breakpoints: ModuleBreakpoint[],
  originalIndex: number
): string {
  const bp = breakpointForIndex(breakpoints, originalIndex);
  return bp ? `Module ${bp.moduleNumber}: ${bp.moduleName}` : "";
}
