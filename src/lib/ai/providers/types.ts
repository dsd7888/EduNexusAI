export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatParams {
  messages: ChatMessage[];
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  model?: "flash" | "pro";
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
