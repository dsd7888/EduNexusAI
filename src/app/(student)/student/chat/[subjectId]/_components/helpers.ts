const QUIZ_LINE = "Want a quick quiz on this?";
const VARIATION_PREFIX = /^Try a variation:\s*/i;

/**
 * exam_prep answers always end with the literal QUIZ_LINE; problem_solving
 * answers end with a "Try a variation: ..." line (see buildTutorSystemPrompt
 * in src/lib/ai/prompts.ts). Strip that trailing line so it can render as a
 * tappable chip instead of plain prose.
 */
export function extractTrailingChip(content: string): {
  chip: string;
  remaining: string;
} | null {
  const trimmed = content.trimEnd();
  const lastNewline = trimmed.lastIndexOf("\n");
  const lastLine = (lastNewline === -1 ? trimmed : trimmed.slice(lastNewline + 1)).trim();

  if (lastLine === QUIZ_LINE || VARIATION_PREFIX.test(lastLine)) {
    const remaining = (lastNewline === -1 ? "" : trimmed.slice(0, lastNewline)).trimEnd();
    return { chip: lastLine, remaining };
  }
  return null;
}

export function domainFromUri(uri: string): string {
  try {
    return new URL(uri).hostname.replace(/^www\./, "");
  } catch {
    return uri;
  }
}

export interface InteractivePayload {
  html: string;
  markdown: string;
}

export function parseInteractiveHtml(content: string): InteractivePayload | null {
  const re = /```interactive-html\s*([\s\S]*?)```/i;
  const match = content.match(re);
  if (!match) return null;
  const html = match[1]?.trim() ?? "";
  if (!html) return null;
  return {
    html,
    markdown: content.replace(re, "").trim(),
  };
}
