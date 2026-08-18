"use client";

/**
 * Item analysis for one bank question (CP-Q4 Part 4).
 *
 * The wrong-answer distribution is the point of this page. Accuracy tells you
 * a question is hard; the distribution tells you WHY — a distractor taking 40%
 * of responses is a specific, nameable misconception the cohort shares, and
 * that is something a faculty member can actually teach against. A bar per
 * option, correct one marked, is the whole design.
 *
 * The correct answer is visible here. That is intentional and consistent with
 * CP-Q3 Part 1 rather than a regression of it — see the route's header.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageSkeleton } from "@/components/layout/PageSkeleton";
import { scoreStyles } from "@/lib/ui/score";
import { cn } from "@/lib/utils";
import FacultyAnalyticsShell from "../../_components/FacultyAnalyticsShell";

interface Cohort {
  subject_id: string;
  subject_name: string | null;
  subject_code: string | null;
  times_served: number;
  times_correct: number;
  accuracy: number | null;
  avg_time_seconds: number | null;
  discrimination: number | null;
  interpretation: { band: string; sentence: string };
}

interface Payload {
  question: {
    id: string;
    subject_id: string;
    question_text: string;
    question_type: string;
    model_answer: string | null;
    numeric_answer: number | null;
    co_code: string | null;
    btl_level: string | null;
    difficulty: string | null;
    marks: number | null;
  };
  cohorts: Cohort[];
  wrongAnswerDistribution:
    | Array<{
        label: string;
        text: string | null;
        is_correct: boolean;
        count: number;
        pct: number;
      }>
    | null;
}

export default function QuestionAnalyticsPage() {
  const params = useParams<{ questionId: string }>();
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!params?.questionId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/faculty/analytics/question/${params.questionId}`
        );
        const body = await res.json();
        if (cancelled) return;
        if (!res.ok) setError(body.error ?? `Request failed (${res.status})`);
        else setData(body as Payload);
      } catch {
        if (!cancelled) setError("Could not reach the server.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [params?.questionId]);

  if (loading) return <PageSkeleton />;
  if (error || !data) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {error ?? "Question not found."}
          </CardContent>
        </Card>
      </div>
    );
  }

  const { question, cohorts, wrongAnswerDistribution } = data;
  const totalServed = cohorts.reduce((s, c) => s + c.times_served, 0);

  return (
    <FacultyAnalyticsShell
      crumbs={[
        { label: "Analytics", href: "/faculty/dashboard" },
        {
          label: "Subject",
          href: `/faculty/analytics/subject/${question.subject_id}`,
        },
        { label: "Question" },
      ]}
      title="Question analysis"
      subtitle={`${question.question_type.toUpperCase()} · served ${totalServed} ${
        totalServed === 1 ? "time" : "times"
      }`}
    >
      <div className="space-y-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Question</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="whitespace-pre-wrap text-sm">{question.question_text}</p>
            <div className="flex flex-wrap gap-2">
              {question.co_code && <Badge variant="secondary">{question.co_code}</Badge>}
              {question.btl_level && (
                <Badge variant="secondary">BTL {question.btl_level}</Badge>
              )}
              {question.difficulty && (
                <Badge variant="secondary">{question.difficulty}</Badge>
              )}
              {question.marks != null && (
                <Badge variant="secondary">{question.marks} marks</Badge>
              )}
            </div>
            {(question.model_answer || question.numeric_answer != null) && (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm dark:border-emerald-900 dark:bg-emerald-950/40">
                <p className="mb-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                  Correct answer
                </p>
                <p className="whitespace-pre-wrap">
                  {question.model_answer ?? String(question.numeric_answer)}
                </p>
              </div>
            )}
            <Link
              href="/faculty/qbank"
              className="inline-block text-xs font-medium underline underline-offset-2"
            >
              Edit in Q Bank
            </Link>
          </CardContent>
        </Card>

        {cohorts.map((c) => {
          const p = c.accuracy == null ? null : Math.round(c.accuracy * 100);
          return (
            <Card key={c.subject_id}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">
                  {c.subject_name ?? "Cohort"}{" "}
                  {c.subject_code && (
                    <span className="text-xs font-normal text-muted-foreground">
                      {c.subject_code}
                    </span>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Stat label="Served" value={String(c.times_served)} />
                  <Stat
                    label="Accuracy"
                    value={p == null ? "—" : `${p}%`}
                    className={scoreStyles(p).text}
                  />
                  <Stat
                    label="Discrimination"
                    value={
                      c.discrimination == null ? "—" : c.discrimination.toFixed(2)
                    }
                    className={
                      c.discrimination != null && c.discrimination < 0
                        ? "text-amber-600"
                        : undefined
                    }
                  />
                  <Stat
                    label="Avg time"
                    value={
                      c.avg_time_seconds == null
                        ? "—"
                        : `${Math.round(c.avg_time_seconds)}s`
                    }
                  />
                </div>
                <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
                  {c.interpretation.sentence}
                </p>
              </CardContent>
            </Card>
          );
        })}

        {wrongAnswerDistribution && wrongAnswerDistribution.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Answer distribution</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-xs text-muted-foreground">
                Which option students chose. A distractor taking a large share
                points at a shared misconception, not just difficulty.
              </p>
              {wrongAnswerDistribution.map((o) => (
                <div key={o.label} className="space-y-1">
                  <div className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="min-w-0">
                      <span className="font-medium">{o.label}.</span>{" "}
                      <span className={cn(o.is_correct && "font-medium")}>
                        {o.text ?? ""}
                      </span>
                      {o.is_correct && (
                        <span className="ml-2 text-xs text-emerald-600">
                          correct
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {o.pct}% ({o.count})
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn(
                        "h-full rounded-full",
                        o.is_correct ? "bg-emerald-500" : "bg-amber-400"
                      )}
                      style={{ width: `${o.pct}%` }}
                    />
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </FacultyAnalyticsShell>
  );
}

function Stat({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("text-lg font-semibold tabular-nums", className)}>
        {value}
      </p>
    </div>
  );
}
