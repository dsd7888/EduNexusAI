import Link from "next/link";
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
  const primarySubjectId = results.subjectIds[0];
  const tryAgainHref = `/student/quiz?mode=${results.mode}${
    primarySubjectId ? `&subjectId=${primarySubjectId}` : ""
  }`;

  const weak = weakModules(results.perQuestionResults);
  const weakHref =
    weak.length > 0 && primarySubjectId
      ? `/student/quiz?mode=mastery&subjectId=${primarySubjectId}&modules=${weak.join(",")}`
      : null;

  return (
    <div className="flex flex-wrap gap-3 pb-8">
      <Button asChild>
        <Link href={tryAgainHref}>Try another</Link>
      </Button>
      {weakHref ? (
        <Button asChild variant="outline">
          <Link href={weakHref}>Practice your weak areas</Link>
        </Button>
      ) : null}
    </div>
  );
}
