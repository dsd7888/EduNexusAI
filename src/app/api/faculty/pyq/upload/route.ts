/**
 * POST /api/faculty/pyq/upload
 *
 * Faculty-facing past-paper upload. multipart/form-data: subject_id, year,
 * exam_type, file (PDF). One file per request — the client uploads a multi-file
 * drop sequentially so each paper gets its own extraction receipt and one bad
 * PDF can't fail the batch.
 *
 * Mirrors the superadmin path in /api/upload (type="pyq") exactly — same
 * storage layout, same `documents` row shape, same shared extractor in
 * src/lib/pyq/extract.ts — and adds the two things the superadmin route has no
 * need for:
 *
 *  - an ASSIGNMENT CHECK. Faculty may only upload against subjects in their
 *    faculty_assignments; dean/hod/superadmin bypass it, matching every other
 *    faculty-tier route.
 *  - an EXTRACTION RECEIPT in the response. The superadmin route returns a bare
 *    count; faculty need to SEE what the AI read back (questions found, CO
 *    coverage, the gaps) or the upload is a black hole and they never do it a
 *    second time. That's the whole adoption mechanic.
 *
 * NO APPROVAL QUEUE, deliberately: papers land live. Faculty are uploading
 * their own department's papers, and a queue in a solo-operator pilot means
 * uploads sit unprocessed behind one person.
 *
 * Storage writes go through the service-role client rather than the caller's
 * session client, because the `documents` bucket carries no faculty-scoped
 * INSERT policy — the assignment check above is the authorization boundary.
 */
import type { NextRequest } from "next/server";
import { apiError, apiSuccess, isUuid, requireRole, logCappedError } from "@/lib/api/helpers";
import { extractAndSavePyqQuestions } from "@/lib/pyq/extract";
import { computePyqCoverage, isExamType } from "@/lib/pyq/coverage";
import { isMissingColumnError } from "@/lib/pyq/co";

// Matches the CHECK constraint in the initial schema (documents_year_pyq) and
// the superadmin upload form's range.
const MIN_YEAR = 2015;
const MAX_YEAR = new Date().getFullYear() + 1;

// Exam papers are a handful of pages. A cap keeps a mis-drop (a scanned
// textbook) from burning a Pro-sized attachment through the extractor.
const MAX_BYTES = 15 * 1024 * 1024;

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireRole(["faculty", "superadmin", "dean", "hod"]);
    if (authResult instanceof Response) return authResult;
    const { user, profile, adminClient } = authResult;

    const formData = await request.formData();
    const subjectId = String(formData.get("subject_id") ?? "").trim();
    const yearRaw = String(formData.get("year") ?? "").trim();
    const examTypeRaw = String(formData.get("exam_type") ?? "").trim();
    const file = formData.get("file") as File | null;

    if (!subjectId || !isUuid(subjectId)) {
      return apiError("A valid subject is required", 400);
    }

    const year = Number(yearRaw);
    if (!yearRaw || !Number.isInteger(year) || year < MIN_YEAR || year > MAX_YEAR) {
      return apiError(`Select a year between ${MIN_YEAR} and ${MAX_YEAR}`, 400);
    }

    // exam_type is optional — a faculty who doesn't know (or a paper that isn't
    // one of the four) stores null rather than being blocked at the door.
    const examType = isExamType(examTypeRaw) ? examTypeRaw : null;

    if (!file || !(file instanceof File) || file.size === 0) {
      return apiError("A PDF file is required", 400);
    }
    if (file.type !== "application/pdf") {
      return apiError("Only PDF files are accepted", 400);
    }
    if (file.size > MAX_BYTES) {
      return apiError("That PDF is larger than 15 MB — is it a scanned paper?", 400);
    }

    // ── Ownership check ───────────────────────────────────────────────────
    if (profile.role === "faculty") {
      const { data: assignment } = await adminClient
        .from("faculty_assignments")
        .select("subject_id")
        .eq("faculty_id", user.id)
        .eq("subject_id", subjectId)
        .maybeSingle();
      if (!assignment) {
        return apiError("Forbidden: subject is not assigned to this faculty", 403);
      }
    }

    const { data: subject } = await adminClient
      .from("subjects")
      .select("id, code")
      .eq("id", subjectId)
      .maybeSingle();
    if (!subject) return apiError("Subject not found", 404);
    const subjectCode = (subject as { code: string }).code ?? "unknown";

    // ── Store the PDF ─────────────────────────────────────────────────────
    // Same `pyq/{subjectId}/{filename}` layout the superadmin route writes, so
    // both sources are indistinguishable to anything reading Storage.
    const buffer = Buffer.from(await file.arrayBuffer());
    const filePath = `pyq/${subjectId}/pyq_${subjectCode}_${Date.now()}.pdf`;

    const { error: uploadError } = await adminClient.storage
      .from("documents")
      .upload(filePath, buffer, {
        contentType: "application/pdf",
        upsert: false,
      });
    if (uploadError) {
      return apiError(`Upload failed: ${uploadError.message}`, 500);
    }

    // exam_type may not exist yet if migration 20260822000000 has not been
    // applied to this environment — retry without it rather than failing the
    // upload. See isMissingColumnError.
    const baseRow = {
      type: "pyq",
      subject_id: subjectId,
      module_id: null,
      year,
      title: file.name,
      file_path: filePath,
      uploaded_by: user.id,
      status: "processing",
    };

    let { data: document, error: dbError } = await adminClient
      .from("documents")
      .insert({ ...baseRow, exam_type: examType })
      .select("id")
      .single();

    if (dbError && isMissingColumnError(dbError)) {
      console.warn(
        "[faculty/pyq/upload] documents.exam_type missing — " +
          "retrying without it (apply migration 20260822000000)"
      );
      ({ data: document, error: dbError } = await adminClient
        .from("documents")
        .insert(baseRow)
        .select("id")
        .single());
    }

    if (dbError || !document) {
      // Roll the object back so a failed insert leaves no orphan in Storage.
      await adminClient.storage.from("documents").remove([filePath]);
      return apiError(`Database error: ${dbError?.message ?? "insert failed"}`, 500);
    }

    const documentId = (document as { id: string }).id;

    // ── Extract ───────────────────────────────────────────────────────────
    // Never throws (see extract.ts). A zero-question result still leaves the
    // paper uploaded and readable — the response tells the faculty plainly that
    // nothing was parsed rather than silently reporting success.
    const result = await extractAndSavePyqQuestions(adminClient, {
      documentId,
      subjectId,
      year,
      pdfBase64: buffer.toString("base64"),
      logContext: {
        userId: user.id,
        userEmail: user.email ?? null,
        userRole: profile.role,
        subjectId,
        subjectCode,
        jobId: crypto.randomUUID(),
        relatedContentId: null,
        feature: "pyq_extraction",
      },
    });

    await adminClient
      .from("documents")
      .update({ status: result.count > 0 ? "ready" : "failed" })
      .eq("id", documentId);

    // Coverage is computed AFTER the write so the receipt shows the subject's
    // new state, which is what the "upload another year" prompt keys off.
    const coverage = await computePyqCoverage(adminClient, subjectId);

    return apiSuccess({
      document_id: documentId,
      title: file.name,
      year,
      exam_type: examType,
      extracted_count: result.count,
      extraction_error: result.error,
      coverage,
    });
  } catch (err) {
    logCappedError("[faculty/pyq/upload]", err, {
      route: "/api/faculty/pyq/upload",
      httpMethod: "POST",
    });
    return apiError(
      err instanceof Error ? err.message : "Upload failed",
      500
    );
  }
}
