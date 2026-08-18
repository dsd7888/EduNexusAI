/**
 * notesMath — the async pre-render pass that turns every LaTeX / chemistry span
 * in a set of notes blocks into raster images, so the synchronous PDFBuilder
 * draw calls (CP-N5 Part 2) can embed them without themselves being async.
 *
 * Mirrors {@link renderPaperMath} in qpaper/paperMath.ts: one pre-pass produces a
 * `MathRenderMap` the builder looks up while drawing, keeping the draw code
 * itself synchronous. Two differences from that file, both deliberate:
 *
 *   1. paperMath.ts deep-walks EVERY string in an arbitrary-shaped paper object.
 *      This walks the typed NoteBlock fields explicitly, because two of them —
 *      `symbols[].symbol` and `symbols[].unit` — need {@link withMathDelimiters}
 *      applied BEFORE extraction (they may carry a bare control sequence with no
 *      `$…$` wrapper; see math-helpers.ts for why). A shape-blind walk has no way
 *      to know which strings those are.
 *   2. It reuses paperMath.ts's OWN `MathRenderMap` type (keyed by `mathKey`,
 *      valued `MathAsset | null`) rather than a bespoke `Map<string, Buffer>`,
 *      because that is the exact shape `PDFBuilder.embedMath()` already consumes
 *      — Part 2 extends the shared builder rather than forking a parallel one,
 *      so the map it hands over must speak the builder's existing language.
 *
 * A single span's render failure produces `null` for that key (not a thrown
 * error) — the same convention paperMath.ts uses, and the one `PDFBuilder`
 * already understands: `embedMath` skips `null` entries, and `mathLine` /
 * `drawTableMath` fall back to the literal LaTeX source when a key is absent
 * from the embedded set. That fallback is more useful to a student than an
 * invisible placeholder image, so no synthetic blank PNG is inserted. All
 * failures for one export are logged together, once, after the pass completes.
 *
 * Server-only (pulls in katexRender → sharp / mathjax-full transitively).
 */

import { renderLatexToImage } from "@/lib/text/katexRender";
import { extractLatexSegments } from "@/lib/text/latexSegments";
import { mathKey, type MathRenderMap } from "@/lib/qpaper/paperMath";
import { withMathDelimiters } from "@/lib/notes/math-helpers";
import type { EnrichedNoteBlock } from "@/lib/notes/pyq-frequency";

export type { MathRenderMap } from "@/lib/qpaper/paperMath";

/** Reference point size every expression is rasterised at (paperMath.ts's own). */
const REFERENCE_PT = 12;

type SpanRef = { latex: string; displayMode: boolean };

/** Scan one text field for math/chemistry spans, adding new ones to `out`. */
function collectFromText(text: string | undefined, out: Map<string, SpanRef>): void {
  if (!text) return;
  // Cheap pre-filter, same guard paperMath.ts uses before the real parse.
  if (!text.includes("$") && !text.includes("\\ce{")) return;
  for (const seg of extractLatexSegments(text)) {
    if (seg.type !== "math") continue;
    const key = mathKey(seg.latex, seg.displayMode);
    if (!out.has(key)) out.set(key, { latex: seg.latex, displayMode: seg.displayMode });
  }
}

/**
 * The single walk both public functions are built on. Not exported: callers
 * that need displayMode (i.e. {@link prerenderNotesMath}) use this directly;
 * callers that only need the deduplicated LaTeX text (i.e.
 * {@link collectNotesMathSpans}) get it derived from the same walk, so the two
 * functions can never disagree about what counts as a span.
 */
function collectSpanRefs(blocks: EnrichedNoteBlock[]): Map<string, SpanRef> {
  const spans = new Map<string, SpanRef>();

  for (const block of blocks) {
    if (block.kind === "concept") {
      collectFromText(block.plainExplanation, spans);
      collectFromText(block.formalStatement, spans);
      continue;
    }
    if (block.kind === "formula") {
      collectFromText(withMathDelimiters(block.formula), spans);
      for (const s of block.symbols) {
        collectFromText(withMathDelimiters(s.symbol), spans);
        if (s.unit) collectFromText(withMathDelimiters(s.unit), spans);
      }
      if (block.workedExample) {
        collectFromText(block.workedExample.problem, spans);
        collectFromText(block.workedExample.solution, spans);
      }
      continue;
    }
    // comparison
    for (const item of block.items) {
      for (const v of item.values) collectFromText(v, spans);
    }
  }

  return spans;
}

/**
 * Walk every block, applying {@link withMathDelimiters} to the fields known to
 * carry bare control sequences (`symbols[].symbol`, `symbols[].unit`) before
 * scanning, and return the unique LaTeX spans found across the whole set.
 *
 * Recognises `$…$` / `$$…$$` and bare `\ce{…}` — the one syntax taught
 * everywhere downstream (§13's `MATH_CHEM_NOTATION_GUIDE`), not a separate
 * `\(…\)` convention this codebase does not otherwise support.
 */
export function collectNotesMathSpans(blocks: EnrichedNoteBlock[]): string[] {
  return [...collectSpanRefs(blocks).values()].map((s) => s.latex);
}

/**
 * Render every unique LaTeX/chemistry span across `blocks` to a PNG, once each,
 * at the shared reference size. Never throws — a malformed span logs and yields
 * `null` for that key; the caller's PDFBuilder falls back to the literal source
 * for anything missing from the map.
 */
export async function prerenderNotesMath(
  blocks: EnrichedNoteBlock[]
): Promise<MathRenderMap> {
  const spans = collectSpanRefs(blocks);
  const map: MathRenderMap = new Map();
  const failed: string[] = [];

  await Promise.all(
    [...spans.entries()].map(async ([key, { latex, displayMode }]) => {
      const r = await renderLatexToImage(latex, {
        displayMode,
        fontSizePt: REFERENCE_PT,
      });
      if (r.ok) {
        map.set(key, {
          buffer: r.buffer,
          width: r.width,
          height: r.height,
          baseline: r.baselinePx,
          displayMode,
        });
      } else {
        map.set(key, null);
        failed.push(latex);
      }
    })
  );

  if (failed.length > 0) {
    console.warn(
      `[notes/pdf] ${failed.length} span${failed.length === 1 ? "" : "s"} failed to render: ${failed
        .map((s) => JSON.stringify(s.slice(0, 60)))
        .join(", ")}`
    );
  }

  return map;
}
