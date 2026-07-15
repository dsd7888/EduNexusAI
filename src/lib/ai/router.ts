import { after } from "next/server";
import { getGeminiProvider, isGeminiRateLimitError } from "./providers/gemini";
import type {
  ChatParams,
  ChatResponse,
  ChatStreamResult,
} from "./providers/types";
import { logAICall } from "./costLogger";

const TASK_TO_MODEL: Record<string, "flash" | "pro"> = {
  chat: "flash",
  // Reasoning tier — deeper multi-step chat answers run on Pro.
  chat_reasoning: "pro",
  // Research tier — search-grounded chat; routed through chatWithSearch.
  chat_research: "flash",
  // ── Chat "Visualize" pipeline: CLASSIFY → GENERATE (see lib/ai/vizPrompts.ts).
  // Call 1 picks the form; exactly one of the three generation tasks then runs.
  chat_viz_classify: "flash", // narrow responseSchema, a routing decision only
  chat_visualize: "pro", // freeform interactive HTML — the quality-critical path
  chat_viz_diagram: "flash", // Mermaid source only; Pro buys nothing (cf. routeDiagramModel)
  chat_viz_plot: "pro", // computed-plot HTML: formula → sampled points → SVG
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
  qbank_image_question: "flash",
  lesson_plan_gen: "flash",
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function scheduleLog(
  ...args: Parameters<typeof logAICall>
): void {
  after(() => {
    void logAICall(...args);
  });
}

/**
 * Resolves task → model and per-task maxTokens defaults. Shared by routeAI and
 * routeAIStream so both entry points apply identical resolution.
 */
function resolveChatParams(task: string, params: ChatParams): ChatParams {
  return {
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
                      : task === "chat_reasoning"
                        ? 32768
                        : task === "chat_viz_classify"
                        ? 512
                        : // NOTE: chat_visualize and chat_viz_plot run on Pro, where
                          // gemini.ts pins maxOutputTokens to 32768 and ignores these
                          // values (§19). They are recorded here as the intended
                          // ceiling — and they DO bind if either task ever falls back
                          // to Flash. The effective limit on Pro is the prompt-level
                          // VIZ_SIZE_CONTRACT in vizPrompts.ts.
                          task === "chat_visualize"
                          ? 16384
                          : task === "chat_viz_plot"
                          ? 8192
                          : task === "chat_viz_diagram"
                          ? 4096
                          : task === "chat_research"
                          ? 16384
                          : task === "syllabus_extract"
                            ? 8192
                            : task === "pyq_extract"
                              ? 4096
                              : task === "qbank_generate"
                                ? 8192
                                : task === "qbank_tag"
                                  ? 2048
                                  : task === "qbank_image_question"
                                    ? 4096
                                    : task === "lesson_plan_gen"
                                      ? 8192
                                      : 4096),
  };
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
  const resolvedParams = resolveChatParams(task, params);

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
    // Research tier is served by the search-grounded path (new SDK). Keeping
    // the task check here — before provider dispatch — leaves cost logging
    // and error handling centralized in this one try/catch.
    const response =
      task === "chat_research"
        ? await provider.chatWithSearch(resolvedParams)
        : await provider.chat(resolvedParams);
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

/**
 * Streaming counterpart of {@link routeAI}. Resolves task → model identically,
 * carries the same logContext, but defers cost logging to finalize().
 *
 * Error / fallback semantics:
 *  - The stream is opened and its FIRST chunk is pulled eagerly. A 429 that
 *    occurs BEFORE the first chunk (either while opening or on that first pull)
 *    triggers exactly one recovery attempt. Recovery degrades DOWNWARD ONLY —
 *    never an upward tier switch:
 *      · pro   → retry on flash (graceful degradation; the answer still lands).
 *      · flash → single SAME-model retry after a short delay. A Flash 429 means
 *        peak load; auto-escalating each one to Pro would be a silent ~20× cost
 *        cliff on the highest-volume path, so we never do that — after the one
 *        retry the error propagates for the UI's inline "busy, retry".
 *  - Any non-429 pre-first-chunk error, or a 429 once the first chunk has been
 *    yielded, is NOT retried.
 *  - Mid-stream errors (after the first chunk) propagate to the consumer.
 *  - logAICall fires EXACTLY ONCE: on success when finalize() resolves (real
 *    token counts), or on a mid-stream / exhausted-recovery failure as an
 *    error/rate_limited row. A `logged` guard enforces the single write.
 */
export async function routeAIStream(
  task: string,
  params: ChatParams
): Promise<ChatStreamResult> {
  const resolvedParams = resolveChatParams(task, params);

  const providerName = process.env.PRIMARY_AI_PROVIDER ?? "gemini";
  if (providerName !== "gemini") {
    throw new Error(
      `Unknown AI provider: ${providerName}. Only "gemini" is supported.`
    );
  }

  const provider = getGeminiProvider();
  const primaryModel = resolvedParams.model ?? DEFAULT_MODEL;

  // Pre-first-chunk 429 recovery plan. Degradation is ONLY ever downward:
  //  - pro   → flash (graceful degradation; chat_reasoning still answers).
  //  - flash → a single SAME-model retry after a delay. A Flash 429 happens at
  //            peak load (e.g. a whole class on chat at once); auto-escalating
  //            every one to Pro is a silent ~20× cost cliff on the platform's
  //            highest-volume path — never switch tier upward here.
  const fallbackPlan: { model: "flash" | "pro"; delayMs: number } =
    primaryModel === "pro"
      ? { model: "flash", delayMs: 0 }
      : { model: "flash", delayMs: 1500 };
  const started = Date.now();

  let logged = false;
  function logOnce(row: Parameters<typeof scheduleLog>[0]): void {
    if (logged) return;
    logged = true;
    scheduleLog(row);
  }

  async function open(modelKey: "flash" | "pro") {
    const result = await provider.chatStream({
      ...resolvedParams,
      model: modelKey,
    });
    const iterator = result.stream[Symbol.asyncIterator]();
    // Pull the first chunk eagerly so a pre-first-chunk 429 surfaces here,
    // where the fallback can still be applied.
    const first = await iterator.next();
    return { result, iterator, first, modelKey };
  }

  let opened: Awaited<ReturnType<typeof open>>;
  try {
    opened = await open(primaryModel);
  } catch (error) {
    if (isGeminiRateLimitError(error)) {
      const sameModel = fallbackPlan.model === primaryModel;
      console.warn(
        `[routeAIStream] ${primaryModel} rate limited before first chunk; ` +
          (sameModel
            ? `single same-model retry after ${fallbackPlan.delayMs}ms (no tier switch)`
            : `degrading to ${fallbackPlan.model}`)
      );
      if (fallbackPlan.delayMs > 0) await sleep(fallbackPlan.delayMs);
      try {
        opened = await open(fallbackPlan.model);
      } catch (fallbackError) {
        logOnce({
          logContext: resolvedParams.logContext,
          task,
          model: fallbackPlan.model,
          unitType: "tokens",
          inputTokens: 0,
          outputTokens: 0,
          thinkingTokens: 0,
          costUsd: 0,
          costInr: 0,
          status: isGeminiRateLimitError(fallbackError)
            ? "rate_limited"
            : "error",
          errorMessage: truncateErrorMessage(fallbackError),
          latencyMs: Date.now() - started,
        });
        throw fallbackError;
      }
    } else {
      logOnce({
        logContext: resolvedParams.logContext,
        task,
        model: primaryModel,
        unitType: "tokens",
        inputTokens: 0,
        outputTokens: 0,
        thinkingTokens: 0,
        costUsd: 0,
        costInr: 0,
        status: isGeminiRateLimitError(error) ? "rate_limited" : "error",
        errorMessage: truncateErrorMessage(error),
        latencyMs: Date.now() - started,
      });
      throw error;
    }
  }

  const { result, iterator, first, modelKey } = opened;

  const stream: ChatStreamResult["stream"] = (async function* () {
    try {
      if (!first.done) yield first.value;
      while (true) {
        const next = await iterator.next();
        if (next.done) break;
        yield next.value;
      }
    } catch (streamError) {
      // Mid-stream failure: log once as error/rate_limited, then propagate.
      logOnce({
        logContext: resolvedParams.logContext,
        task,
        model: modelKey,
        unitType: "tokens",
        inputTokens: 0,
        outputTokens: 0,
        thinkingTokens: 0,
        costUsd: 0,
        costInr: 0,
        status: isGeminiRateLimitError(streamError)
          ? "rate_limited"
          : "error",
        errorMessage: truncateErrorMessage(streamError),
        latencyMs: Date.now() - started,
      });
      throw streamError;
    }
  })();

  const finalize = async (): Promise<ChatResponse> => {
    const response = await result.finalize();
    const latencyMs = Date.now() - started;

    console.log(
      `[routeAIStream] task=${task} model=${response.modelUsed} ` +
        `inputTokens=${response.tokensUsed.input} outputTokens=${response.tokensUsed.output} ` +
        `thinkingTokens=${response.tokensUsed.thinking} ` +
        `costInr=${response.costInr.toFixed(4)}`
    );

    logOnce({
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
  };

  return { stream, finalize };
}
