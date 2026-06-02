import { routeAI } from '@/lib/ai/router';
import { generateImagenImage, buildImagenPrompt } from '@/lib/ai/imagen';
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
    lines.push(`Content: ${s.body_text.join(' | ') || '(no text content)'}`);
    lines.push('');
  }

  // ── ACTIVE REFINEMENT INSTRUCTIONS ──
  const activeOpts: string[] = [];

  if (options.improve_readability) {
    activeOpts.push(
      `IMPROVE READABILITY: Improve the clarity of existing content WITHOUT removing or ` +
        `shortening explanations. Rules:\n` +
        `   - Fix grammatical errors and awkward phrasing\n` +
        `   - Break run-on sentences into cleaner separate sentences\n` +
        `   - Make passive voice active where natural\n` +
        `   - Standardize bullet formatting (parallel structure)\n` +
        `   - NEVER reduce a multi-sentence explanation to a single sentence\n` +
        `   - NEVER remove definitions, examples, or explanatory clauses\n` +
        `   - NEVER apply a word limit per bullet -- preserve all content\n` +
        `   - If a bullet is already clear, return it unchanged\n` +
        `   - Total word count of refined_body must be >= 90% of original\n` +
        `     body_text word count. If your rewrite falls below this,\n` +
        `     add back the removed content.`
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
  lines.push('- NEVER remove existing correct content');
  lines.push('- NEVER change the fundamental meaning of any slide');
  lines.push('- NEVER invent facts not supported by slide content or subject context');
  lines.push(
    '- If a slide is already excellent: set refined_title=original, refined_body=original, change_summary="No changes needed."'
  );
  lines.push(
    '- refined_body total words must be >= 90% of body_text total words. ' +
      'If this is not met, you have over-summarized. Add the missing ' +
      'content back before responding.'
  );
  lines.push('');

  lines.push('OUTPUT: Return ONLY a valid JSON object — no markdown fences, no prose.');
  lines.push('Schema:');
  lines.push(`{
  "slides": [
    {
      "index": <number — same index as input, OR -1 for new slides>,
      "type": "<SlideType — only required for is_new slides>",
      "refined_title": "<string>",
      "refined_body": ["<bullet string>", ...],
      "visual": { "type": "svg"|"mermaid"|"imagen", "content": "<svg markup|mermaid code|imagen prompt>", "caption": "<string>" } | null,
      "is_new": <boolean>,
      "inserted_after_index": <number — index of parent slide, only when is_new=true> | null,
      "change_summary": "<one sentence describing what changed>",
      "content_preserved": <boolean — must be true if refined_body word count >= 90% of original body_text word count>
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
      change_summary: 'Refinement failed — original content preserved.',
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
        maxTokens: 16384,
      });

      const text = String(ai.content ?? '');
      const parsed = parseRefineBatchResponse(text);

      if (parsed) {
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
    change_summary: 'No changes needed.',
  };
}

function assembleRefinedDeck(
  originalSlides: ExtractedSlide[],
  batchResults: BatchResponse[],
  summarySlide: RefinedSlide | null
): RefinedSlide[] {
  // Base layer: one RefinedSlide per original slide
  const base: RefinedSlide[] = originalSlides.map(makeBaseSlide);

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
          refined_body: rs.refined_body,
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
  subjectContext?: SubjectContext
): Promise<RefinedDeck> {
  console.log(
    `[ppt-refine/refiner] Starting refinement: ${deck.slide_count} slides, ` +
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

  // Split into batches of BATCH_SIZE
  const batches: ExtractedSlide[][] = [];
  for (let i = 0; i < deck.slides.length; i += BATCH_SIZE) {
    batches.push(deck.slides.slice(i, i + BATCH_SIZE));
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

  // Assemble intermediate refined slides (before imagen pass)
  const intermediateSlides = assembleRefinedDeck(deck.slides, batchResults, null);

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
