export const CHAT_SYSTEM_PROMPT = "You are a helpful assistant.";

export function buildChatPrompt(messages: { role: string; content: string }[]) {
  return messages.map((m) => m.content).join("\n");
}
