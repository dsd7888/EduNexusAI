import { requireRole, apiError, apiSuccess } from "@/lib/api/helpers";
import { assertSubjectAccess } from "@/lib/api/subjectAccess";
import { buildExportModel, loadManualHeader } from "@/lib/labmanual/exportShared";
import { generateLabManualDocx } from "@/lib/labmanual/docxBuilder";
import { generateLabManualPdf } from "@/lib/labmanual/pdfBuilder";
import {
  type ExportFormat,
  type ExportVariant,
  type LabManualDoc,
} from "@/lib/labmanual/types";
import type { NextRequest } from "next/server";

const DOCX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const SIGNED_URL_TTL = 3600;

const VARIANTS: ExportVariant[] = ["student", "instructor", "solutions"];

/** {variant}_{format}_path column name (§5). */
function pathColumn(variant: ExportVariant, format: ExportFormat): string {
  return `${variant}_${format}_path`;
}

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireRole(["faculty", "superadmin", "dean", "hod"]);
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

    const format = String(body.format ?? "") as ExportFormat;
    if (format !== "docx" && format !== "pdf") {
      return apiError("format must be 'docx' or 'pdf'", 400);
    }

    const variant = String(body.variant ?? "") as ExportVariant;
    if (!VARIANTS.includes(variant)) {
      return apiError("variant must be student, instructor, or solutions", 400);
    }

    // scope: "all" or a single practical number
    const rawScope = body.scope;
    const scope: "all" | number =
      rawScope === "all" || rawScope === undefined
        ? "all"
        : Math.trunc(Number(rawScope));
    if (scope !== "all" && !Number.isFinite(scope)) {
      return apiError("scope must be 'all' or a practical number", 400);
    }

    const denied = await assertSubjectAccess(adminClient, profile.role, user.id, subjectId);
    if (denied) return denied;

    // ── Load the caller's manual ────────────────────────────────────────────
    const { data: manualRow } = await adminClient
      .from("lab_manuals")
      .select("id, doc")
      .eq("subject_id", subjectId)
      .eq("faculty_id", user.id)
      .maybeSingle();
    if (!manualRow) {
      return apiError("No lab manual to export — generate and save one first", 404);
    }
    const row = manualRow as { id: string; doc: LabManualDoc };
    const doc = row.doc;
    const states = doc.practicalStates ?? {};

    const targetSections =
      scope === "all"
        ? doc.sections
        : doc.sections.filter((s) => s.practicalNo === scope);
    if (targetSections.length === 0) {
      return apiError(
        scope === "all"
          ? "This manual has no generated practicals yet"
          : `Practical #${scope} has not been generated`,
        400,
      );
    }

    // ── Reviewed gate (identical for all variants, spec §5) ─────────────────
    const unreviewed = targetSections.filter(
      (s) => states[s.practicalNo]?.reviewed !== true,
    );
    if (unreviewed.length > 0) {
      return apiSuccess(
        {
          error:
            scope === "all"
              ? "Every practical must be reviewed before exporting"
              : `Practical #${scope} must be reviewed before exporting`,
          unreviewed: unreviewed.map((s) => `#${s.practicalNo} ${s.title}`),
        },
        422,
      );
    }

    // ── Build the artifact ──────────────────────────────────────────────────
    const header = await loadManualHeader(subjectId, user.id);
    let model;
    try {
      model = buildExportModel(doc, header, variant, scope);
    } catch (buildErr) {
      // assertNoFacultyLeak throws here — a genuine safety stop, surfaced as 500.
      console.error(
        "[labmanual export] model build failed:",
        buildErr instanceof Error ? buildErr.message : buildErr,
      );
      return apiError(
        buildErr instanceof Error && buildErr.message.includes("leaked")
          ? "Export blocked: a faculty-only block would have leaked into the student manual."
          : "Failed to assemble the document",
        500,
      );
    }

    const ext = format;
    const contentType = format === "docx" ? DOCX_CONTENT_TYPE : "application/pdf";
    let buffer: Buffer;
    try {
      buffer =
        format === "docx"
          ? await generateLabManualDocx(model)
          : await generateLabManualPdf(model);
    } catch (renderErr) {
      console.error(
        "[labmanual export] render failed:",
        renderErr instanceof Error ? renderErr.message : renderErr,
      );
      return apiError("Failed to build the document", 500);
    }

    // ── Upload to the PRIVATE bucket ({faculty_id}/ path, spec §19) ─────────
    const filePath = `${user.id}/${model.filename}_${Date.now()}.${ext}`;
    const { error: uploadError } = await adminClient.storage
      .from("lab-manuals")
      .upload(filePath, buffer, { contentType, upsert: true });
    if (uploadError) {
      console.error("[labmanual export] upload failed:", uploadError.message);
      return apiError("Failed to upload the document", 500);
    }

    // ── Persist the path (whole-manual only) + finalize ─────────────────────
    // Single-practical exports return the signed URL WITHOUT storing a path (§5).
    if (scope === "all") {
      const update: Record<string, string> = {
        [pathColumn(variant, format)]: filePath,
      };
      // status='finalized' only when the whole STUDENT manual is exported (§5).
      if (variant === "student") update.status = "finalized";
      await adminClient.from("lab_manuals").update(update).eq("id", row.id);
    }

    const { data: signed, error: signError } = await adminClient.storage
      .from("lab-manuals")
      .createSignedUrl(filePath, SIGNED_URL_TTL, {
        download: `${model.filename}.${ext}`,
      });
    if (signError || !signed) {
      console.error("[labmanual export] sign failed:", signError?.message);
      return apiError("Failed to create a download link", 500);
    }

    return apiSuccess({ url: signed.signedUrl, path: filePath, variant, format, scope });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    console.error("[labmanual export] error:", message);
    return apiError("Failed to export lab manual", 500);
  }
}
