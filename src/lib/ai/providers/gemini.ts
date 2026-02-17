import { GoogleGenerativeAI, GoogleGenerativeAIFetchError } from "@google/generative-ai";
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

const INPUT_COST_PER_1M_USD = {
  flash: 0.15,
  pro: 1.25,
} as const;

const OUTPUT_COST_PER_1M_USD = {
  flash: 0.6,
  pro: 10.0,
} as const;

const USD_TO_INR = 83.33;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function toGeminiRole(role: "user" | "assistant"): "user" | "model" {
  return role === "assistant" ? "model" : "user";
}

function calculateCostInr(
  inputTokens: number,
  outputTokens: number,
  model: "flash" | "pro"
): number {
  const inputCostUsd =
    (inputTokens / 1_000_000) * INPUT_COST_PER_1M_USD[model];
  const outputCostUsd =
    (outputTokens / 1_000_000) * OUTPUT_COST_PER_1M_USD[model];
  return (inputCostUsd + outputCostUsd) * USD_TO_INR;
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
          temperature = 0.7,
          maxTokens = 8192,
          model: modelKey = "flash",
        } = params;

        if (messages.length === 0) {
          throw new Error("At least one message is required");
        }

        const modelName = MODEL_MAP[modelKey];
        const modelParams: Parameters<typeof genAI.getGenerativeModel>[0] = {
          model: modelName,
          generationConfig: {
            temperature,
            maxOutputTokens: maxTokens,
          },
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
        const result = await chat.sendMessage(lastMessage.content);

        const response = result.response;
        const content = response.text();

        const usageMetadata = (response as { usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number } }).usageMetadata;
        const inputTokens = usageMetadata?.promptTokenCount ?? estimateTokens(
          messages.map((m) => m.content).join("")
        );
        const outputTokens = usageMetadata?.candidatesTokenCount ?? estimateTokens(content);

        const costInr = calculateCostInr(inputTokens, outputTokens, modelKey);

        return {
          content,
          tokensUsed: { input: inputTokens, output: outputTokens },
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
