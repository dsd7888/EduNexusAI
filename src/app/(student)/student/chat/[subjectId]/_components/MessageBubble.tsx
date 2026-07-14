"use client";

import { Card, CardContent } from "@/components/ui/card";
import MarkdownRenderer from "@/components/chat/MarkdownRenderer";
import {
  BookOpenText,
  Check,
  Copy,
  Eye,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Wand2,
  Zap,
} from "lucide-react";
import { useState } from "react";
import { useDebouncedStreamText } from "./hooks";
import { parseInteractiveHtml } from "./helpers";
import { InteractiveHtmlViewer } from "./InteractiveHtmlViewer";
import { CitationList } from "./CitationList";
import { SuggestionChip } from "./SuggestionChips";
import type { UiMessage } from "./types";

interface Props {
  message: UiMessage;
  onRetry: (id: string) => void;
  onRegenerate: (id: string) => void;
  onSimplify: (id: string) => void;
  onGoDeeper: (id: string) => void;
  onVisualize: (id: string) => void;
  onSuggestionTap: (text: string) => void;
}

function ThinkingDots() {
  return (
    <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
      <span>Thinking</span>
      <span className="inline-flex gap-0.5">
        <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground/60" />
        <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground/60 [animation-delay:150ms]" />
        <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground/60 [animation-delay:300ms]" />
      </span>
    </div>
  );
}

export function MessageBubble({
  message,
  onRetry,
  onRegenerate,
  onSimplify,
  onGoDeeper,
  onVisualize,
  onSuggestionTap,
}: Props) {
  const [copied, setCopied] = useState(false);
  const streaming = message.status === "streaming";
  const renderedContent = useDebouncedStreamText(message.content, streaming, 80);

  if (message.role === "user") {
    return (
      <div className="flex animate-in fade-in slide-in-from-bottom-1 justify-end duration-200">
        <div className="max-w-[90%] whitespace-pre-wrap rounded-2xl bg-blue-600 px-4 py-2 text-sm text-white sm:text-[0.95rem]">
          {message.content}
        </div>
      </div>
    );
  }

  const handleCopy = async () => {
    const full = message.trailingChip
      ? `${message.content}\n\n${message.trailingChip}`
      : message.content;
    try {
      await navigator.clipboard.writeText(full);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable — silently ignore, non-critical affordance
    }
  };

  const interactive = message.status === "done" ? parseInteractiveHtml(renderedContent) : null;

  return (
    <div className="group flex animate-in fade-in slide-in-from-bottom-1 justify-start duration-200">
      <Card className="max-w-[90%] border bg-card">
        <CardContent className="px-4 py-3">
          {message.status === "thinking" ? (
            <ThinkingDots />
          ) : message.status === "error" ? (
            <div className="space-y-2">
              <p className="text-sm text-destructive">{message.errorMessage}</p>
              {message.retryable !== false && (
                <button
                  type="button"
                  onClick={() => onRetry(message.id)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-foreground hover:bg-accent"
                >
                  <RotateCcw className="h-3 w-3" />
                  Retry
                </button>
              )}
            </div>
          ) : (
            <>
              {message.cached && (
                <div className="mb-2 inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                  <Zap className="h-2.5 w-2.5" />
                  Instant answer
                </div>
              )}
              {message.autoElevated && (
                <div className="mb-2 inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-medium text-violet-700 dark:bg-violet-950/40 dark:text-violet-300">
                  <Wand2 className="h-2.5 w-2.5" />
                  Deep reasoning
                </div>
              )}

              {interactive ? (
                <>
                  {interactive.markdown ? <MarkdownRenderer content={interactive.markdown} /> : null}
                  <InteractiveHtmlViewer htmlContent={interactive.html} />
                </>
              ) : (
                <span className="relative">
                  <MarkdownRenderer content={renderedContent} />
                  {streaming && (
                    <span className="ml-0.5 inline-block h-4 w-[2px] animate-pulse bg-foreground align-middle" />
                  )}
                </span>
              )}

              {message.effectiveMode === "research" && message.citations && (
                <CitationList citations={message.citations} />
              )}

              {message.status === "done" && message.trailingChip && (
                <SuggestionChip text={message.trailingChip} onSelect={onSuggestionTap} />
              )}

              {message.status === "done" && (
                <div className="mt-2 flex items-center gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
                  <button
                    type="button"
                    onClick={handleCopy}
                    aria-label="Copy"
                    className="flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  >
                    {copied ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
                    {copied ? "Copied" : "Copy"}
                  </button>
                  <button
                    type="button"
                    onClick={() => onRegenerate(message.id)}
                    aria-label="Regenerate"
                    className="flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  >
                    <RefreshCw className="h-3 w-3" />
                    Regenerate
                  </button>
                  <button
                    type="button"
                    onClick={() => onSimplify(message.id)}
                    aria-label="Simplify"
                    className="flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  >
                    <BookOpenText className="h-3 w-3" />
                    Simplify
                  </button>
                  <button
                    type="button"
                    onClick={() => onGoDeeper(message.id)}
                    aria-label="Go deeper"
                    className="flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  >
                    <Sparkles className="h-3 w-3" />
                    Go deeper
                  </button>
                  {!interactive && !message.content.includes("interactive-html") && (
                    <button
                      type="button"
                      onClick={() => onVisualize(message.id)}
                      aria-label="Visualize"
                      className="flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                    >
                      <Eye className="h-3 w-3" />
                      Visualize
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
