"use client";

import { useEffect, useRef, useState } from "react";

function sanitizeMermaidCode(code: string): string {
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

interface Props {
  chart: string;
}

export default function MermaidDiagram({ chart }: Props) {
  const [loading, setLoading] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;

    const render = async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          theme: "base",
          themeVariables: {
            primaryColor: "#EFF6FF",
            primaryBorderColor: "#2563EB",
            primaryTextColor: "#1E293B",
            lineColor: "#64748B",
            fontSize: "14px",
          },
          securityLevel: "loose",
        });

        const id = `mermaid-${Math.random().toString(36).slice(2)}`;
        const safeChart = sanitizeMermaidCode(chart.trim());

        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Mermaid render timeout")), 8000)
        );

        const { svg } = await Promise.race([
          mermaid.render(id, safeChart),
          timeoutPromise,
        ]);

        if (!cancelled && containerRef.current) {
          containerRef.current.innerHTML = svg;
          setLoading(false);
        }
      } catch (err) {
        console.warn("[MermaidDiagram] render error:", err);
        // Fallback: show sanitized code as readable text block
        // This ensures something useful always appears even if Mermaid fails
        if (containerRef.current) {
          containerRef.current.innerHTML = `
            <div style="background:#f1f5f9;border:1px solid #cbd5e1;border-radius:8px;padding:12px;font-family:monospace;font-size:12px;white-space:pre-wrap;color:#475569;overflow-x:auto;">
              ${chart.replace(/</g, "&lt;").replace(/>/g, "&gt;")}
            </div>
          `;
        }
        if (!cancelled) setLoading(false);
      }
    };

    render();
    return () => {
      cancelled = true;
    };
  }, [chart]);

  return (
    <div className="my-2 overflow-x-auto rounded-lg border border-blue-100 bg-blue-50/50 p-3 dark:border-blue-900 dark:bg-blue-950/20">
      {loading && (
        <div className="flex h-32 items-center justify-center">
          <span className="text-xs text-muted-foreground">
            Loading diagram...
          </span>
        </div>
      )}
      <div ref={containerRef} />
    </div>
  );
}
