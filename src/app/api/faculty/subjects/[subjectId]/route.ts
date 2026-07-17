import type { NextRequest } from "next/server";
import { apiError, requireRole } from "@/lib/api/helpers";

interface RouteContext {
  params: Promise<{ subjectId: string }>;
}

/**
 * DELETE /api/faculty/subjects/[subjectId]
 *
 * Removes ONLY this faculty's own faculty_assignments row for the subject. It NEVER
 * deletes the subjects/modules/course_outcomes/exam_scheme rows — other faculty may
 * share the exact same subject (the assigned_existing path lets multiple faculty point
 * at one subject_id), and even an orphaned subject stays available via the catalog.
 */
export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  try {
    const authResult = await requireRole(["faculty"]);
    if (authResult instanceof Response) return authResult;
    const { user, adminClient } = authResult;

    const { subjectId } = await params;
    if (!subjectId) return apiError("subjectId is required", 400);

    // Only proceed if this faculty actually has this assignment.
    const { data: assignment } = await adminClient
      .from("faculty_assignments")
      .select("id")
      .eq("faculty_id", user.id)
      .eq("subject_id", subjectId)
      .maybeSingle();

    if (!assignment) {
      return apiError("This subject isn't in your list", 404);
    }

    // Snapshot the subject's code/name BEFORE deleting, for the log — the snapshot
    // must not depend on the subject still existing later (someone else could delete
    // the underlying subject entirely, unrelated to this action).
    const { data: subject } = await adminClient
      .from("subjects")
      .select("code, name")
      .eq("id", subjectId)
      .maybeSingle();

    // Remove this faculty's OWN links to the subject, at both levels:
    //  1. faculty_assignments (content access).
    //  2. faculty_offerings for every offering of this subject (the branch/semester
    //     links). Removing a subject from your list drops all branches you taught it
    //     in. Never touches the subject/offering rows themselves — other faculty and
    //     the offerings persist.
    const { data: offeringRows } = await adminClient
      .from("subject_offerings")
      .select("id")
      .eq("subject_id", subjectId);
    const offeringIds = (offeringRows ?? []).map((o: { id: string }) => o.id);
    if (offeringIds.length > 0) {
      const { error: facOfferingDelErr } = await adminClient
        .from("faculty_offerings")
        .delete()
        .eq("faculty_id", user.id)
        .in("subject_offering_id", offeringIds);
      if (facOfferingDelErr) return apiError(facOfferingDelErr.message, 500);
    }

    const { error: delErr } = await adminClient
      .from("faculty_assignments")
      .delete()
      .eq("faculty_id", user.id)
      .eq("subject_id", subjectId);
    if (delErr) return apiError(delErr.message, 500);

    await adminClient.from("subject_change_log").insert({
      faculty_id: user.id,
      faculty_email_snapshot: user.email ?? "",
      subject_id: subjectId,
      subject_code_snapshot: (subject as { code?: string } | null)?.code ?? "(unknown)",
      subject_name_snapshot: (subject as { name?: string } | null)?.name ?? "(unknown)",
      action: "removed",
    });

    return Response.json({ removed: true });
  } catch (err) {
    console.error("[faculty/subjects/[subjectId]] DELETE error:", err);
    const message = err instanceof Error ? err.message : "Failed to remove subject";
    return apiError(message, 500);
  }
}
