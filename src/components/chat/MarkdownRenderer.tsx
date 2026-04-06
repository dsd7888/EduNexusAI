"use client";

import "katex/dist/katex.min.css";

import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { lazy, Suspense, type ReactNode, useMemo } from "react";

const MermaidDiagram = lazy(() => import("./MermaidDiagram"));
import { SVGDiagram } from "./SVGDiagram";

interface Props {
  content: string;
}

function parseMessageSegments(content: string): Array<
  | { type: "text"; content: string }
  | { type: "mermaid"; code: string }
  | { type: "svg"; code: string }
> {
  const segments: Array<
    | { type: "text"; content: string }
    | { type: "mermaid"; code: string }
    | { type: "svg"; code: string }
  > = [];

  // Match: fenced ```svg, fenced ```mermaid, OR raw <svg...>...</svg> blocks
  const fenceRegex = /```(mermaid|svg)\n([\s\S]*?)```|(<svg[\s\S]*?<\/svg>)/gi;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = fenceRegex.exec(content)) !== null) {
    // Text before this match
    if (match.index > lastIndex) {
      segments.push({
        type: "text",
        content: content.slice(lastIndex, match.index),
      });
    }

    if (match[1] && match[2]) {
      // Fenced block: ```mermaid or ```svg
      const fenceType = match[1].toLowerCase() as "mermaid" | "svg";
      segments.push({ type: fenceType, code: match[2].trim() });
    } else if (match[3]) {
      // Raw <svg>...</svg> block
      segments.push({ type: "svg", code: match[3].trim() });
    }

    lastIndex = match.index + match[0].length;
  }

  // Remaining text
  if (lastIndex < content.length) {
    segments.push({ type: "text", content: content.slice(lastIndex) });
  }

  return segments;
}

export default function MarkdownRenderer({ content }: Props) {
  const segments = useMemo(() => parseMessageSegments(content), [content]);

  return (
    <div>
      {segments.map((segment, idx) => {
        if (segment.type === "mermaid") {
          return (
            <Suspense
              key={`seg-${idx}`}
              fallback={
                <div className="flex h-32 items-center justify-center rounded-lg bg-muted/50">
                  <span className="text-xs text-muted-foreground">
                    Loading diagram...
                  </span>
                </div>
              }
            >
              <MermaidDiagram chart={segment.code} />
            </Suspense>
          );
        }
        if (segment.type === "svg") {
          return <SVGDiagram key={`seg-${idx}`} svgCode={segment.code} />;
        }
        return (
          <ReactMarkdown
            key={`seg-${idx}`}
            remarkPlugins={[remarkMath, remarkGfm]}
            rehypePlugins={[rehypeKatex]}
            components={{
              p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
              ul: ({ children }) => (
                <ul className="mb-2 list-disc space-y-1 pl-4">{children}</ul>
              ),
              ol: ({ children }) => (
                <ol className="mb-2 list-decimal space-y-1 pl-4">{children}</ol>
              ),
              li: ({ children }) => <li className="text-sm">{children}</li>,
              strong: ({ children }) => (
                <strong className="font-semibold">{children}</strong>
              ),
              h3: ({ children }) => (
                <h3 className="mt-3 mb-1 text-base font-semibold">{children}</h3>
              ),
              h4: ({ children }) => (
                <h4 className="mt-2 mb-1 text-sm font-semibold">{children}</h4>
              ),
              hr: () => <hr className="my-3 border-border" />,
              table({ children, ...props }: any) {
                return (
                  <div className="my-3 overflow-x-auto">
                    <table className="w-full border-collapse text-sm" {...props}>
                      {children}
                    </table>
                  </div>
                );
              },
              thead({ children, ...props }: any) {
                return (
                  <thead className="bg-muted/60 font-semibold" {...props}>
                    {children}
                  </thead>
                );
              },
              th({ children, ...props }: any) {
                return (
                  <th
                    className="border border-border px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                    {...props}
                  >
                    {children}
                  </th>
                );
              },
              td({ children, ...props }: any) {
                return (
                  <td className="border border-border px-3 py-2 text-sm" {...props}>
                    {children}
                  </td>
                );
              },
              tr({ children, ...props }: any) {
                return (
                  <tr
                    className="even:bg-muted/20 transition-colors hover:bg-muted/40"
                    {...props}
                  >
                    {children}
                  </tr>
                );
              },
              pre: ({ children }) => (
                <pre className="my-2 overflow-x-auto rounded-lg bg-muted p-3 text-sm">
                  {children}
                </pre>
              ),
              code: ({
                className,
                children,
                inline,
                ...props
              }: {
                className?: string;
                children?: ReactNode;
                inline?: boolean;
              }) => {
                if (!inline) {
                  return (
                    <code className={className} {...props}>
                      {children}
                    </code>
                  );
                }

                return (
                  <code
                    className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs"
                    {...props}
                  >
                    {children}
                  </code>
                );
              },
            }}
          >
            {segment.content}
          </ReactMarkdown>
        );
      })}
    </div>
  );
}
