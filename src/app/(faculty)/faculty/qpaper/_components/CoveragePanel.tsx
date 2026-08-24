"use client";

/**
 * Unit coverage panel — answers "why isn't this unit in my paper?".
 *
 * The faculty complaint this exists for: generating with three units selected
 * and finding the third absent, with nothing anywhere explaining it. Coverage
 * was invisible, so a scoping bug, a BTL range the unit could not satisfy, and
 * a weightage rounding all looked identical — an unexplained gap.
 *
 * Two rules this component follows:
 *
 *  1. Every verdict states a CAUSE and a REMEDY. "Unit 3: not covered" tells
 *     faculty nothing they can act on; "its BTL levels (1–2) don't overlap the
 *     paper's range (3–5) → widen the range, or update the unit in Syllabus"
 *     does. The wording comes from explainCoverage() in lib/qpaper/coverage.ts
 *     so the pre-flight preview and this post-generation panel are phrased
 *     identically — the same cause described two ways reads as two problems.
 *
 *  2. It renders on success too. A panel that only ever appears when something
 *     is wrong leaves faculty unable to confirm that a paper IS complete.
 */

import { useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  explainCoverage,
  uncoveredModules,
  warnedModules,
  type ModuleCoverage,
} from "@/lib/qpaper/coverage";

export function CoveragePanel({
  coverage,
  /** "preview" runs before generation (nothing has been spent yet). */
  variant = "result",
  className,
}: {
  coverage: ModuleCoverage[];
  variant?: "preview" | "result";
  className?: string;
}) {
  const missing = uncoveredModules(coverage);
  const warned = warnedModules(coverage);
  // Degraded-but-present units (currently btl_clamped): worth surfacing, but
  // never counted as missing — telling faculty a unit is absent when it is in
  // the paper sends them looking for something that is already there.
  const degraded = warned.filter((c) => c.slots > 0);
  const [open, setOpen] = useState(missing.length > 0);

  if (coverage.length === 0) return null;

  const allGood = warned.length === 0;
  const covered = coverage.length - missing.length;

  return (
    <div
      className={cn(
        "rounded-lg border text-sm",
        allGood
          ? "border-emerald-500/30 bg-emerald-500/5"
          : missing.length > 0
            ? "border-amber-500/40 bg-amber-500/5"
            : "border-sky-500/30 bg-sky-500/5",
        className
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
        aria-expanded={open}
      >
        {allGood ? (
          <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />
        ) : missing.length > 0 ? (
          <AlertTriangle className="size-4 shrink-0 text-amber-600" />
        ) : (
          <Info className="size-4 shrink-0 text-sky-600" />
        )}
        <span className="flex-1 font-medium">
          {allGood
            ? variant === "preview"
              ? `All ${coverage.length} selected units will be covered`
              : `All ${coverage.length} selected units are covered`
            : missing.length > 0
              ? variant === "preview"
                ? `${missing.length} of ${coverage.length} units will get no questions`
                : `${missing.length} of ${coverage.length} units got no questions`
              : `${degraded.length} unit${degraded.length === 1 ? "" : "s"} need attention`}
        </span>
        <span className="text-xs text-muted-foreground">
          {covered}/{coverage.length} covered
        </span>
        <ChevronDown
          className={cn("size-4 shrink-0 transition-transform", open && "rotate-180")}
        />
      </button>

      {open && (
        <div className="border-t px-3 py-2.5 space-y-2.5">
          {warned.length === 0 && (
            <p className="text-xs text-muted-foreground">
              Every unit you selected has at least one question, within the BTL
              range you asked for.
            </p>
          )}

          {/* Problems first — this is what the faculty opened the panel for. */}
          {warned.map((c) => {
            const { title, detail, remedy } = explainCoverage(c);
            return (
              <div key={c.moduleNumber} className="space-y-1">
                <div className="flex items-start gap-2">
                  <AlertTriangle
                    className={cn(
                      "mt-0.5 size-3.5 shrink-0",
                      c.slots > 0 ? "text-sky-600" : "text-amber-600"
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium leading-snug">{title}</p>
                    {detail && (
                      <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">
                        {detail}
                      </p>
                    )}
                    {remedy && (
                      <p className="mt-1 text-xs leading-relaxed">
                        <span className="font-medium text-foreground">Fix: </span>
                        <span className="text-muted-foreground">{remedy}</span>
                      </p>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {/* Covered units, compact — confirmation without competing for space. */}
          {coverage.some((c) => c.reason.kind === "ok") && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {coverage
                .filter((c) => c.reason.kind === "ok")
                .map((c) => (
                  <span
                    key={c.moduleNumber}
                    className="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[11px]"
                    title={`${c.moduleName} — ${c.slots} question${c.slots === 1 ? "" : "s"}, ${c.marks} marks`}
                  >
                    <CheckCircle2 className="size-3 text-emerald-600" />
                    Unit {c.moduleNumber}
                    <span className="text-muted-foreground">
                      ({c.slots}Q · {c.marks}M)
                    </span>
                  </span>
                ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
