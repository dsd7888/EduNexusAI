import { requireRole, apiError } from "@/lib/api/helpers";
import { rowToBankQuestion, type FqbRow } from "@/lib/qbank/row";
import {
  uploadQuestionImage,
  createQuestionImageSignedUrl,
  resolveImageExt,
} from "@/lib/qbank/image-storage";
import type { NextRequest } from "next/server";

const VALID_TYPES = new Set([
  "mcq",
  "short_answer",
  "long_answer",
  "numerical",
  "fill_blank",
]);
const VALID_DIFFICULTY = new Set(["easy", "medium", "hard"]);
// Server-side cap mirrors the client-side 5 MB limit.
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
// Signed URL TTL for the newly-created question returned in the response.
const SIGNED_URL_TTL = 3600;

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireRole([
      "faculty",
      "superadmin",
      "dept_admin",
      "dean",
      "hod",
    ]);
    if (authResult instanceof Response) return authResult;
    const { user, adminClient } = authResult;

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return apiError("Invalid JSON body", 400);
    }

    // ── Required fields ─────────────────────────────────────────────────────
    const subjectId = (body.subject_id as string | undefined)?.trim();
    if (!subjectId) return apiError("subject_id is required", 400);

    const questionText = (body.question_text as string | undefined)?.trim();
    if (!questionText) return apiError("question_text is required", 400);

    const questionType = (body.question_type as string | undefined)?.trim();
    if (!questionType || !VALID_TYPES.has(questionType)) {
      return apiError(
        `question_type must be one of: ${[...VALID_TYPES].join(", ")}`,
        400
      );
    }

    const marks = Number(body.marks);
    if (!Number.isFinite(marks) || marks <= 0) {
      return apiError("marks must be a positive number", 400);
    }

    // ── Optional fields ──────────────────────────────────────────────────────
    const moduleId =
      typeof body.module_id === "string"
        ? body.module_id.trim() || null
        : null;
    const coCode =
      typeof body.co_code === "string" ? body.co_code.trim() || null : null;
    const btlLevel =
      typeof body.btl_level === "number" &&
      Number.isInteger(body.btl_level) &&
      body.btl_level >= 1 &&
      body.btl_level <= 6
        ? body.btl_level
        : null;
    const difficulty =
      typeof body.difficulty === "string" &&
      VALID_DIFFICULTY.has(body.difficulty)
        ? body.difficulty
        : null;
    const options =
      questionType === "mcq" && Array.isArray(body.options)
        ? body.options
        : null;

    // ── Image upload ─────────────────────────────────────────────────────────
    // Upload BEFORE inserting so we never create a row with a dangling
    // image_path whose upload never completed.
    let imagePath: string | null = null;
    if (
      typeof body.image_base64 === "string" &&
      body.image_base64.length > 0 &&
      typeof body.image_mime === "string"
    ) {
      const mimeType = body.image_mime as string;
      if (!resolveImageExt(mimeType)) {
        return apiError(
          "Unsupported image type. Allowed: image/jpeg, image/png, image/gif, image/webp",
          400
        );
      }
      const bytes = Buffer.from(body.image_base64, "base64");
      if (bytes.length > MAX_IMAGE_BYTES) {
        return apiError("Image exceeds 5 MB server limit", 400);
      }
      imagePath = await uploadQuestionImage(
        adminClient,
        user.id,
        body.image_base64,
        mimeType
      );
      // If uploadQuestionImage throws, the error propagates — we return 500 and
      // no DB row is inserted.  If the subsequent insert fails after a successful
      // upload the image will be orphaned; that is preferable to the opposite
      // (a row pointing to a path that never uploaded).
    }

    // ── Insert ────────────────────────────────────────────────────────────────
    const { data: inserted, error: insertError } = await adminClient
      .from("faculty_question_bank")
      .insert({
        subject_id: subjectId,
        faculty_id: user.id,
        module_id: moduleId,
        question_text: questionText,
        question_type: questionType,
        marks,
        options: options ?? null,
        co_code: coCode,
        btl_level: btlLevel,
        difficulty,
        source: "faculty_imported",
        is_verified: true,
        image_path: imagePath,
        usage_count: 0,
        po_codes: [],
      })
      .select("*")
      .single();

    if (insertError || !inserted) {
      console.error("[qbank add-manual] insert failed:", insertError?.message);
      return apiError("Failed to add question", 500);
    }

    const row = inserted as FqbRow;
    const question = rowToBankQuestion(row);

    // Mint a signed URL for the newly-created image so the client can display
    // it immediately without a separate list refresh.
    if (row.image_path) {
      question.image_url = await createQuestionImageSignedUrl(
        adminClient,
        row.image_path,
        SIGNED_URL_TTL
      );
    }

    return Response.json({ question }, { status: 201 });
  } catch (err) {
    console.error("[qbank add-manual] Error:", err);
    const message =
      err instanceof Error ? err.message : "Failed to add question";
    return apiError(message, 500);
  }
}
