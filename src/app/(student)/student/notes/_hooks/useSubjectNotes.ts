"use client";

/**
 * Loads a subject's notes for both CP-N4 surfaces (reading view, flashcards).
 *
 * ONE HOOK, TWO PAGES. Both hit the same endpoint and both need the same
 * staleness discipline; a second copy is a second place for the guard below to
 * be forgotten.
 *
 * THE STALENESS GUARD IS THE POINT OF THIS FILE.
 * CLAUDE.md records a bug that passed tsc, lint, build and a full happy-path
 * click-through — a stale async response overwriting fresher state, rendering a
 * tab permanently blank. Every `await` here is followed by a state write, so
 * every one needs to know whether it is still the current request. `reqRef`
 * carries a monotonic id; a response whose id is no longer current is DROPPED,
 * not rendered. That covers both unhappy paths: switching subject mid-flight
 * (the earlier request must not clobber the later one) and hitting "Try again"
 * while a request is still running (the same, in the other direction).
 *
 * AbortController alone would not be enough — an abort races too, and a response
 * that has already resolved cannot be un-resolved. The id check is what actually
 * decides. The controller is still worth having: it stops the wasted download.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import type { EnrichedNoteBlock } from "@/lib/notes/pyq-frequency";
import type { ModuleBreakpoint } from "@/lib/notes/subject-assembler";

export type SubjectNotesMetadata = {
  modulesCovered: string[];
  modulesTotal: number;
  /**
   * May be EMPTY, and the surfaces must handle that rather than assume it is
   * populated: subject rows written before CP-N4 carry no breakpoints, and the
   * assembler's derivation fallback returns [] for rows predating CP-N3's
   * `_moduleId` tagging. Empty means "render a flat list, no section headers,
   * no module filter" — not an error.
   */
  moduleBreakpoints: ModuleBreakpoint[];
};

export type SubjectNotesState = {
  blocks: EnrichedNoteBlock[];
  metadata: SubjectNotesMetadata | null;
  isLoading: boolean;
  /** Human-readable; null when fine. */
  error: string | null;
  /** True when the failure was a quota 429 — the CTA should not offer a retry. */
  isRateLimited: boolean;
  reload: () => void;
  /**
   * Student-triggered cold-start (CP-11): generates every module in the
   * subject that has no fresh notes row, then assembles. `reload()` alone
   * cannot do this — GET only ever ASSEMBLES already-fresh module rows and
   * fails closed with `no_module_notes` when there are none to join, by
   * design (subject-assembler.ts never makes an AI call). This POSTs to the
   * generation endpoint instead, gated by the same `notes_view` limit GET
   * itself charges on a miss.
   */
  generate: () => Promise<void>;
  /** True while a generate() call is in flight. */
  isGenerating: boolean;
};

const EMPTY_METADATA: SubjectNotesMetadata = {
  modulesCovered: [],
  modulesTotal: 0,
  moduleBreakpoints: [],
};

export function useSubjectNotes(subjectId: string): SubjectNotesState {
  const [blocks, setBlocks] = useState<EnrichedNoteBlock[]>([]);
  const [metadata, setMetadata] = useState<SubjectNotesMetadata | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isRateLimited, setIsRateLimited] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);

  // Monotonic request id. Only the latest may write state. Shared by load()
  // and generate() — whichever call is still current when its response
  // arrives is the one allowed to write, exactly the discipline the file
  // header describes, now spanning two entry points instead of one.
  const reqRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  // Re-entrancy guard for generate(): a ref rather than isGenerating itself,
  // same reasoning as the reading page's downloadingRef — a state read only
  // reflects the last commit, so two click events dispatched before React
  // re-renders between them would both see isGenerating === false.
  const generatingRef = useRef(false);

  const load = useCallback(async () => {
    if (!subjectId) return;

    const id = ++reqRef.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsLoading(true);
    setError(null);
    setIsRateLimited(false);

    try {
      const res = await fetch(`/api/notes/subject/${subjectId}`, {
        signal: controller.signal,
      });
      const body = await res.json().catch(() => null);

      // Superseded while awaiting — a newer request owns the state now.
      if (id !== reqRef.current) return;

      if (res.status === 429) {
        setIsRateLimited(true);
        setError(
          body?.message ??
            "You've reached today's limit for building notes. Try again tomorrow."
        );
        setBlocks([]);
        setMetadata(null);
        return;
      }

      if (!res.ok) {
        setError(
          body?.detail ??
            body?.error ??
            "We couldn't load your notes for this subject."
        );
        setBlocks([]);
        setMetadata(null);
        return;
      }

      const meta = body?.sourceMetadata ?? {};
      setBlocks(Array.isArray(body?.blocks) ? body.blocks : []);
      setMetadata({
        modulesCovered: meta.modulesCovered ?? EMPTY_METADATA.modulesCovered,
        modulesTotal: meta.modulesTotal ?? EMPTY_METADATA.modulesTotal,
        // Defensive: an older row, or a response shape that predates Part 1.
        moduleBreakpoints: Array.isArray(meta.moduleBreakpoints)
          ? meta.moduleBreakpoints
          : [],
      });
    } catch (err) {
      if (controller.signal.aborted || id !== reqRef.current) return;
      setError(
        err instanceof Error
          ? err.message
          : "We couldn't load your notes for this subject."
      );
      setBlocks([]);
      setMetadata(null);
    } finally {
      if (id === reqRef.current) setIsLoading(false);
    }
  }, [subjectId]);

  useEffect(() => {
    load();
    // Abort an in-flight request when the subject changes or the page unmounts.
    // Bumping reqRef too, so a response that already resolved is still ignored.
    return () => {
      reqRef.current += 1;
      abortRef.current?.abort();
    };
  }, [load]);

  const generate = useCallback(async () => {
    if (!subjectId || generatingRef.current) return;
    generatingRef.current = true;

    // Same request-id discipline as load(): this call OWNS state on success,
    // so it takes a new id and any in-flight/late load() response for the old
    // id is dropped rather than clobbering what generate() just produced.
    const id = ++reqRef.current;
    abortRef.current?.abort();

    // The prior error (usually the ErrorState this button lives inside) is
    // left in place, not cleared, until generate() actually resolves — the
    // button switches to a disabled "Generating…" label instead, so the
    // student is never mid-click looking at a page with no error AND no
    // content AND no visible reason why.
    setIsGenerating(true);

    try {
      const res = await fetch(`/api/notes/subject/${subjectId}/generate`, {
        method: "POST",
      });
      const body = await res.json().catch(() => null);

      if (id !== reqRef.current) return;

      if (res.status === 429) {
        setIsRateLimited(true);
        setError(
          body?.message ??
            "You've used all your notes builds for today. Try again tomorrow."
        );
        return;
      }

      if (!res.ok) {
        setError(
          body?.detail ??
            body?.error ??
            "We couldn't generate notes for this subject."
        );
        return;
      }

      const meta = body?.sourceMetadata ?? {};
      setBlocks(Array.isArray(body?.blocks) ? body.blocks : []);
      setMetadata({
        modulesCovered: meta.modulesCovered ?? EMPTY_METADATA.modulesCovered,
        modulesTotal: meta.modulesTotal ?? EMPTY_METADATA.modulesTotal,
        moduleBreakpoints: Array.isArray(meta.moduleBreakpoints)
          ? meta.moduleBreakpoints
          : [],
      });
      // Only cleared on confirmed success — the prior error stays visible
      // through every other branch above (each of which already set its own
      // replacement message).
      setError(null);
      setIsRateLimited(false);
    } catch (err) {
      if (id !== reqRef.current) return;
      setError(
        err instanceof Error
          ? err.message
          : "We couldn't generate notes for this subject."
      );
    } finally {
      generatingRef.current = false;
      if (id === reqRef.current) setIsGenerating(false);
    }
  }, [subjectId]);

  return {
    blocks,
    metadata,
    isLoading,
    error,
    isRateLimited,
    reload: load,
    generate,
    isGenerating,
  };
}
