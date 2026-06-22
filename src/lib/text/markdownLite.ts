/**
 * markdownLite — a deliberately small parser for AI-generated question text.
 *
 * Gemini frequently leaks light markdown into `question_text` / `model_answer`
 * (pipe tables, **bold**, `inline code`, simple bullet / numbered lists). Those
 * surfaces render the field as a raw string, so the markup shows up literally
 * (e.g. a DP table printed as `| i | 0 | 1 |` rows).
 *
 * This is NOT a full markdown implementation. It only recognises the handful of
 * constructs that actually appear in real data, and splits the text into an
 * ordered list of block-level segments that <RichQuestionText> can render. Plain
 * text passes straight through as a single text segment.
 */

/** Inline-level token within a text/list-item/cell run. */
export type InlineToken =
  | { type: "text"; value: string }
  | { type: "bold"; value: string }
  | { type: "code"; value: string };

/** Block-level segment of parsed text. */
export type Segment =
  | { type: "text"; content: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "table"; headers: string[]; rows: string[][] };

const BULLET_RE = /^\s*[-*+]\s+(.*)$/;
const ORDERED_RE = /^\s*\d+[.)]\s+(.*)$/;

/**
 * A markdown table separator row, e.g. `|---|:--:|---|` or `--- | ---`.
 * Must contain at least one dash and consist solely of pipes, dashes, colons
 * and whitespace.
 */
function isSeparatorRow(line: string): boolean {
  const t = line.trim();
  return t.includes("-") && /^[|\s:-]+$/.test(t);
}

/** A plausible table row: contains a pipe and isn't a separator. */
function isTableRow(line: string): boolean {
  return line.includes("|") && !isSeparatorRow(line);
}

/** Split a `| a | b |` row into trimmed cells, tolerating missing edge pipes. */
function splitCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

/**
 * Parse raw text into ordered block segments. Tables and lists become their own
 * segments; everything else accumulates into text segments (newlines preserved).
 */
export function parseMarkdownLite(raw: string): Segment[] {
  if (!raw) return [];

  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const segments: Segment[] = [];
  let textBuf: string[] = [];

  const flushText = () => {
    if (textBuf.length === 0) return;
    // Trim leading/trailing blank lines, keep interior structure.
    const content = textBuf.join("\n").replace(/^\n+/, "").replace(/\n+$/, "");
    if (content.trim() !== "") segments.push({ type: "text", content });
    textBuf = [];
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // ── Table: a row immediately followed by a separator row ───────────────
    if (
      isTableRow(line) &&
      i + 1 < lines.length &&
      isSeparatorRow(lines[i + 1]) &&
      lines[i + 1].includes("|")
    ) {
      flushText();
      const headers = splitCells(line);
      const rows: string[][] = [];
      i += 2; // consume header + separator
      while (i < lines.length && isTableRow(lines[i])) {
        const cells = splitCells(lines[i]);
        // Normalise ragged rows to the header width.
        while (cells.length < headers.length) cells.push("");
        rows.push(cells.slice(0, headers.length));
        i += 1;
      }
      segments.push({ type: "table", headers, rows });
      continue;
    }

    // ── List: consecutive bullet or ordered items ──────────────────────────
    const bullet = BULLET_RE.exec(line);
    const ordered = ORDERED_RE.exec(line);
    if (bullet || ordered) {
      flushText();
      const isOrdered = !!ordered;
      const items: string[] = [];
      while (i < lines.length) {
        const m = isOrdered ? ORDERED_RE.exec(lines[i]) : BULLET_RE.exec(lines[i]);
        if (!m) break;
        items.push(m[1].trim());
        i += 1;
      }
      segments.push({ type: "list", ordered: isOrdered, items });
      continue;
    }

    textBuf.push(line);
    i += 1;
  }

  flushText();
  return segments;
}

/**
 * Tokenise an inline run for `**bold**` and `` `code` ``. Anything else stays
 * plain text. Intentionally ignores italics, links, etc. — they don't show up
 * in this data and would add ambiguity.
 */
export function parseInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  // Match either `code` or **bold**; capture groups distinguish them.
  const re = /`([^`]+)`|\*\*([^*]+?)\*\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      tokens.push({ type: "text", value: text.slice(last, m.index) });
    }
    if (m[1] !== undefined) {
      tokens.push({ type: "code", value: m[1] });
    } else {
      tokens.push({ type: "bold", value: m[2] });
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) {
    tokens.push({ type: "text", value: text.slice(last) });
  }
  return tokens;
}

/**
 * True when the text contains any markup this parser would transform — lets
 * callers cheaply skip the rich path for plain strings if they want.
 */
export function hasMarkdownLite(raw: string): boolean {
  if (!raw) return false;
  const segments = parseMarkdownLite(raw);
  if (segments.some((s) => s.type !== "text")) return true;
  return /`[^`]+`|\*\*[^*]+?\*\*/.test(raw);
}
