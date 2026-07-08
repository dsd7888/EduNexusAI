import { after } from "next/server";
import { getGeminiProvider, isGeminiRateLimitError } from "./providers/gemini";
import type { ChatParams, ChatResponse } from "./providers/types";
import { logAICall } from "./costLogger";

const TASK_TO_MODEL: Record<string, "flash" | "pro"> = {
  chat: "flash",
  quiz_gen: "flash",
  placement_prep: "flash",
  ppt_gen: "flash",
  ppt_diagram: "pro", // diagram-only PPT batches — Pro produces better SVG/diagram code
  ppt_extract: "flash",
  ppt_refine: "flash",
  qpaper_gen: "pro",
  qpaper_validate_tags: "flash",
  answer_key_mcq: "flash",
  answer_key_descriptive: "pro", // model answers + marking schemes — same reasoning needs as qpaper_gen
  refine: "flash",
  placement_gen: "pro",
  syllabus_extract: "flash",
  pyq_extract: "flash",
  qbank_generate: "flash",
  qbank_tag: "flash",
  module_co_classify: "flash",
  explainer_ideate: "flash",
  explainer_extract: "pro",
  qbank_image_question: "flash",
};

const DEFAULT_MODEL: "flash" | "pro" = "flash";

export type DiagramRenderHint =
  | "svg"
  | "mermaid"
  | "imagen"
  | "illustration"
  | "dual";
export type DiagramComplexity = "standard" | "intricate";

/**
 * Text-model routing for ONE diagram/dual_visual slide's content generation.
 *
 * This is the diagram-tier policy, kept here next to TASK_TO_MODEL so all
 * model-selection logic lives in one place:
 *
 *  - "mermaid"  → ALWAYS Flash. Mermaid is terse, well-structured markup that a
 *                 fixed-cost renderer turns into the picture; Pro buys nothing
 *                 here, so never spend it regardless of diagramComplexity.
 *  - "svg" / "dual" → routed by diagramComplexity. "standard" SVGs (few elements,
 *                 simple geometry) go to Flash; "intricate" SVGs (dense, geometry-
 *                 critical) go to Pro, where the extra reasoning pays for itself.
 *  - "imagen" / "illustration" → Flash. These slides only need a short text
 *                 prompt from the LLM; the real work is the image-generation API
 *                 (a separate path, tiered by diagramComplexity in imagen.ts), so
 *                 the text model never needs to be Pro.
 *
 * Unknown/absent hints fall back to the SVG rule (the diagram default render type).
 */
export function routeDiagramModel(slide: {
  renderHint?: DiagramRenderHint | null;
  diagramComplexity?: DiagramComplexity | null;
}): "flash" | "pro" {
  const hint = slide.renderHint;
  if (hint === "mermaid") return "flash";
  if (hint === "imagen" || hint === "illustration") return "flash";
  // "svg", "dual", or unknown → technical SVG path, gated on intricacy.
  return slide.diagramComplexity === "intricate" ? "pro" : "flash";
}

/**
 * Batch-level model for a set of diagram slides (diagram batches are normally a
 * single slide, but stay correct if several are sent): take Pro if ANY slide in
 * the batch needs Pro, else Flash.
 */
export function routeDiagramBatchModel(
  slides: {
    renderHint?: DiagramRenderHint | null;
    diagramComplexity?: DiagramComplexity | null;
  }[]
): "flash" | "pro" {
  return slides.some((s) => routeDiagramModel(s) === "pro") ? "pro" : "flash";
}

function truncateErrorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.length > 500 ? `${msg.slice(0, 500)}…` : msg;
}

function scheduleLog(
  ...args: Parameters<typeof logAICall>
): void {
  after(() => {
    void logAICall(...args);
  });
}

/**
 * Routes an AI task to the appropriate provider and model.
 * Sets params.model based on task mapping if not already set.
 * Every call (success, error, rate_limited) is logged to ai_call_logs via after().
 */
export async function routeAI(
  task: string,
  params: ChatParams
): Promise<ChatResponse> {
  const resolvedParams: ChatParams = {
    ...params,
    task,
    model: params.model ?? TASK_TO_MODEL[task] ?? DEFAULT_MODEL,
    maxTokens:
      params.maxTokens ??
      (task === "ppt_gen"
        ? 32768
        : task === "ppt_diagram"
          ? 32768
          : task === "ppt_refine"
            ? 8192
            : task === "placement_gen"
            ? 32768
            : task === "quiz_gen"
              ? 8192
              : task === "placement_prep"
                ? 6000
                : task === "qpaper_gen"
                ? 8192
                : task === "qpaper_validate_tags"
                ? 512
                : task === "answer_key_mcq"
                  ? 2048
                  : task === "refine"
                    ? 8192
                    : task === "chat"
                      ? 16384
                      : task === "syllabus_extract"
                        ? 8192
                        : task === "pyq_extract"
                          ? 4096
                          : task === "qbank_generate"
                            ? 8192
                            : task === "qbank_tag"
                              ? 2048
                              : task === "explainer_extract"
                                ? 16384
                                : task === "explainer_ideate"
                                  ? 8192
                                  : task === "qbank_image_question"
                                    ? 4096
                                    : 4096),
  };

  const providerName =
    process.env.PRIMARY_AI_PROVIDER ?? "gemini";

  if (providerName !== "gemini") {
    throw new Error(
      `Unknown AI provider: ${providerName}. Only "gemini" is supported.`
    );
  }

  const provider = getGeminiProvider();
  const modelKey = resolvedParams.model ?? DEFAULT_MODEL;
  const startedAt = Date.now();

  try {
    const response = await provider.chat(resolvedParams);
    const latencyMs = Date.now() - startedAt;

    console.log(
      `[routeAI] task=${task} model=${response.modelUsed} ` +
        `inputTokens=${response.tokensUsed.input} outputTokens=${response.tokensUsed.output} ` +
        `thinkingTokens=${response.tokensUsed.thinking} ` +
        `costInr=${response.costInr.toFixed(4)}`
    );

    scheduleLog({
      logContext: resolvedParams.logContext,
      task,
      model: modelKey,
      unitType: "tokens",
      inputTokens: response.tokensUsed.input,
      outputTokens: response.tokensUsed.output,
      thinkingTokens: response.tokensUsed.thinking,
      costUsd: response.costUsd,
      costInr: response.costInr,
      status: "success",
      latencyMs,
    });

    return response;
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    const rateLimited = isGeminiRateLimitError(error);

    scheduleLog({
      logContext: resolvedParams.logContext,
      task,
      model: modelKey,
      unitType: "tokens",
      inputTokens: 0,
      outputTokens: 0,
      thinkingTokens: 0,
      costUsd: 0,
      costInr: 0,
      status: rateLimited ? "rate_limited" : "error",
      errorMessage: truncateErrorMessage(error),
      latencyMs,
    });

    if (rateLimited) {
      console.warn("[routeAI] Gemini rate limited");
      throw error;
    }
    throw error;
  }
}
