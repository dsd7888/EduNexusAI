import { Card, CardContent } from "@/components/ui/card";
import { scoreStyles } from "@/lib/ui/score";
import { cn } from "@/lib/utils";
import type { ResultsPayload } from "./types";

const MODE_LABEL: Record<ResultsPayload["mode"], string> = {
  quick: "Quick Check",
  mastery: "Module Mastery",
  exam_sim: "Exam Simulation",
};

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export default function ScoreSummaryCard({ results }: { results: ResultsPayload }) {
  const pct = results.totalMarks > 0 ? Math.round((results.score / results.totalMarks) * 100) : 0;
  const styles = scoreStyles(pct);
  const subjectLabel = results.subjectIds.map((id) => results.subjectNames[id]).join(", ");
  const date = results.completedAt
    ? new Date(results.completedAt).toLocaleString("en-IN", {
        day: "numeric",
        month: "short",
        hour: "numeric",
        minute: "2-digit",
      })
    : null;

  const timeTakenSeconds =
    results.completedAt && results.startedAt
      ? Math.max(
          0,
          Math.round(
            (new Date(results.completedAt).getTime() - new Date(results.startedAt).getTime()) / 1000
          )
        )
      : null;

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 pt-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-baseline gap-2">
            <span className={cn("text-4xl font-bold tabular-nums", styles.text)}>
              {results.score}
            </span>
            <span className="text-lg text-muted-foreground">/ {results.totalMarks}</span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {MODE_LABEL[results.mode]}
            {results.preset === "gate" ? " · GATE Mock" : ""}
            {subjectLabel ? ` · ${subjectLabel}` : ""}
            {date ? ` · ${date}` : ""}
          </p>
          {results.mode === "exam_sim" && timeTakenSeconds != null ? (
            <p className="mt-0.5 text-xs text-muted-foreground">
              Time taken: {formatDuration(timeTakenSeconds)}
              {results.timeLimitMinutes ? ` of ${results.timeLimitMinutes}m limit` : ""}
            </p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
