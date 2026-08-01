/**
 * The PDF block factory — the ONLY thing the export route calls per block.
 * Mirrors `BlockRenderer.tsx`'s `renderBlock` (CP-N4) on the server side: one
 * switch in one place, so a fourth block kind is a new renderer file plus a new
 * case here, not a hunt through the route. No AI calls; pure dispatch.
 *
 * BOTTOM MARGIN LIVES HERE, NOT IN EACH RENDERER. Every renderer draws its own
 * content only; the space (and, in print, a thin divider a screen card's own
 * border would otherwise supply) that separates one block from the next is a
 * single concern that belongs at the call site, not duplicated three times.
 */
import { COLORS, PDFBuilder } from "@/lib/pdf/builder";
import type { EnrichedNoteBlock } from "@/lib/notes/pyq-frequency";
import { drawConceptBlock } from "./conceptRenderer";
import { drawFormulaBlock } from "./formulaRenderer";
import { drawComparisonBlock } from "./comparisonRenderer";
import type { MathRenderMap } from "./notesMath";

export { drawConceptBlock } from "./conceptRenderer";
export { drawFormulaBlock } from "./formulaRenderer";
export { drawComparisonBlock } from "./comparisonRenderer";
export {
  collectNotesMathSpans,
  prerenderNotesMath,
  type MathRenderMap,
} from "./notesMath";

export function drawBlock(
  builder: PDFBuilder,
  block: EnrichedNoteBlock,
  mathMap: MathRenderMap
): void {
  switch (block.kind) {
    case "concept":
      drawConceptBlock(builder, block, mathMap);
      break;
    case "formula":
      drawFormulaBlock(builder, block, mathMap);
      break;
    case "comparison":
      drawComparisonBlock(builder, block, mathMap);
      break;
    default:
      // Unreachable while NoteBlock has exactly three members — the `never`
      // binding makes a fourth kind a COMPILE error here, same discipline as
      // BlockRenderer.tsx's client-side factory.
      assertNever(block);
      return;
  }
  builder.space(10);
  builder.drawLine(COLORS.border, 0.5);
  builder.space(4);
}

function assertNever(block: never): void {
  console.error("[notes/pdf] drawBlock: unhandled block kind", block);
}

/** Horizontal rule + "Module N: Name" — drawn at each moduleBreakpoint boundary. */
export function drawModuleSectionHeader(
  builder: PDFBuilder,
  moduleNumber: number,
  moduleName: string
): void {
  builder.space(6);
  builder.drawLine(COLORS.primary, 1.5);
  builder.space(2);
  builder.text(`Module ${moduleNumber}: ${moduleName}`, {
    font: builder.getFont("bold"),
    size: 14,
    color: COLORS.dark,
  });
  builder.space(6);
}
