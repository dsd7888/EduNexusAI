import { requireRole, apiError } from '@/lib/api/helpers';
import { createAdminClient } from '@/lib/db/supabase-server';
import { refineDeck } from '@/lib/ppt-refine/refiner';
import { assemblePptx } from '@/lib/ppt-refine/assembler';
import type { SubjectContext } from '@/lib/ppt-refine/refiner';
import type { ExtractedDeck, RefinementOptions } from '@/lib/ppt-refine/types';
import type { NextRequest } from 'next/server';

// Vercel function timeout — large decks + Imagen pass can take 90–120 s
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    console.log('[ppt-refine/refine] POST received');

    const authResult = await requireRole(['faculty', 'superadmin', 'dept_admin', 'dean', 'hod']);
    if (authResult instanceof Response) return authResult;
    const { user, adminClient } = authResult;

    // ─── Parse body ──────────────────────────────────────────────────────────
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return apiError('Request body must be JSON', 400);
    }

    const extractionId = typeof body.extraction_id === 'string' ? body.extraction_id.trim() : '';
    const storagePath = typeof body.storage_path === 'string' ? body.storage_path.trim() : null;
    const inlineDeck = body.extracted_deck as
      | (ExtractedDeck & { subject_context?: SubjectContext | null; original_pptx_path?: string })
      | undefined;
    const bodyOriginalPath =
      typeof body.original_pptx_path === 'string' ? body.original_pptx_path.trim() : null;
    const optionsRaw = body.options as Partial<RefinementOptions> | undefined;
    const selectedIndicesRaw = body.selected_indices;

    if (!extractionId) {
      return apiError('extraction_id is required', 400);
    }
    if (!storagePath && !inlineDeck) {
      return apiError('Either storage_path or extracted_deck is required', 400);
    }
    if (!optionsRaw || typeof optionsRaw !== 'object') {
      return apiError('options object is required', 400);
    }

    // Normalise options with safe defaults
    const options: RefinementOptions = {
      improve_readability:      Boolean(optionsRaw.improve_readability),
      expand_thin_sections:     Boolean(optionsRaw.expand_thin_sections),
      add_real_world_examples:  Boolean(optionsRaw.add_real_world_examples),
      add_visuals:              Boolean(optionsRaw.add_visuals),
      add_practice_problems:    Boolean(optionsRaw.add_practice_problems),
      simplify_content:         Boolean(optionsRaw.simplify_content),
      add_summary_slide:        Boolean(optionsRaw.add_summary_slide),
      add_key_insights:         Boolean(optionsRaw.add_key_insights),
      allow_new_slides:         Boolean(optionsRaw.allow_new_slides),
      subject_id:               typeof optionsRaw.subject_id === 'string' ? optionsRaw.subject_id : null,
      target_semester:          typeof optionsRaw.target_semester === 'number' ? optionsRaw.target_semester : null,
    };

    if (!options.subject_id) {
      return apiError('subject_id is required — link this refinement to a subject before continuing', 400);
    }

    // ─── Load extracted deck ─────────────────────────────────────────────────
    let deckWithCtx: ExtractedDeck & { subject_context?: SubjectContext | null };

    if (storagePath) {
      let deckRes: Response;
      try {
        deckRes = await fetch(storagePath, { signal: AbortSignal.timeout(15_000) });
      } catch {
        return apiError('Could not fetch extracted deck from storage (URL may have expired)', 422);
      }
      if (!deckRes.ok) {
        return apiError(`Storage fetch failed: ${deckRes.status}`, 422);
      }
      try {
        deckWithCtx = await deckRes.json() as ExtractedDeck & { subject_context?: SubjectContext | null };
      } catch {
        return apiError('Could not parse extracted deck JSON from storage', 422);
      }
    } else {
      deckWithCtx = inlineDeck!;
    }

    // Validate the deck has slides
    if (!Array.isArray(deckWithCtx.slides) || deckWithCtx.slides.length === 0) {
      return apiError('Extracted deck contains no slides', 422);
    }

    // Separate the ExtractedDeck from its stored subject_context / original path
    const {
      subject_context: storedCtx,
      original_pptx_path: storedOriginalPath,
      ...deck
    } = deckWithCtx as ExtractedDeck & {
      subject_context?: SubjectContext | null;
      original_pptx_path?: string;
    };

    // ─── Load the ORIGINAL .pptx so we can patch it in place ─────────────────
    const originalPptxPath = bodyOriginalPath ?? storedOriginalPath ?? null;
    if (!originalPptxPath) {
      return apiError(
        'original_pptx_path is required — re-upload the presentation to enable in-place refinement',
        400
      );
    }

    let originalBuffer: Buffer;
    try {
      const { data: origData, error: origErr } = await adminClient.storage
        .from('generated-content')
        .download(originalPptxPath);
      if (origErr || !origData) {
        console.error('[ppt-refine/refine] Original download error:', origErr);
        return apiError('Could not load the original presentation from storage', 422);
      }
      originalBuffer = Buffer.from(await origData.arrayBuffer());
    } catch (err) {
      console.error('[ppt-refine/refine] Original download exception:', err);
      return apiError('Could not load the original presentation from storage', 422);
    }

    // ─── Build SubjectContext ────────────────────────────────────────────────
    // Use stored context as baseline; re-fetch if subject_id is provided
    let subjectContext: SubjectContext | undefined =
      storedCtx ?? undefined;

    if (options.subject_id) {
      try {
        const [subjectRes, modulesRes, coRes] = await Promise.all([
          adminClient
            .from('subjects')
            .select('name')
            .eq('id', options.subject_id)
            .maybeSingle(),
          adminClient
            .from('modules')
            .select('name, description')
            .eq('subject_id', options.subject_id)
            .order('module_number', { ascending: true }),
          adminClient
            .from('course_outcomes')
            .select('co_code, description')
            .eq('subject_id', options.subject_id),
        ]);

        if (subjectRes.error) {
          console.error('[ppt-refine/refine] subjects query failed:', subjectRes.error);
        }
        if (modulesRes.error) {
          console.error('[ppt-refine/refine] modules query failed:', modulesRes.error);
        }
        if (coRes.error) {
          console.error('[ppt-refine/refine] course_outcomes query failed:', coRes.error);
        }

        if (subjectRes.data) {
          const sub = subjectRes.data as { name: string };
          subjectContext = {
            subject_name: sub.name,
            modules: ((modulesRes.data ?? []) as Array<{ name: string; description: string | null }>).map(
              (m) => ({ name: m.name, description: m.description ?? '' })
            ),
            course_outcomes: ((coRes.data ?? []) as Array<{ co_code: string; description: string }>).map(
              (c) => ({ co_code: c.co_code, description: c.description })
            ),
          };
        }
      } catch (err) {
        console.warn('[ppt-refine/refine] SubjectContext fetch failed (non-fatal):', err);
        // Use stored context if available
      }
    }

    // ─── Per-slide selection ─────────────────────────────────────────────────
    // `selected_indices` is optional. Absent → refine the whole deck (unchanged
    // legacy behaviour). Present → refine ONLY those original slide indices; the
    // rest are skipped (no AI call, no cost) and left untouched. Validate against
    // the actual slide count and drop anything out of range / non-integer.
    let selectedIndices: number[] | undefined;
    if (selectedIndicesRaw !== undefined) {
      if (!Array.isArray(selectedIndicesRaw)) {
        return apiError('selected_indices must be an array of slide indices', 400);
      }
      const slideCount = deck.slides.length;
      selectedIndices = [
        ...new Set(
          selectedIndicesRaw.filter(
            (n): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n < slideCount
          )
        ),
      ];
      if (selectedIndices.length === 0) {
        return apiError('Select at least one slide to refine', 400);
      }
    }

    // ─── Refine ──────────────────────────────────────────────────────────────
    console.log(
      `[ppt-refine/refine] Refining ${selectedIndices?.length ?? deck.slide_count}/${deck.slide_count} slides for user ${user.id}`
    );

    const refinedDeck = await refineDeck(deck as ExtractedDeck, options, subjectContext, selectedIndices);

    // ─── Assemble PPTX (patch the original in place) ─────────────────────────
    console.log('[ppt-refine/refine] Assembling PPTX...');
    const pptxBuffer = await assemblePptx(refinedDeck, originalBuffer, options);

    // ─── Upload to Storage ───────────────────────────────────────────────────
    const timestamp = Date.now();
    const safeFileName = deck.file_name
      .replace(/\.pptx$/i, '')
      .replace(/[^a-zA-Z0-9]/g, '_')
      .replace(/_+/g, '_')
      .slice(0, 40);

    const storedFilePath = `ppt-refine/${user.id}/${timestamp}_refined_${safeFileName}.pptx`;
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    const { error: uploadError } = await adminClient.storage
      .from('generated-content')
      .upload(storedFilePath, new Uint8Array(pptxBuffer), {
        contentType:
          'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        upsert: false,
        metadata: {
          created_at: new Date().toISOString(),
          expires_at: expiresAt,
          user_id: user.id,
        },
      });

    if (uploadError) {
      console.error('[ppt-refine/refine] Storage upload error:', uploadError);
      return apiError('Failed to store refined presentation', 500);
    }

    const { data: signedData, error: signedError } = await adminClient.storage
      .from('generated-content')
      .createSignedUrl(storedFilePath, 86400); // 24 hr

    if (signedError || !signedData) {
      console.error('[ppt-refine/refine] Signed URL error:', signedError);
      return apiError('Failed to generate download URL', 500);
    }

    // ─── Log to generated_content ────────────────────────────────────────────
    const { error: insertError } = await adminClient
      .from('generated_content')
      .insert({
        subject_id: options.subject_id ?? null,
        module_id: null,
        type: 'ppt',
        title: deck.detected_topic
          ? `Refined: ${deck.detected_topic}`
          : deck.file_name.replace(/\.pptx$/i, ''),
        file_path: storedFilePath,
        metadata: {
          extraction_id: extractionId,
          original_file: deck.file_name,
          original_slides: deck.slide_count,
          selected_slides: selectedIndices?.length ?? deck.slide_count,
          refined_slides: refinedDeck.refined_slide_count,
          new_slides_added: refinedDeck.slides.filter((s) => s.is_new).length,
          options_used: options,
          changes_summary: refinedDeck.changes_summary,
          // History list (src/app/api/generate/ppt/history/route.ts) reads
          // metadata.subject / .topic / .slideCount — match the keys the
          // regular PPT-generation flow uses so refined decks display the
          // same way in "My Generations".
          subject: subjectContext?.subject_name ?? null,
          topic: deck.detected_topic,
          slideCount: refinedDeck.refined_slide_count,
          detected_topic: deck.detected_topic,
          detected_level: deck.detected_level,
          expires_at: expiresAt,
        },
        generated_by: user.id,
        status: 'completed',
      });

    if (insertError) {
      // Non-fatal — download URL is already generated
      console.warn('[ppt-refine/refine] generated_content insert failed:', insertError.message);
    }

    console.log(
      `[ppt-refine/refine] Done — original=${deck.slide_count} ` +
        `refined=${refinedDeck.refined_slide_count} ` +
        `new=${refinedDeck.slides.filter((s) => s.is_new).length}`
    );

    return Response.json({
      download_url: signedData.signedUrl,
      refined_deck: refinedDeck,
      changes_summary: refinedDeck.changes_summary,
      stats: {
        original_slides: deck.slide_count,
        refined_slides: refinedDeck.refined_slide_count,
        new_slides_added: refinedDeck.slides.filter((s) => s.is_new).length,
      },
      ...(insertError ? {
        historyWarning: `Presentation refined but not saved to history: ${insertError.message}`,
      } : {}),
    });
  } catch (err) {
    console.error('[ppt-refine/refine] Unexpected error:', err);
    const message = err instanceof Error ? err.message : 'Failed to refine presentation';
    return apiError(message, 500);
  }
}
