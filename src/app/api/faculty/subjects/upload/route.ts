import type { NextRequest } from "next/server";
import { apiError, requireRole } from "@/lib/api/helpers";
import { extractSyllabusFromPdf } from "@/lib/syllabus/extract";
import { persistSyllabusAndClassify } from "@/lib/syllabus/persistAndClassify";
import { isValidBranch, isValidSemester } from "@/lib/constants/branches";

const SUBJECT_CAP = 5;

// Department is still a true pilot-wide invariant (single-department pilot per
// CLAUDE.md) — unlike branch/semester, faculty never pick this.
const FIXED_DEPARTMENT = "Engineering";

type AdminClient = Parameters<typeof persistSyllabusAndClassify>[0];

/**
 * POST /api/faculty/subjects/upload
 *
 * Core faculty self-serve route. multipart/form-data: file (PDF), code, name (name
 * only required when code doesn't match an existing subject), branch, semester.
 *
 * `subjects` rows are canonical CONTENT (code, name, syllabus/modules/COs), keyed by
 * globally-unique `code`. `subject_offerings` rows record which branch+semester that
 * content is taught in — the same content can have multiple offerings (e.g. the same
 * code taught to both CSE-3 and IT-3) without re-running extraction/classification.
 *
 * Two outcomes, distinguishable by the `status` field in the response:
 *  - "assigned_existing": the code already existed; faculty were attached (and/or a
 *    new offering was recorded), no extraction happened.
 *  - "added_new": a brand-new subject was created, its syllabus extracted, modules +
 *    COs persisted and classified.
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireRole(["faculty"]);
    if (authResult instanceof Response) return authResult;
    const { user, adminClient } = authResult;
    const facultyEmail = user.email ?? "";

    const formData = await request.formData();
    // Normalize: trim + uppercase code consistently for every lookup and insert, so
    // near-duplicate rows can't be created by casing/whitespace alone.
    const code = String(formData.get("code") ?? "").trim().toUpperCase();
    const name = String(formData.get("name") ?? "").trim();
    const branch = String(formData.get("branch") ?? "").trim().toUpperCase();
    const semesterRaw = formData.get("semester");
    const semester = Number(String(semesterRaw ?? ""));
    const pdf = formData.get("file") as File | null;

    if (!code) return apiError("A subject code is required", 400);
    if (!isValidBranch(branch)) return apiError("Select a valid branch", 400);
    if (!isValidSemester(semester)) return apiError("Select a valid semester", 400);

    // ── Look up existing subject by code (case-insensitive, trimmed) ────────────
    const { data: existingSubject } = await adminClient
      .from("subjects")
      .select("id, code, name")
      .ilike("code", code)
      .maybeSingle();

    if (existingSubject) {
      return attachToExisting(
        adminClient,
        user.id,
        facultyEmail,
        existingSubject as { id: string; code: string; name: string },
        branch,
        semester
      );
    }

    // ── New-subject path: name + PDF are required ───────────────────────────────
    if (!name) return apiError("A subject name is required for a new subject", 400);
    if (!pdf || !(pdf instanceof File) || pdf.size === 0) {
      return apiError("A syllabus PDF is required for a new subject", 400);
    }
    if (pdf.type !== "application/pdf") {
      return apiError("Only PDF files are accepted", 400);
    }

    // ── Cap check — this path always creates a brand-new assignment, so check now,
    // before extracting or creating anything ────────────────────────────────────
    const { count: currentCount, error: countErr } = await adminClient
      .from("faculty_assignments")
      .select("id", { count: "exact", head: true })
      .eq("faculty_id", user.id);
    if (countErr) return apiError(countErr.message, 500);
    if ((currentCount ?? 0) >= SUBJECT_CAP) {
      return apiError(
        `You've reached the ${SUBJECT_CAP}-subject limit for this pilot.`,
        400
      );
    }

    // ── Create the subject row ──────────────────────────────────────────────────
    const { data: created, error: createErr } = await adminClient
      .from("subjects")
      .insert({
        name,
        code,
        department: FIXED_DEPARTMENT,
        branch,
        semester,
        created_by: user.id,
      })
      .select("id, code, name")
      .single();

    if (createErr || !created) {
      // Edge case: two faculty racing to create the same new code. code is UNIQUE,
      // so the loser's insert fails — fall back to the assigned_existing path (with
      // this request's own branch/semester) rather than erroring the person out with
      // a raw DB error.
      const isUniqueViolation =
        createErr?.code === "23505" ||
        /duplicate key|unique/i.test(createErr?.message ?? "");
      if (isUniqueViolation) {
        const { data: raced } = await adminClient
          .from("subjects")
          .select("id, code, name")
          .ilike("code", code)
          .maybeSingle();
        if (raced) {
          return attachToExisting(
            adminClient,
            user.id,
            facultyEmail,
            raced as { id: string; code: string; name: string },
            branch,
            semester
          );
        }
      }
      return apiError(createErr?.message ?? "Failed to create subject", 500);
    }

    const newSubjectId = (created as { id: string }).id;

    // ── Create this subject's first offering, alongside the subject row and before
    // extraction, so a rollback below (subjects delete, ON DELETE CASCADE) cleans up
    // both in one step. Capture its id to link the faculty to this specific offering. ─
    const { data: newOffering, error: offeringErr } = await adminClient
      .from("subject_offerings")
      .insert({ subject_id: newSubjectId, branch, semester })
      .select("id")
      .single();
    if (offeringErr || !newOffering) {
      await adminClient.from("subjects").delete().eq("id", newSubjectId);
      console.error("[faculty/subjects/upload] offering insert failed, rolled back subject:", offeringErr);
      return apiError(offeringErr?.message ?? "Failed to create offering", 500);
    }
    const newOfferingId = (newOffering as { id: string }).id;

    // ── Extract, then persist + classify. On ANY failure here the subject row
    // already exists; roll it back (delete) so we never leave an orphaned subject
    // with no modules and no assignment. modules/exam_scheme/subject_offerings/etc.
    // cascade-delete with the subject row. (Chosen over "leave it": simpler to reason
    // about — a failed upload leaves zero trace, matching the qpaper convention of not
    // half-committing a generation.)
    try {
      const arrayBuffer = await pdf.arrayBuffer();
      const base64Data = Buffer.from(arrayBuffer).toString("base64");

      const { extracted } = await extractSyllabusFromPdf(base64Data, {
        userId: user.id,
        userEmail: facultyEmail || null,
        userRole: "faculty",
        subjectId: newSubjectId,
        subjectCode: code,
      });

      if (!extracted) {
        throw new Error("Failed to parse extracted syllabus");
      }

      await persistSyllabusAndClassify(adminClient, newSubjectId, extracted, {
        userId: user.id,
        userEmail: facultyEmail || null,
        userRole: "faculty",
      });
    } catch (err) {
      await adminClient.from("subjects").delete().eq("id", newSubjectId);
      console.error("[faculty/subjects/upload] extract/persist failed, rolled back subject:", err);
      return apiError(
        "We couldn't read that syllabus. Please check the PDF and try again.",
        502
      );
    }

    // ── Assign this faculty to the new subject (content access) ─────────────────
    const { error: assignErr } = await adminClient
      .from("faculty_assignments")
      .insert({
        faculty_id: user.id,
        subject_id: newSubjectId,
        assigned_by: user.id,
      });
    if (assignErr) {
      console.error("[faculty/subjects/upload] assignment insert failed:", assignErr);
      return apiError(assignErr.message, 500);
    }

    // ── Link this faculty to the specific offering they teach (the many-to-many) ─
    const { error: facOfferingErr } = await adminClient
      .from("faculty_offerings")
      .insert({
        faculty_id: user.id,
        subject_offering_id: newOfferingId,
        assigned_by: user.id,
      });
    if (facOfferingErr) {
      console.error("[faculty/subjects/upload] faculty_offering insert failed:", facOfferingErr);
      return apiError(facOfferingErr.message, 500);
    }

    // ── Audit log ────────────────────────────────────────────────────────────
    await adminClient.from("subject_change_log").insert({
      faculty_id: user.id,
      faculty_email_snapshot: facultyEmail,
      subject_id: newSubjectId,
      subject_code_snapshot: code,
      subject_name_snapshot: name,
      action: "added_new",
      metadata: { branch, semester },
    });

    // ── Hand back the id so the frontend can redirect into /faculty/syllabus ────
    return Response.json({
      status: "added_new",
      subject_id: newSubjectId,
      code,
      name,
    });
  } catch (err) {
    console.error("[faculty/subjects/upload] Error:", err);
    const message = err instanceof Error ? err.message : "Upload failed";
    return apiError(message, 500);
  }
}

/**
 * Attach a faculty member to an already-existing subject (the assigned_existing
 * path), ensuring the requested (branch, semester) offering exists. No extraction,
 * no new subject row. Idempotent on both dimensions:
 *  - faculty_assignments: if already assigned, we don't insert again (or double-count
 *    against SUBJECT_CAP).
 *  - subject_offerings: if this branch/semester combo already exists for this
 *    subject, we don't insert again — this is what lets the same syllabus content be
 *    reused across branches/semesters without re-processing.
 * A faculty already teaching this subject under one offering can still add another
 * offering (different branch/semester) for the SAME subject — that's a genuine and
 * expected case (one faculty, multiple branches), so the two checks are independent.
 */
async function attachToExisting(
  adminClient: AdminClient,
  facultyId: string,
  facultyEmail: string,
  subject: { id: string; code: string; name: string },
  branch: string,
  semester: number
): Promise<Response> {
  const { data: alreadyAssigned } = await adminClient
    .from("faculty_assignments")
    .select("id")
    .eq("faculty_id", facultyId)
    .eq("subject_id", subject.id)
    .maybeSingle();

  // Only enforce the cap when this request would actually create a new assignment —
  // adding another offering of a subject the faculty already teaches costs them no
  // extra "slot".
  if (!alreadyAssigned) {
    const { count: currentCount, error: countErr } = await adminClient
      .from("faculty_assignments")
      .select("id", { count: "exact", head: true })
      .eq("faculty_id", facultyId);
    if (countErr) return apiError(countErr.message, 500);
    if ((currentCount ?? 0) >= SUBJECT_CAP) {
      return apiError(
        `You've reached the ${SUBJECT_CAP}-subject limit for this pilot.`,
        400
      );
    }
  }

  const { data: existingOffering } = await adminClient
    .from("subject_offerings")
    .select("id")
    .eq("subject_id", subject.id)
    .eq("branch", branch)
    .eq("semester", semester)
    .maybeSingle();

  let isNewOffering = false;
  let offeringId = (existingOffering as { id: string } | null)?.id ?? null;
  if (!offeringId) {
    const { data: inserted, error: offeringErr } = await adminClient
      .from("subject_offerings")
      .insert({ subject_id: subject.id, branch, semester })
      .select("id")
      .single();
    if (offeringErr || !inserted) {
      // Race: another request created the same (subject_id, branch, semester)
      // offering concurrently. UNIQUE(subject_id, branch, semester) means the
      // loser's insert fails — re-fetch the winner's row so we still get its id.
      const isUniqueViolation =
        offeringErr?.code === "23505" ||
        /duplicate key|unique/i.test(offeringErr?.message ?? "");
      if (!isUniqueViolation) return apiError(offeringErr?.message ?? "Failed to create offering", 500);
      const { data: raced } = await adminClient
        .from("subject_offerings")
        .select("id")
        .eq("subject_id", subject.id)
        .eq("branch", branch)
        .eq("semester", semester)
        .maybeSingle();
      offeringId = (raced as { id: string } | null)?.id ?? null;
    } else {
      offeringId = (inserted as { id: string }).id;
      isNewOffering = true;
    }
  }
  if (!offeringId) return apiError("Failed to resolve offering", 500);

  let isNewAssignment = false;
  if (!alreadyAssigned) {
    const { error: assignErr } = await adminClient
      .from("faculty_assignments")
      .insert({
        faculty_id: facultyId,
        subject_id: subject.id,
        assigned_by: facultyId,
      });
    if (assignErr) return apiError(assignErr.message, 500);
    isNewAssignment = true;
  }

  // Link this faculty to the specific offering (the many-to-many). Idempotent: a
  // faculty who already teaches this exact offering isn't re-linked. This is
  // independent of the assignment check — a faculty already teaching the subject in
  // one branch legitimately gains a NEW faculty_offerings row for a second branch.
  const { data: existingFacOffering } = await adminClient
    .from("faculty_offerings")
    .select("id")
    .eq("faculty_id", facultyId)
    .eq("subject_offering_id", offeringId)
    .maybeSingle();

  let isNewFacultyOffering = false;
  if (!existingFacOffering) {
    const { error: facOfferingErr } = await adminClient
      .from("faculty_offerings")
      .insert({
        faculty_id: facultyId,
        subject_offering_id: offeringId,
        assigned_by: facultyId,
      });
    if (facOfferingErr) {
      const isUniqueViolation =
        facOfferingErr.code === "23505" ||
        /duplicate key|unique/i.test(facOfferingErr.message ?? "");
      if (!isUniqueViolation) return apiError(facOfferingErr.message, 500);
    } else {
      isNewFacultyOffering = true;
    }
  }

  if (isNewOffering || isNewAssignment || isNewFacultyOffering) {
    await adminClient.from("subject_change_log").insert({
      faculty_id: facultyId,
      faculty_email_snapshot: facultyEmail,
      subject_id: subject.id,
      subject_code_snapshot: subject.code,
      subject_name_snapshot: subject.name,
      action: "assigned_existing",
      metadata: {
        branch,
        semester,
        new_offering: isNewOffering,
        new_assignment: isNewAssignment,
        new_faculty_offering: isNewFacultyOffering,
      },
    });
  }

  return Response.json({
    status: "assigned_existing",
    subject_id: subject.id,
    code: subject.code,
    name: subject.name,
    // Two independent signals the UI needs for an accurate toast:
    //  - alreadyInList: the subject was already in this faculty's list.
    //  - newOffering:   a new branch/semester link was created for them this time.
    // (alreadyInList && !newOffering) = exact duplicate; (alreadyInList &&
    // newOffering) = added a new branch/semester to a subject they already teach.
    alreadyInList: Boolean(alreadyAssigned),
    newOffering: isNewFacultyOffering,
  });
}
