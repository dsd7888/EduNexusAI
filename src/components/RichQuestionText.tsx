/**
 * RichQuestionText — renders AI-generated question / answer text that may carry
 * light markdown leakage (pipe tables, **bold**, `code`, simple lists) as proper
 * HTML instead of a raw string. Backed by the targeted parser in
 * `@/lib/text/markdownLite`.
 *
 * Plain strings (the common case) render as an inline <span>, so this is a
 * drop-in replacement for `{question_text}` and won't disturb layouts where the
 * text sits beside a label. Anything richer renders as block content (tables,
 * lists, multi-paragraph text).
 */

import { Fragment } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";
// Registers the mhchem (`\ce{...}`) extension on the shared katex singleton.
import "katex/contrib/mhchem";
import { cn } from "@/lib/utils";
import {
  parseInline,
  parseMarkdownLite,
  type InlineToken,
  type Segment,
} from "@/lib/text/markdownLite";
import { extractLatexSegments } from "@/lib/text/latexSegments";

/**
 * Render a single LaTeX / mhchem span with KaTeX (the same in-browser engine the
 * chat uses). Server-side rasterisation (MathJax) is for PDF/Word/PPT only; on
 * screen we stay on KaTeX per the established split.
 *
 * Malformed input (which AI-generated text occasionally produces) falls back to
 * the literal source shown in a muted code style, so a faculty reviewer can spot
 * and fix it rather than seeing a crash or a red KaTeX error blob.
 */
function MathSpan({
  latex,
  displayMode,
}: {
  latex: string;
  displayMode: boolean;
}) {
  let html: string | null = null;
  try {
    html = katex.renderToString(latex, {
      displayMode,
      throwOnError: true,
      strict: false,
      output: "htmlAndMathml",
    });
  } catch {
    html = null;
  }

  if (html == null) {
    return (
      <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em] text-muted-foreground">
        {latex}
      </code>
    );
  }

  if (displayMode) {
    return (
      <span
        className="my-1 block overflow-x-auto text-center"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}

/** The original bold/code/plain inline tokeniser — untouched behaviour. */
function InlineTokens({ text }: { text: string }) {
  const tokens = parseInline(text);
  return (
    <>
      {tokens.map((tok: InlineToken, i) => {
        if (tok.type === "bold") {
          return (
            <strong key={i} className="font-semibold">
              {tok.value}
            </strong>
          );
        }
        if (tok.type === "code") {
          return (
            <code
              key={i}
              className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]"
            >
              {tok.value}
            </code>
          );
        }
        return <Fragment key={i}>{tok.value}</Fragment>;
      })}
    </>
  );
}

/**
 * Inline run renderer. Splits out math/chemistry spans and renders them with
 * KaTeX; everything else flows through the untouched {@link InlineTokens} path.
 *
 * Fast path: when a run contains no math at all, this is byte-for-byte identical
 * to the previous `Inline` — a single `parseInline` pass — so non-math questions
 * render exactly as before.
 */
function Inline({ text }: { text: string }) {
  const parts = extractLatexSegments(text);
  if (!parts.some((p) => p.type === "math")) {
    return <InlineTokens text={text} />;
  }
  return (
    <>
      {parts.map((p, i) =>
        p.type === "math" ? (
          <MathSpan key={i} latex={p.latex} displayMode={p.displayMode} />
        ) : (
          <InlineTokens key={i} text={p.value} />
        ),
      )}
    </>
  );
}

function SegmentView({ segment }: { segment: Segment }) {
  if (segment.type === "table") {
    return (
      <div className="my-2 overflow-x-auto">
        <table className="w-full border-collapse text-left text-[0.95em]">
          <thead>
            <tr>
              {segment.headers.map((h, i) => (
                <th
                  key={i}
                  className="border border-border bg-muted px-2 py-1 font-semibold"
                >
                  <Inline text={h} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {segment.rows.map((row, ri) => (
              <tr key={ri}>
                {row.map((cell, ci) => (
                  <td
                    key={ci}
                    className="border border-border px-2 py-1 align-top"
                  >
                    <Inline text={cell} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (segment.type === "list") {
    const ListTag = segment.ordered ? "ol" : "ul";
    return (
      <ListTag
        className={cn(
          "my-1 space-y-0.5 pl-5",
          segment.ordered ? "list-decimal" : "list-disc"
        )}
      >
        {segment.items.map((item, i) => (
          <li key={i}>
            <Inline text={item} />
          </li>
        ))}
      </ListTag>
    );
  }

  return (
    <div className="whitespace-pre-wrap">
      <Inline text={segment.content} />
    </div>
  );
}

export function RichQuestionText({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const segments = parseMarkdownLite(text ?? "");

  // Plain single-paragraph text → inline span, preserving prior drop-in behaviour.
  if (segments.length <= 1 && (segments[0]?.type ?? "text") === "text") {
    return (
      <span className={cn("whitespace-pre-wrap", className)}>
        <Inline text={segments[0]?.type === "text" ? segments[0].content : ""} />
      </span>
    );
  }

  return (
    <div className={cn("space-y-1", className)}>
      {segments.map((segment, i) => (
        <SegmentView key={i} segment={segment} />
      ))}
    </div>
  );
}

export default RichQuestionText;
