/**
 * SERVER-ONLY visual rasterizer for PPT-refine export embedding.
 * ------------------------------------------------------------------
 * A RefinedSlide.visual can be one of three shapes (see SlideVisual):
 *   - svg     → inline SVG markup
 *   - imagen  → base64 PNG (already rasterized by the Imagen pass)
 *   - mermaid → Mermaid source code
 *
 * The results-preview surface renders each of these client-side (inline <svg>,
 * <img src="data:...">, <img src="mermaid.ink...">). This module produces the
 * SERVER-SIDE PNG bytes the assembler embeds into the exported .pptx so the
 * downloaded file carries the same visual the faculty saw in the browser.
 *
 * Contract: rasterizeVisual NEVER throws and NEVER fails the export. Any bad
 * input (malformed SVG, Imagen stub, mermaid.ink outage) resolves to `null`
 * with a logged warning so the caller simply skips that one visual.
 *
 * This is a GENERAL SVG rasterizer via `sharp` — deliberately NOT the
 * math-specific renderer in text/katexRender.ts, which is tuned for MathJax's
 * ex-unit LaTeX output. It only shares the underlying `sharp` dependency.
 */

import sharp from 'sharp';
import { sanitizeMermaidCode } from '@/lib/ppt/mermaidSanitize';
import type { SlideVisual } from './types';

/** A base64 PNG shorter than this is a broken/empty Imagen render (matches the
 *  5 KB guard the refiner and generator already use). */
const MIN_IMAGEN_B64_LEN = 5120;

/** Rasterization density (DPI) for SVG → PNG. 200 keeps AI diagrams (typically
 *  700×400 / 800×400 viewBoxes) crisp when scaled up on a slide. */
const SVG_RASTER_DENSITY = 200;

/** Cap the rasterized bitmap's longest edge so a runaway SVG/image can't produce
 *  a multi-megabyte media part that bloats the .pptx. */
const MAX_RASTER_EDGE_PX = 2000;

/** mermaid.ink fetch timeout — same budget the PDF/PPT generators already use. */
const MERMAID_FETCH_TIMEOUT_MS = 8000;

export interface RasterizedVisual {
  buffer: Buffer;
  /** Media file extension WITHOUT the dot. Always 'png' here (mermaid/svg/imagen
   *  all normalise to PNG), but kept explicit so [Content_Types].xml coverage and
   *  the media filename are driven by one value. */
  ext: 'png';
  mime: string;
  /** Pixel dimensions of the rasterized bitmap, for aspect-ratio-correct placement. */
  widthPx: number;
  heightPx: number;
}

/** Ensure an SVG string carries the xmlns librsvg/sharp needs to parse it. */
function normalizeSvg(svg: string): string {
  const cleaned = svg
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/[\r\n]+/g, ' ')
    .trim();
  return cleaned.includes('xmlns=')
    ? cleaned
    : cleaned.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
}

/** Read a PNG buffer's dimensions; returns a safe 4:3 default if metadata fails. */
async function pngDimensions(buffer: Buffer): Promise<{ widthPx: number; heightPx: number }> {
  try {
    const meta = await sharp(buffer).metadata();
    if (meta.width && meta.height) return { widthPx: meta.width, heightPx: meta.height };
  } catch {
    /* fall through to default */
  }
  return { widthPx: 800, heightPx: 600 };
}

async function rasterizeSvg(svg: string, slideIdx: number): Promise<RasterizedVisual | null> {
  const markup = normalizeSvg(svg);
  if (!markup.includes('<svg')) {
    console.warn(`[ppt-refine/visual-raster] slide ${slideIdx}: not valid SVG markup — skipping visual`);
    return null;
  }
  try {
    const buffer = await sharp(Buffer.from(markup), { density: SVG_RASTER_DENSITY })
      .resize({
        width: MAX_RASTER_EDGE_PX,
        height: MAX_RASTER_EDGE_PX,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .png()
      .toBuffer();
    const { widthPx, heightPx } = await pngDimensions(buffer);
    return { buffer, ext: 'png', mime: 'image/png', widthPx, heightPx };
  } catch (err) {
    console.warn(
      `[ppt-refine/visual-raster] slide ${slideIdx}: SVG rasterization failed — skipping visual:`,
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

function decodeImagen(b64: string, slideIdx: number): Promise<RasterizedVisual | null> {
  const clean = b64.trim();
  if (clean.length < MIN_IMAGEN_B64_LEN) {
    console.warn(
      `[ppt-refine/visual-raster] slide ${slideIdx}: Imagen content <5KB (broken render) — skipping visual`
    );
    return Promise.resolve(null);
  }
  try {
    const buffer = Buffer.from(clean, 'base64');
    if (buffer.length < MIN_IMAGEN_B64_LEN) return Promise.resolve(null);
    return pngDimensions(buffer).then(({ widthPx, heightPx }) => ({
      buffer,
      ext: 'png' as const,
      mime: 'image/png',
      widthPx,
      heightPx,
    }));
  } catch (err) {
    console.warn(
      `[ppt-refine/visual-raster] slide ${slideIdx}: Imagen base64 decode failed — skipping visual:`,
      err instanceof Error ? err.message : err
    );
    return Promise.resolve(null);
  }
}

async function rasterizeMermaid(code: string, slideIdx: number): Promise<RasterizedVisual | null> {
  const safe = sanitizeMermaidCode(code.trim());
  if (!safe) return null;
  const encoded = Buffer.from(safe, 'utf-8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
  const url = `https://mermaid.ink/img/${encoded}?type=png&bgColor=white`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(MERMAID_FETCH_TIMEOUT_MS) });
    if (!res.ok) {
      console.warn(
        `[ppt-refine/visual-raster] slide ${slideIdx}: mermaid.ink HTTP ${res.status} — skipping visual`
      );
      return null;
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length < 256) {
      console.warn(
        `[ppt-refine/visual-raster] slide ${slideIdx}: mermaid.ink returned empty body — skipping visual`
      );
      return null;
    }
    const { widthPx, heightPx } = await pngDimensions(buffer);
    return { buffer, ext: 'png', mime: 'image/png', widthPx, heightPx };
  } catch (err) {
    console.warn(
      `[ppt-refine/visual-raster] slide ${slideIdx}: mermaid.ink fetch failed — skipping visual:`,
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

/**
 * Rasterize one slide visual to PNG bytes for embedding, or `null` if it can't be
 * produced (never throws). `slideIdx` is used only for log correlation.
 */
export async function rasterizeVisual(
  visual: SlideVisual,
  slideIdx = -1
): Promise<RasterizedVisual | null> {
  if (!visual || typeof visual.content !== 'string' || !visual.content.trim()) return null;
  switch (visual.type) {
    case 'svg':
      return rasterizeSvg(visual.content, slideIdx);
    case 'imagen':
      return decodeImagen(visual.content, slideIdx);
    case 'mermaid':
      return rasterizeMermaid(visual.content, slideIdx);
    default:
      return null;
  }
}
