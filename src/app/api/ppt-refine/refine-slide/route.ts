import { requireRole, apiError } from '@/lib/api/helpers';
import { refineSingleSlide } from '@/lib/ppt-refine/refiner';
import type { ExtractedSlide, SlideType } from '@/lib/ppt-refine/types';
import type { NextRequest } from 'next/server';

// A single Flash call — well under a minute. Kept generous for the diagram case.
export const maxDuration = 120;

const VALID_TYPES: SlideType[] = [
  'title',
  'overview',
  'concept',
  'diagram',
  'example',
  'practice',
  'summary',
  'unknown',
];

/**
 * Single-slide chat refinement for the standalone PPT tool. Takes one slide's
 * current content + a free-text faculty instruction and returns just that slide,
 * patched immediately — no batch job. Mirrors the batch route's model routing,
 * schema discipline and maxTokens split (all inside refineSingleSlide), but for
 * exactly one slide so the configure-stage chat can update it live.
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireRole(['faculty', 'superadmin', 'dept_admin', 'dean', 'hod']);
    if (authResult instanceof Response) return authResult;

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return apiError('Request body must be JSON', 400);
    }

    // ─── Validate instruction (reuse the post-gen empty/whitespace guard) ─────
    const instructionRaw = typeof body.instruction === 'string' ? body.instruction : '';
    const instruction = instructionRaw.trim();
    if (!instruction) {
      return apiError('Instruction is required', 400);
    }

    // ─── Validate slide index + current slide ─────────────────────────────────
    const slideIndex = body.slide_index;
    if (typeof slideIndex !== 'number' || !Number.isInteger(slideIndex) || slideIndex < 0) {
      return apiError('slide_index must be a non-negative integer', 400);
    }

    const slideRaw = body.slide as Partial<ExtractedSlide> | undefined;
    if (!slideRaw || typeof slideRaw !== 'object') {
      return apiError('slide (current slide content) is required', 400);
    }

    const title = typeof slideRaw.title === 'string' ? slideRaw.title : '';
    const bodyText = Array.isArray(slideRaw.body_text)
      ? slideRaw.body_text.filter((b): b is string => typeof b === 'string')
      : [];
    const type: SlideType = VALID_TYPES.includes(slideRaw.type as SlideType)
      ? (slideRaw.type as SlideType)
      : 'concept';

    // Rebuild a well-formed ExtractedSlide from the (partial) client payload so
    // the refiner always sees complete, typed input.
    const slide: ExtractedSlide = {
      index: slideIndex,
      title,
      type,
      body_text: bodyText,
      has_image: Boolean(slideRaw.has_image),
      has_diagram: Boolean(slideRaw.has_diagram),
      speaker_notes: typeof slideRaw.speaker_notes === 'string' ? slideRaw.speaker_notes : '',
      word_count:
        typeof slideRaw.word_count === 'number'
          ? slideRaw.word_count
          : bodyText.join(' ').split(/\s+/).filter(Boolean).length,
      is_thin: Boolean(slideRaw.is_thin),
    };

    // ─── Grounding context ────────────────────────────────────────────────────
    const subjectName =
      typeof body.subject_name === 'string' && body.subject_name.trim()
        ? body.subject_name.trim()
        : 'this subject';
    const topic = typeof body.topic === 'string' ? body.topic.trim() : '';
    const level = typeof body.level === 'string' && body.level.trim() ? body.level.trim() : 'intermediate';
    const neighboringTitles = Array.isArray(body.neighboring_titles)
      ? (body.neighboring_titles as unknown[])
          .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
          .map((t) => t.trim())
          .slice(0, 4)
      : [];

    // ─── Single Flash call ────────────────────────────────────────────────────
    const refined = await refineSingleSlide(slide, instruction, {
      subjectName,
      topic,
      level,
      neighboringTitles,
      slideIndex,
    });

    return Response.json({
      slide_index: slideIndex,
      refined_slide: refined,
    });
  } catch (err) {
    console.error('[ppt-refine/refine-slide] Unexpected error:', err);
    const message = err instanceof Error ? err.message : 'Failed to refine slide';
    return apiError(message, 500);
  }
}
