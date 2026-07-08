import { routeAI } from '@/lib/ai/router';
import { generateImagenImage, buildImagenPrompt } from '@/lib/ai/imagen';
import { hasLatex, findUnsupportedNotation } from '@/lib/text/latexSegments';
import { NO_CHANGE_SUMMARY, BATCH_FAILURE_SUMMARY, NOT_SELECTED_SUMMARY } from './types';
import type {
  ExtractedDeck,
  ExtractedSlide,
  RefinementOptions,
  RefinedDeck,
  RefinedSlide,
  SlideVisual,
  SlideType,
} from './types';

// ─── Public types ─────────────────────────────────────────────────────────────

export interface SubjectContext {
  subject_name: string;
  modules: { name: string; description: string }[];
  course_outcomes: { co_code: string; description: string }[];
}

// ─── Internal response types ──────────────────────────────────────────────────

interface BatchSlideResult {
  index: number;
  type?: string;
  refined_title: string;
  refined_body: string[];
  visual: SlideVisual | null;
  is_new: boolean;
  inserted_after_index: number | null;
  change_summary: string;
}

interface BatchResponse {
  slides: BatchSlideResult[];
  needs_summary: boolean;
  batch_changes: string[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT =
  `You are an expert academic content enhancer for Indian engineering universities. ` +
  `You improve existing lecture slides while strictly preserving the faculty's ` +
  `teaching intent, structure and voice. You never remove correct content — ` +
  `you only add, clarify and enhance. ` +
  `Output must be production-ready for immediate classroom use.`;

const BATCH_SIZE = 5;
const MIN_IMAGEN_B64_LEN = 5120; // 5 KB guard — shorter responses are API errors

// ─── Length caps ──────────────────────────────────────────────────────────────
//
// Slide bullets must read as scannable phrases, not paragraphs. Two enforcement
// layers back each other up:
//   1. The responseSchema below constrains the model at generation time.
//   2. A deterministic, LaTeX-aware trim pass (trimBatchResponse) is the hard
//      safety net for the cases where the model overshoots anyway.
//
// A plain bullet caps at MAX_BULLET_CHARS. A "KEY INSIGHT:"-prefixed bullet
// renders as a distinct callout, so it earns the more generous MAX_INSIGHT_CHARS.
const MAX_BULLET_CHARS = 100; // normal scannable bullet
const MAX_INSIGHT_CHARS = 140; // "KEY INSIGHT:" callout bullet
const MAX_TITLE_CHARS = 70; // slide title
const MAX_BULLETS = 8; // bullets per slide (headroom above the ~6 target for expand passes)

/** True for a bullet that renders as the KEY INSIGHT callout (case-insensitive). */
function isKeyInsight(bullet: string): boolean {
  return /^\s*KEY INSIGHT\s*:/i.test(bullet);
}

// The schema's per-bullet maxLength is a SINGLE uniform value, but bullets have
// two caps (normal vs. KEY INSIGHT). It is therefore set to the loosest of the
// two (MAX_INSIGHT_CHARS) so the schema never clips a legitimate KEY INSIGHT
// bullet; the trim pass applies the precise per-type cap afterwards.
const BATCH_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    slides: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          index: { type: 'integer' },
          type: { type: 'string' },
          refined_title: { type: 'string', maxLength: MAX_TITLE_CHARS },
          refined_body: {
            type: 'array',
            maxItems: MAX_BULLETS,
            items: { type: 'string', maxLength: MAX_INSIGHT_CHARS },
          },
          visual: {
            type: 'object',
            nullable: true,
            properties: {
              type: { type: 'string' },
              // Mirrors DIAGRAM_BATCH_SCHEMA's svgCode bound (ppt/batch/route.ts):
              // a real, labelled SVG/mermaid diagram runs ~2-6k chars, so 12000 is
              // generous headroom while still capping runaway generation.
              content: { type: 'string', maxLength: 12000 },
              caption: { type: 'string' },
            },
          },
          is_new: { type: 'boolean' },
          inserted_after_index: { type: 'integer', nullable: true },
          change_summary: { type: 'string' },
        },
        required: ['index', 'refined_title', 'refined_body', 'is_new', 'change_summary'],
      },
    },
    needs_summary: { type: 'boolean' },
    batch_changes: { type: 'array', items: { type: 'string' } },
  },
  required: ['slides', 'needs_summary', 'batch_changes'],
};

// ─── Pseudocode / algorithm-notation detection ────────────────────────────────

/**
 * Heuristic detector for a pseudocode/algorithm-notation bullet (e.g. a line
 * from a "function C(n, k): if k=0 return 1 …" box extracted as plain text).
 * This is a judgment call, not a precise rule — extracted body_text carries no
 * markup telling us a line came from a monospace/code box, so we score on
 * surface features instead:
 *  - control-flow keyword (if/else/while/for/return/function/…) — weak, 1pt,
 *    capped regardless of how many distinct keywords appear
 *  - a call-like pattern: identifier immediately followed by "(args)" where
 *    args look code-like (no bare spaces) rather than prose-in-parens like
 *    "O(n log n)" — weak, 1pt
 *  - assignment/comparison operators (:=, ==, <=, <-, etc.) — strong, 2pts
 *  - brace/semicolon punctuation — strong, 2pts
 *  - leading indentation (a code block's line-level indent surviving
 *    extraction) — strong, 2pts
 * Threshold is a score of 2: either one strong signal alone, or both weak
 * signals together. A single weak signal alone (e.g. just the word "for" in
 * an ordinary sentence) is never enough.
 *
 * Tradeoffs: a prose bullet dense with keywords/parens ("if x = 0, call
 * setup()") could false-positive and get skipped from readability rewriting —
 * rare, and the cost is just "one bullet doesn't get polished," not a
 * correctness problem. A pseudocode line written in full English ("If n
 * equals zero, return one") can false-negative and get rewritten — the
 * fallback there is that our post-processing restore step (see
 * `restorePseudocodeLines`) only substitutes lines this same heuristic
 * flags, so a false negative here just means it's treated as prose
 * end-to-end, not that it's corrupted somewhere in between.
 */
function isPseudocodeLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;

  // Weak signal: at least one control-flow keyword. Capped at a single point
  // no matter how many distinct keywords appear — two common English words
  // like "for" and "return" showing up in one ordinary sentence ("Return to
  // the diagram above for context") must not be enough on its own.
  const hasKeyword = /\b(if|else|elseif|while|for|return|function|procedure|repeat|until|then|end|break|continue)\b/i.test(
    trimmed
  );

  // Weak signal: identifier immediately followed by "(args)" — but only when
  // the args themselves look code-like (bare identifiers/numbers, comma-
  // separated, no internal spaces). This excludes prose-in-parens like
  // "O(n log n)" or "(see above)", which have space-separated words inside.
  const callMatch = trimmed.match(/[A-Za-z_]\w*\s*\(([^()]*)\)/);
  const hasCallPattern = !!callMatch && !/\s/.test(callMatch[1].replace(/,\s*/g, ','));

  // Strong signals: each is rare in ordinary prose bullets, so any one of
  // them combined with a weak signal (or two of them alone) is decisive.
  const hasOperator = /(:=|==|!=|<=|>=|<-|\+\+|--|=(?!=))/.test(trimmed);
  const hasBlockSyntax = /[{};]/.test(trimmed);
  const looksIndented = /^(\s{2,}|\t)/.test(line);

  let score = 0;
  if (hasKeyword) score += 1;
  if (hasCallPattern) score += 1;
  if (hasOperator) score += 2;
  if (hasBlockSyntax) score += 2;
  if (looksIndented) score += 2;

  return score >= 2;
}

/**
 * Deterministic backstop for pseudocode preservation — run on every parsed
 * batch response regardless of whether the model honored the "[CODE]" prompt
 * instruction. We don't trust the model to leave code byte-identical, so we
 * reconstruct it ourselves: strip anything in the model's refined_body that
 * still looks like code (a mangled rewrite, or an untouched line we're about
 * to replace anyway) and reassemble as [model's prose bullets] + [original
 * code lines, unchanged, in their original relative order]. This doesn't
 * preserve the exact original interleaving of code and prose (a slide that
 * mixes both gets its prose bullets pulled together, ahead of the code
 * block), but it guarantees the two invariants that matter: code lines are
 * byte-identical to the source, and prose still gets refined.
 */
function restorePseudocodeLines(originalBody: string[], refinedBody: string[]): string[] {
  const codeLines = originalBody.filter(isPseudocodeLine);
  if (codeLines.length === 0) return refinedBody;

  // Already untouched (model left it alone, or this is the fallback path) —
  // keep the original ordering rather than reshuffling into prose-then-code.
  if (
    refinedBody.length === originalBody.length &&
    refinedBody.every((b, i) => b === originalBody[i])
  ) {
    return refinedBody;
  }

  const proseBullets = refinedBody.filter((b) => !isPseudocodeLine(b));
  return [...proseBullets, ...codeLines];
}

// ─── Prompt builder ───────────────────────────────────────────────────────────

function buildBatchPrompt(
  batch: ExtractedSlide[],
  options: RefinementOptions,
  deck: ExtractedDeck,
  ctx: SubjectContext | undefined,
  isFirstBatch: boolean,
  isLastBatch: boolean
): string {
  const lines: string[] = [];

  // ── CONTEXT ──
  lines.push('CONTEXT:');
  lines.push(`- Topic: ${deck.detected_topic}`);
  lines.push(`- Level: ${deck.detected_level}`);
  if (ctx?.subject_name) lines.push(`- Subject: ${ctx.subject_name}`);
  if (ctx?.modules?.length) {
    lines.push(`- Modules: ${ctx.modules.map((m) => m.name).join(', ')}`);
  }
  if (isFirstBatch && ctx?.course_outcomes?.length) {
    const cos = ctx.course_outcomes
      .slice(0, 3)
      .map((c) => `${c.co_code}: ${c.description}`)
      .join('; ');
    lines.push(`- Course outcomes: ${cos}`);
  }
  lines.push('');

  // ── DECK OVERVIEW (truncated — topic awareness without bloat) ──
  lines.push('DECK OVERVIEW (first 800 chars for context):');
  lines.push(deck.full_text_context.slice(0, 800));
  lines.push('');

  // ── SLIDES TO REFINE ──
  lines.push(`SLIDES TO REFINE (${batch.length} slides):`);
  for (const s of batch) {
    const flags = [
      s.is_thin ? 'thin: YES - EXPAND' : 'thin: no',
      s.has_image ? 'has_image' : '',
      s.has_diagram ? 'has_diagram' : '',
    ]
      .filter(Boolean)
      .join(' | ');
    lines.push(`[Slide ${s.index}: "${s.title}" | type: ${s.type} | ${flags}]`);
    const taggedBody = s.body_text.map((line) =>
      isPseudocodeLine(line) ? `[CODE — DO NOT MODIFY] ${line}` : line
    );
    lines.push(`Content: ${taggedBody.join(' | ') || '(no text content)'}`);
    lines.push('');
  }

  // ── ACTIVE REFINEMENT INSTRUCTIONS ──
  const activeOpts: string[] = [];

  if (options.improve_readability) {
    activeOpts.push(
      `IMPROVE READABILITY: Improve the clarity of existing content. Rules:\n` +
        `   - Fix grammatical errors and awkward phrasing\n` +
        `   - Break run-on sentences into cleaner, scannable bullets\n` +
        `   - Make passive voice active where natural\n` +
        `   - Standardize bullet formatting (parallel structure)\n` +
        `   - Bullets are scannable phrases, NOT full sentences — aim for\n` +
        `     6-14 words each so each bullet fits on one line of a slide\n` +
        `   - Preserve every DISTINCT concept, definition, and example, but\n` +
        `     NOT the original phrasing or length — condensing wording while\n` +
        `     keeping the concept is exactly the goal. Split a bullet that\n` +
        `     packs several concepts into one bullet per concept.\n` +
        `   - If a bullet is already a clear, short phrase, return it unchanged\n` +
        `   - EXCEPTION for type: overview slides (Outline/Agenda/Contents): these\n` +
        `     bullets are topic labels, not prose to expand. Only fix genuine\n` +
        `     grammar/spelling mistakes — never turn a label into a\n` +
        `     "label: explanation" sentence, never add explanatory clauses, and\n` +
        `     never pad a short topic name out to 6-14 words. If a bullet is\n` +
        `     already a full sentence, leave it that length — don't artificially\n` +
        `     shorten it either.`
    );
  }
  if (options.expand_thin_sections) {
    activeOpts.push(
      `EXPAND THIN SECTIONS (ONLY slides marked "thin: YES"): ` +
        `Add 3-4 substantive additional points. ` +
        (options.allow_new_slides
          ? `A new slide is permitted — return it with is_new=true and inserted_after_index=<parent index>.`
          : `Expand content within the existing slide only (new slides not permitted).`)
    );
  }
  if (options.add_real_world_examples) {
    activeOpts.push(
      `ADD REAL-WORLD EXAMPLES: Add 1-2 Indian industry/real-world examples. ` +
        `Reference companies like ISRO, Tata, Infosys, L&T, Wipro, DRDO, Reliance where appropriate. ` +
        `Add as dedicated example bullets or a new example slide (is_new=true). ` +
        `For a new example slide, set refined_title to JUST the topic name ` +
        `(e.g. "Sorting in Logistics") — do NOT prefix it with "Real World:" or similar; ` +
        `the label is added automatically.`
    );
  }
  if (options.add_visuals) {
    activeOpts.push(
      `ADD VISUALS (only for concept/diagram/overview slides WITHOUT existing images/diagrams): ` +
        `Choose visual type:\n` +
        `  - "mermaid" → flowcharts, sequences, state machines, ER diagrams\n` +
        `  - "svg"     → comparison diagrams, labeled structures, process flows (700x400, inline only)\n` +
        `  - "imagen"  → real-world illustrations, system diagrams (write a detailed text prompt)\n` +
        `Return visual object; set null for slides that already have visuals or are title/practice/summary type.`
    );
  }
  if (options.add_practice_problems) {
    activeOpts.push(
      `ADD PRACTICE PROBLEMS (after concept or example slides only): ` +
        `Create 1 practice slide with: problem statement, hint, and solution approach. ` +
        `Return as is_new=true, type="practice", inserted_after_index=<parent index>. ` +
        `Set refined_title to JUST the topic name (e.g. "Identifying System Software") — ` +
        `do NOT prefix it with "Practice Problem:" or "Practice:"; the label is added automatically.`
    );
  }
  if (options.simplify_content) {
    const lvl = options.target_semester
      ? `Semester ${options.target_semester}`
      : 'early-semester';
    activeOpts.push(
      `SIMPLIFY CONTENT: Rewrite for ${lvl} students. ` +
        `Replace technical jargon with simpler terms and brief inline definitions. ` +
        `Preserve all key concepts — only simplify the language.`
    );
  }
  if (options.add_key_insights) {
    activeOpts.push(
      `ADD KEY INSIGHTS (concept slides only): ` +
        `Append 1 key insight as the last bullet: "KEY INSIGHT: [single most important exam takeaway]"`
    );
  }
  if (options.add_summary_slide && isLastBatch) {
    activeOpts.push(
      `SUMMARY SLIDE: If the last slide in this batch is type="summary", ` +
        `enhance it with all key topics covered. ` +
        `If no summary slide exists, set needs_summary=true in your response.`
    );
  }

  if (activeOpts.length === 0) {
    activeOpts.push(
      `GENERAL QUALITY PASS: Lightly improve clarity and flow without changing meaning.`
    );
  }

  lines.push('ACTIVE REFINEMENT INSTRUCTIONS:');
  activeOpts.forEach((o, i) => lines.push(`${i + 1}. ${o}`));
  lines.push('');

  lines.push('CRITICAL RULES:');
  lines.push(
    '- Any content line above prefixed "[CODE — DO NOT MODIFY]" is pseudocode or ' +
      'algorithm notation. Copy it into refined_body byte-for-byte exactly as given ' +
      '(minus the prefix) — never reword, reformat, reflow, or "improve" it. This ' +
      'applies regardless of which options are active above.'
  );
  lines.push('- NEVER remove existing correct content');
  lines.push('- NEVER change the fundamental meaning of any slide');
  lines.push('- NEVER invent facts not supported by slide content or subject context');
  lines.push(
    '- If a slide is already excellent: set refined_title=original, refined_body=original, change_summary="No changes needed."'
  );
  lines.push(
    '- Preserve every distinct concept from body_text, but keep each bullet a ' +
      'short scannable phrase. Dropping a CONCEPT is forbidden; trimming ' +
      'wordiness is required. Never merge two distinct concepts into one bullet.'
  );
  lines.push('');

  lines.push('OUTPUT: Return ONLY a valid JSON object — no markdown fences, no prose.');
  lines.push('Schema:');
  lines.push(`{
  "slides": [
    {
      "index": <number — same index as input, OR -1 for new slides>,
      "type": "<SlideType — only required for is_new slides>",
      "refined_title": "<string, <=${MAX_TITLE_CHARS} chars>",
      "refined_body": ["<scannable phrase, <=${MAX_BULLET_CHARS} chars; a KEY INSIGHT bullet may reach ${MAX_INSIGHT_CHARS}>", ...max ${MAX_BULLETS}],
      "visual": { "type": "svg"|"mermaid"|"imagen", "content": "<svg markup|mermaid code|imagen prompt>", "caption": "<string>" } | null,
      "is_new": <boolean>,
      "inserted_after_index": <number — index of parent slide, only when is_new=true> | null,
      "change_summary": "<one sentence describing what changed>"
    }
  ],
  "needs_summary": <boolean — true only in last batch if no summary slide exists>,
  "batch_changes": ["<top-level change description>", ...]
}`);

  return lines.join('\n');
}

// ─── JSON parsing ─────────────────────────────────────────────────────────────

/** Strip any HTML tags the model emits so they never render as literal text. */
function stripHtml(text: string): string {
  return text
    .replace(/<b>(.*?)<\/b>/gi, '$1') // bold → plain
    .replace(/<i>(.*?)<\/i>/gi, '$1') // italic → plain
    .replace(/<strong>(.*?)<\/strong>/gi, '$1')
    .replace(/<em>(.*?)<\/em>/gi, '$1')
    .replace(/<[^>]+>/g, '') // any other tags
    .trim();
}

/** Sanitize every refined_title / refined_body string in a parsed batch. */
function sanitizeBatchResponse(obj: BatchResponse): BatchResponse {
  for (const s of obj.slides) {
    if (typeof s.refined_title === 'string') s.refined_title = stripHtml(s.refined_title);
    if (Array.isArray(s.refined_body)) {
      s.refined_body = s.refined_body.map((b) => (typeof b === 'string' ? stripHtml(b) : b));
    }
  }
  return obj;
}

// ─── Deterministic length trim (LaTeX/mhchem-aware safety net) ────────────────

/**
 * Would cutting `candidate` off here land INSIDE a math/chemistry span — i.e.
 * did the truncation open a `$…$` / `$$…$$` / `\ce{…}` it never closed? We reuse
 * the shared segmenter (via findUnsupportedNotation) so this shares ONE
 * definition of a broken span with the rest of the app. A `\begin{…}` environment
 * warning is ignored: it flags the whole (uncut) text, not damage from our cut.
 */
function cutBreaksMathSpan(candidate: string): boolean {
  const reason = findUnsupportedNotation(candidate);
  return (
    reason === 'unclosed $ math delimiter' ||
    reason === 'unterminated \\ce{…} span'
  );
}

/**
 * Truncate `text` to at most `cap` characters at the nearest whitespace boundary,
 * never cutting mid-word (safe for Hinglish/mixed-language) and never inside a
 * math/chemistry span. Returns the original text unchanged when it already fits,
 * or when no safe cut point exists (e.g. a single math span longer than the cap —
 * left intact and logged by the caller).
 */
function trimToCap(text: string, cap: number): { text: string; truncated: boolean } {
  if (text.length <= cap) return { text, truncated: false };

  const latex = hasLatex(text);

  // Scan whitespace boundaries at/under the cap, largest first.
  const upper = Math.min(cap, text.length - 1);
  for (let i = upper; i > 0; i--) {
    if (!/\s/.test(text[i])) continue;
    const candidate = text.slice(0, i).replace(/\s+$/, '');
    if (!candidate) continue;
    // Only pay the segmenter cost when the text actually contains math.
    if (latex && cutBreaksMathSpan(candidate)) continue;
    return { text: candidate, truncated: true };
  }

  // No safe boundary ≤ cap (one long word or an oversized math span) — leave it.
  return { text, truncated: false };
}

/**
 * Enforce the per-bullet / per-title length caps on a parsed batch as a
 * deterministic backstop to the responseSchema. Mutates and returns `obj`.
 */
function trimBatchResponse(obj: BatchResponse): BatchResponse {
  for (const s of obj.slides) {
    if (typeof s.refined_title === 'string') {
      const t = trimToCap(s.refined_title, MAX_TITLE_CHARS);
      if (t.truncated) {
        console.warn(
          `[ppt-refine/refiner] Trimmed over-long title on slide ${s.index}: "${s.refined_title}"`
        );
        s.refined_title = t.text;
      } else if (s.refined_title.length > MAX_TITLE_CHARS) {
        console.warn(
          `[ppt-refine/refiner] Title on slide ${s.index} exceeds ${MAX_TITLE_CHARS} chars but has no safe cut point — left intact.`
        );
      }
    }

    if (Array.isArray(s.refined_body)) {
      s.refined_body = s.refined_body.map((b) => {
        if (typeof b !== 'string') return b;
        // A pseudocode/algorithm line must stay byte-identical (same invariant
        // isPseudocodeLine protects in the prompt) — never truncate it.
        if (isPseudocodeLine(b)) return b;
        const cap = isKeyInsight(b) ? MAX_INSIGHT_CHARS : MAX_BULLET_CHARS;
        const r = trimToCap(b, cap);
        if (r.truncated) {
          console.warn(
            `[ppt-refine/refiner] Trimmed over-long bullet on slide ${s.index}: "${b}"`
          );
          return r.text;
        }
        if (b.length > cap) {
          console.warn(
            `[ppt-refine/refiner] Bullet on slide ${s.index} exceeds ${cap} chars but has no safe cut point (likely one long math span) — left intact.`
          );
        }
        return b;
      });
    }
  }
  return obj;
}

function parseRefineBatchResponse(raw: string): BatchResponse | null {
  let text = raw
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/gi, '')
    .trim();

  // Fix common Gemini JSON issues
  text = text
    .replace(/,\s*}/g, '}')
    .replace(/,\s*]/g, ']')
    .replace(/}\s*{/g, '},{');

  const attempt = (str: string): BatchResponse | null => {
    try {
      const obj = JSON.parse(str) as BatchResponse;
      if (Array.isArray(obj?.slides) && obj.slides.length > 0) return sanitizeBatchResponse(obj);
    } catch {
      /* continue */
    }
    return null;
  };

  // Attempt 1: direct parse
  const d1 = attempt(text);
  if (d1) return d1;

  // Attempt 2: extract between first { and last }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end > start) {
    const d2 = attempt(text.slice(start, end + 1));
    if (d2) return d2;
  }

  return null;
}

// ─── Fallback when a batch completely fails ───────────────────────────────────

function fallbackBatchResponse(batch: ExtractedSlide[]): BatchResponse {
  return {
    slides: batch.map((s) => ({
      index: s.index,
      refined_title: s.title,
      refined_body: s.body_text,
      visual: null,
      is_new: false,
      inserted_after_index: null,
      change_summary: BATCH_FAILURE_SUMMARY,
    })),
    needs_summary: false,
    batch_changes: ['[Batch failed — original content preserved for these slides]'],
  };
}

// ─── Single-batch processor with retry ───────────────────────────────────────

async function processOneBatch(
  batch: ExtractedSlide[],
  options: RefinementOptions,
  deck: ExtractedDeck,
  ctx: SubjectContext | undefined,
  isFirstBatch: boolean,
  isLastBatch: boolean,
  maxRetries = 2
): Promise<BatchResponse> {
  const prompt = buildBatchPrompt(
    batch,
    options,
    deck,
    ctx,
    isFirstBatch,
    isLastBatch
  );

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(
        `[ppt-refine/refiner] Batch slides ${batch[0].index}-${batch[batch.length - 1].index} attempt ${attempt}/${maxRetries}`
      );

      const ai = await routeAI('ppt_refine', {
        systemPrompt: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: prompt }],
        // Every observed legitimate batch stays under ~2.4k tokens (text-only)
        // or comfortably under 8k (add_visuals, where up to BATCH_SIZE inline
        // SVG/mermaid diagrams at ~2-6k chars each can legitimately stack up).
        // A runaway generation should hit this ceiling and fail fast/cheap —
        // not balloon to the old 16384 cap before the parse failure is caught.
        maxTokens: options.add_visuals ? 8192 : 4096,
        responseSchema: BATCH_RESPONSE_SCHEMA,
      });

      const text = String(ai.content ?? '');
      const parsed = parseRefineBatchResponse(text);

      if (parsed) {
        trimBatchResponse(parsed);
        console.log(
          `[ppt-refine/refiner] Batch parsed OK — ${parsed.slides.length} slides, ` +
            `${parsed.slides.filter((s) => s.is_new).length} new`
        );
        return parsed;
      }

      console.warn(
        `[ppt-refine/refiner] Parse failed on attempt ${attempt}. Raw head: ${text.slice(0, 200)}`
      );
    } catch (err) {
      console.warn(
        `[ppt-refine/refiner] API error on attempt ${attempt}:`,
        err instanceof Error ? err.message : err
      );
      if (attempt === maxRetries) break;
    }

    if (attempt < maxRetries) {
      await new Promise((r) => setTimeout(r, attempt * 1500));
    }
  }

  console.error(
    `[ppt-refine/refiner] All retries exhausted for slides ${batch[0].index}-${batch[batch.length - 1].index} — using fallback`
  );
  return fallbackBatchResponse(batch);
}

// ─── Imagen pass (Pro-tier image generation, separate after Flash batches) ────

async function runImagenPass(
  slides: RefinedSlide[],
  deck: ExtractedDeck
): Promise<void> {
  const imagenSlides = slides.filter((s) => s.visual?.type === 'imagen');
  if (imagenSlides.length === 0) return;

  console.log(
    `[ppt-refine/refiner] Imagen pass: generating ${imagenSlides.length} image(s)`
  );

  await Promise.allSettled(
    imagenSlides.map(async (slide) => {
      const visual = slide.visual!;
      const fullPrompt = buildImagenPrompt({
        slideTitle: slide.refined_title,
        subject: deck.detected_topic,
        topic: deck.detected_topic,
        imagenPrompt: visual.content,
        renderHint: 'illustration',
      });

      try {
        const base64 = await generateImagenImage(fullPrompt);

        if (base64 && base64.length >= MIN_IMAGEN_B64_LEN) {
          visual.content = base64;
          console.log(
            `[ppt-refine/refiner] Imagen OK for slide ${slide.index} (${(base64.length / 1024).toFixed(1)}KB)`
          );
        } else {
          console.warn(
            `[ppt-refine/refiner] Imagen returned null or <5KB for slide ${slide.index} — keeping prompt`
          );
        }
      } catch (err) {
        console.warn(
          `[ppt-refine/refiner] Imagen error for slide ${slide.index}:`,
          err instanceof Error ? err.message : err
        );
      }
    })
  );
}

// ─── Summary slide generation ─────────────────────────────────────────────────

async function generateSummarySlide(
  refinedSlides: RefinedSlide[],
  deck: ExtractedDeck
): Promise<RefinedSlide | null> {
  const titlesBlock = refinedSlides
    .filter((s) => !s.is_new)
    .map((s, i) => `${i + 1}. ${s.refined_title}`)
    .join('\n');

  const prompt =
    `You are generating a summary slide for a lecture on "${deck.detected_topic}" (${deck.detected_level} level).\n\n` +
    `Slide titles covered:\n${titlesBlock}\n\n` +
    `Generate a summary slide with exactly 8 key takeaways — the most important points students must remember for exams.\n\n` +
    `Output JSON only (no markdown fences):\n` +
    `{"refined_title": "Summary & Key Takeaways", "refined_body": ["<takeaway>", ...<8 items>]}`;

  try {
    const ai = await routeAI('ppt_refine', {
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 1024,
    });

    const text = String(ai.content ?? '');
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]) as {
      refined_title?: string;
      refined_body?: string[];
    };

    if (typeof parsed.refined_title === 'string') parsed.refined_title = stripHtml(parsed.refined_title);
    if (Array.isArray(parsed.refined_body)) parsed.refined_body = parsed.refined_body.map((b) => (typeof b === 'string' ? stripHtml(b) : b));

    if (!Array.isArray(parsed.refined_body) || parsed.refined_body.length === 0)
      return null;

    const body = parsed.refined_body.slice(0, 8);
    const titleStr = parsed.refined_title ?? 'Summary & Key Takeaways';

    return {
      index: -1, // renumbered during assembly
      title: titleStr,
      type: 'summary',
      body_text: body,
      has_image: false,
      has_diagram: false,
      speaker_notes: '',
      word_count: body.join(' ').split(/\s+/).filter((w) => w).length,
      is_thin: false,
      refined_title: titleStr,
      refined_body: body,
      visual: undefined,
      is_new: true,
      change_summary: 'AI-generated summary slide added.',
    };
  } catch (err) {
    console.warn(
      '[ppt-refine/refiner] Summary slide generation failed:',
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

// ─── Slide assembly ───────────────────────────────────────────────────────────

function makeBaseSlide(s: ExtractedSlide): RefinedSlide {
  return {
    ...s,
    refined_title: s.title,
    refined_body: s.body_text,
    visual: undefined,
    is_new: false,
    change_summary: NO_CHANGE_SUMMARY,
  };
}

function assembleRefinedDeck(
  originalSlides: ExtractedSlide[],
  batchResults: BatchResponse[],
  summarySlide: RefinedSlide | null,
  selectedSet: Set<number> | null
): RefinedSlide[] {
  // Base layer: one RefinedSlide per original slide. A slide the faculty member
  // did NOT select never entered a batch, so it will never be overwritten by a
  // batch result below — stamp it up front as a deliberate skip (refined ===
  // original from makeBaseSlide, but with the NOT_SELECTED_SUMMARY reason) so it
  // is counted as unchanged and, in the assembler, left byte-identical.
  const base: RefinedSlide[] = originalSlides.map((s) => {
    const bs = makeBaseSlide(s);
    if (selectedSet && !selectedSet.has(s.index)) bs.change_summary = NOT_SELECTED_SUMMARY;
    return bs;
  });

  // Collect new slides grouped by where they insert
  const insertionMap = new Map<number, RefinedSlide[]>();

  for (const batch of batchResults) {
    for (const rs of batch.slides) {
      if (rs.is_new) {
        const insertAfter = rs.inserted_after_index ?? rs.index;
        if (!insertionMap.has(insertAfter)) insertionMap.set(insertAfter, []);

        insertionMap.get(insertAfter)!.push({
          // Inherit base ExtractedSlide fields from the parent slide (for type safety)
          ...(base[Math.min(insertAfter, base.length - 1)] ?? base[0]),
          // Override with AI-provided content
          type: (rs.type as SlideType | undefined) ?? 'concept',
          title: rs.refined_title,
          body_text: rs.refined_body,
          word_count: rs.refined_body
            .join(' ')
            .split(/\s+/)
            .filter((w) => w).length,
          is_thin: false,
          has_image: false,
          has_diagram: false,
          speaker_notes: '',
          refined_title: rs.refined_title,
          refined_body: rs.refined_body,
          visual: rs.visual ?? undefined,
          is_new: true,
          change_summary: rs.change_summary,
        });
        continue;
      }

      // Apply refinement to existing slide
      if (rs.index >= 0 && rs.index < base.length) {
        base[rs.index] = {
          ...base[rs.index],
          refined_title: rs.refined_title,
          refined_body: restorePseudocodeLines(base[rs.index].body_text, rs.refined_body),
          visual: rs.visual ?? undefined,
          is_new: false,
          change_summary: rs.change_summary,
        };
      }
    }
  }

  // Build final array: for each original slide, push it then push any insertions
  const result: RefinedSlide[] = [];
  for (let i = 0; i < base.length; i++) {
    result.push(base[i]);
    const insertions = insertionMap.get(i) ?? [];
    result.push(...insertions);
  }

  // Append summary slide
  if (summarySlide) result.push(summarySlide);

  // Renumber sequentially
  return result.map((s, i) => ({ ...s, index: i }));
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function refineDeck(
  deck: ExtractedDeck,
  options: RefinementOptions,
  subjectContext?: SubjectContext,
  // Which original slide indices to send to the AI. `undefined` = refine the
  // whole deck (the default, behaviourally identical to before this feature). An
  // explicit list refines ONLY those slides; every other slide is stamped
  // NOT_SELECTED_SUMMARY, never batched (no AI call, no cost) and left untouched.
  selectedIndices?: number[]
): Promise<RefinedDeck> {
  // null → "all selected"; a Set → refine only these indices. Kept as null (not
  // a full Set) for the default so the whole path stays identical to before.
  const selectedSet = selectedIndices ? new Set(selectedIndices) : null;

  console.log(
    `[ppt-refine/refiner] Starting refinement: ${deck.slide_count} slides, ` +
      `${selectedSet ? `${selectedSet.size} selected, ` : ''}` +
      `topic="${deck.detected_topic}", level=${deck.detected_level}`
  );

  if (deck.slides.length === 0) {
    return {
      original_slide_count: 0,
      refined_slide_count: 0,
      slides: [],
      changes_summary: ['No slides to refine.'],
    };
  }

  // Only the SELECTED slides are batched and sent to the AI. Non-selected slides
  // are skipped entirely here (stamped later in assembleRefinedDeck) — this is
  // where the real cost/time saving comes from: fewer batches actually sent.
  const slidesToRefine = selectedSet
    ? deck.slides.filter((s) => selectedSet.has(s.index))
    : deck.slides;

  // Split into batches of BATCH_SIZE
  const batches: ExtractedSlide[][] = [];
  for (let i = 0; i < slidesToRefine.length; i += BATCH_SIZE) {
    batches.push(slidesToRefine.slice(i, i + BATCH_SIZE));
  }

  console.log(`[ppt-refine/refiner] Processing ${batches.length} batch(es) in parallel`);

  // Process all batches in parallel
  const batchResults = await Promise.all(
    batches.map((batch, idx) =>
      processOneBatch(
        batch,
        options,
        deck,
        subjectContext,
        idx === 0,
        idx === batches.length - 1
      )
    )
  );

  // Assemble intermediate refined slides (before imagen pass). Pass the full
  // deck.slides (all originals, in order) plus the selected set so non-selected
  // slides are stamped NOT_SELECTED_SUMMARY rather than the AI no-op summary.
  const intermediateSlides = assembleRefinedDeck(deck.slides, batchResults, null, selectedSet);

  // Imagen pass — separate Pro-tier generation for slides that need real images
  if (options.add_visuals) {
    await runImagenPass(intermediateSlides, deck);
  }

  // Summary slide — if any batch flagged needs_summary and option is active
  let summarySlide: RefinedSlide | null = null;
  const needsSummary =
    options.add_summary_slide &&
    batchResults.some((r) => r.needs_summary) &&
    !intermediateSlides.some((s) => s.type === 'summary');

  if (needsSummary) {
    console.log('[ppt-refine/refiner] Generating summary slide...');
    summarySlide = await generateSummarySlide(intermediateSlides, deck);
  }

  // Final assembly with summary
  const finalSlides = summarySlide
    ? [...intermediateSlides.map((s, i) => ({ ...s, index: i })), { ...summarySlide, index: intermediateSlides.length }]
    : intermediateSlides;

  // Collect all batch-level change descriptions
  const changesSummary = batchResults
    .flatMap((r) => r.batch_changes)
    .filter((c) => c && !c.startsWith('[Batch failed'));

  if (summarySlide) changesSummary.push('Summary slide generated and appended.');

  const imagenCount = finalSlides.filter(
    (s) =>
      s.visual?.type === 'imagen' && s.visual.content.length >= MIN_IMAGEN_B64_LEN
  ).length;
  if (imagenCount > 0) {
    changesSummary.push(`${imagenCount} imagen image(s) generated for visual slides.`);
  }

  console.log(
    `[ppt-refine/refiner] Done. original=${deck.slide_count} refined=${finalSlides.length} ` +
      `new=${finalSlides.filter((s) => s.is_new).length} changes=${changesSummary.length}`
  );

  return {
    original_slide_count: deck.slide_count,
    refined_slide_count: finalSlides.length,
    slides: finalSlides,
    changes_summary: changesSummary.length > 0 ? changesSummary : ['No significant changes needed.'],
  };
}
