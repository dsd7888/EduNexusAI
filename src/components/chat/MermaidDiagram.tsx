"use client";

import { useEffect, useState } from "react";

function sanitizeMermaidCode(code: string): string {
  return code
    // Replace parentheses inside edge labels |...|
    // e.g. |Heat Input (Q_in)| → |Heat Input Q_in|
    .replace(/\|([^|]*)\(([^)]*)\)([^|]*)\|/g, "|$1$2$3|")
    // Replace special chars that break Mermaid parser in labels
    .replace(/\|([^|]*)[{}]([^|]*)\|/g, "|$1$2|")
    // Remove subscript notation in labels (Q_in → Qin)
    .replace(/\|([^|]*)_([^|]*)\|/g, (_, pre, post) => `|${pre}${post}|`)
    // Trim whitespace in labels
    .replace(/\|\s+/g, "|")
    .replace(/\s+\|/g, "|");
}

interface Props {
  chart: string;
}

export default function MermaidDiagram({ chart }: Props) {
  const [error, setError] = useState(false);
  const [svg, setSvg] = useState<string>("");

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
        const { svg } = await mermaid.render(id, safeChart);
        if (!cancelled) setSvg(svg);
      } catch (err) {
        console.error("[MermaidDiagram] render error:", err);
        if (!cancelled) setError(true);
      }
    };

    render();
    return () => {
      cancelled = true;
    };
  }, [chart]);

  if (error) {
    return (
      <pre className="overflow-x-auto rounded-lg bg-muted p-3 text-xs">
        <code>{chart}</code>
      </pre>
    );
  }

  if (!svg) {
    return (
      <div className="flex h-32 items-center justify-center rounded-lg bg-muted/50">
        <span className="text-xs text-muted-foreground">Loading diagram...</span>
      </div>
    );
  }

  return (
    <div
      className="my-2 overflow-x-auto rounded-lg border border-blue-100 bg-blue-50/50 p-3 dark:border-blue-900 dark:bg-blue-950/20"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
