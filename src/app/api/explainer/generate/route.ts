import { apiError, apiSuccess, requireRole } from "@/lib/api/helpers";
import { createAdminClient } from "@/lib/db/supabase-server";
import { generateExplainerContent } from "@/lib/explainer/scriptGenerator";
import { generateVoiceover } from "@/lib/explainer/tts";
import { renderExplainer } from "@/lib/explainer/renderer";
import {
  createExplainerSignedUrl,
  generateUniqueShortCode,
  uploadExplainerHtml,
} from "@/lib/explainer/storage";
import type {
  ExplainerRequest,
  GeneratedExplainer,
  SubjectContext,
} from "@/lib/explainer/types";

// Explainers are reusable content — sign for 7 days.
const SIGNED_URL_TTL_SECONDS = 7 * 24 * 60 * 60;
// Rough runtime estimate used for the stored metadata / list display.
const SECONDS_PER_SEGMENT = 10;

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * Load the syllabus context the generator needs: subject name/branch/semester,
 * the (optional) module's name + description, and the subject's course outcomes.
 * Returns undefined if the subject can't be found so generation still proceeds
 * from the bare topic.
 */
async function loadSubjectContext(
  admin: AdminClient,
  subjectId: string,
  moduleId: string | undefined
): Promise<SubjectContext | undefined> {
  const { data: subject } = await admin
    .from("subjects")
    .select("name, branch, semester")
    .eq("id", subjectId)
    .maybeSingle();
  if (!subject) return undefined;
  const s = subject as {
    name: string;
    branch: string | null;
    semester: number | null;
  };

  let moduleName = "(not specified)";
  let moduleDescription = "";
  if (moduleId) {
    const { data: mod } = await admin
      .from("modules")
      .select("name, description")
      .eq("id", moduleId)
      .maybeSingle();
    if (mod) {
      const m = mod as { name: string; description: string | null };
      moduleName = m.name;
      moduleDescription = m.description ?? "";
    }
  }

  const { data: cos } = await admin
    .from("course_outcomes")
    .select("co_code, description")
    .eq("subject_id", subjectId);
  const course_outcomes = (
    (cos ?? []) as { co_code: string; description: string }[]
  ).map((c) => ({ co_code: c.co_code, description: c.description }));

  return {
    subject_name: s.name,
    module_name: moduleName,
    module_description: moduleDescription,
    course_outcomes,
    branch: s.branch ?? "(not specified)",
    semester: typeof s.semester === "number" ? s.semester : 3,
  };
}

/**
 * Inject per-segment TTS audio into the rendered HTML by replacing the renderer's
 * `window.__AUDIO=null;` placeholder with an array of base64 data-URIs.
 */
function injectAudio(html: string, audioSegments: (string | null)[]): string {
  const dataUris = audioSegments.map((b64) =>
    b64 ? `data:audio/mp3;base64,${b64}` : null
  );
  const json = JSON.stringify(dataUris).replace(/</g, "\\u003c");
  return html.replace("window.__AUDIO=null;", `window.__AUDIO=${json};`);
}

export async function POST(request: Request) {
  const auth = await requireRole(["faculty", "superadmin", "dean", "hod"]);
  if (auth instanceof Response) return auth;
  const { user, adminClient } = auth;

  // ── 1. Parse + validate body ──
  let body: Partial<ExplainerRequest>;
  try {
    body = (await request.json()) as Partial<ExplainerRequest>;
  } catch {
    return apiError("Invalid JSON body", 400);
  }
  if (!body || typeof body.topic !== "string" || !body.topic.trim()) {
    return apiError("A topic is required", 400);
  }

  const req: ExplainerRequest = {
    topic: body.topic.trim(),
    subject_id: body.subject_id,
    module_id: body.module_id,
    context_hint: body.context_hint,
    audience_semester:
      typeof body.audience_semester === "number"
        ? body.audience_semester
        : undefined,
  };

  // ── 2. Subject context (admin client; bypasses RLS) ──
  let subjectContext: SubjectContext | undefined;
  if (req.subject_id) {
    try {
      subjectContext = await loadSubjectContext(
        adminClient,
        req.subject_id,
        req.module_id
      );
    } catch (e) {
      console.warn("[explainer/generate] subject context load failed", e);
    }
  }

  // ── 3. Content (two-call pipeline) ──
  let content;
  try {
    content = await generateExplainerContent(req, subjectContext);
  } catch (e) {
    console.error("[explainer/generate] content generation failed:", e);
    return apiError(
      "Could not generate explainer for this topic. Try being more specific.",
      500
    );
  }

  // ── 4. Render HTML ──
  let html = renderExplainer(content);

  // ── 5. Voiceover (never blocks; null if TTS unavailable) ──
  let audioSegments: (string | null)[] | null = null;
  try {
    audioSegments = await generateVoiceover(
      content.narrative_segments.map((seg, i) => ({
        segment_id: String(i),
        duration: 0,
        narration: seg.caption,
        cues: [],
      })),
      "female"
    );
  } catch (e) {
    console.warn("[explainer/generate] voiceover failed; continuing silent", e);
    audioSegments = null;
  }

  // ── 6. Inject audio into HTML ──
  if (audioSegments) {
    html = injectAudio(html, audioSegments);
  }
  const hasAudio = audioSegments !== null;

  // ── 7. Allocate short code ──
  let shortCode: string;
  try {
    shortCode = await generateUniqueShortCode(adminClient);
  } catch (e) {
    console.error("[explainer/generate] short code allocation failed", e);
    return apiError("Failed to allocate explainer code", 500);
  }

  // ── 8. Upload HTML ──
  let storagePath: string;
  try {
    storagePath = await uploadExplainerHtml(adminClient, user.id, shortCode, html);
  } catch (e) {
    console.error("[explainer/generate] storage upload failed", e);
    return apiError("Failed to store explainer", 500);
  }

  // 7-day signed URL (best-effort; permalink is the fallback).
  const signedUrl = await createExplainerSignedUrl(
    adminClient,
    storagePath,
    SIGNED_URL_TTL_SECONDS
  );

  const durationSeconds = content.narrative_segments.length * SECONDS_PER_SEGMENT;

  // ── 9. Persist row (ExtractedContent stored in the jsonb `script` column) ──
  const { data: row, error: insertError } = await adminClient
    .from("explainers")
    .insert({
      short_code: shortCode,
      subject_id: req.subject_id ?? null,
      module_id: req.module_id ?? null,
      topic: req.topic,
      script: content,
      storage_path: storagePath,
      has_audio: hasAudio,
      duration_seconds: durationSeconds,
      created_by: user.id,
    })
    .select("id, created_at")
    .single();

  if (insertError || !row) {
    console.error("[explainer/generate] insert failed", insertError);
    return apiError("Failed to save explainer", 500);
  }
  const inserted = row as { id: string; created_at: string };

  // ── 10. Return GeneratedExplainer ──
  const result: GeneratedExplainer = {
    id: inserted.id,
    short_code: shortCode,
    topic: req.topic,
    subject_name: content.subject_name,
    html_player: html,
    storage_url: signedUrl ?? `/e/${shortCode}`,
    has_audio: hasAudio,
    duration_seconds: durationSeconds,
    created_at: inserted.created_at,
  };

  return apiSuccess(result, 201);
}
