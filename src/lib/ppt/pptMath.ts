/**
 * pptMath — the PPT-specific bridge between slide body text and the shared
 * server-side LaTeX/mhchem rasteriser (`renderLatexToImage`).
 *
 * pptxgenjs has no concept of inline images inside a flowing text run, so we
 * cannot interleave an equation PNG mid-sentence the way the PDF/Word builders
 * do. Instead we rasterise a whole line (its plain text wrapped in `\text{...}`,
 * its math kept raw) into ONE crisp PNG and embed that image in the line's slot.
 * Rendering at 300 DPI then scaling to fit the existing text-box bounds keeps it
 * sharp and — crucially — never lets an equation overflow the slide (a line that
 * is too wide is scaled down, not clipped).
 *
 * Fast-path discipline (mirrors PDF/Word/answer-key from Sub-pass A): callers
 * gate on `hasLatex()` / `bulletsHaveMath()` and only reach this module when a
 * line actually contains math. Non-math slides take their exact pre-existing
 * pptxgenjs text-run path, byte-identical to before.
 *
 * Server-only (pulls in `renderLatexToImage` → sharp / mathjax-full). It is
 * imported only by `generator.ts`, which already runs server-side.
 */

import { renderLatexToImage } from "@/lib/text/katexRender";
import {
  extractLatexSegments,
  hasLatex,
  shouldRenderInline,
} from "@/lib/text/latexSegments";

/** Resolution the shared rasteriser renders at — image px ÷ this = physical inches. */
const PRINT_DPI = 300;

export { hasLatex };

/** True when any bullet/line in the group carries a math or chemistry span. */
export function bulletsHaveMath(bullets: string[] | undefined | null): boolean {
  return (bullets ?? []).some((b) => hasLatex(b));
}

/** A rasterised slide line, sized in physical inches for direct pptxgenjs embed. */
export interface PptTextImage {
  /** `data:image/png;base64,...` ready for `slide.addImage({ data })`. */
  dataUri: string;
  /** Natural width in inches at 300 DPI (scale DOWN to fit, never up). */
  wIn: number;
  /** Natural height in inches. */
  hIn: number;
  /** True when the line was rendered as display/block math (its own space). */
  displayMode: boolean;
}

/** Escape a plain-text run so it is safe inside a LaTeX `\text{...}` group. */
function escapeTextForLatex(s: string): string {
  return s
    .replace(/\\/g, "\\textbackslash{}")
    .replace(/([%#&_{}$])/g, "\\$1")
    .replace(/\^/g, "\\textasciicircum{}")
    .replace(/~/g, "\\textasciitilde{}");
}

/**
 * Collapse a mixed text+math line into a single inline LaTeX string: plain-text
 * segments wrapped in `\text{...}`, math/chemistry segments kept verbatim (a
 * bare `\ce{...}` renders fine inside inline math with mhchem loaded). Returns
 * null when the line has no math — the caller keeps its plain-text path.
 */
export function lineToInlineLatex(text: string): string | null {
  const segs = extractLatexSegments(text);
  if (!segs.some((s) => s.type === "math")) return null;
  let out = "";
  for (const seg of segs) {
    if (seg.type === "text") {
      if (seg.value) out += `\\text{${escapeTextForLatex(seg.value)}}`;
    } else {
      out += seg.latex;
    }
  }
  return out;
}

/**
 * Rasterise a slide line to a fit-ready PNG, or return null when there is no
 * math (caller keeps its untouched pptxgenjs text path) or the LaTeX failed to
 * render (caller falls back to the literal source, exactly like PDF/Word).
 *
 * A line that is *entirely* one block-level span (`$$…$$`, or a single inline
 * span that `shouldRenderInline` judges tall — a fraction, integral, matrix, …)
 * is rendered in display mode so it gets its own visual space; everything else
 * renders as one inline line.
 */
export async function renderPptTextImage(
  text: string,
  opts: { fontSizePt: number; colorHex: string },
): Promise<PptTextImage | null> {
  if (!hasLatex(text)) return null;

  const trimmed = text.trim();
  const segs = extractLatexSegments(trimmed);

  let latex: string;
  let displayMode: boolean;
  const onlyMath =
    segs.length === 1 && segs[0].type === "math" ? segs[0] : null;
  if (
    onlyMath &&
    (onlyMath.displayMode || !shouldRenderInline(onlyMath.latex))
  ) {
    latex = onlyMath.latex;
    displayMode = true;
  } else {
    const inline = lineToInlineLatex(trimmed);
    if (inline == null) return null;
    latex = inline;
    displayMode = false;
  }

  const r = await renderLatexToImage(latex, {
    displayMode,
    fontSizePt: opts.fontSizePt,
    color: `#${opts.colorHex}`,
  });
  if (!r.ok) return null;

  return {
    dataUri: `data:image/png;base64,${r.buffer.toString("base64")}`,
    wIn: r.width / PRINT_DPI,
    hIn: r.height / PRINT_DPI,
    displayMode,
  };
}
