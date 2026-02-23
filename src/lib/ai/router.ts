import { getGeminiProvider, isGeminiRateLimitError } from "./providers/gemini";
import type { ChatParams, ChatResponse } from "./providers/types";

const TASK_TO_MODEL: Record<string, "flash" | "pro"> = {
  chat: "flash",
  quiz_gen: "flash",
  ppt_gen: "flash",
  qpaper_gen: "flash",
  refine: "pro",
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
    model: params.model ?? TASK_TO_MODEL[task] ?? DEFAULT_MODEL,
    maxTokens:
      task === "ppt_gen" ? params.maxTokens ?? 8192 : params.maxTokens,
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
