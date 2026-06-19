import type { NextRequest } from "next/server";
import { requireRole, apiError, apiSuccess } from "@/lib/api/helpers";
import { routeAI } from "@/lib/ai/router";

export const maxDuration = 30;

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    score: {
      type: "number",
      description:
        "Score 1-10. 7+ is good. Be strict — most first attempts deserve 4-6.",
    },
    what_worked: {
      type: "string",
      description: "One specific thing done well. If nothing, say so.",
    },
    primary_issue: {
      type: "string",
      description: "The single most important thing to fix. Be specific.",
    },
    improved_answer: {
      type: "string",
      description:
        "A rewritten version following the framework. Sound like a confident fresher, not an AI. No filler phrases. Under 150 words.",
    },
    one_tip: {
      type: "string",
      description: "One actionable tip for this type of question going forward.",
    },
  },
  required: [
    "score",
    "what_worked",
    "primary_issue",
    "improved_answer",
    "one_tip",
  ],
};

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireRole(["student"]);
    if (authResult instanceof Response) return authResult;

    const body = (await request.json()) as {
      question_id?: unknown;
      question_text?: unknown;
      answer_framework?: unknown;
      student_answer?: unknown;
      role_context?: unknown;
    };

    const questionText =
      typeof body.question_text === "string" ? body.question_text.trim() : "";
    const answerFramework =
      typeof body.answer_framework === "string"
        ? body.answer_framework.trim()
        : "";
    const studentAnswer =
      typeof body.student_answer === "string" ? body.student_answer.trim() : "";
    const roleContext =
      typeof body.role_context === "string" ? body.role_context.trim() : null;

    if (!questionText) {
      return apiError("question_text is required.", 400);
    }
    if (!answerFramework) {
      return apiError("answer_framework is required.", 400);
    }
    if (studentAnswer.length < 20) {
      return apiError("Answer must be at least 20 characters.", 400);
    }
    if (studentAnswer.length > 1000) {
      return apiError("Answer must be under 1000 characters.", 400);
    }

    const prompt =
      `Evaluate this interview answer for an Indian fresher ` +
      `applying for campus placement.\n\n` +
      `Question: "${questionText}"\n` +
      `Expected framework: ${answerFramework}\n\n` +
      `Student's answer:\n"${studentAnswer}"\n` +
      (roleContext ? `Target role: ${roleContext}\n` : "") +
      `\nEvaluate honestly. This is practice — be direct, not encouraging.`;

    let result;
    try {
      result = await routeAI("placement_prep", {
        messages: [{ role: "user", content: prompt }],
        thinkingBudget: 0,
        maxTokens: 1500,
        responseSchema: RESPONSE_SCHEMA,
      });
    } catch (err) {
      console.error("[interview/evaluate] AI call failed:", err);
      return apiError("Evaluation failed. Try again.", 500);
    }

    let evaluation: Record<string, unknown>;
    try {
      evaluation = JSON.parse(String(result.content ?? ""));
    } catch {
      console.error("[interview/evaluate] Failed to parse AI response");
      return apiError("Evaluation failed. Try again.", 500);
    }

    if (typeof (evaluation as { score?: unknown }).score !== "number") {
      return apiError("Evaluation failed. Try again.", 500);
    }

    return apiSuccess(evaluation);
  } catch (error) {
    console.error(
      "[interview/evaluate] Error:",
      error instanceof Error ? error.message : error
    );
    return apiError("Evaluation failed. Try again.", 500);
  }
}
