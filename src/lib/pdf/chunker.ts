export interface ChunkOptions {
  maxTokens?: number; // default 500
  overlapTokens?: number; // default 50
}

export interface TextChunk {
  content: string;
  index: number;
  startChar: number;
  endChar: number;
}

type SentenceSpan = {
  start: number;
  end: number; // exclusive
  tokens: number;
};

function estimateTokens(text: string): number {
  // Very rough approximation: ~4 chars per token
  return Math.max(1, Math.ceil(text.length / 4));
}

function splitIntoSentences(text: string): SentenceSpan[] {
  const spans: SentenceSpan[] = [];

  // Matches "sentences" ending in ., !, ? including following whitespace (or EOF)
  const re = /[^.!?]+[.!?]+(?:\s+|$)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const start = match.index;
    const end = match.index + match[0].length;
    const slice = text.slice(start, end);
    spans.push({ start, end, tokens: estimateTokens(slice) });
  }

  // Capture any remaining trailing text (e.g., last sentence without punctuation)
  const lastEnd = spans.length > 0 ? spans[spans.length - 1].end : 0;
  if (lastEnd < text.length) {
    const tail = text.slice(lastEnd);
    if (tail.trim().length > 0) {
      spans.push({
        start: lastEnd,
        end: text.length,
        tokens: estimateTokens(tail),
      });
    }
  }

  // Fallback: if regex didn't match but there's text
  if (spans.length === 0 && text.trim().length > 0) {
    spans.push({ start: 0, end: text.length, tokens: estimateTokens(text) });
  }

  return spans;
}

export function chunkText(text: string, options?: ChunkOptions): TextChunk[] {
  const raw = text ?? "";
  if (!raw.trim()) return [];

  const maxTokens = Math.max(1, options?.maxTokens ?? 500);
  const overlapTokens = Math.max(0, options?.overlapTokens ?? 50);

  const sentences = splitIntoSentences(raw);
  if (sentences.length === 0) return [];

  const chunks: TextChunk[] = [];
  let cursor = 0;

  while (cursor < sentences.length) {
    const startIdx = cursor;
    let tokenSum = 0;
    let endIdx = startIdx;

    for (let i = startIdx; i < sentences.length; i++) {
      const t = sentences[i].tokens;
      if (i === startIdx || tokenSum + t <= maxTokens) {
        tokenSum += t;
        endIdx = i;
      } else {
        break;
      }
    }

    const startChar = sentences[startIdx].start;
    const endChar = sentences[endIdx].end;
    const content = raw.slice(startChar, endChar).trim();

    chunks.push({
      content,
      index: chunks.length,
      startChar,
      endChar,
    });

    if (endIdx >= sentences.length - 1) break;

    if (overlapTokens <= 0) {
      cursor = endIdx + 1;
      continue;
    }

    // Choose overlap start based on token budget, walking backwards.
    let overlapStartIdx = endIdx;
    let overlapSum = 0;
    for (let j = endIdx; j >= startIdx; j--) {
      const t = sentences[j].tokens;
      // Always include at least the last sentence in overlap when overlapTokens > 0
      if (j !== endIdx && overlapSum + t > overlapTokens) break;
      overlapSum += t;
      overlapStartIdx = j;
      if (overlapSum >= overlapTokens) break;
    }

    // Ensure forward progress to avoid infinite loops on tiny chunks.
    cursor = overlapStartIdx <= startIdx ? endIdx + 1 : overlapStartIdx;
  }

  return chunks;
}
