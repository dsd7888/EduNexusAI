import { requireRole, apiError } from "@/lib/api/helpers";
import { rowToBankQuestion, type FqbRow } from "@/lib/qbank/row";
import {
  uploadQuestionImage,
  createQuestionImageSignedUrl,
  resolveImageExt,
} from "@/lib/qbank/image-storage";
import { tagQuestions } from "@/lib/qbank/tagger";
import type { MCQOption, QuestionSource, QuestionType } from "@/lib/qbank/types";
import type { NextRequest } from "next/server";

const VALID_TYPES = new Set([
  "mcq",
  "short_answer",
  "long_answer",
  "numerical",
  "fill_blank",
]);
const VALID_DIFFICULTY = new Set(["easy", "medium", "hard"]);
const VALID_SOURCES = new Set<QuestionSource>([
  "ai_generated",
  "faculty_imported",
  "pyq_inspired",
]);
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

    // ── Required fields ──────────────────────────────────────────────────────
    const subjectId = (body.subject_id as string | undefined)?.trim();
    if (!subjectId) return apiError("subject_id is required", 400);

    const questionText =
      (body.question_text as string | undefined)?.trim() ?? "";
    if (!questionText) {
      return apiError("question_text is required", 400);
    }

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
        ? (body.options as MCQOption[])
        : null;
    const modelAnswer =
      typeof body.model_answer === "string"
        ? body.model_answer.trim() || null
        : null;
    const source: QuestionSource =
      typeof body.source === "string" && VALID_SOURCES.has(body.source as QuestionSource)
        ? (body.source as QuestionSource)
        : "faculty_imported";

    // ── Image: accept a pre-uploaded path from draft-image OR a direct upload ─
    let imagePath: string | null = null;
    if (
      typeof body.image_path === "string" &&
      body.image_path.length > 0
    ) {
      // Pre-uploaded by draft-image — skip re-upload.
      imagePath = body.image_path;
    } else if (
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
    }

    // ── Auto-tag missing CO / BTL via AI (same path as CSV import) ────────────
    let finalCoCode = coCode;
    let finalBtlLevel = btlLevel;
    let finalDifficulty = difficulty;
    const needsTagging = !coCode || btlLevel == null;

    if (needsTagging) {
      const [subjectRes, moduleRows, coRows] = await Promise.all([
        adminClient.from("subjects").select("name").eq("id", subjectId).single(),
        adminClient
          .from("modules")
          .select("id, name, description")
          .eq("subject_id", subjectId)
          .order("module_number"),
        adminClient
          .from("course_outcomes")
          .select("co_code, description")
          .eq("subject_id", subjectId),
      ]);

      if (!subjectRes.error && subjectRes.data) {
        const modules = (moduleRows.data ?? []) as {
          id: string;
          name: string;
          description: string | null;
        }[];
        const tagged = await tagQuestions(
          [{ question_text: questionText, question_type: questionType as QuestionType, marks }],
          {
            subject_name: (subjectRes.data as { name: string }).name,
            modules: modules.map((m) => ({
              id: m.id,
              name: m.name,
              description: m.description ?? "",
            })),
            course_outcomes: (coRows.data ?? []) as {
              co_code: string;
              description: string;
            }[],
          }
        );
        if (tagged.length > 0) {
          finalCoCode = coCode ?? tagged[0].inferred_co_code;
          finalBtlLevel = btlLevel ?? tagged[0].inferred_btl_level;
          finalDifficulty =
            difficulty ?? tagged[0].inferred_difficulty ?? null;
        }
      }
    }

    // is_verified only when faculty explicitly supplied both CO and BTL (not AI-inferred).
    const isVerified =
      source !== "ai_generated" && Boolean(coCode) && btlLevel != null;

    const { data: inserted, error: insertError } = await adminClient
      .from("faculty_question_bank")
      .insert({
        subject_id: subjectId,
        faculty_id: user.id,
        module_id: moduleId,
        question_text: questionText,
        question_type: questionType,
        marks,
        model_answer: modelAnswer,
        options: options ?? null,
        co_code: finalCoCode,
        btl_level: finalBtlLevel,
        difficulty: finalDifficulty,
        source,
        is_verified: isVerified,
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
