import { GoogleGenerativeAI, GoogleGenerativeAIFetchError } from "@google/generative-ai";
import { GoogleGenAI } from "@google/genai";
import { calculateTextCostInr } from "../pricing";
import type {
  AIProvider,
  ChatMessage,
  ChatParams,
  ChatResponse,
  ChatStreamChunk,
  ChatStreamResult,
} from "./types";

const MODEL_MAP = {
  flash: "gemini-2.5-flash",
  pro: "gemini-2.5-pro",
} as const;

const EMBED_MODEL = "gemini-embedding-001";

/** Model used for the search-grounded research path (new @google/genai SDK). */
const RESEARCH_MODEL = "gemini-2.5-flash";

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function toGeminiRole(role: "user" | "assistant"): "user" | "model" {
  return role === "assistant" ? "model" : "user";
}

/**
 * Shared usage/cost extraction for chat() and chatStream(). Reads Gemini's
 * usageMetadata (falling back to a char-based estimate exactly like chat()
 * always has) and prices it with calculateTextCostInr.
 */
function computeChatUsage(
  response: {
    usageMetadata?: {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
      thoughtsTokenCount?: number;
    };
  },
  content: string,
  messages: ChatMessage[],
  modelKey: "flash" | "pro"
): Pick<ChatResponse, "tokensUsed" | "costUsd" | "costInr"> {
  const usageMetadata = response.usageMetadata;
  const inputTokens =
    usageMetadata?.promptTokenCount ??
    estimateTokens(messages.map((m) => m.content).join(""));
  const outputTokens =
    usageMetadata?.candidatesTokenCount ?? estimateTokens(content);
  const thinkingTokens = usageMetadata?.thoughtsTokenCount ?? 0;

  const { costUsd, costInr } = calculateTextCostInr(
    inputTokens,
    outputTokens,
    thinkingTokens,
    modelKey
  );

  return {
    tokensUsed: {
      input: inputTokens,
      output: outputTokens,
      thinking: thinkingTokens,
    },
    costUsd,
    costInr,
  };
}

function createGeminiProvider(): AIProvider {
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Missing GOOGLE_GENERATIVE_AI_API_KEY environment variable"
    );
  }

  const genAI = new GoogleGenerativeAI(apiKey);

  // Lazily-created new-SDK client, used only by the search-grounded research
  // path. imagen.ts holds its own; both may coexist while gemini.ts's other
  // methods stay on the legacy @google/generative-ai SDK.
  let genaiClient: GoogleGenAI | null = null;
  function getGenaiClient(): GoogleGenAI {
    if (!genaiClient) {
      genaiClient = new GoogleGenAI({ apiKey });
    }
    return genaiClient;
  }

  /**
   * Shared model/config/history construction for chat() and chatStream().
   * Extracted so the two paths can NEVER drift: same generationConfig
   * (temperature, maxOutputTokens, thinkingConfig, responseMimeType/schema),
   * same systemInstruction, same history mapping, same final-message parts
   * (including attachments). Returns a started chat plus the resolved message
   * content and the bits both paths need for usage/cost accounting.
   */
  function prepareChatCall(params: ChatParams) {
    const {
      messages,
      systemPrompt,
      maxTokens = 8192,
      model: modelKey = "flash",
      task: taskName = "",
    } = params;

    if (messages.length === 0) {
      throw new Error("At least one message is required");
    }

    const modelName = MODEL_MAP[modelKey];

    // Structured output tasks need thinking disabled
    // Thinking tokens eat into maxOutputTokens on gemini-2.5-flash
    const isStructuredTask = [
      "ppt_gen",
      "ppt_extract",
      "ppt_refine",
      "quiz_gen",
      "placement_prep",
      "qpaper_gen",
      "refine",
      "placement_gen",
      "syllabus_extract",
      "pyq_extract",
      "qbank_generate",
      "qbank_tag",
      // Answer-key blocks emit a strict JSON array. The MCQ block runs on
      // Flash, where leaving thinking uncapped silently consumes the
      // maxOutputTokens budget and truncates the JSON → parse failure.
      "answer_key_mcq",
      "answer_key_descriptive",
      // Lesson-plan generation: per-module/practicals calls that always
      // pass a narrow responseSchema. thinkingBudget:0 is MANDATORY here
      // (CLAUDE_CONTEXT §19) — Flash thinking tokens would truncate the JSON.
      "lesson_plan_gen",
      // Lab-manual generation: the per-practical section call and the
      // learning-path proposal both pass a narrow responseSchema.
      // thinkingBudget:0 is MANDATORY (CLAUDE_CONTEXT §19) — the section call
      // emits the largest structured payload in the product, so Flash thinking
      // tokens eating maxOutputTokens would truncate it mid-scaffold.
      "lab_manual_gen",
      "lab_path_gen",
      // Syllabus audit: the single suggestion call passes a narrow
      // responseSchema. thinkingBudget:0 is MANDATORY (CLAUDE_CONTEXT §19) —
      // a truncated response here silently loses proposals off the end of the
      // array, which looks like "the AI found nothing" rather than an error.
      "syllabus_audit",
      // Chat Visualize, call 1 + the diagram branch of call 2: both pass a
      // narrow responseSchema. Listed here for the structured-task temperature
      // (0.4 — a routing decision and terse markup, neither wants 0.7) and as
      // defence in depth on thinkingBudget:0, which both call sites also set
      // explicitly. The interactive/plot branches emit freeform HTML and are
      // deliberately NOT listed — they want the creative default.
      "chat_viz_classify",
      "chat_viz_diagram",
    ].includes(taskName);

    const temperature =
      params.temperature ?? (isStructuredTask ? 0.4 : 0.7);

    // Pro always gets full token budget
    const maxOutputTokens = modelName.includes("pro")
      ? 32768
      : maxTokens; // already set per-task in router

    const generationConfig: Record<string, unknown> = {
      temperature,
      maxOutputTokens,
    };

    if (params.thinkingBudget !== undefined) {
      // Explicit per-call budget takes priority
      generationConfig.thinkingConfig = {
        thinkingBudget: params.thinkingBudget,
      };
    } else if (isStructuredTask && modelName.includes("flash")) {
      // Structured JSON tasks: disable thinking entirely
      generationConfig.thinkingConfig = { thinkingBudget: 0 };
    }
    // Otherwise: thinking is uncapped (default Flash behavior)

    if (
      taskName === "qpaper_gen" ||
      taskName === "pyq_extract" ||
      taskName === "answer_key_descriptive"
    ) {
      generationConfig.responseMimeType = "application/json";
    }

    // A caller-supplied responseSchema constrains output to schema-conformant
    // JSON — Gemini guarantees the shape, so no parse-retry loop is needed.
    if (params.responseSchema) {
      generationConfig.responseMimeType = "application/json";
      generationConfig.responseSchema = params.responseSchema;
    }

    const modelParams: Parameters<typeof genAI.getGenerativeModel>[0] = {
      model: modelName,
      generationConfig: generationConfig as Parameters<
        typeof genAI.getGenerativeModel
      >[0]["generationConfig"],
    };

    if (systemPrompt) {
      modelParams.systemInstruction = systemPrompt;
    }

    const model = genAI.getGenerativeModel(modelParams);

    const lastMessage = messages[messages.length - 1];
    const historyMessages = messages.slice(0, -1);

    const history = historyMessages.map((msg: ChatMessage) => ({
      role: toGeminiRole(msg.role),
      parts: [{ text: msg.content }],
    }));

    const chat = model.startChat({ history });

    const attachments = params.attachments ?? [];
    const messageContent =
      attachments.length > 0
        ? [
            { text: lastMessage.content },
            ...attachments.map((a) => ({
              inlineData: { mimeType: a.mediaType, data: a.data },
            })),
          ]
        : lastMessage.content;

    return { chat, messageContent, modelKey, modelName, messages };
  }

  return {
    name: "gemini",

    async chat(params: ChatParams): Promise<ChatResponse> {
      try {
        const { chat, messageContent, modelKey, modelName, messages } =
          prepareChatCall(params);

        const result = await chat.sendMessage(messageContent);

        const response = result.response;
        const content = response.text();

        const usage = computeChatUsage(
          response as Parameters<typeof computeChatUsage>[0],
          content,
          messages,
          modelKey
        );

        return {
          content,
          ...usage,
          modelUsed: modelName,
        };
      } catch (error) {
        if (error instanceof Error) {
          console.error("[Gemini chat error]", error.message);
        }
        throw new Error(
          `Gemini chat failed: ${error instanceof Error ? error.message : "Unknown error"}`
        );
      }
    },

    async chatStream(params: ChatParams): Promise<ChatStreamResult> {
      // NOTE: intentionally NOT wrapped in try/catch-rethrow like chat(). The
      // raw GoogleGenerativeAIFetchError must propagate so routeAIStream can
      // detect a 429 and apply the before-first-chunk fallback. Same setup as
      // chat() via prepareChatCall — the two can never drift.
      const { chat, messageContent, modelKey, modelName, messages } =
        prepareChatCall(params);

      const streamResult = await chat.sendMessageStream(messageContent);

      let accumulated = "";
      const stream: AsyncIterable<ChatStreamChunk> = (async function* () {
        for await (const chunk of streamResult.stream) {
          const text = chunk.text();
          if (text) accumulated += text;
          yield { text };
        }
      })();

      const finalize = async (): Promise<ChatResponse> => {
        const response = await streamResult.response;
        // Prefer the accumulated stream text; fall back to the aggregated
        // response's text if nothing was accumulated.
        const content = accumulated || response.text();
        const usage = computeChatUsage(
          response as Parameters<typeof computeChatUsage>[0],
          content,
          messages,
          modelKey
        );
        return {
          content,
          ...usage,
          modelUsed: modelName,
        };
      };

      return { stream, finalize };
    },

    async chatWithSearch(params: ChatParams): Promise<ChatResponse> {
      const { messages, systemPrompt } = params;
      if (messages.length === 0) {
        throw new Error("At least one message is required");
      }

      const ai = getGenaiClient();

      const contents = messages.map((m) => ({
        role: toGeminiRole(m.role),
        parts: [{ text: m.content }],
      }));

      const config: Record<string, unknown> = {
        tools: [{ googleSearch: {} }],
      };
      if (systemPrompt) config.systemInstruction = systemPrompt;
      if (params.temperature !== undefined)
        config.temperature = params.temperature;
      if (params.maxTokens !== undefined)
        config.maxOutputTokens = params.maxTokens;

      const result = await ai.models.generateContent({
        model: RESEARCH_MODEL,
        contents,
        config,
      });

      const content = result.text ?? "";

      // Research always runs on Flash. usageMetadata falls back to the same
      // char estimate chat() uses when the API omits it.
      const usage = computeChatUsage(
        {
          usageMetadata: result.usageMetadata as
            | {
                promptTokenCount?: number;
                candidatesTokenCount?: number;
                thoughtsTokenCount?: number;
              }
            | undefined,
        },
        content,
        messages,
        "flash"
      );

      // Extract deduped web citations from groundingMetadata.
      const groundingChunks =
        result.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
      const seen = new Set<string>();
      const citations: { title: string; uri: string }[] = [];
      for (const chunk of groundingChunks) {
        const uri = chunk.web?.uri;
        if (!uri || seen.has(uri)) continue;
        seen.add(uri);
        citations.push({ title: chunk.web?.title ?? uri, uri });
      }

      return {
        content,
        ...usage,
        modelUsed: RESEARCH_MODEL,
        citations,
      };
    },

    async embed(text: string): Promise<number[]> {
      try {
        const model = genAI.getGenerativeModel({ model: EMBED_MODEL });
        const result = await model.embedContent(text);
        return result.embedding.values;
      } catch (error) {
        if (error instanceof Error) {
          console.error("[Gemini embed error]", error.message);
        }
        throw new Error(
          `Gemini embed failed: ${error instanceof Error ? error.message : "Unknown error"}`
        );
      }
    },

    async generateImage(_prompt: string): Promise<string> {
      throw new Error("Image generation not yet implemented");
    },
  };
}

let cachedProvider: AIProvider | null = null;

export function getGeminiProvider(): AIProvider {
  if (!cachedProvider) {
    cachedProvider = createGeminiProvider();
  }
  return cachedProvider;
}

export function isGeminiRateLimitError(error: unknown): boolean {
  return (
    error instanceof GoogleGenerativeAIFetchError && error.status === 429
  );
}
