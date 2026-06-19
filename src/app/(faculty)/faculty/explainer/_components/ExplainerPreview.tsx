"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Copy,
  ExternalLink,
  Loader2,
  Sparkles,
  Trash2,
  Volume2,
} from "lucide-react";
import {
  copyExplainerLink,
  formatDuration,
  type PreviewState,
} from "./shared";

const GENERATING_MESSAGES = [
  "Thinking like a professor...",
  "Identifying the best visualization...",
  "Building the animation...",
  "Almost ready...",
];

interface Props {
  state: PreviewState;
  onTryAgain: () => void;
  onDelete: (id: string) => void;
  deleting: boolean;
}

export function ExplainerPreview({
  state,
  onTryAgain,
  onDelete,
  deleting,
}: Props) {
  // ── Empty ──────────────────────────────────────────────────────────────
  if (state.kind === "empty") {
    return (
      <div className="flex h-full min-h-[420px] flex-col items-center justify-center gap-5 p-6">
        <AnimatedPlaceholder />
        <p className="text-center text-sm font-medium text-muted-foreground">
          Generate your first explainer →
        </p>
      </div>
    );
  }

  // ── Generating ─────────────────────────────────────────────────────────
  if (state.kind === "generating") {
    return <GeneratingState />;
  }

  // ── Error ──────────────────────────────────────────────────────────────
  if (state.kind === "error") {
    return (
      <div className="flex h-full min-h-[420px] flex-col items-center justify-center gap-4 p-6 text-center">
        <div className="flex size-14 items-center justify-center rounded-full bg-destructive/10">
          <Sparkles className="size-7 text-destructive" />
        </div>
        <p className="max-w-sm text-sm text-muted-foreground">{state.message}</p>
        <Button onClick={onTryAgain} variant="outline">
          Try Again
        </Button>
      </div>
    );
  }

  // ── Result ─────────────────────────────────────────────────────────────
  const ex = state.explainer;
  return (
    <div className="space-y-4 p-1">
      {/*
        The animation engine needs scripts (allow-scripts) and same-origin so it
        can use new Audio() for voiceover playback. The player autoplays on load.
      */}
      <iframe
        title={`Explainer: ${ex.topic}`}
        className="aspect-video w-full rounded-lg border border-border bg-black"
        sandbox="allow-scripts allow-same-origin"
        {...(ex.srcDoc ? { srcDoc: ex.srcDoc } : { src: ex.url })}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => copyExplainerLink(ex.short_code)}
        >
          <Copy className="size-4" />
          Copy Link
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => window.open(`/e/${ex.short_code}`, "_blank")}
        >
          <ExternalLink className="size-4" />
          Open in New Tab
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="text-destructive hover:text-destructive"
          disabled={deleting}
          onClick={() => onDelete(ex.id)}
        >
          {deleting ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Trash2 className="size-4" />
          )}
          Delete
        </Button>

        <div className="ml-auto flex items-center gap-2">
          <Badge variant="secondary">{formatDuration(ex.duration_seconds)}</Badge>
          {ex.has_audio && (
            <Badge
              variant="outline"
              className="gap-1 text-emerald-400 border-emerald-400/40"
            >
              <Volume2 className="size-3" />
              Audio
            </Badge>
          )}
        </div>
      </div>

      <p className="text-center text-xs text-muted-foreground">
        Share this link with students — works on any device
      </p>
    </div>
  );
}

// ─── Generating state with rotating messages ──────────────────────────────

function GeneratingState() {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    const t = setInterval(
      () => setIdx((i) => (i + 1) % GENERATING_MESSAGES.length),
      3000
    );
    return () => clearInterval(t);
  }, []);
  return (
    <div className="flex h-full min-h-[420px] flex-col items-center justify-center gap-5 p-6">
      <Loader2 className="size-12 animate-spin text-primary" />
      <p className="text-center text-sm font-medium text-muted-foreground transition-opacity">
        {GENERATING_MESSAGES[idx]}
      </p>
    </div>
  );
}

// ─── Animated empty-state placeholder ─────────────────────────────────────
// A lightweight mock of an explainer canvas: two pulsing nodes joined by a
// drawn edge, with a caption bar — hints at what gets generated.

function AnimatedPlaceholder() {
  return (
    <div className="relative aspect-video w-full max-w-md overflow-hidden rounded-lg border border-border bg-gradient-to-br from-slate-900 to-slate-800">
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 56">
        <line
          x1="28"
          y1="22"
          x2="62"
          y2="34"
          stroke="#60a5fa"
          strokeWidth="0.6"
          strokeDasharray="3"
          className="animate-pulse"
        />
      </svg>
      <div
        className="absolute left-[20%] top-[28%] size-10 animate-pulse rounded-full border-2 border-blue-400/60 bg-blue-500/20"
        style={{ animationDelay: "0s" }}
      />
      <div
        className="absolute left-[55%] top-[48%] size-10 animate-pulse rounded-full border-2 border-amber-400/60 bg-amber-500/20"
        style={{ animationDelay: "0.5s" }}
      />
      <div
        className="absolute right-[14%] top-[20%] h-8 w-16 animate-pulse rounded-md border border-emerald-400/40 bg-emerald-500/10"
        style={{ animationDelay: "1s" }}
      />
      <div className="absolute inset-x-0 bottom-0 flex h-9 items-center justify-center bg-black/50 text-[11px] text-slate-300">
        A short, animated explanation appears here
      </div>
    </div>
  );
}
