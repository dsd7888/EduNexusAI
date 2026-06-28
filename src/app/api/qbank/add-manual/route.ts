import { requireRole, apiError } from "@/lib/api/helpers";
import { rowToBankQuestion, type FqbRow } from "@/lib/qbank/row";
import {
  uploadQuestionImage,
  createQuestionImageSignedUrl,
  resolveImageExt,
} from "@/lib/qbank/image-storage";
import { routeAI } from "@/lib/ai/router";
import type { MCQOption } from "@/lib/qbank/types";
import type { NextRequest } from "next/server";

const VALID_TYPES = new Set([
  "mcq",
  "short_answer",
  "long_answer",
  "numerical",
  "fill_blank",
]);
const VALID_DIFFICULTY = new Set(["easy", "medium", "hard"]);
const VALID_OPT_LABELS = new Set(["A", "B", "C", "D"]);
// Server-side cap mirrors the client-side 5 MB limit.
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
// Signed URL TTL for the newly-created question returned in the response.
const SIGNED_URL_TTL = 3600;

const IMAGE_QUESTION_SYSTEM_PROMPT =
  "You are an expert question setter for Indian engineering university examinations. " +
  "You are given an image by a faculty member and must write a question that can ONLY be answered " +
  "by genuinely examining it — referencing a specific labeled component, a particular value shown " +
  "on a graph, a concrete step illustrated in a diagram, or other content uniquely visible in the " +
  "image. Do NOT write a generic question that could appear without the image. The student must " +
  "actually look at what is shown to answer correctly.";

function buildImageQuestionSchema(questionType: string): object {
  return {
    type: "object",
    properties: {
      question_text: { type: "string" },
      model_answer: { type: "string" },
      ...(questionType === "mcq"
        ? {
            options: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  label: { type: "string" },
                  text: { type: "string" },
                  is_correct: { type: "boolean" },
                },
                required: ["label", "text", "is_correct"],
              },
            },
          }
        : {}),
      co_code: { type: "string" },
      btl_level: { type: "integer" },
      difficulty: { type: "string" },
    },
    required: ["question_text", "model_answer"],
  };
}

function buildImageQuestionPrompt(params: {
  questionType: string;
  marks: number;
  subjectName: string;
  moduleName: string | null;
  moduleDescription: string | null;
  courseOutcomes: { co_code: string; description: string }[];
}): string {
  const lines: string[] = [`Subject: ${params.subjectName}`];
  if (params.moduleName) {
    lines.push(`Module: ${params.moduleName}`);
    if (params.moduleDescription) {
      lines.push(
        `Module content: ${params.moduleDescription.slice(0, 300).trim()}`
      );
    }
  }
  if (params.courseOutcomes.length > 0) {
    lines.push("Course Outcomes:");
    for (const co of params.courseOutcomes) {
      lines.push(`  ${co.co_code}: ${co.description}`);
    }
  }
  lines.push(
    "",
    `Write exactly one ${params.questionType} question worth ${params.marks} marks based on the attached image.`,
    "The question MUST directly reference what is specifically visible in the image — a labeled part, a value on a graph, a step in a diagram — not a generic question that could appear without the image.",
    params.questionType === "mcq"
      ? "Provide exactly 4 options (labels A, B, C, D), exactly one is_correct: true, with plausible distractors."
      : "Provide a detailed model answer.",
    "Assign the most relevant co_code from the list above (or null if unsure), a Bloom's Taxonomy btl_level (1-6), and a difficulty (easy/medium/hard)."
  );
  return lines.join("\n");
}

function normaliseAiOptions(raw: unknown): MCQOption[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: MCQOption[] = [];
  for (const o of raw) {
    if (!o || typeof o !== "object") continue;
    const obj = o as Record<string, unknown>;
    const label = String(obj.label ?? "").toUpperCase().trim();
    const text = String(obj.text ?? "").trim();
    if (!VALID_OPT_LABELS.has(label) || !text) continue;
    out.push({
      label: label as MCQOption["label"],
      text,
      is_correct: Boolean(obj.is_correct),
    });
  }
  return out.length > 0 ? out : null;
}

function normBtl(v: unknown): number | null {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const t = Math.trunc(n);
  return t >= 1 && t <= 6 ? t : null;
}

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

    // question_text may be empty when an image drives AI generation.
    const questionText =
      (body.question_text as string | undefined)?.trim() ?? "";

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
    let imageBase64: string | null = null;
    let imageMime: string | null = null;
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
      imageBase64 = body.image_base64;
      imageMime = mimeType;
      imagePath = await uploadQuestionImage(
        adminClient,
        user.id,
        body.image_base64,
        mimeType
      );
    }

    // ── Mode gate ────────────────────────────────────────────────────────────
    if (!questionText && !imagePath) {
      return apiError(
        "question_text is required when no image is attached",
        400
      );
    }

    // ── AI image generation path ─────────────────────────────────────────────
    // Triggered when question_text is empty but an image was uploaded.
    if (!questionText) {
      const [subjectRes, coRes, moduleRes] = await Promise.all([
        adminClient
          .from("subjects")
          .select("name")
          .eq("id", subjectId)
          .single(),
        adminClient
          .from("course_outcomes")
          .select("co_code, description")
          .eq("subject_id", subjectId),
        moduleId
          ? adminClient
              .from("modules")
              .select("name, description")
              .eq("id", moduleId)
              .single()
          : Promise.resolve({ data: null, error: null }),
      ]);

      if (subjectRes.error || !subjectRes.data) {
        return apiError("Subject not found", 404);
      }

      const subject = subjectRes.data as { name: string };
      const courseOutcomes = (coRes.data ?? []) as {
        co_code: string;
        description: string;
      }[];
      const moduleData = moduleRes.data as {
        name: string;
        description: string | null;
      } | null;

      const prompt = buildImageQuestionPrompt({
        questionType,
        marks,
        subjectName: subject.name,
        moduleName: moduleData?.name ?? null,
        moduleDescription: moduleData?.description ?? null,
        courseOutcomes,
      });

      const aiResult = await routeAI("qbank_image_question", {
        model: "flash",
        messages: [{ role: "user", content: prompt }],
        systemPrompt: IMAGE_QUESTION_SYSTEM_PROMPT,
        attachments: [{ mediaType: imageMime!, data: imageBase64! }],
        responseSchema: buildImageQuestionSchema(questionType),
        thinkingBudget: 0,
        temperature: 0.6,
        maxTokens: 2048,
      });

      let aiQuestion: {
        question_text?: string;
        model_answer?: string;
        options?: unknown;
        co_code?: string;
        btl_level?: unknown;
        difficulty?: string;
      };
      try {
        aiQuestion = JSON.parse(aiResult.content) as typeof aiQuestion;
      } catch {
        console.error(
          "[qbank add-manual] AI image parse failed:",
          aiResult.content.slice(0, 200)
        );
        return apiError(
          "AI failed to generate a valid question from the image",
          502
        );
      }

      const aiText = aiQuestion.question_text?.trim();
      if (!aiText) {
        return apiError("AI returned an empty question", 502);
      }

      // Faculty-provided tags override AI's inferred ones.
      const finalCoCode = coCode ?? (aiQuestion.co_code?.trim() || null);
      const finalBtlLevel = btlLevel ?? normBtl(aiQuestion.btl_level);
      const finalDifficulty =
        difficulty ??
        (VALID_DIFFICULTY.has(aiQuestion.difficulty ?? "")
          ? (aiQuestion.difficulty as "easy" | "medium" | "hard")
          : null);
      const finalOptions =
        questionType === "mcq" ? normaliseAiOptions(aiQuestion.options) : null;

      const { data: inserted, error: insertError } = await adminClient
        .from("faculty_question_bank")
        .insert({
          subject_id: subjectId,
          faculty_id: user.id,
          module_id: moduleId,
          question_text: aiText,
          question_type: questionType,
          marks,
          model_answer: aiQuestion.model_answer?.trim() || null,
          options: finalOptions,
          co_code: finalCoCode,
          btl_level: finalBtlLevel,
          difficulty: finalDifficulty,
          source: "ai_generated",
          is_verified: false,
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
    }

    // ── Normal faculty-authored path ─────────────────────────────────────────
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
