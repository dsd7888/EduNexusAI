"use client";

import { ChevronDown, ChevronUp, RefreshCw, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import MermaidDiagram from "@/components/chat/MermaidDiagram";
import {
  VIZ_CONCEPTUAL_FALLBACK_NOTE,
  VIZ_LABEL,
  VIZ_LOADING_COPY,
  VIZ_LOADING_COPY_GENERIC,
  type VizClassification,
  type VizPayloadKind,
  type VizType,
} from "@/lib/ai/vizTypes";
import { InteractiveHtmlViewer } from "./InteractiveHtmlViewer";

interface Props {
  sessionId: string;
  subjectId: string;
  messageId: string;
  onClose: () => void;
}

interface VizResult {
  vizType: VizType;
  payload: string;
  payloadKind: VizPayloadKind;
  classification: VizClassification;
}

type PanelState =
  | { phase: "loading" }
  | { phase: "ready"; result: VizResult }
  | { phase: "error"; message: string };

/**
 * Inline visualization panel for one assistant message.
 *
 * Owns its own fetch and state so a visualization is never a chat message —
 * errors retry in place rather than polluting the transcript (the old
 * prompt-prefix path made every attempt, and every failure, a visible turn).
 *
 * The classification from call 1 is held here and replayed on Regenerate, so a
 * regenerate costs ONE AI call (generation only), not two.
 */
export function VisualizationPanel({
  sessionId,
  subjectId,
  messageId,
  onClose,
}: Props) {
  const [state, setState] = useState<PanelState>({ phase: "loading" });
  const [collapsed, setCollapsed] = useState(false);
  // Held in state, not a ref: the header label and loading copy read it during
  // render, and a ref mutation would not re-render them. Set once, by call 1.
  const [classification, setClassification] = useState<VizClassification | null>(
    null
  );

  // Guards against a slow in-flight response overwriting a newer one.
  const requestIdRef = useRef(0);

  /**
   * `reuse` is passed in rather than read from state so this callback never
   * depends on the classification — otherwise the mount effect below would
   * re-fire every time a build stored one, looping forever.
   *
   * Does NOT set the loading phase itself: the mount effect relies on the
   * initial state already being "loading", which keeps this free of a
   * synchronous setState during the effect. Re-runs go through `rebuild`.
   */
  const build = useCallback(
    async (reuse: VizClassification | null) => {
      const requestId = ++requestIdRef.current;

      try {
        const res = await fetch("/api/chat/visualize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId,
            subjectId,
            messageId,
            // Present only on regenerate/retry — the server re-validates it and
            // falls back to a fresh classification if it is unusable.
            classification: reuse ?? undefined,
          }),
        });

        const data = await res.json().catch(() => ({}));
        if (requestId !== requestIdRef.current) return;

        if (!res.ok) {
          setState({
            phase: "error",
            message:
              typeof data?.message === "string"
                ? data.message
                : "Couldn't build this visualization.",
          });
          return;
        }

        if (data.classification) setClassification(data.classification);
        setState({ phase: "ready", result: data as VizResult });
      } catch {
        if (requestId !== requestIdRef.current) return;
        setState({
          phase: "error",
          message: "Couldn't reach the server. Check your connection.",
        });
      }
    },
    [sessionId, subjectId, messageId]
  );

  /** Regenerate / retry: show loading, then run. */
  const rebuild = useCallback(
    (reuse: VizClassification | null) => {
      setState({ phase: "loading" });
      void build(reuse);
    },
    [build]
  );

  useEffect(() => {
    void build(null);
  }, [build]);

  const knownType = classification?.vizType;
  const headerLabel = knownType ? VIZ_LABEL[knownType] : "Visualization";

  return (
    <div className="mt-3 rounded-xl border border-border bg-muted/30">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <span className="text-xs font-medium text-foreground">{headerLabel}</span>
        <div className="flex items-center gap-1">
          {state.phase === "ready" && (
            <button
              type="button"
              onClick={() => rebuild(classification)}
              aria-label="Regenerate visualization"
              className="flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            >
              <RefreshCw className="h-3 w-3" />
              Regenerate
            </button>
          )}
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? "Expand visualization" : "Collapse visualization"}
            className="flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          >
            {collapsed ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
            {collapsed ? "Show" : "Hide"}
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close visualization"
            className="flex h-6 items-center rounded-md px-1.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          >
            Close
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="px-3 py-3">
          {state.phase === "loading" && (
            <div className="flex items-center gap-2.5 py-6 text-sm text-muted-foreground">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
              {/* vizType-aware only once a classification exists — i.e. on
                  regenerate. The first build resolves both calls in one
                  round-trip, so the type is unknown while it runs. */}
              {knownType ? VIZ_LOADING_COPY[knownType] : VIZ_LOADING_COPY_GENERIC}
            </div>
          )}

          {state.phase === "error" && (
            <div className="space-y-2 py-4">
              <p className="text-sm text-destructive">{state.message}</p>
              <button
                type="button"
                onClick={() => rebuild(classification)}
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-foreground hover:bg-accent"
              >
                <RotateCcw className="h-3 w-3" />
                Try again
              </button>
            </div>
          )}

          {state.phase === "ready" && (
            <>
              {state.result.classification?.conceptualFallback && (
                <p className="mb-2 text-xs text-muted-foreground">
                  {VIZ_CONCEPTUAL_FALLBACK_NOTE}
                </p>
              )}
              {state.result.payloadKind === "mermaid" ? (
                <MermaidDiagram chart={state.result.payload} />
              ) : (
                <InteractiveHtmlViewer htmlContent={state.result.payload} />
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
