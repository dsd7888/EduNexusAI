"use client";

import { ArrowDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { MessageBubble } from "./MessageBubble";
import { OrphanResumeCard } from "./OrphanResumeCard";
import { SuggestionGrid } from "./SuggestionChips";
import type { UiMessage } from "./types";

interface Props {
  messages: UiMessage[];
  suggestedPrompts: string[];
  onSuggestionSelect: (text: string) => void;
  onRetry: (id: string) => void;
  onRegenerate: (id: string) => void;
  onSimplify: (id: string) => void;
  onGoDeeper: (id: string) => void;
  onVisualize: (id: string) => void;
  /** Set once, on session resume, when the last loaded message is a user
   * turn with no assistant reply — cleared as soon as any new exchange starts. */
  orphanMessage?: string | null;
  onGetOrphanAnswer?: () => void;
}

const PIN_THRESHOLD_PX = 120;

export function MessageList({
  messages,
  suggestedPrompts,
  onSuggestionSelect,
  onRetry,
  onRegenerate,
  onSimplify,
  onGoDeeper,
  onVisualize,
  orphanMessage,
  onGetOrphanAnswer,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(true);

  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setPinned(distanceFromBottom < PIN_THRESHOLD_PX);
  };

  useEffect(() => {
    if (!pinned) return;
    const el = containerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages, pinned]);

  const jumpToLatest = () => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    setPinned(true);
  };

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="h-full overflow-y-auto px-2 py-4 sm:px-3"
      >
        {messages.length === 0 ? (
          <SuggestionGrid prompts={suggestedPrompts} onSelect={onSuggestionSelect} />
        ) : (
          <div className="space-y-4">
            {messages.map((m) => (
              <MessageBubble
                key={m.id}
                message={m}
                onRetry={onRetry}
                onRegenerate={onRegenerate}
                onSimplify={onSimplify}
                onGoDeeper={onGoDeeper}
                onVisualize={onVisualize}
                onSuggestionTap={onSuggestionSelect}
              />
            ))}
            {orphanMessage && onGetOrphanAnswer && (
              <OrphanResumeCard onGetAnswer={onGetOrphanAnswer} />
            )}
          </div>
        )}
      </div>

      {!pinned && messages.length > 0 && (
        <button
          type="button"
          onClick={jumpToLatest}
          className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium shadow-md transition-colors hover:bg-accent"
        >
          <ArrowDown className="h-3 w-3" />
          Jump to latest
        </button>
      )}
    </div>
  );
}
