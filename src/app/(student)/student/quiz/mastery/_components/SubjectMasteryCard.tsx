"use client";

/**
 * One subject's mastery card — collapsed shows the aggregate, tapping expands
 * the module breakdown INLINE (not a navigation — CP-Q3 Part 5B spec is
 * explicit about this: drilldown pages are deferred to a future checkpoint).
 */

import { useState } from "react";
import { ChevronDown } from "lucide-react";

import RichQuestionText from "@/components/RichQuestionText";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import ModuleRow from "./ModuleRow";
import type { MasterySubject } from "./types";

/** The subject-level aggregate bar is ALWAYS amber — not colour-by-value like
 * a per-module accuracy bar. This is a summary of practice volume and spread
 * across a whole subject, not a pass/fail signal, so it doesn't earn emerald
 * the way a single module's accuracy does. */
function AggregateBar({ pct }: { pct: number | null }) {
  return (
    <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
      <div
        className="h-full rounded-full bg-linear-to-r from-amber-400 to-amber-500 dark:from-amber-500 dark:to-amber-400"
        style={{ width: `${Math.max(0, Math.min(100, pct ?? 0))}%` }}
      />
    </div>
  );
}

export default function SubjectMasteryCard({ subject }: { subject: MasterySubject }) {
  const [open, setOpen] = useState(false);

  return (
    <Card>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer select-none pb-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">
                  <RichQuestionText text={subject.subjectName} />
                </p>
                <p className="text-xs text-muted-foreground">{subject.subjectCode}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="text-lg font-semibold tabular-nums">
                  {subject.aggregateMastery != null ? `${subject.aggregateMastery}%` : "—"}
                </span>
                <ChevronDown
                  className={cn("size-4 text-muted-foreground transition-transform", open && "rotate-180")}
                />
              </div>
            </div>
            <AggregateBar pct={subject.aggregateMastery} />
            <p className="text-xs text-muted-foreground">
              {subject.practicedModuleCount} of {subject.moduleCount} module
              {subject.moduleCount === 1 ? "" : "s"} practiced
            </p>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="space-y-3 border-t pt-4">
            {subject.modules.map((m) => (
              <ModuleRow key={m.moduleId} module={m} />
            ))}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
