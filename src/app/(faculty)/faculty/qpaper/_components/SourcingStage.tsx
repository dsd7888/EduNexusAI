"use client";

/**
 * Stage — "Sourcing": one row per SourceCategory (Fresh / PYQ-style / Bank),
 * each with a percentage input, plus a running-total bar that reuses the
 * marks-tracker pattern. The Bank row is disabled (with an inline note) when the
 * subject has no verified bank questions, so it can't silently fail at
 * generation time. When the faculty arrived from the Q Bank with staged
 * questions, those are surfaced as a guaranteed-included note above the rows.
 */

import { Label } from "@/components/ui/label";
import { NumericField } from "./NumericField";
import { cn } from "@/lib/utils";
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
}

export function SourcingStage({
  mix,
  setMix,
  verifiedBankCount,
  preferredBankQuestionIds,
}: SourcingStageProps) {
  const bankDisabled = verifiedBankCount === null || verifiedBankCount === 0;
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
          const rowDisabled = key === "bank" && bankDisabled;
          const note = rowDisabled
            ? verifiedBankCount === null
              ? "Checking your question bank…"
              : "No verified questions yet for this subject"
            : hint;
          return (
            <div
              key={key}
              className={cn(
                "flex items-center gap-3 rounded-md border px-3 py-2",
                rowDisabled && "opacity-60"
              )}
            >
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium">{label}</div>
                <div className="text-[11px] text-muted-foreground">{note}</div>
              </div>
              <div className="flex items-center gap-1">
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
        PYQ-style slots mirror past-paper phrasing; fresh slots use original
        framing.
      </p>
    </div>
  );
}
