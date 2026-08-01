/**
 * Comparison block PDF renderer — a single bordered table (axes as columns,
 * items as rows), mirroring ComparisonBlockCard.tsx's `ComparisonTable` tree.
 * Print has no viewport to reflow against, so there is no stacked-cards
 * counterpart to the screen's sub-480px layout — one table, always. Up to
 * 4 items × 6 axes = 7 columns (name + axes); `PDFBuilder.drawTable` already
 * distributes width evenly and paginates row-wise (repeating the header) if a
 * table runs past one page, so "avoid a split table" is satisfied by picking a
 * smaller font pre-emptively for wide tables rather than a runtime shrink loop
 * — the builder has no "would this overflow" callback to shrink in response to.
 * Deterministic layout only — no AI calls.
 */
import { COLORS, PDFBuilder } from "@/lib/pdf/builder";
import type { ComparisonBlock } from "@/lib/notes/types";
import type { PyqSignal } from "@/lib/notes/pyq-frequency";
import type { MathRenderMap } from "./notesMath";
import { drawPyqLine } from "./shared";

const WIDE_TABLE_COLS = 5; // name + 4 axes; beyond this, drop the font size one step.

export function drawComparisonBlock(
  builder: PDFBuilder,
  block: ComparisonBlock & { pyqSignal?: PyqSignal },
  // Pre-embedded on the builder before any block is drawn (see conceptRenderer's
  // note); drawTable consults it directly for math-bearing cells.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _mathMap: MathRenderMap
): void {
  builder.sectionHeading(block.title, COLORS.primary);
  drawPyqLine(builder, block.pyqSignal);

  const headers = ["", ...block.axes];
  const rows = block.items.map((item) => [item.name, ...item.values]);
  const size = headers.length > WIDE_TABLE_COLS ? 8.5 : 9.5;

  builder.space(4);
  builder.drawTable(headers, rows, { size });
}
