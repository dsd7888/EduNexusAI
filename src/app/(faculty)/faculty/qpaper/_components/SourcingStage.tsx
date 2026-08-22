"use client";

/**
 * Stage — "Sourcing": one row per SourceCategory (Fresh / PYQ-style / Bank),
 * each with a percentage input, plus a running-total bar that reuses the
 * marks-tracker pattern. When the faculty arrived from the Q Bank with staged
 * questions, those are surfaced as a guaranteed-included note above the rows.
 *
 * A ROW IS DISABLED WHEN THE DATA BEHIND IT DOES NOT EXIST. The Bank row has
 * always worked this way — no verified questions, no Bank allocation — because
 * a percentage the generator cannot satisfy fails silently at generation time
 * and the faculty has no way to know.
 *
 * The PYQ-style row did NOT, and that was the bug this stage now fixes. It sat
 * enabled at 20% by default for every subject, including the ones with zero
 * uploaded papers, so a fifth of every generated paper was presented as
 * mirroring past exams while the generator was actually falling back to the
 * subject-family archetype hints in src/lib/qpaper/archetypes.ts. Offering a
 * capability the data cannot honour is worse than not offering it: the faculty
 * cannot tell the difference in the output, so they trust a claim that isn't
 * true. Both rows now key off real availability, and the disabled row carries
 * the upload action rather than a bare apology.
 */

import { Label } from "@/components/ui/label";
import { Upload } from "lucide-react";
import { NumericField } from "@/components/ui/numeric-field";
import { cn } from "@/lib/utils";
import { coverageSummary, type PyqCoverage } from "@/lib/pyq/coverage";
import { PYQ_EMPTY_HINT, PYQ_UPLOAD_CTA } from "@/components/pyq/pyqCopy";
import {
  SOURCE_CATEGORY_META,
  sourcingMixTotal,
  type SourceCategory,
  type SourcingMixState,
} from "./shared";

interface SourcingStageProps {
  mix: SourcingMixState;
  setMix: (m: SourcingMixState) => void;
  /** null = still checking; number = verified questions for the subject. */
  verifiedBankCount: number | null;
  /** IDs guaranteed-included from the Q Bank (set when arriving via staging). */
  preferredBankQuestionIds: string[];
  /** null = still checking; see usePyqCoverage on why that is not "none". */
  pyqCoverage: PyqCoverage | null;
  /** Opens the shared upload dialog, owned by the page. */
  onUploadPyq: () => void;
}

export function SourcingStage({
  mix,
  setMix,
  verifiedBankCount,
  preferredBankQuestionIds,
  pyqCoverage,
  onUploadPyq,
}: SourcingStageProps) {
  const bankDisabled = verifiedBankCount === null || verifiedBankCount === 0;
  const pyqDisabled = pyqCoverage === null || pyqCoverage.state === "none";
  const total = sourcingMixTotal(mix);
  const diff = total - 100;
  const status =
    diff === 0
      ? { label: "On target", tone: "text-emerald-600 bg-emerald-50 border-emerald-200" }
      : diff < 0
        ? { label: `${Math.abs(diff)}% left`, tone: "text-amber-700 bg-amber-50 border-amber-200" }
        : { label: `${diff}% over`, tone: "text-rose-700 bg-rose-50 border-rose-200" };
  const pct = Math.min(100, total);

  const setPercent = (key: SourceCategory, raw: string) => {
    const n = Math.max(0, Math.min(100, Math.round(Number(raw) || 0)));
    setMix({ ...mix, [key]: n });
  };

  const preferredCount = preferredBankQuestionIds.length;

  return (
    <div className="space-y-2">
      <Label className="text-xs">Question sourcing mix</Label>

      {preferredCount > 0 && (
        <div className="rounded-md border bg-muted/40 px-3 py-2">
          <p className="text-xs font-medium">
            📚 {preferredCount} question{preferredCount === 1 ? "" : "s"} from
            your Q Bank will be included
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Guaranteed regardless of the percentages below — the mix only governs
            the remaining slots.
          </p>
        </div>
      )}

      <div className="space-y-1.5">
        {SOURCE_CATEGORY_META.map(({ key, label, hint }) => {
          const rowDisabled =
            (key === "bank" && bankDisabled) ||
            (key === "pyq_style" && pyqDisabled);

          // Three-way note per row: checking / unavailable-and-why / what it
          // will actually do. The enabled PYQ row states its real coverage
          // ("Mirroring 3 papers (2022–2024) · covers 5 of 6 COs") rather than
          // the generic hint — that specificity is the payoff for uploading,
          // and it is also the honest disclosure when coverage is partial.
          let note = hint;
          if (key === "bank" && bankDisabled) {
            note =
              verifiedBankCount === null
                ? "Checking your question bank…"
                : "No verified questions yet for this subject";
          } else if (key === "pyq_style") {
            if (pyqCoverage === null) note = "Checking uploaded past papers…";
            else if (pyqCoverage.state === "none") note = PYQ_EMPTY_HINT;
            else note = coverageSummary(pyqCoverage) ?? hint;
          }

          const showUploadCta =
            key === "pyq_style" && pyqCoverage?.state === "none";

          return (
            // The dimming sits on the row's CONTENT, not on the row itself, so
            // the upload CTA below can stay at full contrast. A disabled
            // control whose only way out is rendered at 60% opacity fails the
            // point of disabling it.
            <div
              key={key}
              className="rounded-md border px-3 py-2"
            >
              <div className="flex items-center gap-3">
                <div className={cn("flex-1 min-w-0", rowDisabled && "opacity-60")}>
                  <div className="text-sm font-medium">{label}</div>
                  <div className="text-[11px] text-muted-foreground">{note}</div>
                </div>
                <div
                  className={cn(
                    "flex items-center gap-1",
                    rowDisabled && "opacity-60"
                  )}
                >
                  <NumericField
                    min={0}
                    max={100}
                    value={rowDisabled ? 0 : mix[key]}
                    disabled={rowDisabled}
                    onChange={(n) => setPercent(key, String(n))}
                    className="h-8 w-16 text-sm text-right"
                  />
                  <span className="text-xs text-muted-foreground">%</span>
                </div>
              </div>

              {/* The action lives ON the inert control, at the moment reaching
                  for it costs the faculty something concrete. This is the
                  primary entry point to the upload flow — not a banner
                  elsewhere on the page. */}
              {showUploadCta && (
                <button
                  type="button"
                  onClick={onUploadPyq}
                  className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
                >
                  <Upload className="size-3" />
                  {PYQ_UPLOAD_CTA}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Running total — same progress-bar pattern as the marks tracker. */}
      <div className="rounded-lg border bg-background/95 p-3">
        <div className="flex items-center justify-between gap-3 mb-1.5">
          <div className="flex items-baseline gap-2">
            <span className="text-xl font-bold tabular-nums">{total}</span>
            <span className="text-xs text-muted-foreground">of 100%</span>
          </div>
          <span
            className={cn(
              "text-[11px] font-medium px-2 py-0.5 rounded-full border",
              status.tone
            )}
          >
            {status.label}
          </span>
        </div>
        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
          <div
            className={cn(
              "h-full transition-all",
              diff === 0
                ? "bg-emerald-500"
                : diff < 0
                  ? "bg-amber-500"
                  : "bg-rose-500"
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      <p className="text-[10px] text-muted-foreground">
        Bank-sourced slots pull from your verified Q Bank respecting each slot&apos;s
        module/CO/BTL; any slot the bank can&apos;t fill falls back to fresh AI.
        PYQ-style slots mirror the phrasing and marks ladder of the past papers
        uploaded for this subject; fresh slots use original framing.
      </p>

      {/* Stated once, quietly, only where the capability is unavailable — the
          honest description of what generation falls back to. */}
      {pyqCoverage?.state === "none" && (
        <p className="text-[10px] text-muted-foreground">
          With no past papers on file, exam style is inferred from the subject
          family rather than from your department&apos;s actual papers.
        </p>
      )}
    </div>
  );
}
