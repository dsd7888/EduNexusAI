import { getGeminiProvider, isGeminiRateLimitError } from "./providers/gemini";
import type { ChatParams, ChatResponse } from "./providers/types";

const TASK_TO_MODEL: Record<string, "flash" | "pro"> = {
  chat: "flash",
  quiz_gen: "flash",
  placement_prep: "flash",
  ppt_gen: "flash",
  ppt_diagram: "pro", // diagram-only PPT batches — Pro produces better SVG/diagram code
  ppt_extract: "flash",
  ppt_refine: "flash",
  qpaper_gen: "pro",
  answer_key_mcq: "flash",
  refine: "flash",
  placement_gen: "pro",
  syllabus_extract: "flash",
  pyq_extract: "flash",
  qbank_generate: "flash",
  qbank_tag: "flash",
  explainer_ideate: "flash",
  explainer_extract: "pro",
};

const DEFAULT_MODEL: "flash" | "pro" = "flash";

/**
 * Routes an AI task to the appropriate provider and model.
 * Sets params.model based on task mapping if not already set.
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
            ? 16384
            : task === "placement_gen"
            ? 32768
            : task === "quiz_gen"
              ? 8192
              : task === "placement_prep"
                ? 6000
                : task === "qpaper_gen"
                ? 8192
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

  try {
    const response = await provider.chat(resolvedParams);

    console.log(
      `[routeAI] task=${task} model=${response.modelUsed} ` +
        `inputTokens=${response.tokensUsed.input} outputTokens=${response.tokensUsed.output} ` +
        `costInr=${response.costInr.toFixed(4)}`
    );

    return response;
  } catch (error) {
    if (isGeminiRateLimitError(error)) {
      console.warn("[routeAI] Gemini rate limited");
      throw error;
    }
    throw error;
  }
}
