"use client";

/**
 * Main-area STATE 2 — "Generating": replaces the entire main area while a
 * paper is being assembled. The cycling hint list is pure engagement copy —
 * it does not reflect real backend status (that's `progressMsg`) — so faculty
 * don't read a stalled UI as frozen during the ~30-60s round trip. No cancel
 * button: generation can't actually be aborted mid-flight.
 */

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import type { SubjectRow } from "@/hooks/useSupabaseData";
import type { PaperMetadata } from "./shared";

const HINTS = [
  "Analyzing syllabus weightage...",
  "Distributing questions across modules...",
  "Applying CO and difficulty targets...",
  "Writing questions...",
  "Validating tags...",
];

interface GeneratingViewProps {
  selectedSubject: SubjectRow | undefined;
  meta: PaperMetadata;
  targetMarks: number;
  progressMsg: string;
}

export function GeneratingView({
  selectedSubject,
  meta,
  targetMarks,
  progressMsg,
}: GeneratingViewProps) {
  const [hintIndex, setHintIndex] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setHintIndex((i) => (i + 1) % HINTS.length);
    }, 4000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="space-y-6">
      <div className="rounded-lg border bg-card p-4">
        <p className="text-sm font-medium">
          {selectedSubject ? `${selectedSubject.code} — ${selectedSubject.name}` : "Question Paper"}
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">
          {meta.examTitle || "Exam"} · {targetMarks} marks
        </p>
      </div>

      <div className="flex flex-col items-center justify-center gap-6 py-20 text-center">
        <Loader2 className="size-16 animate-spin text-primary" />
        <div className="space-y-2">
          <p className="text-base font-medium">{progressMsg || "Generating..."}</p>
          <p className="text-sm text-muted-foreground">{HINTS[hintIndex]}</p>
        </div>
      </div>
    </div>
  );
}
