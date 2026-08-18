import { useState } from "react";
import Link from "next/link";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PerQuestionResult, ResultsPayload } from "./types";

/** Modules with <60% accuracy THIS session — the "practice weak areas" scope. */
function weakModules(results: PerQuestionResult[]): string[] {
  const byModule = new Map<string, { correct: number; total: number }>();
  for (const r of results) {
    if (!r.moduleId) continue;
    const e = byModule.get(r.moduleId) ?? { correct: 0, total: 0 };
    e.total += 1;
    if (r.isCorrect) e.correct += 1;
    byModule.set(r.moduleId, e);
  }
  return Array.from(byModule.entries())
    .filter(([, e]) => e.correct / e.total < 0.6)
    .map(([moduleId]) => moduleId);
}

export default function ResultCtas({ results }: { results: ResultsPayload }) {
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const primarySubjectId = results.subjectIds[0];
  const tryAgainHref = `/student/quiz?mode=${results.mode}${
    primarySubjectId ? `&subjectId=${primarySubjectId}` : ""
  }`;

  const weak = weakModules(results.perQuestionResults);
  const weakHref =
    weak.length > 0 && primarySubjectId
      ? `/student/quiz?mode=mastery&subjectId=${primarySubjectId}&modules=${weak.join(",")}`
      : null;

  const handleExport = async () => {
    if (exporting) return;
    setExporting(true);
    setExportError(null);
    try {
      const res = await fetch("/api/quiz/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: results.sessionId }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        setExportError(json?.error ?? "Could not export this quiz.");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "quiz-results.pdf";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setExportError("Network problem exporting this quiz.");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-2 pb-8">
      <div className="flex flex-wrap gap-3">
        <Button asChild>
          <Link href={tryAgainHref}>Try another</Link>
        </Button>
        {weakHref ? (
          <Button asChild variant="outline">
            <Link href={weakHref}>Practice your weak areas</Link>
          </Button>
        ) : null}
        <Button variant="outline" onClick={handleExport} disabled={exporting}>
          {exporting ? (
            <Loader2 className="mr-1.5 size-4 animate-spin" />
          ) : (
            <Download className="mr-1.5 size-4" />
          )}
          Export PDF
        </Button>
      </div>
      {exportError ? (
        <p className="text-sm text-amber-600 dark:text-amber-500">{exportError}</p>
      ) : null}
    </div>
  );
}
