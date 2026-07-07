/**
 * paperMath — the async pre-render pass that turns every LaTeX / mhchem span in
 * an assembled paper into raster images, so the synchronous PDF and Word builders
 * can embed them without themselves being async.
 *
 * This mirrors {@link loadPaperImages} in `qpaperImages.ts`: one pre-pass produces
 * a `Map` keyed by content, which the three export surfaces (qpaper PDF, answer-key
 * PDF, Word) look up while drawing. Keeping the rasterisation here — outside the
 * draw code — is what lets those builders stay unchanged for non-math content.
 *
 * Sizing strategy: every distinct expression is rendered ONCE, at a fixed
 * reference point size ({@link REFERENCE_PT}) at 300 DPI. Because that raster is
 * high-resolution, each builder scales it down to whatever font size it needs at
 * embed time and it stays crisp — see {@link mathSizePt} / {@link mathSizeDocxPx}.
 *
 * Server-only (pulls in `renderLatexToImage` → sharp / mathjax-full).
 */

import { renderLatexToImage } from "@/lib/text/katexRender";
import { extractLatexSegments } from "@/lib/text/latexSegments";

/** The reference size every expression is rasterised at (then scaled per use). */
const REFERENCE_PT = 12;
const PRINT_DPI = 300;

/** A rasterised expression at the reference size. Pixel geometry is intrinsic. */
export interface MathAsset {
  buffer: Buffer;
  /** Intrinsic pixel width at {@link REFERENCE_PT} / 300 DPI. */
  width: number;
  /** Intrinsic pixel height. */
  height: number;
  /** Baseline offset in px (how far below the text baseline the top sits). */
  baseline: number;
  /** True for display/block math, false for inline. */
  displayMode: boolean;
}

/** latex-span key → rasterised asset (null when the span failed to render). */
export type MathRenderMap = Map<string, MathAsset | null>;

/** Stable key for a span: rendering only depends on the LaTeX and display mode. */
export function mathKey(latex: string, displayMode: boolean): string {
  return `${displayMode ? "D" : "I"}:${latex}`;
}

/**
 * Convert an asset's intrinsic pixels to PDF points at a target font size.
 *
 *   pt = px × (72 / 300 DPI) × (targetPt / REFERENCE_PT) = px × targetPt / 50
 */
/** Intrinsic pixel geometry shared by {@link MathAsset} and embedded variants. */
export interface MathGeometry {
  width: number;
  height: number;
  baseline: number;
}

export function mathSizePt(
  asset: MathGeometry,
  targetPt: number,
): { width: number; height: number; baseline: number } {
  const k = (targetPt * 72) / (PRINT_DPI * REFERENCE_PT); // = targetPt / 50
  return {
    width: asset.width * k,
    height: asset.height * k,
    baseline: asset.baseline * k,
  };
}

/**
 * Convert an asset's intrinsic pixels to docx pixels (96 DPI) at a target size.
 *
 *   docpx = px × (96 / 300 DPI) × (targetPt / REFERENCE_PT) = px × targetPt / 37.5
 */
export function mathSizeDocxPx(
  asset: MathGeometry,
  targetPt: number,
): { width: number; height: number } {
  const k = (targetPt * 96) / (PRINT_DPI * REFERENCE_PT); // = targetPt / 37.5
  return {
    width: Math.max(1, Math.round(asset.width * k)),
    height: Math.max(1, Math.round(asset.height * k)),
  };
}

/** Recursively collect every string value found anywhere in a value. */
function collectStrings(value: unknown, out: string[], depth = 0): void {
  if (depth > 12 || value == null) return;
  if (typeof value === "string") {
    out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) collectStrings(v, out, depth + 1);
    return;
  }
  if (typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) {
      collectStrings(v, out, depth + 1);
    }
  }
}

/**
 * Walk an assembled paper (any shape), find every distinct LaTeX / chemistry span
 * in its text, and rasterise each once. Returns a map the builders look up by
 * {@link mathKey}.
 *
 * Deep-walking every string is deliberate: it guarantees no text field is missed
 * regardless of the paper's shape, and non-math strings simply yield no spans.
 * Malformed spans render to `null`; builders fall back to the literal source.
 */
export async function renderPaperMath(paper: unknown): Promise<MathRenderMap> {
  const strings: string[] = [];
  collectStrings(paper, strings);

  // Unique spans keyed by (latex, displayMode); dedup avoids re-rendering repeats.
  const spans = new Map<string, { latex: string; displayMode: boolean }>();
  for (const s of strings) {
    if (!s.includes("$") && !s.includes("\\ce{")) continue; // cheap pre-filter
    for (const seg of extractLatexSegments(s)) {
      if (seg.type !== "math") continue;
      const key = mathKey(seg.latex, seg.displayMode);
      if (!spans.has(key)) {
        spans.set(key, { latex: seg.latex, displayMode: seg.displayMode });
      }
    }
  }

  const map: MathRenderMap = new Map();
  await Promise.all(
    Array.from(spans.entries()).map(async ([key, { latex, displayMode }]) => {
      const r = await renderLatexToImage(latex, {
        displayMode,
        fontSizePt: REFERENCE_PT,
      });
      map.set(
        key,
        r.ok
          ? {
              buffer: r.buffer,
              width: r.width,
              height: r.height,
              baseline: r.baselinePx,
              displayMode,
            }
          : null,
      );
    }),
  );
  return map;
}
