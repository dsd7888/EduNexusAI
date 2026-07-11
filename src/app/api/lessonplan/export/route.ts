import { requireRole, apiError, apiSuccess } from "@/lib/api/helpers";
import { assertSubjectAccess } from "@/lib/api/subjectAccess";
import { PRACTICALS_STATE_KEY } from "@/lib/lessonplan/types";
import { generateLessonPlanDocx } from "@/lib/lessonplan/docxBuilder";
import { generateLessonPlanPdf } from "@/lib/lessonplan/pdfBuilder";
import type { LessonPlanDoc, ModulePlanState } from "@/lib/lessonplan/types";
import type { NextRequest } from "next/server";

const DOCX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const SIGNED_URL_TTL = 3600; // 1 hour

/** Human label for a moduleStates key ("m3" → "Module 3", "practicals" → "Practicals"). */
function stateKeyLabel(key: string): string {
  if (key === PRACTICALS_STATE_KEY) return "Practicals";
  const m = /^m(\d+)$/.exec(key);
  return m ? `Module ${m[1]}` : key;
}

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireRole([
      "faculty",
      "superadmin",
      "dean",
      "hod",
    ]);
    if (authResult instanceof Response) return authResult;
    const { user, profile, adminClient } = authResult;

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return apiError("Invalid JSON body", 400);
    }

    const subjectId = String(body.subjectId ?? "").trim();
    if (!subjectId) return apiError("subjectId is required", 400);

    const format = String(body.format ?? "").trim();
    if (format !== "docx" && format !== "pdf") {
      return apiError("format must be 'docx' or 'pdf'", 400);
    }

    // ── Assignment check (faculty only) ─────────────────────────────────────
    const denied = await assertSubjectAccess(
      adminClient,
      profile.role,
      user.id,
      subjectId,
    );
    if (denied) return denied;

    // ── Load the caller's plan ──────────────────────────────────────────────
    const { data: planRow } = await adminClient
      .from("lesson_plans")
      .select("id, plan")
      .eq("subject_id", subjectId)
      .eq("faculty_id", user.id)
      .maybeSingle();
    if (!planRow) {
      return apiError("No lesson plan to export — generate and save one first", 404);
    }

    const plan = (planRow as { plan: LessonPlanDoc }).plan;
    const moduleStates = (plan?.moduleStates ?? {}) as Record<
      string,
      ModulePlanState
    >;

    // ── Reviewed gate: every moduleState must be reviewed (§5) ───────────────
    const stateKeys = Object.keys(moduleStates);
    const unreviewed = stateKeys.filter((k) => moduleStates[k]?.reviewed !== true);
    if (stateKeys.length === 0 || unreviewed.length > 0) {
      return apiSuccess(
        {
          error: "Every module must be reviewed before export",
          unreviewed: (stateKeys.length === 0 ? [] : unreviewed).map(stateKeyLabel),
        },
        422,
      );
    }

    // ── Build the artifact ──────────────────────────────────────────────────
    const ext = format === "docx" ? "docx" : "pdf";
    const contentType = format === "docx" ? DOCX_CONTENT_TYPE : "application/pdf";
    let buffer: Buffer;
    try {
      buffer =
        format === "docx"
          ? await generateLessonPlanDocx(plan, subjectId, user.id)
          : await generateLessonPlanPdf(plan, subjectId, user.id);
    } catch (buildErr) {
      console.error(
        "[lessonplan export] build failed:",
        buildErr instanceof Error ? buildErr.message : buildErr,
      );
      return apiError("Failed to build the document", 500);
    }

    // ── Upload to the PRIVATE bucket (path keyed by faculty id, per §19) ─────
    const filePath = `${user.id}/lessonplan_${subjectId.slice(0, 8)}_${Date.now()}.${ext}`;
    const { error: uploadError } = await adminClient.storage
      .from("lesson-plans")
      .upload(filePath, buffer, { contentType, upsert: true });
    if (uploadError) {
      console.error("[lessonplan export] upload failed:", uploadError.message);
      return apiError("Failed to upload the document", 500);
    }

    // ── Persist the PATH (not a URL) + finalize the plan ────────────────────
    const pathColumn = format === "docx" ? "docx_path" : "pdf_path";
    await adminClient
      .from("lesson_plans")
      .update({ [pathColumn]: filePath, status: "finalized" })
      .eq("id", (planRow as { id: string }).id);

    // ── Short-lived signed URL for immediate download ───────────────────────
    const { data: signed, error: signError } = await adminClient.storage
      .from("lesson-plans")
      .createSignedUrl(filePath, SIGNED_URL_TTL);
    if (signError || !signed) {
      console.error("[lessonplan export] sign failed:", signError?.message);
      return apiError("Failed to create a download link", 500);
    }

    return apiSuccess({ url: signed.signedUrl, path: filePath, format });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    console.error("[lessonplan export] error:", message);
    return apiError("Failed to export lesson plan", 500);
  }
}
