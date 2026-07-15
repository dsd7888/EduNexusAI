"use client";

/**
 * REVIEW — unit accordion → practical cards, plus the sticky export footer.
 *
 * Export buttons are wired in Checkpoint 5 (the builders and routes don't exist
 * yet); the gating logic they depend on — "every practical reviewed" — is live
 * here now, which is what the review stage is for.
 */

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronLeft, FileText, GraduationCap, Lock } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { PracticalCard } from "./PracticalCard";
import {
  allReviewed,
  groupWarnings,
  reviewedCount,
  stateFor,
  unreviewedTitles,
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

  // Units that actually have generated content; anything generated but not in a
  // unit (shouldn't happen — the gate guarantees a partition) still renders.
  const units = doc.path?.units ?? [];
  const placed = new Set(units.flatMap((u) => u.practicalNos));
  const orphans = doc.sections
    .map((s) => s.practicalNo)
    .filter((n) => !placed.has(n));

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4 pb-24">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={onBackToPath}>
          <ChevronLeft className="size-4" />
          Learning path
        </Button>
        <span className="text-muted-foreground text-xs">
          {saving ? "Saving…" : "All changes saved"}
        </span>
      </div>

      <Accordion
        type="multiple"
        defaultValue={units.map((u) => `unit-${u.unitNo}`)}
        className="space-y-2"
      >
        {units.map((unit) => {
          const generated = unit.practicalNos.filter((n) => sectionOf.has(n));
          if (generated.length === 0) return null;
          const unitReviewed = generated.filter(
            (n) => stateFor(doc, n).reviewed,
          ).length;
          return (
            <AccordionItem
              key={unit.unitNo}
              value={`unit-${unit.unitNo}`}
              className="rounded-md border px-3"
            >
              <AccordionTrigger className="hover:no-underline">
                <div className="flex flex-1 items-center gap-2 pr-2">
                  <Badge variant="outline">Unit {unit.unitNo}</Badge>
                  <span className="flex-1 text-left text-sm font-medium">
                    {unit.name}
                  </span>
                  <span className="text-muted-foreground text-xs tabular-nums">
                    {unitReviewed}/{generated.length} reviewed
                  </span>
                </div>
              </AccordionTrigger>
              <AccordionContent className="space-y-3 pb-3">
                {generated.map((n) => {
                  const section = sectionOf.get(n)!;
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
                })}
              </AccordionContent>
            </AccordionItem>
          );
        })}

        {orphans.length > 0 && (
          <AccordionItem value="orphans" className="rounded-md border px-3">
            <AccordionTrigger>Not in any unit</AccordionTrigger>
            <AccordionContent className="space-y-3 pb-3">
              {orphans.map((n) => {
                const section = sectionOf.get(n)!;
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
              })}
            </AccordionContent>
          </AccordionItem>
        )}
      </Accordion>

      {/* Sticky export footer — buttons land in CP5 */}
      <div className="bg-background/95 fixed inset-x-0 bottom-0 border-t backdrop-blur">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-3 px-4 py-3">
          <div className="min-w-40 flex-1">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs font-medium">
                {done} of {total} reviewed
              </span>
              {!ready && total > 0 && (
                <span
                  className="text-muted-foreground truncate text-xs"
                  title={unreviewedTitles(doc).join("\n")}
                >
                  {unreviewedTitles(doc).length} left
                </span>
              )}
            </div>
            <Progress value={total ? (done / total) * 100 : 0} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" disabled title="Available in the next checkpoint">
              {ready ? <FileText className="size-4" /> : <Lock className="size-4" />}
              Student Manual
            </Button>
            <Button size="sm" variant="outline" disabled title="Available in the next checkpoint">
              <GraduationCap className="size-4" />
              Instructor Manual
            </Button>
            <Button size="sm" variant="outline" disabled title="Available in the next checkpoint">
              <Lock className="size-4" />
              Model Solutions
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
