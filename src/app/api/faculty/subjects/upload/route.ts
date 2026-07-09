import type { NextRequest } from "next/server";
import { apiError, requireRole } from "@/lib/api/helpers";
import { extractSyllabusFromPdf } from "@/lib/syllabus/extract";
import { persistSyllabusAndClassify } from "@/lib/syllabus/persistAndClassify";

const SUBJECT_CAP = 5;

// Fixed, hidden metadata for this single-department pilot — never shown to or entered
// by faculty. Exact strings must match every existing subject row (see seed_cse_sem1_4).
const FIXED_DEPARTMENT = "Engineering";
const FIXED_BRANCH = "Computer Science and Engineering";
const FIXED_SEMESTER = 1;

/**
 * POST /api/faculty/subjects/upload
 *
 * Core faculty self-serve route. multipart/form-data: file (PDF), code, name (name
 * only required when code doesn't match an existing subject).
 *
 * Two outcomes, distinguishable by the `status` field in the response:
 *  - "assigned_existing": the code already existed; faculty were attached directly,
 *    no extraction happened.
 *  - "added_new": a brand-new subject was created, its syllabus extracted, modules +
 *    COs persisted and classified.
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireRole(["faculty"]);
    if (authResult instanceof Response) return authResult;
    const { user, adminClient } = authResult;
    const facultyEmail = user.email ?? "";

    // ── a. CAP CHECK FIRST, before extracting or creating anything ──────────────
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

    const formData = await request.formData();
    // Normalize: trim + uppercase code consistently for every lookup and insert, so
    // near-duplicate rows can't be created by casing/whitespace alone.
    const code = String(formData.get("code") ?? "").trim().toUpperCase();
    const name = String(formData.get("name") ?? "").trim();
    const pdf = formData.get("file") as File | null;

    if (!code) return apiError("A subject code is required", 400);

    // ── b. Look up existing subject by code (case-insensitive, trimmed) ─────────
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
        existingSubject as { id: string; code: string; name: string }
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

    // ── c. Create the subject row ───────────────────────────────────────────────
    const { data: created, error: createErr } = await adminClient
      .from("subjects")
      .insert({
        name,
        code,
        department: FIXED_DEPARTMENT,
        branch: FIXED_BRANCH,
        semester: FIXED_SEMESTER,
        created_by: user.id,
      })
      .select("id, code, name")
      .single();

    if (createErr || !created) {
      // Edge case 1: two faculty racing to create the same new code. code is UNIQUE,
      // so the loser's insert fails — fall back to the assigned_existing path rather
      // than erroring the person out with a raw DB error.
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
            raced as { id: string; code: string; name: string }
          );
        }
      }
      return apiError(createErr?.message ?? "Failed to create subject", 500);
    }

    const newSubjectId = (created as { id: string }).id;

    // ── d + e. Extract, then persist + classify. On ANY failure here the subject
    // row from step c already exists; roll it back (delete) so we never leave an
    // orphaned subject with no modules and no assignment. modules/exam_scheme/etc.
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

    // ── f. Assign this faculty to the new subject ───────────────────────────────
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

    // ── g. Audit log ────────────────────────────────────────────────────────────
    await adminClient.from("subject_change_log").insert({
      faculty_id: user.id,
      faculty_email_snapshot: facultyEmail,
      subject_id: newSubjectId,
      subject_code_snapshot: code,
      subject_name_snapshot: name,
      action: "added_new",
    });

    // ── h. Hand back the id so the frontend can redirect into /faculty/syllabus ──
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
 * Attach a faculty member to an already-existing subject (the assigned_existing path).
 * No extraction, no new subject row. Idempotent: if they're already attached we just
 * return the subject id so the frontend can redirect them into it.
 */
async function attachToExisting(
  adminClient: Parameters<typeof persistSyllabusAndClassify>[0],
  facultyId: string,
  facultyEmail: string,
  subject: { id: string; code: string; name: string }
): Promise<Response> {
  const { data: alreadyAssigned } = await adminClient
    .from("faculty_assignments")
    .select("id")
    .eq("faculty_id", facultyId)
    .eq("subject_id", subject.id)
    .maybeSingle();

  if (!alreadyAssigned) {
    const { error: assignErr } = await adminClient
      .from("faculty_assignments")
      .insert({
        faculty_id: facultyId,
        subject_id: subject.id,
        assigned_by: facultyId,
      });
    if (assignErr) return apiError(assignErr.message, 500);

    await adminClient.from("subject_change_log").insert({
      faculty_id: facultyId,
      faculty_email_snapshot: facultyEmail,
      subject_id: subject.id,
      subject_code_snapshot: subject.code,
      subject_name_snapshot: subject.name,
      action: "assigned_existing",
    });
  }

  return Response.json({
    status: "assigned_existing",
    subject_id: subject.id,
    code: subject.code,
    name: subject.name,
    alreadyInList: Boolean(alreadyAssigned),
  });
}
