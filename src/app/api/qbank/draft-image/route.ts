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
  "When assigning a module, first identify which module the image's content most belongs to from " +
  "the provided list, THEN choose the CO that module maps toward — pick module before CO, not independently. " +
  "Always pick the NEAREST match for both module and CO — never return null for either. " +
  "Every image-based question maps to some module and CO; if the fit is not perfect, pick the closest ones, " +
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
      module_number: { type: "integer" },
      suggested_type: {
        type: "string",
        enum: ["mcq", "short_answer", "long_answer", "numerical", "fill_blank"],
      },
    },
    required: [
      "question_text",
      "model_answer",
      "co_code",
      "btl_level",
      "difficulty",
      "module_number",
    ],
  };
}

function extractQuestionTextFromAiContent(content: string): string | null {
  const match = content.match(/"question_text"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (!match) return null;
  try {
    return (JSON.parse(`"${match[1]}"`) as string).trim() || null;
  } catch {
    return match[1].trim() || null;
  }
}

function buildImageQuestionPrompt(params: {
  questionType: string;
  marks: number;
  subjectName: string;
  modules: { id: string; name: string; description: string | null; module_number: number }[];
  courseOutcomes: { co_code: string; description: string }[];
}): string {
  const lines: string[] = [`Subject: ${params.subjectName}`];
  if (params.modules.length > 0) {
    lines.push("Modules (identify which best fits this image's content, return its module_number):");
    for (const m of params.modules) {
      const desc = m.description ? ` — ${m.description.slice(0, 200).trim()}` : "";
      lines.push(`  ${m.module_number}: ${m.name}${desc}`);
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
    `Write exactly one question worth ${params.marks} marks based on the attached image. Also suggest the most appropriate question_type using this rubric — the suggestion will override the faculty's initial selection if the content clearly fits a different type:`,
    "- mcq: best for recall, recognition, or single-concept checks where 4 plausible options can be written",
    "- short_answer: single-sentence or 2-3 line response; simple recall, identification, or single-step computation",
    "- long_answer: requires multi-step explanation, algorithm trace, derivation, proof, or 'show all steps / show your work' — if the model answer would be more than 4-5 lines, this is long_answer",
    "- numerical: purely computational, single final numeric answer, no explanation of steps required",
    "- fill_blank: a statement with a specific word/phrase missing",
    `The faculty's currently selected type is: ${params.questionType}. Override it with suggested_type only when the image/question content clearly fits a different type — don't override for stylistic preference.`,
    "The question MUST directly reference what is specifically visible in the image — a labeled part, a value on a graph, a step in a diagram — not a generic question that could appear without the image.",
    params.questionType === "mcq"
      ? "Provide exactly 4 options (labels A, B, C, D), exactly one is_correct: true, with plausible distractors."
      : "Provide a detailed model answer.",
    "First identify which module this image's content most belongs to from the list above, then choose the CO that module maps toward. Return module_number as an integer matching one of the listed modules — always pick the closest one, never return null.",
    "Assign the CLOSEST co_code from the list above — always pick one, never return null. The content is taught in this course so every question maps to some CO even if the fit is not perfect.",
    "Assign btl_level using this rule: if the question only asks to execute a known procedure on the given data (compute, identify, find a value) — that's BTL 3 (Apply). Only use BTL 4 or higher if the question requires comparing multiple approaches, justifying a choice, or breaking down why something works — not just running the procedure once. Also assign a difficulty (easy/medium/hard)."
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
    const { user, profile, adminClient } = authResult;
    const jobId = crypto.randomUUID();

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

    const [subjectRes, coRes, modulesRes] = await Promise.all([
      adminClient
        .from("subjects")
        .select("name")
        .eq("id", subjectId)
        .single(),
      adminClient
        .from("course_outcomes")
        .select("co_code, description")
        .eq("subject_id", subjectId),
      adminClient
        .from("modules")
        .select("id, name, description, module_number")
        .eq("subject_id", subjectId)
        .order("module_number"),
    ]);

    if (subjectRes.error || !subjectRes.data) {
      return apiError("Subject not found", 404);
    }

    const subject = subjectRes.data as { name: string };
    const courseOutcomes = (coRes.data ?? []) as {
      co_code: string;
      description: string;
    }[];
    const allModules = (modulesRes.data ?? []) as {
      id: string;
      name: string;
      description: string | null;
      module_number: number;
    }[];

    const prompt = buildImageQuestionPrompt({
      questionType,
      marks,
      subjectName: subject.name,
      modules: allModules,
      courseOutcomes,
    });

    const aiResult = await routeAI("qbank_image_question", {
      model: "flash",
      messages: [{ role: "user", content: prompt }],
      systemPrompt: IMAGE_QUESTION_SYSTEM_PROMPT,
      attachments: [{ mediaType: mimeType, data: body.image_base64 }],
      responseSchema: buildImageQuestionSchema(questionType),
      thinkingBudget: 0,
      logContext: {
        userId: user.id,
        userEmail: user.email ?? null,
        userRole: profile.role,
        subjectId,
        subjectCode: null,
        jobId,
        relatedContentId: null,
        feature: "qbank",
      },
      // Each call has a distinct image as its real source of variation; randomness isn't needed here,
      // and CO/BTL/difficulty tagging should be as consistent as every other tagging task (all near 0).
      temperature: 0.1,
      maxTokens: 4096,
    });

    let aiQuestion: {
      question_text?: string;
      model_answer?: string;
      options?: unknown;
      co_code?: string;
      btl_level?: unknown;
      difficulty?: string;
      module_number?: unknown;
      suggested_type?: string;
    };
    try {
      aiQuestion = JSON.parse(aiResult.content) as typeof aiQuestion;
    } catch {
      const recovered = extractQuestionTextFromAiContent(aiResult.content);
      if (!recovered) {
        console.error(
          "[qbank draft-image] AI parse failed:",
          aiResult.content.slice(0, 200)
        );
        return apiError(
          "AI failed to generate a valid question from the image",
          502
        );
      }
      aiQuestion = { question_text: recovered };
    }

    const aiText = aiQuestion.question_text?.trim();
    if (!aiText) {
      return apiError("AI returned an empty question", 502);
    }

    if (
      !aiQuestion.suggested_type ||
      !VALID_TYPES.has(aiQuestion.suggested_type)
    ) {
      aiQuestion.suggested_type = questionType;
    }

    const aiModuleNumber =
      typeof aiQuestion.module_number === "number"
        ? Math.trunc(aiQuestion.module_number)
        : null;
    const inferredModule =
      aiModuleNumber !== null
        ? (allModules.find((m) => m.module_number === aiModuleNumber) ?? null)
        : null;
    const resolvedModuleId = inferredModule?.id ?? moduleId ?? null;

    const suggestedType = aiQuestion.suggested_type;
    const finalType =
      suggestedType &&
      VALID_TYPES.has(suggestedType) &&
      (questionType === "short_answer" || suggestedType === questionType)
        ? suggestedType
        : questionType;

    return Response.json({
      image_path: imagePath,
      question_text: aiText,
      question_type: finalType,
      options:
        finalType === "mcq" ? normaliseAiOptions(aiQuestion.options) : null,
      model_answer: aiQuestion.model_answer?.trim() || null,
      co_code: aiQuestion.co_code?.trim() || null,
      btl_level: normBtl(aiQuestion.btl_level),
      difficulty: VALID_DIFFICULTY.has(aiQuestion.difficulty ?? "")
        ? (aiQuestion.difficulty as "easy" | "medium" | "hard")
        : null,
      module_id: resolvedModuleId,
    });
  } catch (err) {
    console.error("[qbank draft-image] Error:", err);
    const message = err instanceof Error ? err.message : "Failed to generate draft";
    return apiError(message, 500);
  }
}
