/**
 * katexRender — the single shared LaTeX + chemistry (mhchem) → image renderer used
 * by every print/export surface (PDF, Word, PPT) and by server-side preview.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SERVER-SIDE ONLY. Do not import this module from a client component or any file
 * that ends up in the browser bundle: it pulls in `mathjax-full` and `sharp`
 * (a native binary). The *screen* chat preview renders math a different way —
 * `src/components/chat/MarkdownRenderer.tsx` uses react-markdown + rehype-katex
 * (KaTeX in the browser). This module is the parallel, rasterising path.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Why MathJax and not KaTeX here:
 *   KaTeX (used on screen) only emits HTML + MathML positioned with CSS + web
 *   fonts — rasterising it requires a real browser/CSS engine (puppeteer), which
 *   is heavy and hostile to Vercel's serverless functions. MathJax renders LaTeX
 *   (and, via its mhchem extension, `\ce{...}` chemistry) to a *self-contained*
 *   SVG whose glyphs are vector `<path>`s — no font dependency — which `sharp`
 *   (already in the dependency tree) rasterises to a crisp PNG at any resolution.
 *   Both engines speak the same LaTeX, so the taught syntax (below) is identical
 *   on screen and in print; only pixel-level typography differs cosmetically.
 *
 * This file deliberately does NOT touch `markdownLite.ts` (bold/code/table/list
 * segmentation). Math/chemistry is a separate rendering concern.
 *
 * The client-safe pure helpers (`extractLatexSegments`, `shouldRenderInline`,
 * `MATH_CHEM_NOTATION_GUIDE`, …) live in `./latexSegments` so client bundles can
 * use them without pulling in `sharp`/`mathjax-full`; they are re-exported below
 * for server callers that want a single import.
 */

import { mathjax } from "mathjax-full/js/mathjax.js";
import { TeX } from "mathjax-full/js/input/tex.js";
import { SVG } from "mathjax-full/js/output/svg.js";
import { liteAdaptor } from "mathjax-full/js/adaptors/liteAdaptor.js";
import { RegisterHTMLHandler } from "mathjax-full/js/handlers/html.js";
import { AllPackages } from "mathjax-full/js/input/tex/AllPackages.js";
// Registering the mhchem configuration teaches the TeX input jax the `\ce{...}`
// macro. It must be imported for its side effect before the document is built.
import "mathjax-full/js/input/tex/mhchem/MhchemConfiguration.js";
import sharp from "sharp";

// ── Rendering constants ──────────────────────────────────────────────────────

/** Target raster resolution. Print wants 300 DPI, not the 96 DPI of a screen. */
const PRINT_DPI = 300;

/**
 * MathJax expresses an expression's SVG width/height in `ex` units. One `ex` is,
 * by MathJax's convention, half an `em` (half the font size). Converting an `ex`
 * measurement to physical print pixels is therefore:
 *
 *   pxPerEx = fontSizePt × (PRINT_DPI / 72 pt-per-inch) × EX_PER_EM
 *
 * so a 12 pt expression renders its `em` at 12 × 300/72 = 50 px, and one `ex` at
 * 25 px. (Validated empirically: `x^2` at 12 pt → 58×48 px.)
 */
const EX_PER_EM = 0.5;

/** Default glyph colour. Pure black is the safe, predictable choice for print. */
const DEFAULT_COLOR = "#000000";

// ── MathJax singleton ────────────────────────────────────────────────────────
// Building the adaptor/handler/document is comparatively expensive and the
// document is safely reusable across conversions, so we construct it once.

let mathDocument: ReturnType<typeof mathjax.document> | null = null;

function getMathDocument() {
  if (mathDocument) return mathDocument;

  const adaptor = liteAdaptor();
  RegisterHTMLHandler(adaptor);

  // `formatError` normally renders malformed LaTeX as inline red text; we instead
  // rethrow so `renderLatexToImage` can catch it and return a clean error result.
  const tex = new TeX({
    packages: AllPackages, // includes mhchem once MhchemConfiguration is imported
    formatError: (_jax: unknown, err: unknown) => {
      throw err;
    },
  });
  // `fontCache: "local"` keeps every glyph definition inside the one SVG we emit,
  // so each rasterised expression is fully self-contained (no cross-SVG <use> refs
  // that sharp/librsvg could not resolve).
  const svgOut = new SVG({ fontCache: "local" });

  mathDocument = mathjax.document("", { InputJax: tex, OutputJax: svgOut });
  // Stash the adaptor on the module so we can read the produced SVG string back.
  liteAdaptorRef = adaptor;
  return mathDocument;
}

let liteAdaptorRef: ReturnType<typeof liteAdaptor> | null = null;

// ── Public API ───────────────────────────────────────────────────────────────

export interface RenderLatexOptions {
  /** Block (display) math when true; inline (text) math when false. */
  displayMode: boolean;
  /** Font size in points; drives the physical pixel size at {@link PRINT_DPI}. */
  fontSizePt: number;
  /** Glyph colour (any CSS colour librsvg accepts). Defaults to black. */
  color?: string;
}

/** Successful raster of a LaTeX/chemistry expression. */
export interface RenderedLatex {
  ok: true;
  /** PNG bytes, transparent background, RGBA. */
  buffer: Buffer;
  /** Raster width in pixels (physical print pixels at {@link PRINT_DPI}). */
  width: number;
  /** Raster height in pixels. */
  height: number;
  /**
   * Baseline offset in pixels for inline placement: how far *below* the text
   * baseline the image's top edge should sit (MathJax's `vertical-align`,
   * converted to px). Positive means shift the image down. Block renderers can
   * ignore this; inline renderers use it to sit the image on the text baseline.
   */
  baselinePx: number;
}

/** A failed render — callers decide the fallback (literal text, flag for review). */
export interface RenderLatexError {
  ok: false;
  /** Human-readable reason (e.g. the MathJax parse error message). */
  error: string;
  /** The offending input, echoed back for logging / review queues. */
  latex: string;
}

export type RenderLatexResult = RenderedLatex | RenderLatexError;

/**
 * Render a single LaTeX (or mhchem `\ce{...}`) expression to a PNG.
 *
 * Never throws: malformed LaTeX — which AI-generated content will occasionally
 * emit — resolves to a {@link RenderLatexError} so generation does not crash.
 */
export async function renderLatexToImage(
  latex: string,
  opts: RenderLatexOptions,
): Promise<RenderLatexResult> {
  const source = (latex ?? "").trim();
  if (!source) {
    return { ok: false, error: "empty expression", latex: latex ?? "" };
  }

  const color = opts.color ?? DEFAULT_COLOR;
  const pxPerEx = opts.fontSizePt * (PRINT_DPI / 72) * EX_PER_EM;

  try {
    const doc = getMathDocument();
    const adaptor = liteAdaptorRef!;
    const node = doc.convert(source, { display: opts.displayMode });
    let svgString = adaptor.innerHTML(node);

    // MathJax may surface a soft parse failure as an <merror> node rather than by
    // throwing; treat that as an error too.
    if (/<merror|data-mjx-error/.test(svgString)) {
      return { ok: false, error: "invalid LaTeX", latex: source };
    }

    // Pull the ex-unit geometry MathJax stamped on the root <svg>.
    const widthEx = matchUnit(svgString, "width");
    const heightEx = matchUnit(svgString, "height");
    const vAlignEx = matchStyleEx(svgString, "vertical-align");
    if (widthEx == null || heightEx == null) {
      return { ok: false, error: "could not size rendered SVG", latex: source };
    }

    const widthPx = Math.max(1, Math.ceil(widthEx * pxPerEx));
    const heightPx = Math.max(1, Math.ceil(heightEx * pxPerEx));
    const baselinePx = Math.round(-(vAlignEx ?? 0) * pxPerEx);

    // MathJax glyphs are filled with `currentColor`; librsvg has no CSS context to
    // resolve that, so bake the concrete colour in. Then swap the ex-unit
    // width/height on the root element for explicit pixel dimensions, which makes
    // sharp rasterise at exactly those physical print pixels.
    svgString = svgString
      .replace(/currentColor/g, color)
      .replace(/(<svg[^>]*?)width="[\d.]+ex"/, `$1width="${widthPx}"`)
      .replace(/(<svg[^>]*?)height="[\d.]+ex"/, `$1height="${heightPx}"`);

    const buffer = await sharp(Buffer.from(svgString)).png().toBuffer();

    return { ok: true, buffer, width: widthPx, height: heightPx, baselinePx };
  } catch (err) {
    // MathJax throws a `TexError` that carries `.message` but is not a JS `Error`
    // instance, so read `.message` structurally rather than via `instanceof`.
    const message =
      typeof err === "object" && err !== null && "message" in err
        ? String((err as { message: unknown }).message)
        : String(err);
    return { ok: false, error: message, latex: source };
  }
}

/** Read a numeric `<name>="N.NNex"` attribute off the root SVG element. */
function matchUnit(svg: string, name: "width" | "height"): number | null {
  const m = svg.match(new RegExp(`${name}="([\\d.]+)ex"`));
  return m ? parseFloat(m[1]) : null;
}

/** Read `<style="... vertical-align: -N.NNex ...">` off the root SVG element. */
function matchStyleEx(svg: string, prop: string): number | null {
  const m = svg.match(new RegExp(`${prop}:\\s*(-?[\\d.]+)ex`));
  return m ? parseFloat(m[1]) : null;
}

// ── Re-exports of the client-safe pure helpers ───────────────────────────────
// Server callers can import these from here alongside `renderLatexToImage`;
// client code must import them from `./latexSegments` directly.

export {
  shouldRenderInline,
  extractLatexSegments,
  hasLatex,
  findUnsupportedNotation,
  hasUnsupportedNotation,
  MATH_CHEM_NOTATION_GUIDE,
  type LatexSegment,
} from "./latexSegments";
