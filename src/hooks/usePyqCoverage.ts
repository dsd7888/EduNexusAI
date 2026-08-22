"use client";

/**
 * Past-paper coverage for one subject, shared by every PYQ-aware surface
 * (qpaper Sourcing, qbank Generate, the Past Papers tab, the DoneView nudge).
 *
 * `coverage === null` means STILL LOADING and is not the same as "no papers" —
 * callers must keep a PYQ control in a neutral/checking state while null rather
 * than flashing the disabled empty-state on every subject switch. This mirrors
 * how `verifiedBankCount: number | null` is already threaded through the qpaper
 * builder for the Bank row.
 *
 * A failed fetch resolves to EMPTY_COVERAGE rather than an error state: the
 * worst case of guessing "no papers" is that we offer an upload prompt to
 * someone who has already uploaded, which is recoverable noise. The opposite
 * default would enable PYQ-style generation with nothing behind it, which is
 * the exact dishonesty this whole feature exists to remove.
 */

import { useCallback, useEffect, useState } from "react";
import { EMPTY_COVERAGE, type PyqCoverage, type PyqPaper } from "@/lib/pyq/coverage";

interface UsePyqCoverageResult {
  coverage: PyqCoverage | null;
  papers: PyqPaper[] | null;
  refresh: () => void;
  /** Apply a coverage the server just returned (upload/delete responses). */
  applyCoverage: (next: PyqCoverage) => void;
}

export function usePyqCoverage(
  subjectId: string | null | undefined,
  options: { withPapers?: boolean } = {}
): UsePyqCoverageResult {
  const withPapers = options.withPapers ?? false;
  // Tagged with the subject it belongs to so a switch derives back to "loading"
  // without a synchronous reset in an effect (the pattern the qbank page uses
  // for its stats).
  const [state, setState] = useState<{
    subjectId: string;
    coverage: PyqCoverage;
    papers: PyqPaper[] | null;
  } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!subjectId) return;
    let cancelled = false;
    const url =
      `/api/faculty/pyq/coverage?subject_id=${encodeURIComponent(subjectId)}` +
      (withPapers ? "&papers=true" : "");
    fetch(url)
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((json: { coverage?: PyqCoverage; papers?: PyqPaper[] }) => {
        if (cancelled) return;
        setState({
          subjectId,
          coverage: json.coverage ?? EMPTY_COVERAGE,
          papers: json.papers ?? null,
        });
      })
      .catch(() => {
        if (cancelled) return;
        setState({ subjectId, coverage: EMPTY_COVERAGE, papers: withPapers ? [] : null });
      });
    return () => {
      cancelled = true;
    };
  }, [subjectId, withPapers, reloadKey]);

  const matches = state && subjectId && state.subjectId === subjectId;

  const applyCoverage = useCallback(
    (next: PyqCoverage) => {
      if (!subjectId) return;
      // The papers list is not part of an upload/delete response, so it is
      // dropped here and refetched — showing a stale list beside fresh counts
      // would be worse than a brief reload.
      setState({ subjectId, coverage: next, papers: null });
      if (withPapers) setReloadKey((k) => k + 1);
    },
    [subjectId, withPapers]
  );

  return {
    coverage: matches ? state.coverage : null,
    papers: matches ? state.papers : null,
    refresh: useCallback(() => setReloadKey((k) => k + 1), []),
    applyCoverage,
  };
}
