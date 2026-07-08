"use client";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Wand2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEffect, useRef, type RefObject } from "react";

// ─── SHARED SLIDE-CHAT CONSOLE ────────────────────────────────────────────────
//
// The chat interaction surface shared by the standalone PPT tool
// (/faculty/refine) and the post-gen refine flow (/faculty/generate/refine/…):
// the suggestion-chip empty state, the message log, and the input + send row.
//
// It intentionally owns NO pipeline logic. Everything surface-specific — the
// slide list (reorder/delete/insert vs. checkbox selection), the slide preview,
// message-log STORAGE (a single array cleared on slide switch vs. a per-slide
// map), and how an instruction is actually applied — stays in the two pages and
// is injected via props/callbacks. This is the mature post-gen flow's exact
// markup and behaviour, so migrating that flow onto this component is a pure
// extraction with zero observable change; the standalone tool adopts the same
// look but keeps its send-on-chip-click via `chipBehavior`.

export interface ChatConsoleMessage {
  role: "user" | "assistant";
  content: string;
  isError?: boolean;
}

export interface SlideChatConsoleProps {
  /** Whether a slide is selected/active — drives the empty state and input lock. */
  hasSelection: boolean;
  /** The transcript to render. The CALLER owns storage (single array reset on
   *  slide switch, or a per-slide map) — the console only renders what it's given,
   *  so there is never message-log bleed between slides in either pipeline. */
  messages: ChatConsoleMessage[];
  /** Suggestion chips, already resolved by slide type by the caller so each
   *  surface keeps its own fallback (post-gen `?? []`, standalone a DEFAULT set). */
  suggestions: string[];
  /** Controlled input value + setter. The parent owns clear-on-send semantics. */
  input: string;
  onInputChange: (value: string) => void;
  /** Apply the instruction. The parent adds the user message, calls the API, etc. */
  onSend: (instruction: string) => void;
  /** True while a send is in flight — locks the input and shows the typing dots. */
  isBusy: boolean;
  /** Chip click: "fill" drops the text into the input and focuses it (post-gen);
   *  "send" submits it immediately (standalone's instant-patch UX). */
  chipBehavior: "fill" | "send";
  placeholder: string;
  /** Shown when no slide is selected and the log is empty (post-gen only reaches
   *  this state). */
  emptyStateText?: string;
  /** Optional external ref to the textarea — the post-gen flow focuses it from
   *  its slide list ("+ Add slide after"). Defaults to an internal ref. */
  inputRef?: RefObject<HTMLTextAreaElement | null>;
}

export function SlideChatConsole({
  hasSelection,
  messages,
  suggestions,
  input,
  onInputChange,
  onSend,
  isBusy,
  chipBehavior,
  placeholder,
  emptyStateText = "Select any slide to start refining",
  inputRef,
}: SlideChatConsoleProps) {
  const internalRef = useRef<HTMLTextAreaElement | null>(null);
  const textareaRef = inputRef ?? internalRef;
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll to the newest message (identical to the post-gen flow's effect).
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, isBusy]);

  const submit = () => {
    if (!input.trim() || !hasSelection || isBusy) return;
    onSend(input);
  };

  const handleChip = (s: string) => {
    if (chipBehavior === "send") {
      if (isBusy) return;
      onSend(s);
    } else {
      onInputChange(s);
      textareaRef.current?.focus();
    }
  };

  return (
    <>
      {/* MESSAGES */}
      <div className="flex-1 overflow-y-auto min-h-0 px-4 py-4 space-y-3">
        {messages.length === 0 && !hasSelection ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-muted-foreground">
            <Wand2 className="h-10 w-10 opacity-40" />
            <p className="text-sm">{emptyStateText}</p>
          </div>
        ) : null}

        {messages.length === 0 && hasSelection ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Try
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => handleChip(s)}
                  className="rounded-full border bg-white px-3 py-1.5 text-xs text-foreground transition hover:bg-muted"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {messages.map((m, i) =>
          m.role === "user" ? (
            <div
              key={i}
              className="ml-auto max-w-[80%] rounded-2xl rounded-tr-sm bg-primary px-3 py-2 text-sm text-primary-foreground"
            >
              {m.content}
            </div>
          ) : (
            <div
              key={i}
              className={cn(
                "max-w-[80%] rounded-2xl rounded-tl-sm px-3 py-2 text-sm",
                m.isError
                  ? "border border-red-200 bg-red-50 text-red-700"
                  : "bg-muted text-foreground"
              )}
            >
              {m.content}
            </div>
          )
        )}

        {isBusy ? (
          <div className="flex max-w-[80%] items-center gap-1 rounded-2xl rounded-tl-sm bg-muted px-4 py-3">
            <span
              className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/60"
              style={{ animationDelay: "0ms" }}
            />
            <span
              className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/60"
              style={{ animationDelay: "150ms" }}
            />
            <span
              className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/60"
              style={{ animationDelay: "300ms" }}
            />
          </div>
        ) : null}

        <div ref={messagesEndRef} />
      </div>

      {/* INPUT */}
      <div className="shrink-0 border-t px-4 py-3 bg-background flex gap-2 items-end">
        <Textarea
          ref={textareaRef}
          rows={2}
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          disabled={!hasSelection || isBusy}
          placeholder={placeholder}
          className="flex-1 resize-none"
        />
        <Button
          onClick={submit}
          disabled={!input.trim() || !hasSelection || isBusy}
          size="icon"
          className="shrink-0"
          aria-label="Send"
        >
          <Wand2 className="h-4 w-4" />
        </Button>
      </div>
    </>
  );
}
