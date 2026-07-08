import AdmZip from 'adm-zip';
import { XMLParser } from 'fast-xml-parser';
import { routeAI } from '@/lib/ai/router';
import { parseSlideSize } from './slide-size';
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

function getRunTexts(para: Record<string, unknown>): string[] {
  const texts: string[] = [];

  const runs = (para['a:r'] ?? []) as Array<Record<string, unknown>>;
  for (const run of runs) {
    const t = run['a:t'];
    if (typeof t === 'string' && t.trim()) texts.push(t);
    else if (typeof t === 'number') texts.push(String(t));
  }

  // a:t directly on the paragraph (rare but valid)
  const direct = para['a:t'];
  if (typeof direct === 'string' && direct.trim()) texts.push(direct);

  return texts;
}

function txBodyToLines(txBody: Record<string, unknown>): string[] {
  const lines: string[] = [];
  const paras = (txBody['a:p'] ?? []) as Array<Record<string, unknown>>;
  for (const para of paras) {
    const line = getRunTexts(para).join('').trim();
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

// ─── Slide type inference ─────────────────────────────────────────────────────

function inferSlideType(
  title: string,
  index: number,
  hasDiagram: boolean
): SlideType {
  if (index === 0) return 'title';
  const t = title.toLowerCase();
  if (/overview|agenda|outline|contents/.test(t)) return 'overview';
  if (/introduction|concept|fundamentals|theory|definition/.test(t))
    return 'concept';
  if (hasDiagram || /diagram|flow|architecture|structure/.test(t))
    return 'diagram';
  if (/example|case study|application|illustration/.test(t)) return 'example';
  if (/practice|exercise|problem|question/.test(t)) return 'practice';
  if (/summary|conclusion|recap|review/.test(t)) return 'summary';
  return 'unknown';
}

// ─── Slide XML parsing ────────────────────────────────────────────────────────

interface ParsedSlideData {
  title: string;
  bodyLines: string[];
  hasImage: boolean;
  hasDiagram: boolean;
}

function parseSlideXml(xml: string): ParsedSlideData {
  const parser = makeParser();
  const doc = parser.parse(xml) as Record<string, unknown>;

  const sld = doc['p:sld'] as Record<string, unknown> | undefined;
  if (!sld) return { title: '', bodyLines: [], hasImage: false, hasDiagram: false };

  const spTree = (
    (sld['p:cSld'] as Record<string, unknown>)?.['p:spTree'] ?? {}
  ) as Record<string, unknown>;

  const shapes = (spTree['p:sp'] ?? []) as Array<Record<string, unknown>>;

  let title = '';
  const bodyLines: string[] = [];

  for (const shape of shapes) {
    const nvPr = (
      (shape['p:nvSpPr'] as Record<string, unknown>)?.['p:nvPr'] ?? {}
    ) as Record<string, unknown>;
    const ph = nvPr['p:ph'] as Record<string, unknown> | undefined;

    const isTitle =
      ph?.['@_type'] === 'title' ||
      ph?.['@_idx'] === 0 ||
      ph?.['@_idx'] === '0';

    const txBody = shape['p:txBody'] as Record<string, unknown> | undefined;
    if (!txBody) continue;

    const lines = txBodyToLines(txBody);
    if (isTitle) {
      title = lines.join(' ').trim();
    } else {
      bodyLines.push(...lines);
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
  fileName: string
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
