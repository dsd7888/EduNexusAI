import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { scoreStyles } from "@/lib/ui/score";
import { cn } from "@/lib/utils";
import type { NegativeMarkingImpact, SectionalBreakdownEntry } from "./types";

function formatMin(seconds: number): string {
  const m = Math.round(seconds / 60);
  return `${m}m`;
}

const TYPE_LABEL: Record<string, string> = { mcq: "MCQ", msq: "MSQ", nat: "NAT" };

export default function SectionalBreakdown({
  sections,
  negativeMarkingImpact,
}: {
  sections: SectionalBreakdownEntry[];
  negativeMarkingImpact?: NegativeMarkingImpact;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">By subject</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="divide-y overflow-hidden rounded-lg border">
          {sections.map((s) => {
            const pct = s.totalMarks > 0 ? Math.round((s.marksAwarded / s.totalMarks) * 100) : 0;
            const styles = scoreStyles(pct);
            return (
              <div key={s.subjectId} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{s.subjectName}</p>
                  <p className="text-xs text-muted-foreground">
                    {s.correctCount}/{s.questionCount} correct · {formatMin(s.timeActualSeconds)} of{" "}
                    {formatMin(s.timeTargetSeconds)} target
                  </p>
                </div>
                <span className={cn("shrink-0 text-sm font-semibold tabular-nums", styles.text)}>
                  {s.marksAwarded}/{s.totalMarks}
                </span>
              </div>
            );
          })}
        </div>

        {negativeMarkingImpact && negativeMarkingImpact.delta !== 0 ? (
          <p className="text-sm text-muted-foreground">
            You would have scored{" "}
            <span className="font-medium text-foreground">{negativeMarkingImpact.rawScore}</span>{" "}
            without negative marking. The −1/3 penalty on{" "}
            {(["mcq", "msq", "nat"] as const)
              .filter((t) => negativeMarkingImpact.perTypeBreakdown[t].wrong > 0 && negativeMarkingImpact.perTypeBreakdown[t].totalPenalty !== 0)
              .map(
                (t) =>
                  `${negativeMarkingImpact.perTypeBreakdown[t].wrong} wrong ${TYPE_LABEL[t]}${negativeMarkingImpact.perTypeBreakdown[t].wrong === 1 ? "" : "s"}`
              )
              .join(", ")}{" "}
            cost you {Math.abs(negativeMarkingImpact.delta)} mark
            {Math.abs(negativeMarkingImpact.delta) === 1 ? "" : "s"}.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
