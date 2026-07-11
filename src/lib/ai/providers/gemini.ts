import { GoogleGenerativeAI, GoogleGenerativeAIFetchError } from "@google/generative-ai";
import { calculateTextCostInr } from "../pricing";
import type {
  AIProvider,
  ChatMessage,
  ChatParams,
  ChatResponse,
} from "./types";

const MODEL_MAP = {
  flash: "gemini-2.5-flash",
  pro: "gemini-2.5-pro",
} as const;

const EMBED_MODEL = "gemini-embedding-001";

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function toGeminiRole(role: "user" | "assistant"): "user" | "model" {
  return role === "assistant" ? "model" : "user";
}

function createGeminiProvider(): AIProvider {
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Missing GOOGLE_GENERATIVE_AI_API_KEY environment variable"
    );
  }

  const genAI = new GoogleGenerativeAI(apiKey);

  return {
    name: "gemini",

    async chat(params: ChatParams): Promise<ChatResponse> {
      try {
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
        const result = attachments.length > 0
          ? await chat.sendMessage([
              { text: lastMessage.content },
              ...attachments.map((a) => ({
                inlineData: { mimeType: a.mediaType, data: a.data },
              })),
            ])
          : await chat.sendMessage(lastMessage.content);

        const response = result.response;
        const content = response.text();

        const usageMetadata = (
          response as {
            usageMetadata?: {
              promptTokenCount?: number;
              candidatesTokenCount?: number;
              thoughtsTokenCount?: number;
            };
          }
        ).usageMetadata;
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
          content,
          tokensUsed: {
            input: inputTokens,
            output: outputTokens,
            thinking: thinkingTokens,
          },
          costUsd,
          costInr,
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
