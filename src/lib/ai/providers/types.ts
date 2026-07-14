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

export interface AILogContext {
  userId: string | null;
  userEmail: string | null;
  userRole: string | null;
  subjectId: string | null;
  subjectCode: string | null;
  jobId: string; // caller-generated UUID, or an existing stable id
  relatedContentId: string | null;
  feature: string; // see feature column comment on ai_call_logs
  attemptNumber?: number; // defaults to 1 if omitted
  metadata?: Record<string, unknown>;
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
  /**
   * Required attribution context for ai_call_logs. Every routeAI caller must
   * supply this — the field is required so missing sites fail TypeScript instead
   * of silently skipping cost logging.
   */
  logContext: AILogContext;
}

export interface ChatResponse {
  content: string;
  tokensUsed: { input: number; output: number; thinking: number };
  costUsd: number;
  costInr: number;
  modelUsed: string;
  /**
   * Grounding sources returned by search-backed chat paths (chatWithSearch).
   * Absent for ordinary chat()/chatStream() responses.
   */
  citations?: { title: string; uri: string }[];
}

/** One incremental piece of a streamed chat response. */
export interface ChatStreamChunk {
  text: string;
}

/**
 * Result of opening a streaming chat call. Consume {@link stream} for the
 * incremental text, then await {@link finalize} exactly once to get the full
 * ChatResponse with real token counts and cost (computed from usageMetadata).
 */
export interface ChatStreamResult {
  stream: AsyncIterable<ChatStreamChunk>;
  finalize: () => Promise<ChatResponse>;
}

export interface AIProvider {
  name: string;
  chat(params: ChatParams): Promise<ChatResponse>;
  /** Streaming counterpart of {@link chat} — identical model/config/history. */
  chatStream(params: ChatParams): Promise<ChatStreamResult>;
  /**
   * Search-grounded chat (new @google/genai SDK, googleSearch tool). Returns a
   * ChatResponse whose `citations` are extracted from groundingMetadata.
   */
  chatWithSearch(params: ChatParams): Promise<ChatResponse>;
  embed(text: string): Promise<number[]>;
  generateImage(prompt: string): Promise<string>;
}
