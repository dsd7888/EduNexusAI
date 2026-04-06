"use client";

import { useEffect, useRef, useState } from "react";

function sanitizeMermaidCode(code: string): string {
  if (!code || code.trim().length === 0) return code;

  const lines = code.split("\n");

  const sanitizedLines = lines.map((line) => {
    const trimmed = line.trim();

    // Skip empty lines and directive lines (graph TD, flowchart LR, etc.)
    if (
      !trimmed ||
      /^(graph|flowchart|sequenceDiagram|stateDiagram|classDiagram|gitGraph|pie|gantt|erDiagram|journey|mindmap|timeline)\b/i.test(
        trimmed
      )
    ) {
      return line;
    }

    // Fix edge labels: content inside |...| pipes
    let result = line.replace(/\|([^|]*)\|/g, (_, label) => {
      const cleaned = label
        .replace(/[(){}]/g, "")
        .replace(/_/g, " ")
        .replace(/:/g, "-")
        .replace(/[<>&%#"]/g, "")
        .replace(/\s{2,}/g, " ")
        .trim();
      return `|${cleaned}|`;
    });

    // Fix node labels: content inside [...] that contain special chars
    result = result.replace(/(\w+)\[([^\]]*)\]/g, (match, id, label) => {
      const needsQuoting = /[:&<>%#]/.test(label);
      if (needsQuoting) {
        const cleaned = label
          .replace(/:/g, " -")
          .replace(/[&<>%#]/g, "")
          .replace(/"/g, "'")
          .trim();
        return `${id}["${cleaned}"]`;
      }
      return match;
    });

    // Fix node IDs that start with a number (invalid in Mermaid)
    result = result.replace(
      /(?:^|\s)(\d[\w]*)\s*(?:\[|\(|\{|-->|---)/g,
      (match) => match.replace(/(\d[\w]*)/, "n$1")
    );

    // Fix subgraph labels with colons
    result = result.replace(
      /^(\s*subgraph\s+)(.+)$/,
      (_, prefix, label) =>
        prefix + label.replace(/:/g, " -").replace(/[&<>%#]/g, "")
    );

    return result;
  });

  const sanitized = sanitizedLines.join("\n");

  // Final pass: if the diagram has >15 nodes, truncate to prevent render timeouts
  const nodeCount = (sanitized.match(/\w+\s*[\[({]/g) || []).length;
  if (nodeCount > 15) {
    const header =
      sanitizedLines.find((l) =>
        /^(graph|flowchart|sequenceDiagram|stateDiagram)\b/i.test(l.trim())
      ) || "graph TD";
    const nodeLines = sanitizedLines
      .filter(
        (l) =>
          l.trim() &&
          !/^(graph|flowchart|sequenceDiagram|stateDiagram)\b/i.test(l.trim())
      )
      .slice(0, 15);
    return [header, ...nodeLines].join("\n");
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
