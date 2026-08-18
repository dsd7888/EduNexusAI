"use client";

/**
 * One student's assessment picture within one subject (CP-Q4 Part 4).
 *
 * WHAT IS NOT ON THIS PAGE, and why it never will be by accident: no chat
 * history, no placement data, no record of which generated content the student
 * opened. The route returns none of it (see its header for the reasoning), and
 * `_cp_q4_verify/cross_feature_scoping.ts` asserts the response body stays
 * assessment-only. This page cannot render what it is never sent.
 *
 * The streak shown here is the same number, from the same function, that the
 * student sees on their own landing page. A faculty member acting on a
 * different figure would be intervening on an artefact of whose screen it was
 * rendered on.
 */

import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageSkeleton } from "@/components/layout/PageSkeleton";
import { scoreStyles } from "@/lib/ui/score";
import { cn } from "@/lib/utils";
import FacultyAnalyticsShell from "../../_components/FacultyAnalyticsShell";

interface Payload {
  student: { id: string; name: string | null; email: string | null };
  subjectId: string;
  sessionCount: number;
  aggregateAccuracy: number | null;
  attemptCount: number;
  lastActive: string | null;
  streak: {
    weeks: number;
    currentWeekSessions: number;
    currentWeekPending: boolean;
    sessionsToQualify: number;
  };
  perModule: Array<{
    module_id: string;
    module_name: string | null;
    module_number: number | null;
    attempts: number;
    correct: number;
    accuracy: number | null;
    current_difficulty: string;
  }>;
  recentSessions: Array<{
    sessionId: string;
    mode: string;
    preset: string | null;
    at: string;
    score: number | null;
    totalMarks: number | null;
    scorePct: number | null;
  }>;
}

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

export default function StudentAnalyticsPage() {
  const params = useParams<{ studentId: string }>();
  const search = useSearchParams();
  const subjectId = search.get("subjectId");

  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!params?.studentId || !subjectId) {
      setLoading(false);
      setError("Not found.");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/faculty/analytics/student/${params.studentId}?subjectId=${subjectId}`
        );
        const body = await res.json();
        if (cancelled) return;
        if (!res.ok) setError(body.error ?? "Not found.");
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
  }, [params?.studentId, subjectId]);

  if (loading) return <PageSkeleton />;
  if (error || !data) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {error ?? "Not found."}
          </CardContent>
        </Card>
      </div>
    );
  }

  const aggPct =
    data.aggregateAccuracy == null
      ? null
      : Math.round(data.aggregateAccuracy * 100);

  return (
    <FacultyAnalyticsShell
      crumbs={[
        { label: "Analytics", href: "/faculty/dashboard" },
        {
          label: "Subject",
          href: `/faculty/analytics/subject/${data.subjectId}`,
        },
        { label: data.student.name ?? "Student" },
      ]}
      title={data.student.name ?? "Student"}
      subtitle={
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>{data.sessionCount} sessions in this subject</span>
          <span>·</span>
          <span>{data.attemptCount} questions answered</span>
          {data.lastActive && (
            <>
              <span>·</span>
              <span>last active {fmtDate(data.lastActive)}</span>
            </>
          )}
        </span>
      }
    >
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Overall</CardTitle>
          </CardHeader>
          <CardContent className="flex items-end gap-6">
            <div>
              <p className="text-xs text-muted-foreground">Accuracy</p>
              <p
                className={cn(
                  "text-4xl font-semibold tabular-nums",
                  scoreStyles(aggPct).text
                )}
              >
                {aggPct == null ? "—" : `${aggPct}%`}
              </p>
            </div>
            <div className="pb-1">
              <p className="text-xs text-muted-foreground">Streak</p>
              <p className="text-lg font-semibold">
                {data.streak.weeks === 0
                  ? "None yet"
                  : `${data.streak.weeks} ${
                      data.streak.weeks === 1 ? "week" : "weeks"
                    }`}
              </p>
              {data.streak.currentWeekPending && (
                <p className="text-xs text-muted-foreground">
                  {data.streak.currentWeekSessions} this week
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Recent sessions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {data.recentSessions.length === 0 && (
              <p className="py-3 text-sm text-muted-foreground">
                No completed sessions.
              </p>
            )}
            {data.recentSessions.map((s) => (
              <div
                key={s.sessionId}
                className="flex items-center justify-between gap-2 border-b py-2 text-sm last:border-0"
              >
                <span className="flex items-center gap-2">
                  <Badge variant="secondary" className="capitalize">
                    {s.preset ?? s.mode.replace("_", " ")}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {fmtDate(s.at)}
                  </span>
                </span>
                <span
                  className={cn(
                    "tabular-nums",
                    scoreStyles(s.scorePct).text
                  )}
                >
                  {s.scorePct == null ? "—" : `${s.scorePct}%`}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Module mastery</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.perModule.length === 0 && (
              <p className="py-3 text-sm text-muted-foreground">
                No module mastery recorded yet.
              </p>
            )}
            {data.perModule.map((m) => {
              const p = m.accuracy == null ? null : Math.round(m.accuracy * 100);
              const s = scoreStyles(p);
              return (
                <div key={m.module_id} className="space-y-1">
                  <div className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="min-w-0 truncate">
                      {m.module_number != null && (
                        <span className="text-muted-foreground">
                          M{m.module_number}{" "}
                        </span>
                      )}
                      {m.module_name ?? "Module"}
                    </span>
                    <span className={cn("shrink-0 tabular-nums", s.text)}>
                      {p == null ? "—" : `${p}%`}
                      <span className="ml-2 text-xs capitalize text-muted-foreground">
                        {m.current_difficulty}
                      </span>
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn("h-full rounded-full", s.bar)}
                      style={{ width: `${p ?? 0}%` }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {m.correct}/{m.attempts} correct
                  </p>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>
    </FacultyAnalyticsShell>
  );
}
