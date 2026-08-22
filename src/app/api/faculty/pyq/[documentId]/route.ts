/**
 * DELETE /api/faculty/pyq/[documentId]
 *
 * Remove one uploaded past paper. Deleting the `documents` row cascades to
 * `pyq_questions` (FK ON DELETE CASCADE), so the extracted questions go with
 * it and coverage recomputes correctly on the next read.
 *
 * WHO MAY DELETE: the uploader, or a superadmin/dean/hod. Deliberately NOT
 * "anyone assigned to the subject" — past papers are shared subject content, so
 * a co-teacher removing another faculty's upload would silently degrade a paper
 * generator they don't own. Read-shared, delete-owned.
 *
 * The Storage object is removed after the row. If that call fails the row is
 * already gone, which is the right way round: an orphaned PDF in a bucket is
 * inert, whereas a `documents` row pointing at a deleted object would surface
 * as a broken paper in the list.
 */
import type { NextRequest } from "next/server";
import { apiError, apiSuccess, isUuid, requireRole } from "@/lib/api/helpers";
import { computePyqCoverage } from "@/lib/pyq/coverage";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ documentId: string }> }
) {
  try {
    const authResult = await requireRole(["faculty", "superadmin", "dean", "hod"]);
    if (authResult instanceof Response) return authResult;
    const { user, profile, adminClient } = authResult;

    const { documentId } = await params;
    if (!documentId || !isUuid(documentId)) {
      return apiError("A valid document id is required", 400);
    }

    const { data: doc } = await adminClient
      .from("documents")
      .select("id, type, subject_id, file_path, uploaded_by")
      .eq("id", documentId)
      .maybeSingle();

    if (!doc) return apiError("Paper not found", 404);

    const document = doc as {
      id: string;
      type: string;
      subject_id: string;
      file_path: string;
      uploaded_by: string;
    };

    if (document.type !== "pyq") {
      return apiError("That document is not a past paper", 400);
    }

    if (profile.role === "faculty" && document.uploaded_by !== user.id) {
      return apiError(
        "Only the faculty member who uploaded this paper can remove it",
        403
      );
    }

    const { error: deleteError } = await adminClient
      .from("documents")
      .delete()
      .eq("id", documentId);
    if (deleteError) return apiError(deleteError.message, 500);

    // Best-effort — see the header note on ordering.
    const { error: storageError } = await adminClient.storage
      .from("documents")
      .remove([document.file_path]);
    if (storageError) {
      console.warn(
        `[faculty/pyq/delete] row deleted but storage object remains: ${storageError.message}`
      );
    }

    const coverage = await computePyqCoverage(adminClient, document.subject_id);
    return apiSuccess({ deleted: documentId, coverage });
  } catch (err) {
    console.error("[faculty/pyq/delete]", err);
    return apiError("Failed to remove the paper", 500);
  }
}
