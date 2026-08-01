/**
 * Concept block PDF renderer — mirrors ConceptBlockCard.tsx's reading-mode
 * ordering (plain explanation first, formal statement set apart, motivation
 * last-but-present; see that file for why the hierarchy is deliberately
 * inverted from a textbook's). Deterministic layout only — no AI calls.
 */
import { COLORS, CONTENT_W, MARGIN, PDFBuilder } from "@/lib/pdf/builder";
import type { ConceptBlock } from "@/lib/notes/types";
import type { PyqSignal } from "@/lib/notes/pyq-frequency";
import type { MathRenderMap } from "./notesMath";
import { drawPyqLine } from "./shared";

export function drawConceptBlock(
  builder: PDFBuilder,
  block: ConceptBlock & { pyqSignal?: PyqSignal },
  // Pre-embedded on the builder by the caller via embedMath() before any block
  // is drawn; textOrMath/mathLine consult that embedded set directly. Accepted
  // here (unused) to keep the three draw*Block signatures identical, matching
  // BlockRenderer.tsx's factory contract on the client side.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _mathMap: MathRenderMap
): void {
  builder.sectionHeading(block.title, COLORS.primary);
  drawPyqLine(builder, block.pyqSignal);

  builder.space(2);
  builder.textOrMath(block.plainExplanation, { size: 10.5, color: COLORS.text });

  if (block.formalStatement) {
    builder.space(4);
    const endCard = builder.beginCard(COLORS.bgLight, COLORS.primary);
    builder.textOrMath(block.formalStatement, {
      x: MARGIN + 10,
      maxWidth: CONTENT_W - 10,
      size: 10,
      color: COLORS.text,
    });
    endCard();
  }

  builder.space(8);
  builder.textOrMath(block.whyItMatters, {
    font: builder.getFont("italic"),
    size: 9.5,
    color: COLORS.muted,
  });

  const terms = block.relatedTerms ?? [];
  if (terms.length > 0) {
    builder.space(4);
    builder.text(terms.join("  ·  "), { size: 8.5, color: COLORS.muted });
  }
}
