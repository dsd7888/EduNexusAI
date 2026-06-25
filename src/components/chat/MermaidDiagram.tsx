"use client";

import { useEffect, useRef, useState } from "react";
import { sanitizeMermaidCode } from "@/lib/ppt/mermaidSanitize";

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
