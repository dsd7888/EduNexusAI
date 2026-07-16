"use client";

/**
 * REVIEW — unit accordion → practical cards, plus the sticky export footer.
 *
 * The export builders and routes land in Checkpoint 5. The footer here is honest
 * about that: it shows real review progress and, once everything is reviewed,
 * says exports are the final step rather than presenting a dead grey button that
 * reads as broken.
 */

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  CheckCircle2,
  ChevronLeft,
  FileText,
  GraduationCap,
  Lock,
} from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { PracticalCard } from "./PracticalCard";
import {
  allReviewed,
  groupWarnings,
  reviewedCount,
  stateFor,
  type Difficulty,
  type LabManualDoc,
  type LabManualWarning,
  type PracticalManualSection,
  type PracticalState,
} from "./shared";

interface Props {
  doc: LabManualDoc;
  warnings: LabManualWarning[];
  regenSet: Set<number>;
  onSectionChange: (
    practicalNo: number,
    patch: Partial<PracticalManualSection>,
  ) => void;
  onStateChange: (practicalNo: number, patch: Partial<PracticalState>) => void;
  onRegenerate: (
    practicalNo: number,
    difficulty: Difficulty,
    instruction?: string,
  ) => void;
  onBackToPath: () => void;
  saving: boolean;
}

export function ReviewStage({
  doc,
  warnings,
  regenSet,
  onSectionChange,
  onStateChange,
  onRegenerate,
  onBackToPath,
  saving,
}: Props) {
  const byPractical = groupWarnings(warnings);
  const sectionOf = new Map(doc.sections.map((s) => [s.practicalNo, s]));
  const done = reviewedCount(doc);
  const total = doc.sections.length;
  const ready = allReviewed(doc);

  const units = doc.path?.units ?? [];
  const placed = new Set(units.flatMap((u) => u.practicalNos));
  const orphans = doc.sections
    .map((s) => s.practicalNo)
    .filter((n) => !placed.has(n));

  const renderCard = (n: number) => {
    const section = sectionOf.get(n);
    if (!section) return null;
    return (
      <PracticalCard
        key={n}
        section={section}
        state={stateFor(doc, n)}
        warnings={byPractical.get(n) ?? []}
        regenerating={regenSet.has(n)}
        onChange={(patch) => onSectionChange(n, patch)}
        onStateChange={(patch) => onStateChange(n, patch)}
        onRegenerate={(d, instr) => onRegenerate(n, d, instr)}
      />
    );
  };

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4 pb-28">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={onBackToPath}>
          <ChevronLeft className="size-4" />
          Learning path
        </Button>
        <span
          className={`flex items-center gap-1.5 text-xs ${
            saving ? "text-muted-foreground" : "text-emerald-600 dark:text-emerald-400"
          }`}
        >
          {saving ? (
            "Saving…"
          ) : (
            <>
              <CheckCircle2 className="size-3.5" />
              All changes saved
            </>
          )}
        </span>
      </div>

      <div className="space-y-1">
        <h2 className="text-xl font-bold tracking-tight">Review the manual</h2>
        <p className="text-muted-foreground text-sm">
          Edit anything inline — theory renders your maths and chemistry live. Mark
          each practical reviewed once it&rsquo;s right; editing a reviewed
          practical re-opens it for review.
        </p>
      </div>

      <Accordion
        type="multiple"
        defaultValue={units.map((u) => `unit-${u.unitNo}`)}
        className="space-y-3"
      >
        {units.map((unit) => {
          const generated = unit.practicalNos.filter((n) => sectionOf.has(n));
          if (generated.length === 0) return null;
          const unitReviewed = generated.filter(
            (n) => stateFor(doc, n).reviewed,
          ).length;
          const unitDone = unitReviewed === generated.length;
          return (
            <AccordionItem
              key={unit.unitNo}
              value={`unit-${unit.unitNo}`}
              className="overflow-hidden rounded-lg border shadow-sm"
            >
              <AccordionTrigger className="bg-muted/40 hover:bg-muted/70 px-4 py-3 hover:no-underline">
                <div className="flex flex-1 items-center gap-2.5 pr-2">
                  <Badge
                    variant="outline"
                    className="border-sky-300 bg-sky-50 text-sky-700 dark:border-sky-800 dark:bg-sky-950/50 dark:text-sky-300"
                  >
                    Unit {unit.unitNo}
                  </Badge>
                  <span className="flex-1 text-left font-semibold">{unit.name}</span>
                  <span
                    className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium tabular-nums ${
                      unitDone
                        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
                        : "text-muted-foreground bg-background"
                    }`}
                  >
                    {unitDone && <CheckCircle2 className="size-3" />}
                    {unitReviewed}/{generated.length}
                  </span>
                </div>
              </AccordionTrigger>
              <AccordionContent className="space-y-3 p-3">
                {generated.map(renderCard)}
              </AccordionContent>
            </AccordionItem>
          );
        })}

        {orphans.length > 0 && (
          <AccordionItem
            value="orphans"
            className="overflow-hidden rounded-lg border shadow-sm"
          >
            <AccordionTrigger className="bg-muted/40 px-4 py-3">
              Not in any unit
            </AccordionTrigger>
            <AccordionContent className="space-y-3 p-3">
              {orphans.map(renderCard)}
            </AccordionContent>
          </AccordionItem>
        )}
      </Accordion>

      {/* ── Sticky export footer ──────────────────────────────────────────── */}
      <div className="bg-background/95 fixed inset-x-0 bottom-0 z-10 border-t shadow-[0_-1px_3px_rgba(0,0,0,0.04)] backdrop-blur">
        <div className="mx-auto max-w-4xl px-4 py-3">
          <div className="mb-2 flex items-center gap-3">
            <div className="flex-1">
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="font-semibold">
                  {done} of {total} practicals reviewed
                </span>
                <span className="text-muted-foreground">
                  {ready ? "Ready to export" : `${total - done} still to review`}
                </span>
              </div>
              <Progress
                value={total ? (done / total) * 100 : 0}
                className={ready ? "[&>div]:bg-emerald-500" : undefined}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-muted-foreground text-xs">
              {ready ? (
                <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="size-3.5" />
                  All reviewed — exports (Student / Instructor / Solutions, PDF &amp;
                  Word) are the final build step.
                </span>
              ) : (
                "Review every practical to unlock the three export formats."
              )}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" disabled>
                <FileText className="size-4" />
                Student Manual
              </Button>
              <Button size="sm" variant="outline" disabled>
                <GraduationCap className="size-4" />
                Instructor Manual
              </Button>
              <Button size="sm" variant="outline" disabled>
                <Lock className="size-4" />
                Model Solutions
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
