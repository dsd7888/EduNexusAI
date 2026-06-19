export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatAttachment {
  /** MIME type, e.g. "application/pdf". */
  mediaType: string;
  /** Base64-encoded bytes (no data URI prefix). */
  data: string;
}

export interface ChatParams {
  messages: ChatMessage[];
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  model?: "flash" | "pro";
  /** Set by router so the provider can tune generation (e.g. thinking, temperature). */
  task?: string;
  /** Optional inline data parts (PDFs, images) attached to the final user message. */
  attachments?: ChatAttachment[];
  /**
   * Optional Gemini responseSchema (OpenAPI-subset). When set, the provider
   * forces responseMimeType=application/json and constrains output to the
   * schema, guaranteeing schema-conformant JSON (no parse-retry loop needed).
   */
  responseSchema?: object;
  /**
   * Optional thinking-token cap (gemini-2.5-flash). When set, overrides the
   * isStructuredTask thinkingBudget:0 default. Use to cap (not disable) thinking
   * for tasks that need reasoning but must leave headroom for content output.
   */
  thinkingBudget?: number;
}

export interface ChatResponse {
  content: string;
  tokensUsed: { input: number; output: number };
  costInr: number;
  modelUsed: string;
}

export interface AIProvider {
  name: string;
  chat(params: ChatParams): Promise<ChatResponse>;
  embed(text: string): Promise<number[]>;
  generateImage(prompt: string): Promise<string>;
}
