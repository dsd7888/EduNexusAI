import AdmZip from 'adm-zip';
import { parseSlideSize, type SlideCanvas } from './slide-size';
import {
  NO_CHANGE_SUMMARY,
  BATCH_FAILURE_SUMMARY,
  REVERT_SUMMARY,
  PARTIAL_REVERT_TITLE_SUMMARY,
  PARTIAL_REVERT_BODY_SUMMARY,
  NOT_SELECTED_SUMMARY,
} from './types';
import type { RefinedDeck, RefinedSlide } from './types';

/**
 * XML-PATCHING ASSEMBLER
 * ----------------------
 * The original pipeline rebuilt every slide from scratch with pptxgenjs, which
 * destroyed the source deck's theme, fonts, images, diagrams and footers.
 *
 * This implementation instead PATCHES the original .pptx in place:
 *   - Existing slides: only the title + body <a:t> text runs are swapped, every
 *     other byte (images, charts, SmartArt, grouped shapes, formatting, theme)
 *     is preserved exactly.
 *   - New slides (is_new === true): appended as minimal placeholder slides that
 *     reference an existing slideLayout, so they inherit the master theme.
 *
 * Why surgical string editing instead of a full XML parse+rebuild:
 *   A parse → mutate → serialise round-trip risks subtly altering unrelated XML
 *   (entity re-encoding, self-closing tags, namespace attrs) which can make
 *   PowerPoint refuse to open the file. By only rewriting the matched <a:t>
 *   text spans we guarantee every other byte is identical to the original, and
 *   any uncertainty makes us bail and keep the original slide untouched.
 *
 * NOTE ON SCOPE: visual (<p:pic>) injection and bottom "KEY INSIGHT" callout
 * boxes are intentionally NOT injected into existing slides — an absolutely
 * positioned box would cover the original footer/logo and clash with the
 * preserved theme. Refined visual/insight content still flows through as body
 * text. New slides are built text-only so they always open cleanly.
 */

// ─── Text helpers ───────────────────────────────────────────────────────────

function stripMd(t: string): string {
  return (t ?? '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/`(.*?)`/g, '$1')
    .trim();
}

function cleanText(t: string): string {
  return stripMd(t).replace(/\s+/g, ' ').trim();
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Strip any HTML tags the model emits so they never render as literal text. */
function stripHtml(text: string): string {
  return text
    .replace(/<b>(.*?)<\/b>/gi, '$1')
    .replace(/<i>(.*?)<\/i>/gi, '$1')
    .replace(/<strong>(.*?)<\/strong>/gi, '$1')
    .replace(/<em>(.*?)<\/em>/gi, '$1')
    .replace(/<[^>]+>/g, '')
    .trim();
}

/** Sanitize + XML-escape text destined for an <a:t> node. */
function escT(s: string): string {
  return xmlEscape(stripHtml(s));
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ─── Balanced XML element scanning ──────────────────────────────────────────
// We never fully parse the document; we just locate element boundaries so we
// can target the exact <a:t> text spans to rewrite.

interface ChildSpan {
  name: string;
  start: number; // index of '<' of the opening tag
  end: number; // index just after the matching close (or self-close)
}

/**
 * Given the index of the '<' of an opening tag named `name`, return the span
 * [start, end) of the whole element including its matching close tag. Handles
 * nesting of same-named elements (e.g. p:grpSp inside p:grpSp). Returns null on
 * any malformed / unmatched input so the caller can bail safely.
 */
function elementRange(xml: string, openStart: number, name: string): [number, number] | null {
  const tagRe = new RegExp(`<(/?)${escapeRe(name)}\\b[^>]*?(/?)>`, 'g');
  tagRe.lastIndex = openStart;
  let depth = 0;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(xml))) {
    const isClose = m[1] === '/';
    const selfClose = m[2] === '/';
    if (m.index === openStart) {
      if (selfClose) return [openStart, tagRe.lastIndex];
      depth = 1;
      continue;
    }
    if (depth === 0) return null; // matched something outside our element
    if (selfClose) continue;
    if (isClose) {
      depth--;
      if (depth === 0) return [openStart, tagRe.lastIndex];
    } else {
      depth++;
    }
  }
  return null;
}

/** Inner content range + outer span of the first element named `name`. */
function getInnerRange(
  xml: string,
  name: string
): { innerStart: number; innerEnd: number; outerStart: number; outerEnd: number } | null {
  const openRe = new RegExp(`<${escapeRe(name)}\\b[^>]*?(/?)>`);
  const m = openRe.exec(xml);
  if (!m) return null;
  if (m[1] === '/') return null; // self-closed, no inner content
  const outerStart = m.index;
  const innerStart = m.index + m[0].length;
  const range = elementRange(xml, outerStart, name);
  if (!range) return null;
  const outerEnd = range[1];
  const closeRe = new RegExp(`</${escapeRe(name)}\\s*>\\s*$`);
  const cm = closeRe.exec(xml.slice(outerStart, outerEnd));
  const innerEnd = cm ? outerStart + cm.index : outerEnd;
  return { innerStart, innerEnd, outerStart, outerEnd };
}

/** Top-level child elements within [innerStart, innerEnd). */
function topChildren(xml: string, innerStart: number, innerEnd: number): ChildSpan[] {
  const res: ChildSpan[] = [];
  const tagOpen = /<([A-Za-z_][\w:.-]*)\b/g;
  let i = innerStart;
  while (i < innerEnd) {
    tagOpen.lastIndex = i;
    const m = tagOpen.exec(xml);
    if (!m || m.index >= innerEnd) break;
    const name = m[1];
    const range = elementRange(xml, m.index, name);
    if (!range) break;
    res.push({ name, start: range[0], end: range[1] });
    i = range[1];
  }
  return res;
}

// ─── Text-run helpers ───────────────────────────────────────────────────────

/** Does this fragment contain at least one non-empty <a:t> run? */
function hasText(fragment: string): boolean {
  const re = /<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(fragment))) {
    if (m[1] && m[1].trim()) return true;
  }
  return false;
}

/**
 * Rewrite the text of a fragment: set the FIRST <a:t> run to `value` (escaped)
 * and empty every subsequent <a:t> run. All formatting (<a:rPr>, <a:pPr>,
 * bullets, fonts) is untouched. Passing '' empties the whole fragment's text.
 */
function setFragmentText(fragment: string, value: string): string {
  let first = true;
  return fragment.replace(/(<a:t\b[^>]*>)([\s\S]*?)(<\/a:t>)/g, (_whole, open, _content, close) => {
    if (first) {
      first = false;
      return `${open}${value ? escT(value) : ''}${close}`;
    }
    return `${open}${close}`;
  });
}

interface Placeholder {
  type?: string;
  idx?: string;
}

function getPlaceholder(spXml: string): Placeholder | null {
  const m = /<p:ph\b([^>]*?)\/?>/.exec(spXml);
  if (!m) return null;
  const attrs = m[1];
  const type = /\btype="([^"]*)"/.exec(attrs)?.[1];
  const idx = /\bidx="([^"]*)"/.exec(attrs)?.[1];
  return { type, idx };
}

/**
 * Ensure a shape's <a:bodyPr> carries <a:normAutofit/> so PowerPoint auto-shrinks
 * text to fit the box. Replaces <a:spAutoFit/> / <a:noAutofit/>; adds one if absent.
 *
 * A bare <a:normAutofit/> only makes PowerPoint recompute the shrink when the box
 * is edited interactively — on open/export the *stored* fontScale is honoured, so
 * a bare tag renders at 100% and long text still bleeds. When `fontScale` (0–1) is
 * supplied we bake that scale into the tag so the shrink is applied on render.
 *
 * Author-set autofit is respected: an existing <a:normAutofit .../> is kept, and
 * a computed `fontScale` is only stamped on when the existing tag has none of its
 * own (never clobber an authored fontScale).
 */
function ensureNormAutofit(spXml: string, fontScale?: number): string {
  const scaleAttr =
    fontScale !== undefined && fontScale < 1
      ? ` fontScale="${Math.round(fontScale * 100000)}"`
      : '';

  const tx = getInnerRange(spXml, 'p:txBody');
  if (!tx) return spXml;

  const bpOpen = /<a:bodyPr\b[^>]*?(\/?)>/.exec(spXml.slice(tx.outerStart, tx.outerEnd));
  if (!bpOpen) {
    // No <a:bodyPr> — insert a minimal one at the very start of <p:txBody>.
    return (
      spXml.slice(0, tx.innerStart) +
      `<a:bodyPr><a:normAutofit${scaleAttr}/></a:bodyPr>` +
      spXml.slice(tx.innerStart)
    );
  }

  const bpAbsStart = tx.outerStart + bpOpen.index;
  const selfClose = bpOpen[1] === '/';

  if (selfClose) {
    const bpAbsEnd = bpAbsStart + bpOpen[0].length;
    const openTag = bpOpen[0].replace(/\/>$/, '>');
    return (
      spXml.slice(0, bpAbsStart) +
      openTag +
      `<a:normAutofit${scaleAttr}/></a:bodyPr>` +
      spXml.slice(bpAbsEnd)
    );
  }

  const bpRange = elementRange(spXml, bpAbsStart, 'a:bodyPr');
  if (!bpRange) return spXml;
  let bpXml = spXml.slice(bpRange[0], bpRange[1]);
  if (/<a:normAutofit\b/.test(bpXml)) {
    // Already present — respect the author's autofit. Only stamp on our computed
    // fontScale when the existing tag carries none of its own.
    if (scaleAttr && !/<a:normAutofit\b[^>]*\bfontScale=/.test(bpXml)) {
      bpXml = bpXml.replace(/<a:normAutofit\b([^>]*?)\/>/, `<a:normAutofit$1${scaleAttr}/>`);
      return spXml.slice(0, bpRange[0]) + bpXml + spXml.slice(bpRange[1]);
    }
    return spXml;
  }

  bpXml = bpXml.replace(/<a:spAutoFit\s*\/>/g, '').replace(/<a:noAutofit\s*\/>/g, '');

  // Insert after <a:prstTxWarp> if present (schema order), else after the open tag.
  const openTag = /^<a:bodyPr\b[^>]*?>/.exec(bpXml)?.[0] ?? '<a:bodyPr>';
  let insertPos = openTag.length;
  const warp = /<a:prstTxWarp\b(?:[^>]*\/>|[\s\S]*?<\/a:prstTxWarp>)/.exec(bpXml);
  if (warp) insertPos = warp.index + warp[0].length;
  bpXml = bpXml.slice(0, insertPos) + `<a:normAutofit${scaleAttr}/>` + bpXml.slice(insertPos);

  return spXml.slice(0, bpRange[0]) + bpXml + spXml.slice(bpRange[1]);
}

/** Read a shape's own <a:xfrm> offset/extent (EMU). NaN where unspecified. */
function getShapeXfrm(spXml: string): { y: number; cx: number; cy: number } | null {
  const xf = getInnerRange(spXml, 'a:xfrm');
  if (!xf) return null;
  const xfXml = spXml.slice(xf.outerStart, xf.outerEnd);
  const offTag = /<a:off\b[^>]*\/>/.exec(xfXml)?.[0] ?? '';
  const extTag = /<a:ext\b[^>]*\/>/.exec(xfXml)?.[0] ?? '';
  const y = Number(/\by="(-?\d+)"/.exec(offTag)?.[1] ?? NaN);
  const cx = Number(/\bcx="(\d+)"/.exec(extTag)?.[1] ?? NaN);
  const cy = Number(/\bcy="(\d+)"/.exec(extTag)?.[1] ?? NaN);
  return { y, cx, cy };
}

/** Set the cy (height) on a shape's own <a:xfrm> <a:ext>. */
function setShapeCy(spXml: string, cy: number): string {
  const xf = getInnerRange(spXml, 'a:xfrm');
  if (!xf) return spXml;
  const before = spXml.slice(0, xf.innerStart);
  const inner = spXml
    .slice(xf.innerStart, xf.innerEnd)
    .replace(/(<a:ext\b[^>]*\bcy=")\d+(")/, `$1${cy}$2`);
  return before + inner + spXml.slice(xf.innerEnd);
}

// ─── Text-fit estimation ────────────────────────────────────────────────────
// Refined text is frequently longer than the original the box was sized for. A
// bare <a:normAutofit/> does NOT shrink it on render (see ensureNormAutofit), so
// without an estimate the surplus text bleeds out of the box (the ADA_GTU
// overflow). We approximate the line count the new text needs at a given font
// size and box width, compare it to how many lines the box height can hold, and
// (if it overflows) find the largest fontScale that makes it fit. This is a
// deliberately coarse estimate — it only needs to catch gross overflow, not be
// pixel-perfect, and it is biased to UNDER-trigger so tight-by-design boxes are
// left alone.

const EMU_PER_POINT = 12700;
const LINE_HEIGHT_FACTOR = 1.2; // line advance ≈ 1.2× font size
const AVG_CHAR_WIDTH_FACTOR = 0.5; // avg proportional glyph advance ≈ 0.5em
/** Below this the text is unreadably small — the box was never meant to hold
 *  this much, so we keep the original text rather than ship a 40% wall. */
const MIN_AUTOFIT_SCALE = 0.6;
/** Fallback font sizes (pt) when a shape declares none explicitly (inherited
 *  from layout/master, which we don't resolve). Chosen moderate so the estimate
 *  neither wildly over- nor under-triggers. */
const DEFAULT_TITLE_FONT_PT = 24;
const DEFAULT_BODY_FONT_PT = 18;
/** Body font (pt) of an appended new/continuation slide — matches the sz="1600"
 *  runs emitted by buildNewSlideBody. Used to fit-check continuation overflow. */
const DEFAULT_NEW_BODY_PT = 16;

type FitResult =
  | { kind: 'fits' } // fits at 100%, OR geometry/size unknown → leave as-is
  | { kind: 'shrink'; scale: number } // apply this fontScale via normAutofit
  | { kind: 'overflow' }; // cannot fit even at MIN_AUTOFIT_SCALE → keep original

/** First explicit run/def font size in points, or NaN if the shape declares none. */
function firstFontSizePt(spXml: string): number {
  const m = /<a:(?:rPr|defRPr|endParaRPr)\b[^>]*\bsz="(\d+)"/.exec(spXml);
  return m ? Number(m[1]) / 100 : NaN;
}

/** Estimate the total wrapped-line count `paras` need at a font size and width. */
function estimateLines(paras: string[], widthPt: number, fontSizePt: number): number {
  const charsPerLine = Math.max(1, Math.floor(widthPt / (fontSizePt * AVG_CHAR_WIDTH_FACTOR)));
  let lines = 0;
  for (const p of paras) {
    lines += Math.max(1, Math.ceil(p.length / charsPerLine)); // every bullet is ≥ 1 line
  }
  return lines;
}

/**
 * Core fit estimator against an explicit box (EMU) and font size (pt): does
 * `paras` fit at 100%, at some readable shrink, or not at all? Pure — takes raw
 * geometry so it can be reused both for existing shapes (via assessTextFit) and
 * for a prospective appended continuation slide's body box (which has no shape
 * XML yet). Unknown/degenerate geometry → 'fits' (leave as-is, never block).
 */
function fitScaleForBox(paras: string[], cxEmu: number, cyEmu: number, fontPt: number): FitResult {
  if (
    !Number.isFinite(cxEmu) ||
    !Number.isFinite(cyEmu) ||
    cxEmu <= 0 ||
    cyEmu <= 0 ||
    !Number.isFinite(fontPt) ||
    fontPt <= 0
  ) {
    return { kind: 'fits' };
  }

  const widthPt = cxEmu / EMU_PER_POINT;
  const heightPt = cyEmu / EMU_PER_POINT;

  const fitsAt = (scale: number): boolean => {
    const fs = fontPt * scale;
    const lines = estimateLines(paras, widthPt, fs);
    const maxLines = Math.max(1, Math.floor(heightPt / (fs * LINE_HEIGHT_FACTOR)));
    return lines <= maxLines;
  };

  if (fitsAt(1)) return { kind: 'fits' };

  // Step down in PowerPoint-like 5% increments to the readable floor.
  for (let scale = 0.95; scale >= MIN_AUTOFIT_SCALE - 1e-9; scale -= 0.05) {
    if (fitsAt(scale)) return { kind: 'shrink', scale };
  }
  return { kind: 'overflow' };
}

/**
 * Assess whether `paras` fit `cyEmu` of vertical space in the shape's box, and if
 * not, the largest fontScale that would. `cyEmu` is passed in (not read from the
 * shape) because the caller may have already shrunk the box for an overlapping
 * image (Bug 4) — we must estimate against the box the text will actually get.
 */
function assessTextFit(
  spXml: string,
  paras: string[],
  cyEmu: number,
  defaultFontPt: number
): FitResult {
  const xf = getShapeXfrm(spXml);
  const cx = xf?.cx ?? NaN;
  let fontPt = firstFontSizePt(spXml);
  if (!Number.isFinite(fontPt) || fontPt <= 0) fontPt = defaultFontPt;
  return fitScaleForBox(paras, cx, cyEmu, fontPt);
}

/**
 * Patch a title shape's text. Replaces existing run text when present; injects a
 * fresh run (preserving schema order) when the placeholder was originally empty,
 * so faculty-blank titles no longer render as "Click to add title".
 */
function patchTitleShape(spXml: string, title: string): string {
  const tx = getInnerRange(spXml, 'p:txBody');
  if (!tx) return setFragmentText(spXml, title);

  const txInner = spXml.slice(tx.innerStart, tx.innerEnd);
  const hasRunText = /<a:r\b[\s\S]*?<a:t\b/.test(txInner);
  if (hasRunText) return setFragmentText(spXml, title);

  // Empty placeholder — inject a run into the first paragraph (or create one).
  const runXml = `<a:r><a:rPr lang="en-IN" b="1" dirty="0"/><a:t>${escT(title)}</a:t></a:r>`;
  const paras = topChildren(spXml, tx.innerStart, tx.innerEnd).filter((c) => c.name === 'a:p');

  if (paras.length > 0) {
    const p0 = paras[0];
    const pXml = spXml.slice(p0.start, p0.end);
    let newPXml: string;
    const endPr = /<a:endParaRPr\b(?:[^>]*\/>|[\s\S]*?<\/a:endParaRPr>)/.exec(pXml);
    if (endPr) {
      // endParaRPr must remain last — insert the run before it.
      newPXml = pXml.slice(0, endPr.index) + runXml + pXml.slice(endPr.index);
    } else if (/<a:p\b[^>]*\/>/.test(pXml)) {
      newPXml = pXml.replace(/<a:p\b([^>]*)\/>/, `<a:p$1>${runXml}</a:p>`);
    } else {
      newPXml = pXml.replace(/<\/a:p>\s*$/, `${runXml}</a:p>`);
    }
    return spXml.slice(0, p0.start) + newPXml + spXml.slice(p0.end);
  }

  // No paragraph at all — add one after <a:bodyPr>/<a:lstStyle> (schema order).
  const lst = /<a:lstStyle\b(?:[^>]*\/>|[\s\S]*?<\/a:lstStyle>)/.exec(txInner);
  const bp = /<a:bodyPr\b(?:[^>]*\/>|[\s\S]*?<\/a:bodyPr>)/.exec(txInner);
  const rel = lst ? lst.index + lst[0].length : bp ? bp.index + bp[0].length : 0;
  const insertAt = tx.innerStart + rel;
  return spXml.slice(0, insertAt) + `<a:p>${runXml}</a:p>` + spXml.slice(insertAt);
}

// ─── Existing-slide body patching ───────────────────────────────────────────

function patchBodyShape(spXml: string, bullets: string[]): string {
  const tx = getInnerRange(spXml, 'p:txBody');
  if (!tx) return spXml;

  const paras = topChildren(spXml, tx.innerStart, tx.innerEnd).filter((c) => c.name === 'a:p');
  const textParas = paras.filter((p) => hasText(spXml.slice(p.start, p.end)));
  if (textParas.length === 0) return spXml; // nothing safe to map onto

  const n = textParas.length;
  const m = bullets.length;
  const lastPara = textParas[n - 1];
  const lastParaXml = spXml.slice(lastPara.start, lastPara.end);

  interface Op {
    start: number;
    end: number;
    text: string;
  }
  const ops: Op[] = [];

  for (let i = 0; i < n; i++) {
    const p = textParas[i];
    const pxml = spXml.slice(p.start, p.end);
    const value = i < m ? cleanText(bullets[i]) : '';
    ops.push({ start: p.start, end: p.end, text: setFragmentText(pxml, value) });
  }

  // Extra refined bullets → clone the last text paragraph (keeps bullet style).
  if (m > n) {
    const extra = bullets
      .slice(n)
      .map((b) => setFragmentText(lastParaXml, cleanText(b)))
      .join('');
    ops.push({ start: lastPara.end, end: lastPara.end, text: extra });
  }

  ops.sort((a, b) => b.start - a.start); // apply right-to-left so offsets stay valid
  let out = spXml;
  for (const op of ops) out = out.slice(0, op.start) + op.text + out.slice(op.end);
  return out;
}

/** Overflow bullets that must spill onto an appended continuation slide. */
export interface ContinuationSpec {
  bullets: string[];
  /** fontScale (0–1) to bake into the continuation body when it needs a shrink. */
  bodyFontScale?: number;
}

export interface PatchResult {
  xml: string;
  /** Set when body overflow was split off onto a continuation slide. */
  continuation?: ContinuationSpec;
  /** True when EITHER the title or body was dropped (kept original) because it
   *  didn't fit — i.e. titleReverted || bodyReverted. Kept for callers that only
   *  need to know "did anything get reverted", not which part. */
  reverted?: boolean;
  /** True when the refined TITLE specifically was dropped back to the original
   *  because it overflowed even at the readable font floor. Independent of
   *  bodyReverted — a slide can have its title reverted while its body still
   *  patched successfully, or vice versa. */
  titleReverted?: boolean;
  /** True when the refined BODY specifically was dropped back to the original
   *  (no continuation split was possible either). Independent of titleReverted. */
  bodyReverted?: boolean;
}

/**
 * Patch a single existing slide's title + body text. Never touches <p:pic>,
 * <p:graphicFrame>, <p:grpSp>, formatting or layout. Returns the original XML
 * unchanged on any uncertainty.
 *
 * When body text overflows even at the readable font floor AND new slides are
 * allowed (opts.allowNewSlides + opts.canvas supplied), the refined bullets are
 * split: the largest whole-bullet prefix that fits stays on this slide and the
 * remainder is returned as `continuation` for the caller to append as one
 * continuation slide (this does NOT flag bodyReverted — the refined content did
 * land, just across two slides). When new slides are NOT allowed (or a
 * continuation can't be made to fit), the original text is kept unchanged and
 * `bodyReverted` is flagged; the title is reverted/flagged independently via
 * `titleReverted` if the refined title alone overflows. Either part can revert
 * while the other patches successfully.
 */
export function patchSlideXml(
  originalXml: string,
  slide: RefinedSlide,
  opts: { allowNewSlides?: boolean; canvas?: SlideCanvas } = {}
): PatchResult {
  let continuation: ContinuationSpec | undefined;
  let titleReverted = false;
  let bodyReverted = false;
  try {
    const spTree = getInnerRange(originalXml, 'p:spTree');
    if (!spTree) return { xml: originalXml };

    const children = topChildren(originalXml, spTree.innerStart, spTree.innerEnd);
    const shapes = children
      .filter((c) => c.name === 'p:sp')
      .map((sp) => {
        const spXml = originalXml.slice(sp.start, sp.end);
        return {
          sp,
          spXml,
          ph: getPlaceholder(spXml),
          hasTx: /<p:txBody\b/.test(spXml),
          paraCount: (spXml.match(/<a:p\b/g) ?? []).length,
        };
      })
      .filter((s) => s.hasTx);

    if (shapes.length === 0) return { xml: originalXml };

    const isTitle = (ph: Placeholder | null) =>
      !!ph && (ph.type === 'title' || ph.type === 'ctrTitle' || ph.idx === '0');
    const isBody = (ph: Placeholder | null) =>
      !!ph && (ph.idx === '1' || ph.type === 'body' || ph.type === 'subTitle');

    const titleShape = shapes.find((s) => isTitle(s.ph)) ?? null;
    const bodyCandidates = shapes.filter((s) => s !== titleShape);
    const bodyShape =
      bodyCandidates.find((s) => isBody(s.ph)) ??
      bodyCandidates.slice().sort((a, b) => b.paraCount - a.paraCount)[0] ??
      null;

    // Build edits (right-to-left so spans stay valid).
    interface Edit {
      start: number;
      end: number;
      text: string;
    }
    const edits: Edit[] = [];

    const newTitle = cleanText(slide.refined_title ?? '');
    if (titleShape && newTitle) {
      // Bug 6: estimate whether the refined title fits the title box. If it
      // overflows we shrink via a computed normAutofit fontScale; if it can't
      // reasonably fit even shrunk, we keep the original title rather than bleed.
      const titleXf = getShapeXfrm(titleShape.spXml);
      const fit = assessTextFit(
        titleShape.spXml,
        [newTitle],
        titleXf?.cy ?? NaN,
        DEFAULT_TITLE_FONT_PT
      );
      if (fit.kind === 'overflow') {
        titleReverted = true;
        console.warn(
          `[ppt-refine/assembler] slide ${slide.index}: refined title too long for its box ` +
            `even at ${Math.round(MIN_AUTOFIT_SCALE * 100)}% font — keeping original title`
        );
      } else {
        // Bug 2: inject text even into originally-empty title placeholders.
        // Bug 1/6: ensure the title box auto-shrinks long titles to fit.
        let titleXml = patchTitleShape(titleShape.spXml, newTitle);
        titleXml = ensureNormAutofit(titleXml, fit.kind === 'shrink' ? fit.scale : undefined);
        edits.push({ start: titleShape.sp.start, end: titleShape.sp.end, text: titleXml });
      }
    }

    const newBody = (slide.refined_body ?? []).map((b) => b).filter((b) => typeof b === 'string');
    if (bodyShape && bodyShape !== titleShape && newBody.length > 0) {
      // Bug 4: if an image sits inside the body text box, shrink the body height
      // so the text stays above it instead of rendering behind it. Compute the
      // reduced height first — the fit estimate (Bug 6) must run against the box
      // the text will actually occupy, not the original full-height box.
      const bodyXf = getShapeXfrm(bodyShape.spXml);
      let shrunkCy = Number.NaN; // the Bug-4 reduced height, if any
      if (bodyXf && Number.isFinite(bodyXf.y) && Number.isFinite(bodyXf.cy)) {
        const bodyTop = bodyXf.y;
        const bodyBottom = bodyXf.y + bodyXf.cy;
        const pics = topChildren(originalXml, spTree.innerStart, spTree.innerEnd).filter(
          (c) => c.name === 'p:pic'
        );
        let minSafe = Infinity;
        for (const pic of pics) {
          const xf = getShapeXfrm(originalXml.slice(pic.start, pic.end));
          if (!xf || !Number.isFinite(xf.y)) continue;
          if (xf.y > bodyTop && xf.y < bodyBottom) {
            const safe = xf.y - bodyTop - 91440; // 0.1" margin
            if (safe > 0 && safe < minSafe) minSafe = safe;
          }
        }
        if (minSafe !== Infinity && minSafe < bodyXf.cy) shrunkCy = minSafe;
      }

      // Bug 6: estimate whether the refined bullets fit the (possibly image-
      // reduced) body height. Overflow → shrink via a computed normAutofit
      // fontScale; hopeless overflow → keep the original body text.
      const effectiveCy = Number.isFinite(shrunkCy) ? shrunkCy : bodyXf?.cy ?? NaN;
      const cxBody = bodyXf?.cx ?? NaN;
      let bodyFontPt = firstFontSizePt(bodyShape.spXml);
      if (!Number.isFinite(bodyFontPt) || bodyFontPt <= 0) bodyFontPt = DEFAULT_BODY_FONT_PT;

      const cleanedBody = newBody.map((b) => cleanText(b)).filter(Boolean);
      const fit = assessTextFit(bodyShape.spXml, cleanedBody, effectiveCy, DEFAULT_BODY_FONT_PT);

      // Emit the body edit for a given bullet list at a given fit result.
      const emitBody = (bullets: string[], bodyFit: FitResult) => {
        let bodyXml = patchBodyShape(bodyShape.spXml, bullets);
        if (Number.isFinite(shrunkCy)) bodyXml = setShapeCy(bodyXml, shrunkCy);
        // Bug 5/6: ensure the body box auto-shrinks text that overflows its
        // height (applied AFTER the Bug 4 cy adjustment).
        bodyXml = ensureNormAutofit(bodyXml, bodyFit.kind === 'shrink' ? bodyFit.scale : undefined);
        edits.push({ start: bodyShape.sp.start, end: bodyShape.sp.end, text: bodyXml });
      };

      if (fit.kind !== 'overflow') {
        emitBody(newBody, fit);
      } else {
        // Refined body can't fit even at the readable floor. If new slides are
        // allowed, spill the overflow onto ONE appended continuation slide;
        // otherwise keep the original body unchanged (pre-3d behaviour).
        let handled = false;
        if (
          opts.allowNewSlides &&
          opts.canvas &&
          cleanedBody.length >= 2 &&
          Number.isFinite(cxBody) &&
          Number.isFinite(effectiveCy)
        ) {
          // Greedy: largest whole-bullet prefix that still fits the (image-
          // reduced) original box at ≥ the readable floor. Prefix fit is
          // monotonic, so stop at the first prefix that overflows.
          let keep = 0;
          for (let i = 1; i <= cleanedBody.length; i++) {
            if (fitScaleForBox(cleanedBody.slice(0, i), cxBody, effectiveCy, bodyFontPt).kind !== 'overflow') {
              keep = i;
            } else break;
          }

          // keep === 0 → even one bullet overflows (a single huge bullet); a
          // continuation would be near-empty on the source, so fall through to
          // the safe original-text fallback instead.
          if (keep >= 1 && keep < cleanedBody.length) {
            const fitsBullets = cleanedBody.slice(0, keep);
            const overflowBullets = cleanedBody.slice(keep);

            // The overflow must fit ONE continuation slide at the readable floor.
            // Cap at a single continuation per source slide: if the remainder is
            // itself too big for a fresh full-body slide, do NOT chain a second —
            // fall back to keeping the original text.
            const cont = scaleBox(BODY_REF, ...canvasDims(opts.canvas));
            const contFit = fitScaleForBox(
              overflowBullets,
              cont.cx,
              cont.cy,
              DEFAULT_NEW_BODY_PT
            );
            if (contFit.kind !== 'overflow') {
              emitBody(fitsBullets, fitScaleForBox(fitsBullets, cxBody, effectiveCy, bodyFontPt));
              continuation = {
                bullets: overflowBullets,
                bodyFontScale: contFit.kind === 'shrink' ? contFit.scale : undefined,
              };
              handled = true;
              console.log(
                `[ppt-refine/assembler] slide ${slide.index}: split ${cleanedBody.length} bullets → ` +
                  `${fitsBullets.length} kept + ${overflowBullets.length} on a continuation slide`
              );
            }
          }
        }

        if (!handled) {
          bodyReverted = true;
          console.warn(
            `[ppt-refine/assembler] slide ${slide.index}: refined body too long for its box ` +
              `even at ${Math.round(MIN_AUTOFIT_SCALE * 100)}% font — keeping original body`
          );
        }
      }
    }

    if (edits.length === 0) {
      return { xml: originalXml, reverted: titleReverted || bodyReverted, titleReverted, bodyReverted };
    }

    edits.sort((a, b) => b.start - a.start);
    let out = originalXml;
    for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end);
    return { xml: out, continuation, reverted: titleReverted || bodyReverted, titleReverted, bodyReverted };
  } catch (err) {
    console.warn('[ppt-refine/assembler] patchSlideXml failed, keeping original:', err);
    return { xml: originalXml };
  }
}

/** SlideCanvas → the (widthEmu, heightEmu) tuple scaleBox expects, guarded. */
function canvasDims(canvas: SlideCanvas): [number, number] {
  const { widthEmu, heightEmu } = safeCanvas(canvas);
  return [widthEmu, heightEmu];
}

// ─── New-slide construction ─────────────────────────────────────────────────

/** Regular 16pt body bullet (top level). */
function regularBullet(text: string): string {
  return `<a:p><a:r><a:rPr lang="en-IN" sz="1600" dirty="0"/><a:t>${escT(text)}</a:t></a:r></a:p>`;
}

/** 14pt sub-bullet (level 1). */
function subBullet(text: string): string {
  return (
    `<a:p><a:pPr lvl="1"/><a:r><a:rPr lang="en-IN" sz="1400" dirty="0"/>` +
    `<a:t>${escT(text)}</a:t></a:r></a:p>`
  );
}

/**
 * Build the body paragraph XML for a new slide. Practice slides get special
 * label formatting (bold "Problem Statement:", italic muted "Hint:", 14pt
 * "Solution Approach:" and following lines). All other types render flat 16pt.
 */
function buildNewSlideBody(bullets: string[], type: string): string {
  if (bullets.length === 0) return `<a:p><a:endParaRPr lang="en-IN"/></a:p>`;

  if (type !== 'practice') {
    // Real-world / others: consistent 16pt bullets.
    return bullets.map(regularBullet).join('');
  }

  const out: string[] = [];
  let afterSolution = false;

  for (const b of bullets) {
    if (/^problem statement:/i.test(b)) {
      const content = b.replace(/^problem statement:\s*/i, '');
      out.push(
        `<a:p>` +
          `<a:r><a:rPr lang="en-IN" sz="1600" b="1" dirty="0"/><a:t>Problem Statement: </a:t></a:r>` +
          `<a:r><a:rPr lang="en-IN" sz="1600" dirty="0"/><a:t>${escT(content)}</a:t></a:r>` +
          `</a:p>`
      );
      afterSolution = false;
      continue;
    }
    if (/^hint:/i.test(b)) {
      out.push(
        `<a:p><a:pPr lvl="1"/><a:r>` +
          `<a:rPr lang="en-IN" sz="1400" i="1" dirty="0"><a:solidFill><a:srgbClr val="4B5563"/></a:solidFill></a:rPr>` +
          `<a:t>${escT(b)}</a:t></a:r></a:p>`
      );
      afterSolution = false;
      continue;
    }
    if (/^solution approach:/i.test(b)) {
      afterSolution = true;
      out.push(subBullet(b));
      continue;
    }
    out.push(afterSolution ? subBullet(b) : regularBullet(b));
  }

  return out.join('');
}

// ─── New-slide geometry scaling ─────────────────────────────────────────────
// The reference coordinates below were authored for a 10" × 5.625" (16:9)
// canvas. We scale them to whatever the uploaded deck's <p:sldSz> actually is,
// so new slides fill the same proportional area as the original slides rather
// than a small box in the corner of a larger canvas.

const REFERENCE_WIDTH_EMU = 9144000; // 10"
const REFERENCE_HEIGHT_EMU = 5143500; // 5.625"
const MIN_CANVAS_EMU = 914400; // 1" — anything smaller is malformed input

interface Geometry {
  x: number;
  y: number;
  cx: number;
  cy: number;
}

// Original hardcoded new-slide boxes (EMU) at the 10" × 5.625" reference size.
const TITLE_REF: Geometry = { x: 311700, y: 445025, cx: 8520575, cy: 572700 };
const BODY_REF: Geometry = { x: 311700, y: 1143000, cx: 8520575, cy: 3810600 };

/**
 * Scale one EMU value from the reference dimension to the actual canvas
 * dimension. Pure and independent per axis: x/cx use the width ratio, y/cy the
 * height ratio, so non-16:9 canvases (e.g. legacy 4:3) don't get distorted.
 */
function scaleGeometry(emu: number, referenceDim: number, actualDim: number): number {
  return Math.round((emu * actualDim) / referenceDim);
}

/** Scale a whole box, x-axis by width ratio and y-axis by height ratio. */
function scaleBox(box: Geometry, widthEmu: number, heightEmu: number): Geometry {
  return {
    x: scaleGeometry(box.x, REFERENCE_WIDTH_EMU, widthEmu),
    y: scaleGeometry(box.y, REFERENCE_HEIGHT_EMU, heightEmu),
    cx: scaleGeometry(box.cx, REFERENCE_WIDTH_EMU, widthEmu),
    cy: scaleGeometry(box.cy, REFERENCE_HEIGHT_EMU, heightEmu),
  };
}

/**
 * Resolve the canvas to scale against, guarding malformed input. A non-finite
 * or absurdly small dimension would produce a divide-by-zero-adjacent or
 * corrupt box, so we fail safe to the reference size (scale factor 1.0 — i.e.
 * the original pre-scaling hardcoded coordinates) and log a warning.
 */
function safeCanvas(canvas: SlideCanvas): SlideCanvas {
  const { widthEmu, heightEmu } = canvas;
  if (
    !Number.isFinite(widthEmu) ||
    !Number.isFinite(heightEmu) ||
    widthEmu < MIN_CANVAS_EMU ||
    heightEmu < MIN_CANVAS_EMU
  ) {
    console.warn(
      `[ppt-refine/assembler] Invalid canvas ${widthEmu}×${heightEmu} EMU — ` +
        `falling back to 10"×5.625" reference geometry`
    );
    return { widthEmu: REFERENCE_WIDTH_EMU, heightEmu: REFERENCE_HEIGHT_EMU };
  }
  return canvas;
}

export function buildNewSlideXml(
  slide: RefinedSlide,
  canvas: SlideCanvas,
  opts: { bodyFontScale?: number; isContinuation?: boolean } = {}
): string {
  let title = cleanText(slide.refined_title || slide.title || 'Slide');
  // A continuation slide's title already carries "(cont'd)" — don't also prefix
  // the "Practice:" / "Real World:" label a fresh AI-proposed slide would get.
  if (slide.is_new && !opts.isContinuation) {
    // One clean label, no emoji (emojis in titles break some PowerPoint builds).
    if (slide.type === 'practice') title = `Practice: ${title}`;
    else if (slide.type === 'example') title = `Real World: ${title}`;
  }

  // Bake a computed shrink into the body autofit (a bare <a:normAutofit/> renders
  // at 100% and would bleed — same reasoning as ensureNormAutofit for existing
  // slides). Only stamped when a shrink is actually needed.
  const bodyAutofit =
    opts.bodyFontScale !== undefined && opts.bodyFontScale < 1
      ? `<a:normAutofit fontScale="${Math.round(opts.bodyFontScale * 100000)}"/>`
      : `<a:normAutofit/>`;

  const source =
    slide.refined_body && slide.refined_body.length ? slide.refined_body : slide.body_text ?? [];
  const bullets = source.map((b) => cleanText(b)).filter(Boolean);

  const body = buildNewSlideBody(bullets, slide.type);

  // Scale the reference boxes to the ACTUAL uploaded canvas size (guarded).
  const { widthEmu, heightEmu } = safeCanvas(canvas);
  const t = scaleBox(TITLE_REF, widthEmu, heightEmu);
  const b = scaleBox(BODY_REF, widthEmu, heightEmu);

  // Explicit positioned shapes (NOT <p:ph> placeholders) so font sizes are
  // deterministic instead of inherited from the master. Positions/sizes are
  // scaled to the source deck's canvas; font sizes are intentionally NOT scaled.
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ` +
    `xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">` +
    `<p:cSld><p:spTree>` +
    `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
    `<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/>` +
    `<a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>` +
    // Title — explicit position, 24pt bold, autofit at 90%
    `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/>` +
    `<p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr/></p:nvSpPr>` +
    `<p:spPr><a:xfrm><a:off x="${t.x}" y="${t.y}"/><a:ext cx="${t.cx}" cy="${t.cy}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>` +
    `<p:txBody><a:bodyPr><a:normAutofit fontScale="90000"/></a:bodyPr><a:lstStyle/>` +
    `<a:p><a:r><a:rPr lang="en-IN" sz="2400" b="1" dirty="0"/><a:t>${escT(title)}</a:t></a:r></a:p>` +
    `</p:txBody></p:sp>` +
    // Body — explicit position, 16pt regular / 14pt sub-bullets, autofit
    `<p:sp><p:nvSpPr><p:cNvPr id="3" name="Body"/>` +
    `<p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr/></p:nvSpPr>` +
    `<p:spPr><a:xfrm><a:off x="${b.x}" y="${b.y}"/><a:ext cx="${b.cx}" cy="${b.cy}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>` +
    `<p:txBody><a:bodyPr>${bodyAutofit}</a:bodyPr><a:lstStyle/>${body}</p:txBody></p:sp>` +
    `</p:spTree></p:cSld>` +
    `<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`
  );
}

/**
 * Build a continuation slide (is_new) that carries the overflow bullets split off
 * an existing source slide by patchSlideXml. Inherits the source's type so
 * practice/example body formatting is preserved, but its title is the source
 * title suffixed with "(cont'd)" and it is flagged isContinuation so no
 * "Practice:" / "Real World:" prefix is added on top.
 */
function makeContinuationSlide(source: RefinedSlide, bullets: string[]): RefinedSlide {
  const baseTitle = cleanText(source.refined_title || source.title || 'Slide');
  const contTitle = `${baseTitle} (cont'd)`;
  return {
    ...source,
    index: -1, // positional; the assembler never maps continuation slides by index
    title: contTitle,
    refined_title: contTitle,
    body_text: bullets,
    refined_body: bullets,
    visual: undefined,
    is_new: true,
    is_thin: false,
    has_image: false,
    has_diagram: false,
    speaker_notes: '',
    word_count: bullets.join(' ').split(/\s+/).filter((w) => w).length,
    change_summary: `Continuation of "${baseTitle}" — overflow content moved here.`,
  };
}

function buildSlideRels(layoutTarget: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" ` +
    `Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" ` +
    `Target="${layoutTarget}"/></Relationships>`
  );
}

// ─── Presentation-part helpers ──────────────────────────────────────────────

function slideFileNum(name: string): number {
  return parseInt(name.match(/slide(\d+)\.xml/)?.[1] ?? '0', 10);
}

/** Map every presentation relationship Id → Target. */
function parseRels(relsXml: string): Map<string, string> {
  const map = new Map<string, string>();
  const els = relsXml.match(/<Relationship\b[^>]*\/>/g) ?? [];
  for (const el of els) {
    const id = /Id="([^"]+)"/.exec(el)?.[1];
    const target = /Target="([^"]+)"/.exec(el)?.[1];
    if (id && target) map.set(id, target);
  }
  return map;
}

function maxRelId(relsXml: string): number {
  let max = 0;
  for (const m of relsXml.matchAll(/Id="rId(\d+)"/g)) max = Math.max(max, parseInt(m[1], 10));
  return max;
}

function maxSldId(presXml: string): number {
  let max = 255; // sldId values must be >= 256
  for (const m of presXml.matchAll(/<p:sldId\b[^>]*\bid="(\d+)"/g))
    max = Math.max(max, parseInt(m[1], 10));
  return max;
}

function findDefaultLayoutTarget(zip: AdmZip): string {
  const layouts = zip
    .getEntries()
    .map((e) => e.entryName)
    .filter((n) => /^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(n))
    .sort((a, b) => slideFileNum(a) - slideFileNum(b));
  const first = layouts[0];
  if (first) return `../slideLayouts/${first.split('/').pop()}`;
  return '../slideLayouts/slideLayout1.xml';
}

/** Resolve the slideLayout target referenced by an existing slide file. */
function layoutForSlide(zip: AdmZip, slideFile: number, fallback: string): string {
  try {
    const relsName = `ppt/slides/_rels/slide${slideFile}.xml.rels`;
    if (!zip.getEntry(relsName)) return fallback;
    const xml = zip.readAsText(relsName);
    const els = xml.match(/<Relationship\b[^>]*\/>/g) ?? [];
    for (const el of els) {
      if (/slideLayout/.test(el)) {
        const target = /Target="([^"]+)"/.exec(el)?.[1];
        if (target) return target;
      }
    }
  } catch {
    /* fall through */
  }
  return fallback;
}

function insertSldId(
  presXml: string,
  anchorRid: string | null,
  id: number,
  rId: string
): string {
  const el = `<p:sldId id="${id}" r:id="${rId}"/>`;
  if (anchorRid) {
    const re = new RegExp(`(<p:sldId\\b[^>]*\\br:id="${escapeRe(anchorRid)}"[^>]*/>)`);
    if (re.test(presXml)) return presXml.replace(re, `$1${el}`);
  }
  return presXml.replace('</p:sldIdLst>', `${el}</p:sldIdLst>`);
}

// ─── Main export ────────────────────────────────────────────────────────────

const SLIDE_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.presentationml.slide+xml';
const SLIDE_REL_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide';

export async function assemblePptx(
  deck: RefinedDeck,
  originalBuffer: Buffer,
  options?: { allow_new_slides?: boolean }
): Promise<Buffer> {
  const allowNewSlides = options?.allow_new_slides ?? false;
  const zip = new AdmZip(originalBuffer);

  // Slide files in suffix-sorted order (the same order the extractor used). The
  // k-th ORIGINAL (non-new) slide in deck order maps to sortedSlideFiles[k] —
  // we index by deck-order position, NOT by slide.index, because slide.index was
  // renumbered deck-wide during assembly and no longer tracks the source file
  // once new slides are interleaved.
  const sortedSlideFiles = zip
    .getEntries()
    .map((e) => e.entryName)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => slideFileNum(a) - slideFileNum(b))
    .map((name) => ({ name, num: slideFileNum(name) }));

  // The ACTUAL canvas of the uploaded deck — the single source of truth for
  // scaling new-slide geometry (same parser + fallback as the extractor).
  const canvas = parseSlideSize(zip.readAsText('ppt/presentation.xml'));

  // ─── Patch existing slides in place; collect continuation overflow ────────
  // `augmented` is deck order with any continuation slide interleaved directly
  // after its source, so the append pass below anchors everything correctly.
  const augmented: RefinedSlide[] = [];
  const contScale = new Map<RefinedSlide, number | undefined>();
  let patched = 0;
  let origPos = 0;
  for (const s of deck.slides) {
    if (s.is_new) {
      augmented.push(s);
      continue;
    }
    augmented.push(s);
    const file = sortedSlideFiles[origPos++];
    if (!file) continue;
    // A slide the faculty member did not select for refinement is left exactly
    // as it was: we advance the source-file cursor (origPos already incremented,
    // keeping the position-based file mapping in sync) but never read or rewrite
    // its file, so it stays byte-identical to the original. It also never reaches
    // the fit-check, so it can never spawn a continuation slide.
    if (s.change_summary === NOT_SELECTED_SUMMARY) continue;
    try {
      const xml = zip.readAsText(file.name);
      const { xml: next, continuation, reverted, titleReverted, bodyReverted } = patchSlideXml(xml, s, {
        allowNewSlides,
        canvas,
      });
      if (next !== xml) {
        zip.updateFile(file.name, Buffer.from(next, 'utf-8'));
        patched++;
        // Partial revert: the file DID change (so this still counts as
        // "Enhanced"), but title or body specifically was dropped back to the
        // original. Both can't be true here — if they were, edits.length would
        // be 0 and next === xml, landing in the byte-identical branch below
        // instead. The AI's change_summary generically describes both parts
        // changing, which is now inaccurate for the part that reverted —
        // replace it with a specific, accurate note.
        if (titleReverted) {
          s.change_summary = PARTIAL_REVERT_TITLE_SUMMARY;
        } else if (bodyReverted) {
          s.change_summary = PARTIAL_REVERT_BODY_SUMMARY;
        }
      } else if (
        s.change_summary !== NO_CHANGE_SUMMARY &&
        s.change_summary !== BATCH_FAILURE_SUMMARY
      ) {
        // The slide is byte-identical to the original: either the AI made no real
        // change, or a refinement was reverted because it didn't fit. Reflect
        // that in the deck object (returned to the results view) so it is counted
        // as unchanged, not enhanced. If change_summary is already one of the
        // recognized fallback reasons (e.g. the batch-failure message), it's
        // already an accurate, specific explanation — don't overwrite it.
        s.change_summary = reverted ? REVERT_SUMMARY : NO_CHANGE_SUMMARY;
        s.refined_title = s.title;
        s.refined_body = s.body_text;
      }
      if (continuation && continuation.bullets.length > 0) {
        const cont = makeContinuationSlide(s, continuation.bullets);
        contScale.set(cont, continuation.bodyFontScale);
        augmented.push(cont);
      }
    } catch (err) {
      console.warn(`[ppt-refine/assembler] failed to patch ${file.name}:`, err);
    }
  }

  // ─── Append new + continuation slides ────────────────────────────────────
  let appended = 0;

  if (augmented.some((s) => s.is_new)) {
    let presXml = zip.readAsText('ppt/presentation.xml');
    let relsXml = zip.readAsText('ppt/_rels/presentation.xml.rels');
    const ctName = '[Content_Types].xml';
    let ctXml = zip.readAsText(ctName);

    const ridToTarget = parseRels(relsXml);
    const fileNumToRid = new Map<number, string>();
    for (const [rid, target] of ridToTarget) {
      const num = slideFileNum(target);
      if (num > 0 && /slide\d+\.xml/.test(target)) fileNumToRid.set(num, rid);
    }

    let maxFileNum = sortedSlideFiles.reduce((mx, f) => Math.max(mx, f.num), 0);
    let nextRel = maxRelId(relsXml);
    let nextSldId = maxSldId(presXml);
    const defaultLayout = findDefaultLayoutTarget(zip);

    const relAdds: string[] = [];
    const ctAdds: string[] = [];

    // Walk augmented order so each new/continuation slide is anchored after its
    // preceding slide. Non-new slides advance the source-file cursor.
    let anchorRid: string | null = null;
    let appendPos = 0;

    for (const s of augmented) {
      if (!s.is_new) {
        const f = sortedSlideFiles[appendPos++];
        if (f) anchorRid = fileNumToRid.get(f.num) ?? anchorRid;
        continue;
      }

      const fileNum = ++maxFileNum;
      const rId = `rId${++nextRel}`;
      const sldId = ++nextSldId;

      // Inherit the layout of the anchor slide (or a sensible default).
      let layoutTarget = defaultLayout;
      if (anchorRid) {
        const anchorTarget = ridToTarget.get(anchorRid);
        const anchorNum = anchorTarget ? slideFileNum(anchorTarget) : 0;
        if (anchorNum > 0) layoutTarget = layoutForSlide(zip, anchorNum, defaultLayout);
      }

      // Continuation slides carry a baked body fontScale and skip the practice/
      // example title relabel; AI-proposed slides use the default build.
      const isContinuation = contScale.has(s);
      const xmlBody = buildNewSlideXml(
        s,
        canvas,
        isContinuation ? { bodyFontScale: contScale.get(s), isContinuation: true } : {}
      );

      zip.addFile(`ppt/slides/slide${fileNum}.xml`, Buffer.from(xmlBody, 'utf-8'));
      zip.addFile(
        `ppt/slides/_rels/slide${fileNum}.xml.rels`,
        Buffer.from(buildSlideRels(layoutTarget), 'utf-8')
      );

      relAdds.push(
        `<Relationship Id="${rId}" Type="${SLIDE_REL_TYPE}" Target="slides/slide${fileNum}.xml"/>`
      );
      ctAdds.push(
        `<Override PartName="/ppt/slides/slide${fileNum}.xml" ContentType="${SLIDE_CONTENT_TYPE}"/>`
      );

      presXml = insertSldId(presXml, anchorRid, sldId, rId);
      anchorRid = rId; // chain subsequent new slides after this one
      appended++;
    }

    relsXml = relsXml.replace('</Relationships>', `${relAdds.join('')}</Relationships>`);
    ctXml = ctXml.replace('</Types>', `${ctAdds.join('')}</Types>`);

    zip.updateFile('ppt/presentation.xml', Buffer.from(presXml, 'utf-8'));
    zip.updateFile('ppt/_rels/presentation.xml.rels', Buffer.from(relsXml, 'utf-8'));
    zip.updateFile(ctName, Buffer.from(ctXml, 'utf-8'));
  }

  // Fold any continuation slides back into the deck (returned to the results
  // view) so stats/counters and the slide list reflect what's in the file.
  if (contScale.size > 0) {
    deck.slides = augmented.map((s, i) => ({ ...s, index: i }));
    deck.refined_slide_count = deck.slides.length;
  }

  console.log(
    `[ppt-refine/assembler] patched=${patched} appended=${appended} ` +
      `continuations=${contScale.size} total=${sortedSlideFiles.length + appended}`
  );

  return zip.toBuffer();
}
