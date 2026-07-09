import AdmZip from 'adm-zip';
import { XMLParser } from 'fast-xml-parser';
import { routeAI } from '@/lib/ai/router';
import { parseSlideSize } from './slide-size';
import type { AILogContext } from '@/lib/ai/providers/types';
import type { ExtractedDeck, ExtractedSlide, SlideType } from './types';

// ─── XML parser factory ───────────────────────────────────────────────────────

function makeParser() {
  return new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    parseAttributeValue: true,
    // Always treat these as arrays even when only one element is present
    isArray: (name: string) =>
      ['p:sp', 'p:grpSp', 'a:p', 'a:r'].includes(name),
  });
}

// ─── Text helpers ─────────────────────────────────────────────────────────────

// Symbol-font glyphs (Wingdings, Webdings, …) live in the Unicode Private Use
// Area. They render as decorative bullets/ornaments, carry no readable text,
// and — because they are not whitespace — survive `.trim()`. Strip them so a
// decorative shape does not contribute a stray empty/garbage bullet.
const PUA_RE = /[\uE000-\uF8FF]/g;

function cleanRunText(t: string): string {
  return t.replace(PUA_RE, '');
}

function getRunTexts(para: Record<string, unknown>): string[] {
  const texts: string[] = [];

  const runs = (para['a:r'] ?? []) as Array<Record<string, unknown>>;
  for (const run of runs) {
    const t = run['a:t'];
    if (typeof t === 'string') {
      const cleaned = cleanRunText(t);
      if (cleaned.trim()) texts.push(cleaned);
    } else if (typeof t === 'number') texts.push(String(t));
  }

  // a:t directly on the paragraph (rare but valid)
  const direct = para['a:t'];
  if (typeof direct === 'string') {
    const cleaned = cleanRunText(direct);
    if (cleaned.trim()) texts.push(cleaned);
  }

  return texts;
}

function txBodyToLines(txBody: Record<string, unknown>): string[] {
  const lines: string[] = [];
  const paras = (txBody['a:p'] ?? []) as Array<Record<string, unknown>>;
  for (const para of paras) {
    const line = getRunTexts(para).join('').trim();
    // Drop every empty / whitespace-only paragraph, not just leading ones. We
    // extract text for AI refinement (not layout), so an intentionally-blank
    // spacer paragraph carries no content worth preserving; keeping it would
    // only inject empty bullets that corrupt downstream titles/bodies.
    if (line) lines.push(line);
  }
  return lines;
}

function wordCount(parts: string[]): number {
  return parts
    .join(' ')
    .split(/\s+/)
    .filter((w) => w.length > 0).length;
}

function countWords(s: string): number {
  return s.split(/\s+/).filter((w) => w.length > 0).length;
}

// ─── Slide type inference ─────────────────────────────────────────────────────

/**
 * Is this title a deck-level wrap-up slide (the kind ppt-refine's
 * add_summary_slide option should skip generating a duplicate for)?
 *
 * "key takeaways" is included because this project's OWN PPT generator titles
 * its summary slide exactly "Key Takeaways" (see slide.addText("Key
 * Takeaways", …) in src/lib/ppt/generator.ts) — the plain "summary" keyword
 * alone misses every deck this product itself produces, which is the deck
 * type ppt-refine most commonly receives.
 *
 * Deliberately excludes bare "review": on its own it is the generic word for
 * a mid-lecture recap of ONE topic (e.g. "Review of Pass 1" in a two-pass
 * assembler lecture), not a reliable signal of a deck-ending summary the way
 * "summary" / "key takeaways" / "conclusion" / "recap" are.
 *
 * Also excludes any match qualified by a subtopic/section reference (a
 * trailing "of X", a part/pass/phase/unit/module/chapter/section/step
 * reference, or a digit) — "Recap of Loops", "Chapter 3 Summary", "Pass 1
 * Review" all describe a review of ONE section partway through the deck, not
 * a deck-level wrap-up slide, even though they contain a matching keyword.
 */
function isSummaryTitle(title: string): boolean {
  const t = title.toLowerCase().trim();
  if (!/\b(summary|conclusion|recap|key\s+takeaways?)\b/.test(t)) return false;
  if (/\b(of|for|in|part|pass|phase|unit|module|chapter|section|step)\b/.test(t)) return false;
  if (/\d/.test(t)) return false;
  return true;
}

function inferSlideType(
  title: string,
  index: number,
  hasDiagram: boolean
): SlideType {
  if (index === 0) return 'title';
  const t = title.toLowerCase();
  if (/overview|agenda|outline|contents/.test(t)) return 'overview';
  // Beyond explicit "concept"/"theory" words, cover the common ways real decks
  // title a definitional/explanatory slide without using those words — "Types
  // of X", "X format", "X syntax", "Components of X", "Classification of X",
  // "Characteristics/Features of X", etc. (e.g. "Assembly language statement
  // format", "Types of assembly language statements").
  if (
    /introduction|concept|fundamentals|theory|definition|basics|principles/.test(
      t
    ) ||
    /\btypes?\s+of\b|\bformat(s|ting)?\b|\bsyntax\b|\bclassification\b|\bcategories\b|\bcharacteristics\b|\bfeatures\s+of\b|\b(components?|elements?)\s+of\b/.test(
      t
    )
  )
    return 'concept';
  if (hasDiagram || /diagram|flow|architecture|structure/.test(t))
    return 'diagram';
  if (/example|case study|application|illustration/.test(t)) return 'example';
  if (/practice|exercise|problem|question/.test(t)) return 'practice';
  if (isSummaryTitle(title)) return 'summary';
  return 'unknown';
}

// ─── Slide XML parsing ────────────────────────────────────────────────────────

interface ParsedSlideData {
  title: string;
  bodyLines: string[];
  hasImage: boolean;
  hasDiagram: boolean;
}

/** A text-bearing shape reduced to what we need for title/body assignment. */
interface ShapeText {
  /** Marked as a title placeholder in the slide layout. */
  isTitle: boolean;
  /** Vertical offset (EMU) — used to pick the topmost heading when no placeholder exists. */
  yOff: number;
  /** Non-empty text lines (symbol glyphs stripped, blank paragraphs dropped). */
  lines: string[];
}

function shapeToText(shape: Record<string, unknown>): ShapeText {
  const nvPr = (
    (shape['p:nvSpPr'] as Record<string, unknown>)?.['p:nvPr'] ?? {}
  ) as Record<string, unknown>;
  const ph = nvPr['p:ph'] as Record<string, unknown> | undefined;

  const isTitle =
    ph?.['@_type'] === 'title' ||
    ph?.['@_idx'] === 0 ||
    ph?.['@_idx'] === '0';

  const xfrm = (shape['p:spPr'] as Record<string, unknown> | undefined)?.[
    'a:xfrm'
  ] as Record<string, unknown> | undefined;
  const yRaw = (xfrm?.['a:off'] as Record<string, unknown> | undefined)?.[
    '@_y'
  ];
  let yOff: number;
  if (typeof yRaw === 'number') yOff = yRaw;
  else if (typeof yRaw === 'string') yOff = parseInt(yRaw, 10);
  else yOff = Number.MAX_SAFE_INTEGER;
  if (Number.isNaN(yOff)) yOff = Number.MAX_SAFE_INTEGER;

  const txBody = shape['p:txBody'] as Record<string, unknown> | undefined;
  const lines = txBody ? txBodyToLines(txBody) : [];

  return { isTitle, yOff, lines };
}

/**
 * Collect every text-bearing shape, recursing into grouped shapes (p:grpSp)
 * to any depth. Shapes nested inside a group are otherwise invisible to a
 * flat spTree['p:sp'] scan, so their text (and any title placeholder they
 * carry) would be silently dropped.
 */
function collectShapeTexts(
  node: Record<string, unknown>,
  acc: ShapeText[]
): void {
  const sps = (node['p:sp'] ?? []) as Array<Record<string, unknown>>;
  for (const shape of sps) acc.push(shapeToText(shape));

  const groups = (node['p:grpSp'] ?? []) as Array<Record<string, unknown>>;
  for (const group of groups) collectShapeTexts(group, acc);
}

function parseSlideXml(xml: string): ParsedSlideData {
  const parser = makeParser();
  const doc = parser.parse(xml) as Record<string, unknown>;

  const sld = doc['p:sld'] as Record<string, unknown> | undefined;
  if (!sld) return { title: '', bodyLines: [], hasImage: false, hasDiagram: false };

  const spTree = (
    (sld['p:cSld'] as Record<string, unknown>)?.['p:spTree'] ?? {}
  ) as Record<string, unknown>;

  const allShapes: ShapeText[] = [];
  collectShapeTexts(spTree, allShapes);
  // Only shapes that actually carry readable text participate in title/body.
  const textShapes = allShapes.filter((s) => s.lines.length > 0);

  let title = '';
  const bodyLines: string[] = [];

  const titleShapes = textShapes.filter((s) => s.isTitle);

  if (titleShapes.length > 0) {
    // Normal case: the layout marks a title placeholder (possibly inside a group).
    title = titleShapes
      .map((s) => s.lines.join(' '))
      .join(' ')
      .trim();
    for (const s of textShapes) {
      if (!s.isTitle) bodyLines.push(...s.lines);
    }
  } else {
    // No title placeholder — the author used plain text boxes (as on the
    // ADA "Outline" slide). Derive a heading: a "heading" shape is one whose
    // first line is short (<= 6 words). Pick the topmost such shape; its first
    // line becomes the title and its remaining lines become body. Other single
    // short (<= 3 word) boxes are decorative labels (e.g. a rotated "Looping"
    // band) and are dropped; everything else is body, in document order.
    const headingCandidates = textShapes.filter(
      (s) => countWords(s.lines[0]) <= 6
    );
    const titleShape = headingCandidates.length
      ? headingCandidates.reduce((a, b) => (b.yOff < a.yOff ? b : a))
      : undefined;

    if (titleShape) title = titleShape.lines[0];

    for (const s of textShapes) {
      if (s === titleShape) {
        bodyLines.push(...s.lines.slice(1));
      } else if (s.lines.length === 1 && countWords(s.lines[0]) <= 3) {
        // decorative single-word/short label — skip
      } else {
        bodyLines.push(...s.lines);
      }
    }
  }

  // Image: <p:pic> presence
  const hasImage =
    Array.isArray(spTree['p:pic']) ||
    (spTree['p:pic'] != null && typeof spTree['p:pic'] === 'object');

  // Diagram: <p:graphicFrame> (charts, SmartArt, tables) or <p:grpSp> (grouped shapes)
  const grpSpArr = (spTree['p:grpSp'] ?? []) as unknown[];
  const hasDiagram =
    Array.isArray(spTree['p:graphicFrame']) ||
    (spTree['p:graphicFrame'] != null &&
      typeof spTree['p:graphicFrame'] === 'object') ||
    grpSpArr.length > 0;

  return { title, bodyLines, hasImage, hasDiagram };
}

// ─── Notes XML parsing ────────────────────────────────────────────────────────

function parseNotesXml(xml: string): string {
  const parser = makeParser();
  const doc = parser.parse(xml) as Record<string, unknown>;

  const notes = doc['p:notes'] as Record<string, unknown> | undefined;
  if (!notes) return '';

  const spTree = (
    (notes['p:cSld'] as Record<string, unknown>)?.['p:spTree'] ?? {}
  ) as Record<string, unknown>;

  const shapes = (spTree['p:sp'] ?? []) as Array<Record<string, unknown>>;
  const lines: string[] = [];

  for (const shape of shapes) {
    const nvPr = (
      (shape['p:nvSpPr'] as Record<string, unknown>)?.['p:nvPr'] ?? {}
    ) as Record<string, unknown>;
    const ph = nvPr['p:ph'] as Record<string, unknown> | undefined;

    // Skip the slide-image placeholder
    if (ph?.['@_type'] === 'sldImg') continue;

    const txBody = shape['p:txBody'] as Record<string, unknown> | undefined;
    if (!txBody) continue;

    lines.push(...txBodyToLines(txBody));
  }

  return lines.join('\n');
}

// ─── Notes lookup via relationship files ──────────────────────────────────────

function buildNotesMap(zip: AdmZip): Map<number, string> {
  const map = new Map<number, string>();

  // index all notes slide XMLs by path
  const notesByPath = new Map<string, string>();
  for (const entry of zip.getEntries()) {
    if (/^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(entry.entryName)) {
      notesByPath.set(
        entry.entryName,
        entry.getData().toString('utf-8')
      );
    }
  }

  // read slide relationship files to map slideN → notesSlideN
  for (const entry of zip.getEntries()) {
    const relMatch = entry.entryName.match(
      /^ppt\/slides\/_rels\/slide(\d+)\.xml\.rels$/
    );
    if (!relMatch) continue;

    const slideNum = parseInt(relMatch[1], 10);
    const content = entry.getData().toString('utf-8');

    const targetMatch = content.match(
      /Target="\.\.\/notesSlides\/(notesSlide\d+\.xml)"/
    );
    if (!targetMatch) continue;

    const notesPath = `ppt/notesSlides/${targetMatch[1]}`;
    const notesXml = notesByPath.get(notesPath);
    if (notesXml) map.set(slideNum, notesXml);
  }

  return map;
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function extractDeckFromBuffer(
  buffer: Buffer,
  fileName: string,
  logContext: AILogContext
): Promise<ExtractedDeck> {
  const zip = new AdmZip(buffer);

  // Collect and sort slide entries by numeric suffix
  const slideEntries = zip
    .getEntries()
    .filter((e) => /^ppt\/slides\/slide\d+\.xml$/.test(e.entryName))
    .sort((a, b) => {
      const n = (p: string) =>
        parseInt(p.match(/slide(\d+)\.xml/)?.[1] ?? '0', 10);
      return n(a.entryName) - n(b.entryName);
    });

  const notesMap = buildNotesMap(zip);

  // Original slide dimensions (EMU) from ppt/presentation.xml <p:sldSz>.
  // Parsed via the shared helper so the assembler's fallback can never drift.
  const presEntry = zip.getEntry('ppt/presentation.xml');
  const { widthEmu, heightEmu } = presEntry
    ? parseSlideSize(presEntry.getData().toString('utf-8'))
    : parseSlideSize('');

  const slides: ExtractedSlide[] = [];

  for (let i = 0; i < slideEntries.length; i++) {
    const entry = slideEntries[i];
    const slideNum = parseInt(
      entry.entryName.match(/slide(\d+)\.xml/)?.[1] ?? '1',
      10
    );

    const xml = entry.getData().toString('utf-8');
    const { title, bodyLines, hasImage, hasDiagram } = parseSlideXml(xml);

    const notesXml = notesMap.get(slideNum);
    const speakerNotes = notesXml ? parseNotesXml(notesXml) : '';

    const wc = wordCount([title, ...bodyLines]);

    slides.push({
      index: i,
      title: title || `Slide ${i + 1}`,
      type: inferSlideType(title, i, hasDiagram),
      body_text: bodyLines,
      has_image: hasImage,
      has_diagram: hasDiagram,
      speaker_notes: speakerNotes,
      word_count: wc,
      is_thin: wc < 40,
    });
  }

  const fullTextContext = slides
    .map(
      (s) => `[Slide ${s.index + 1}: ${s.title}]\n${s.body_text.join('\n')}`
    )
    .join('\n\n');

  // One Gemini Flash call — detect topic + academic level from sample titles
  let detectedTopic = fileName.replace(/\.pptx$/i, '').replace(/[_-]/g, ' ');
  let detectedLevel: 'basic' | 'intermediate' | 'advanced' = 'intermediate';

  try {
    const sample = slides
      .slice(0, 15)
      .map((s) => `"${s.title}": ${s.body_text[0] ?? ''}`)
      .join('\n');

    const ai = await routeAI('ppt_extract', {
      messages: [
        {
          role: 'user',
          content:
            `Given these slide titles and first lines from a presentation:\n${sample}\n\n` +
            `Output JSON only (no markdown fences): ` +
            `{"detected_topic": "<topic>", "detected_level": "basic"|"intermediate"|"advanced"}`,
        },
      ],
      maxTokens: 256,
      logContext: {
        ...logContext,
        metadata: {
          ...(logContext.metadata ?? {}),
          fileName,
        },
      },
    });

    const text = String(ai.content ?? '');
    const jsonMatch = text.match(/\{[\s\S]*?\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as {
        detected_topic?: string;
        detected_level?: string;
      };
      if (parsed.detected_topic) detectedTopic = parsed.detected_topic;
      if (
        parsed.detected_level === 'basic' ||
        parsed.detected_level === 'intermediate' ||
        parsed.detected_level === 'advanced'
      ) {
        detectedLevel = parsed.detected_level;
      }
    }
  } catch (err) {
    console.warn(
      '[ppt-refine/extractor] AI topic detection failed, using filename fallback:',
      err
    );
  }

  return {
    file_name: fileName,
    slide_count: slides.length,
    slides,
    full_text_context: fullTextContext,
    detected_topic: detectedTopic,
    detected_level: detectedLevel,
    original_width_emu: widthEmu,
    original_height_emu: heightEmu,
  };
}
