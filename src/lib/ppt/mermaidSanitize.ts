export function sanitizeMermaidCode(code: string): string {
  if (!code?.trim()) return code;

  const lines = code.split("\n").map((rawLine) => {
    let line = rawLine;
    const trimmed = line.trim();
    if (!trimmed) return line;

    // Skip diagram type declarations
    if (
      /^(graph|flowchart|sequenceDiagram|stateDiagram|classDiagram|gitGraph|pie|gantt|erDiagram|journey|mindmap|timeline)\b/i.test(
        trimmed
      )
    ) {
      return line;
    }

    // Strip quoted subgraph titles: subgraph "Some Title" → subgraph Some Title
    // The subgraph id["Title"] form is valid; bare subgraph "Title" is not.
    if (/^subgraph\s+"/i.test(trimmed)) {
      line = line.replace(/(\bsubgraph\s+)"([^"]+)"/i, "$1$2");
      return line;
    }

    // Rename reserved words used as node IDs (not in labels)
    // Only rename when used as a standalone node ID before --> or a bracket
    line = line.replace(
      /\bend\b(?=\s*(?:-->|---|$|\[|\(|\{))/g,
      "endNode"
    );
    line = line.replace(
      /\bstart\b(?=\s*(?:-->|---|$|\[|\(|\{))/g,
      "startNode"
    );

    // Clean content inside node labels [...], {...}, ((...))
    // Strip everything except alphanumeric, spaces, basic punctuation
    line = line.replace(/\[([^\]]*)\]/g, (_, inner) => {
      const clean = inner
        .replace(/[[\]{}()<>=!]/g, "")
        .replace(/\s+/g, " ")
        .trim();
      return `[${clean}]`;
    });
    line = line.replace(/\{([^}]*)\}/g, (_, inner) => {
      const clean = inner
        .replace(/[[\]{}()<>=!]/g, "")
        .replace(/\s+/g, " ")
        .trim();
      return `{${clean}}`;
    });

    // Clean edge label pipes |...|
    line = line.replace(/\|([^|]*)\|/g, (_, inner) => {
      const clean = inner
        .replace(/[|{}[\]()<>=!:]/g, "")
        .replace(/\s+/g, " ")
        .trim();
      return `|${clean}|`;
    });

    // Fix node IDs starting with digits.
    // (Rewritten without negative lookbehind for ES2017 compat — captures the
    // boundary char (start-of-line or any non-word/non-quote) and prepends `n`.)
    line = line.replace(
      /(^|[^"\w])(\d[\w]*)(?=\s*(?:[[({]|-->|---))/g,
      "$1n$2"
    );

    return line;
  });

  // Truncate if too many nodes (prevents render timeout)
  const sanitized = lines.join("\n");
  const nodeCount = (sanitized.match(/\w+\s*[\[({]/g) || []).length;
  if (nodeCount > 15) {
    const header =
      lines.find((l) =>
        /^(graph|flowchart|sequenceDiagram|stateDiagram)\b/i.test(l.trim())
      ) || "graph TD";
    const rest = lines
      .filter(
        (l) =>
          l.trim() &&
          !/^(graph|flowchart|sequenceDiagram|stateDiagram)\b/i.test(l.trim())
      )
      .slice(0, 15);
    return [header, ...rest].join("\n");
  }

  return sanitized;
}
