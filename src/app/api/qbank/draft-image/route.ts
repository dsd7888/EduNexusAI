import { requireRole, apiError } from "@/lib/api/helpers";
import {
  uploadQuestionImage,
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
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const IMAGE_QUESTION_SYSTEM_PROMPT =
  "You are an expert question setter for Indian engineering university examinations. " +
  "You are given an image by a faculty member and must write a question that can ONLY be answered " +
  "by genuinely examining it — referencing a specific labeled component, a particular value shown " +
  "on a graph, a concrete step illustrated in a diagram, or other content uniquely visible in the " +
  "image. Do NOT write a generic question that could appear without the image. The student must " +
  "actually look at what is shown to answer correctly. " +
  "When assigning a CO code, always pick the NEAREST match from the provided list — never return null. " +
  "Every image-based question maps to some CO; if the fit is not perfect, pick the closest one, " +
  "because the content is taught in this course and carries weightage either way.";

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
    required: ["question_text", "model_answer", "co_code", "btl_level", "difficulty"],
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
    "Assign the CLOSEST co_code from the list above — always pick one, never return null. The content is taught in this course so every question maps to some CO even if the fit is not perfect.",
    "Also assign a Bloom's Taxonomy btl_level (1-6) and a difficulty (easy/medium/hard)."
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

    const subjectId = (body.subject_id as string | undefined)?.trim();
    if (!subjectId) return apiError("subject_id is required", 400);

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

    const moduleId =
      typeof body.module_id === "string"
        ? body.module_id.trim() || null
        : null;

    if (
      typeof body.image_base64 !== "string" ||
      body.image_base64.length === 0 ||
      typeof body.image_mime !== "string"
    ) {
      return apiError("image_base64 and image_mime are required", 400);
    }

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

    // Upload image first so draft response includes the path for the commit step.
    const imagePath = await uploadQuestionImage(
      adminClient,
      user.id,
      body.image_base64,
      mimeType
    );

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
      attachments: [{ mediaType: mimeType, data: body.image_base64 }],
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
        "[qbank draft-image] AI parse failed:",
        aiResult.content.slice(0, 200)
      );
      return apiError("AI failed to generate a valid question from the image", 502);
    }

    const aiText = aiQuestion.question_text?.trim();
    if (!aiText) {
      return apiError("AI returned an empty question", 502);
    }

    return Response.json({
      image_path: imagePath,
      question_text: aiText,
      options:
        questionType === "mcq" ? normaliseAiOptions(aiQuestion.options) : null,
      model_answer: aiQuestion.model_answer?.trim() || null,
      co_code: aiQuestion.co_code?.trim() || null,
      btl_level: normBtl(aiQuestion.btl_level),
      difficulty: VALID_DIFFICULTY.has(aiQuestion.difficulty ?? "")
        ? (aiQuestion.difficulty as "easy" | "medium" | "hard")
        : null,
    });
  } catch (err) {
    console.error("[qbank draft-image] Error:", err);
    const message = err instanceof Error ? err.message : "Failed to generate draft";
    return apiError(message, 500);
  }
}
