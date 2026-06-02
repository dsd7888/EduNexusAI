import { requireRole, apiError } from '@/lib/api/helpers';
import { createAdminClient } from '@/lib/db/supabase-server';
import { extractDeckFromBuffer } from '@/lib/ppt-refine/extractor';
import type { NextRequest } from 'next/server';

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB
const PPTX_MIME =
  'application/vnd.openxmlformats-officedocument.presentationml.presentation';

export async function POST(request: NextRequest) {
  try {
    console.log('[ppt-refine/extract] POST request received');

    const authResult = await requireRole(['faculty', 'superadmin', 'dept_admin']);
    if (authResult instanceof Response) return authResult;
    const { user } = authResult;

    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return apiError('Request must be multipart/form-data', 400);
    }

    const file = formData.get('file');
    if (!(file instanceof File)) {
      return apiError('file field is required', 400);
    }

    // Validate extension
    if (!file.name.toLowerCase().endsWith('.pptx')) {
      return apiError('Only .pptx files are supported', 400);
    }

    // Validate MIME type (browsers may send different MIME for pptx)
    const validMimes = [
      PPTX_MIME,
      'application/octet-stream',
      'application/zip',
    ];
    if (file.type && !validMimes.includes(file.type)) {
      return apiError(
        `Invalid file type "${file.type}". Upload a .pptx file.`,
        400
      );
    }

    // Validate size
    if (file.size > MAX_FILE_SIZE) {
      return apiError(
        `File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum is 50 MB.`,
        400
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    let extractedDeck;
    try {
      extractedDeck = await extractDeckFromBuffer(buffer, file.name);
    } catch (err) {
      console.error('[ppt-refine/extract] Extraction error:', err);
      return apiError(
        'Could not parse this PPTX. The file may be corrupted or password-protected.',
        422
      );
    }

    // Optional: enrich with subject context
    const subjectId = formData.get('subject_id');
    let subjectContext: { name: string; modules: string[] } | undefined;

    if (typeof subjectId === 'string' && subjectId.trim()) {
      const adminClient = createAdminClient();

      const { data: subject } = await adminClient
        .from('subjects')
        .select('name')
        .eq('id', subjectId.trim())
        .maybeSingle();

      const { data: modules } = await adminClient
        .from('modules')
        .select('name')
        .eq('subject_id', subjectId.trim())
        .order('order_index', { ascending: true });

      if (subject) {
        subjectContext = {
          name: (subject as { name: string }).name,
          modules: ((modules ?? []) as Array<{ name: string }>).map(
            (m) => m.name
          ),
        };
      }
    }

    // Store extracted deck JSON in Supabase Storage
    const adminClient = createAdminClient();
    const timestamp = Date.now();

    // Persist the ORIGINAL .pptx so the refine step can patch it in place
    // (the XML-patching assembler needs the source bytes, not a rebuild).
    const originalPptxPath = `ppt-refine/${user.id}/${timestamp}_original.pptx`;
    const { error: originalUploadError } = await adminClient.storage
      .from('generated-content')
      .upload(originalPptxPath, new Uint8Array(buffer), {
        contentType: PPTX_MIME,
        upsert: false,
      });

    if (originalUploadError) {
      console.error(
        '[ppt-refine/extract] Original PPTX upload error:',
        originalUploadError
      );
      return apiError(
        'Could not store the uploaded presentation. Please try again.',
        500
      );
    }

    const storagePath = `ppt-refine/${user.id}/${timestamp}_extracted.json`;
    const jsonBytes = Buffer.from(
      JSON.stringify({
        ...extractedDeck,
        subject_context: subjectContext ?? null,
        original_pptx_path: originalPptxPath,
      }),
      'utf-8'
    );

    const { error: uploadError } = await adminClient.storage
      .from('generated-content')
      .upload(storagePath, jsonBytes, {
        contentType: 'application/json',
        upsert: false,
      });

    if (uploadError) {
      console.error('[ppt-refine/extract] Storage upload error:', uploadError);
      // Non-fatal — still return the deck; client can work without a stored copy
      console.warn('[ppt-refine/extract] Continuing without storage');
    }

    // 2-hour signed URL
    const { data: signedData } = uploadError
      ? { data: null }
      : await adminClient.storage
          .from('generated-content')
          .createSignedUrl(storagePath, 2 * 60 * 60);

    const extractionId = `${user.id}_${timestamp}`;

    console.log(
      `[ppt-refine/extract] Done. slides=${extractedDeck.slide_count} ` +
        `thin=${extractedDeck.slides.filter((s) => s.is_thin).length} ` +
        `topic="${extractedDeck.detected_topic}" level=${extractedDeck.detected_level}`
    );

    return Response.json({
      extraction_id: extractionId,
      extracted_deck: {
        ...extractedDeck,
        subject_context: subjectContext ?? null,
        original_pptx_path: originalPptxPath,
      },
      storage_path: signedData?.signedUrl ?? null,
      original_pptx_path: originalPptxPath,
    });
  } catch (err) {
    console.error('[ppt-refine/extract] Unexpected error:', err);
    const message =
      err instanceof Error ? err.message : 'Failed to extract presentation';
    return apiError(message, 500);
  }
}
