/**
 * Formula block PDF renderer — mirrors FormulaBlockCard.tsx's reading-mode
 * ordering (name → PYQ badge → formula → symbols table → worked example →
 * conditions). Deterministic layout only — no AI calls.
 *
 * THE FORMULA EXPRESSION IS FORCED THROUGH THE "BLOCK" (CENTERED) PATH.
 * `PDFBuilder.mathLine()` only centers a span when the source is authored as
 * `$$…$$` (MathJax display mode); a formula field is conventionally authored
 * `$…$` (single dollar, inline) per §13, which would otherwise left-flow like a
 * word in a sentence. Wrapping the extracted latex in `$$…$$` before handing it
 * to `mathLine` forces the centered "block" token path. `drawBlock`'s own
 * lookup (`mathKey(latex, true) ?? mathKey(latex, false)`) finds the asset
 * regardless — it was pre-rendered and keyed under whichever displayMode
 * `extractLatexSegments` actually assigned it (see notesMath.ts), and that
 * fallback is exactly what makes the mismatch harmless.
 *
 * NO MONOSPACE FONT ON THIS BUILDER. `createPDFBuilder()` embeds only the four
 * Helvetica variants (regular/bold/italic/boldItalic) — adding a fifth (Courier)
 * would touch every consumer of the shared builder for one rare fallback case
 * (a single malformed formula). The render-failure fallback below uses italic
 * instead, which is visually distinct from body text without that blast radius.
 */
import { COLORS, PDFBuilder } from "@/lib/pdf/builder";
import { extractLatexSegments } from "@/lib/text/latexSegments";
import { mathKey } from "@/lib/qpaper/paperMath";
import type { FormulaBlock } from "@/lib/notes/types";
import type { PyqSignal } from "@/lib/notes/pyq-frequency";
import { withMathDelimiters } from "@/lib/notes/math-helpers";
import type { MathRenderMap } from "./notesMath";
import { drawPyqLine, drawMultilineMathText } from "./shared";

/** The first (and, per §13's convention, only) math span in a formula field. */
function formulaSpan(raw: string): { latex: string; displayMode: boolean } | null {
  for (const seg of extractLatexSegments(raw)) {
    if (seg.type === "math") return { latex: seg.latex, displayMode: seg.displayMode };
  }
  return null;
}

function drawFormulaExpression(
  builder: PDFBuilder,
  block: FormulaBlock,
  mathMap: MathRenderMap
): void {
  const raw = withMathDelimiters(block.formula);
  const span = formulaSpan(raw);

  if (!span) {
    // No math syntax at all (e.g. a bare "F = ma" with neither `$` nor a
    // control sequence) — plain centered text, never dropped.
    builder.text(raw, { size: 13, color: COLORS.text, align: "center" });
    return;
  }

  const asset = mathMap.get(mathKey(span.latex, span.displayMode));
  if (!asset) {
    // Render failed — never silently drop it: show the source, centered,
    // visually set apart from body text.
    builder.text(raw, {
      font: builder.getFont("italic"),
      size: 11,
      color: COLORS.muted,
      align: "center",
    });
    return;
  }

  builder.mathLine(`$$${span.latex}$$`, { size: 14 });
}

/** symbol | meaning | unit — the unit column disappears when nothing has one. */
function drawSymbolsTable(builder: PDFBuilder, symbols: FormulaBlock["symbols"]): void {
  const showUnits = symbols.some((s) => Boolean(s.unit && s.unit.trim()));
  const headers = showUnits ? ["Symbol", "Meaning", "Unit"] : ["Symbol", "Meaning"];
  const rows = symbols.map((s) => {
    const row = [withMathDelimiters(s.symbol), s.meaning];
    if (showUnits) row.push(s.unit ? withMathDelimiters(s.unit) : "—");
    return row;
  });
  builder.space(4);
  builder.drawTable(headers, rows, { size: 9.5 });
}

function drawWorkedExample(
  builder: PDFBuilder,
  example: NonNullable<FormulaBlock["workedExample"]>
): void {
  builder.space(8);
  builder.text("Example", { font: builder.getFont("bold"), size: 9.5, color: COLORS.muted });
  builder.space(2);
  builder.textOrMath(example.problem, {
    font: builder.getFont("italic"),
    size: 10,
    color: COLORS.muted,
  });
  builder.space(3);
  drawMultilineMathText(builder, example.solution, { size: 10, color: COLORS.text });
}

export function drawFormulaBlock(
  builder: PDFBuilder,
  block: FormulaBlock & { pyqSignal?: PyqSignal },
  mathMap: MathRenderMap
): void {
  builder.sectionHeading(block.name, COLORS.primary);
  drawPyqLine(builder, block.pyqSignal);

  builder.space(4);
  drawFormulaExpression(builder, block, mathMap);

  drawSymbolsTable(builder, block.symbols);

  if (block.workedExample) {
    drawWorkedExample(builder, block.workedExample);
  }

  if (block.conditions) {
    builder.space(6);
    builder.text("Applies when:", {
      font: builder.getFont("bold"),
      size: 9,
      color: COLORS.muted,
    });
    builder.textOrMath(block.conditions, { size: 9, color: COLORS.muted });
  }
}
