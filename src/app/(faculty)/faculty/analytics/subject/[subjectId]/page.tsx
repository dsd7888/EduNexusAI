"use client";

/**
 * Faculty analytics dashboard for one subject (CP-Q4 Part 4).
 *
 * Six panels, 2-column on desktop and single column on mobile. Everything is
 * driven by ONE fetch of /api/faculty/analytics/subject/[subjectId] — the
 * snapshot arrives whole, so no panel can be showing data from a different
 * moment than its neighbour.
 *
 * NO STUDENT NAMES IN ANY AGGREGATE PANEL. Panels 1–5 describe the cohort and
 * contain no identity by construction. Panel 6 is a roster and names students
 * openly — that is the design (see src/lib/analytics/privacy.ts on why the two
 * are different things, and why blurring them produces a leaderboard).
 *
 * Colour: score.ts only. Red is never used for a score — a module at 30%
 * accuracy renders amber, because the panel's job is to direct attention, not
 * to grade the teacher.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { RefreshCw, Search, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageSkeleton } from "@/components/layout/PageSkeleton";
import { scoreStyles } from "@/lib/ui/score";
import { cn } from "@/lib/utils";
import FacultyAnalyticsShell, { humanizeAge } from "../../_components/FacultyAnalyticsShell";

// ─── Response shapes ─────────────────────────────────────────────────────────

interface PerModule {
  module_id: string;
  module_name: string;
  module_number: number;
  weightage_percent: number | null;
  accuracy: number | null;
  attempts: number;
  students_count: number;
}
interface PerQuestion {
  question_id: string;
  question_text: string;
  question_type: string;
  times_served: number;
  times_correct: number;
  accuracy: number | null;
  avg_time_seconds: number | null;
  discrimination: number | null;
}
interface COAttainment {
  co_code: string;
  weighted_accuracy: number | null;
  attempts: number;
  contributing_modules: string[];
}
interface Engagement {
  weekly_active_students: number[];
  streak_distribution: Record<string, number>;
  practice_frequency_median: number | null;
}
interface Payload {
  subject: { id: string; name: string; code: string; branch: string; semester: number };
  snapshot: {
    computed_at: string;
    student_count: number;
    session_count: number;
    attempt_count: number;
    aggregate_accuracy: number | null;
    per_module: PerModule[];
    per_question: PerQuestion[];
    co_attainment: COAttainment[];
    engagement: Engagement;
  };
  staleAt: string;
  refreshedInline: boolean;
  cohortBelowFloor: boolean;
  cohortFloor: number;
  refreshRejectedUntil: string | null;
}

interface StudentRow {
  id: string;
  name: string | null;
  sessionCount: number;
  accuracy: number | null;
  streakWeeks: number;
  lastActive: string | null;
}

/** Accreditation-typical CO attainment target. A display threshold, not part
 *  of the computation — see computeCOAttainment's docstring. */
const CO_TARGET_PCT = 60;
/** Modules below this surface in the heatmap callout. */
const MODULE_CONCERN_PCT = 50;

const pct = (r: number | null) => (r == null ? null : Math.round(r * 100));

export default function SubjectAnalyticsPage() {
  const params = useParams<{ subjectId: string }>();
  const subjectId = params?.subjectId;

  const [data, setData] = useState<Payload | null>(null);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());

  // Staleness guard. Every branch below mutates state AFTER an await, and this
  // page has three ways to overlap requests: a subject switch mid-flight, a
  // manual refresh landing after the initial load, and a double-clicked refresh.
  // Without the token, a slow earlier response can resolve last and overwrite a
  // newer one — the failure mode CLAUDE.md's verification protocol exists to
  // catch, and it is invisible on the happy path.
  const loadToken = useRef(0);

  const load = useCallback(
    async (force = false) => {
      if (!subjectId) return;
      const token = ++loadToken.current;
      if (force) setRefreshing(true);
      else setLoading(true);
      try {
        const res = await fetch(
          `/api/faculty/analytics/subject/${subjectId}${force ? "?force=1" : ""}`
        );
        if (token !== loadToken.current) return;
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          if (token !== loadToken.current) return;
          setError(body.error ?? `Request failed (${res.status})`);
          return;
        }
        const body = (await res.json()) as Payload;
        if (token !== loadToken.current) return;
        setData(body);
        setError(null);
        setNow(new Date());
      } catch {
        if (token !== loadToken.current) return;
        setError("Could not reach the server.");
      } finally {
        // Spinner state is only cleared by the request that still owns the
        // page; a superseded one must not stop the newer one's spinner.
        if (token === loadToken.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [subjectId]
  );

  useEffect(() => {
    void load();
  }, [load]);

  // The students table is a separate, cheaper read — it is a roster, not part
  // of the cached aggregate, and it must reflect the current cohort even when
  // the snapshot is two hours old.
  useEffect(() => {
    if (!subjectId) return;
    let cancelled = false;
    (async () => {
      const res = await fetch(
        `/api/faculty/analytics/subject/${subjectId}/students`
      );
      if (!res.ok || cancelled) return;
      const body = (await res.json()) as { students: StudentRow[] };
      if (!cancelled) setStudents(body.students ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [subjectId]);

  const refreshBlockedFor = useMemo(() => {
    if (!data?.refreshRejectedUntil) return 0;
    return Math.max(
      0,
      Math.ceil(
        (new Date(data.refreshRejectedUntil).getTime() - now.getTime()) / 60000
      )
    );
  }, [data?.refreshRejectedUntil, now]);

  if (loading) return <PageSkeleton />;

  if (error || !data) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {error ?? "No analytics available."}
          </CardContent>
        </Card>
      </div>
    );
  }

  const { snapshot, subject } = data;
  const aggregatePct = pct(snapshot.aggregate_accuracy);

  return (
    <FacultyAnalyticsShell
      crumbs={[
        { label: subject.name, href: "/faculty/dashboard" },
        { label: "Analytics" },
      ]}
      title={`${subject.name} — Analytics`}
      subtitle={
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>{subject.code}</span>
          <span>·</span>
          <span>
            {snapshot.student_count}{" "}
            {snapshot.student_count === 1 ? "student" : "students"} with data
          </span>
          <span>·</span>
          <span>{humanizeAge(snapshot.computed_at, now)}</span>
        </span>
      }
      actions={
        <Button
          variant="outline"
          size="sm"
          disabled={refreshing || refreshBlockedFor > 0}
          onClick={() => void load(true)}
        >
          <RefreshCw className={cn("size-4", refreshing && "animate-spin")} />
          {refreshBlockedFor > 0
            ? `Refresh in ${refreshBlockedFor}m`
            : refreshing
              ? "Refreshing"
              : "Refresh"}
        </Button>
      }
    >
      {data.cohortBelowFloor ? (
        <Card>
          <CardContent className="space-y-2 py-10 text-center">
            <p className="text-sm font-medium">
              Cohort too small for aggregates
            </p>
            <p className="mx-auto max-w-md text-sm text-muted-foreground">
              {snapshot.student_count} of this subject&apos;s students have
              practised so far. Aggregates appear at {data.cohortFloor}. Below
              that, a &ldquo;cohort average&rdquo; is one or two students&apos;
              work with their names removed.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {/* 1 ── COHORT MASTERY */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Cohort mastery</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-end gap-3">
                <span
                  className={cn(
                    "text-4xl font-semibold tabular-nums",
                    scoreStyles(aggregatePct).text
                  )}
                >
                  {aggregatePct == null ? "—" : `${aggregatePct}%`}
                </span>
                <span className="pb-1 text-xs text-muted-foreground">
                  across {snapshot.attempt_count.toLocaleString()} attempts in{" "}
                  {snapshot.session_count.toLocaleString()} sessions
                </span>
              </div>
              <WeeklyBars
                values={snapshot.engagement.weekly_active_students}
                label="Active students per week"
              />
            </CardContent>
          </Card>

          {/* 2 ── PER-MODULE HEATMAP */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Module accuracy</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <ConcernCallout
                count={
                  snapshot.per_module.filter(
                    (m) =>
                      m.accuracy != null && m.accuracy * 100 < MODULE_CONCERN_PCT
                  ).length
                }
                singular={`module under ${MODULE_CONCERN_PCT}% accuracy`}
                plural={`modules under ${MODULE_CONCERN_PCT}% accuracy`}
              />
              <div className="space-y-2">
                {[...snapshot.per_module]
                  .sort(
                    (a, b) =>
                      (b.weightage_percent ?? 0) - (a.weightage_percent ?? 0)
                  )
                  .map((m) => (
                    <ModuleBar key={m.module_id} m={m} />
                  ))}
                {snapshot.per_module.length === 0 && <Empty />}
              </div>
            </CardContent>
          </Card>

          {/* 3 ── CO ATTAINMENT */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">CO attainment</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <COCallout cos={snapshot.co_attainment} />
              <div className="space-y-2">
                {snapshot.co_attainment.map((co) => {
                  const p = pct(co.weighted_accuracy);
                  const s = scoreStyles(p, { target: CO_TARGET_PCT });
                  return (
                    <div key={co.co_code} className="space-y-1">
                      <div className="flex items-baseline justify-between text-sm">
                        <span className="font-medium">{co.co_code}</span>
                        <span className={cn("tabular-nums", s.text)}>
                          {p == null ? "—" : `${p}%`}
                          <span className="ml-2 text-xs text-muted-foreground">
                            {co.attempts} attempts
                          </span>
                        </span>
                      </div>
                      <Meter pct={p} barClass={s.bar} />
                    </div>
                  );
                })}
                {snapshot.co_attainment.length === 0 && <Empty />}
              </div>
            </CardContent>
          </Card>

          {/* 4 ── QUESTION QUALITY */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Question quality</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-xs text-muted-foreground">
                Weakest discriminators first — questions that don&apos;t
                separate stronger from weaker students are the actionable ones.
              </p>
              {snapshot.per_question.slice(0, 10).map((q) => (
                <QuestionRow key={q.question_id} q={q} />
              ))}
              {snapshot.per_question.length === 0 && <Empty />}
            </CardContent>
          </Card>

          {/* 5 ── ENGAGEMENT */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Engagement</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <WeeklyBars
                values={snapshot.engagement.weekly_active_students}
                label="Active students, last 8 weeks"
              />
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">
                  Streak distribution
                </p>
                {(["0", "1-2", "3-4", "5+"] as const).map((bucket) => {
                  const n = snapshot.engagement.streak_distribution[bucket] ?? 0;
                  const total = Object.values(
                    snapshot.engagement.streak_distribution
                  ).reduce((s, v) => s + v, 0);
                  return (
                    <div key={bucket} className="flex items-center gap-2 text-sm">
                      <span className="w-12 shrink-0 text-xs text-muted-foreground">
                        {bucket === "0" ? "None" : `${bucket} wk`}
                      </span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-slate-400"
                          style={{
                            width: total > 0 ? `${(n / total) * 100}%` : "0%",
                          }}
                        />
                      </div>
                      <span className="w-8 shrink-0 text-right text-xs tabular-nums">
                        {n}
                      </span>
                    </div>
                  );
                })}
              </div>
              <p className="text-sm text-muted-foreground">
                {snapshot.engagement.practice_frequency_median == null
                  ? "No practice recorded in the last 8 weeks."
                  : `Median practice: ${snapshot.engagement.practice_frequency_median.toFixed(
                      1
                    )} sessions per active student per week.`}
              </p>
            </CardContent>
          </Card>

          {/* 6 ── STUDENTS TABLE (the one panel that names students, by design) */}
          <Card className="lg:col-span-2">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Students</CardTitle>
            </CardHeader>
            <CardContent>
              <StudentsTable
                rows={students}
                subjectId={subject.id}
                now={now}
              />
            </CardContent>
          </Card>
        </div>
      )}
    </FacultyAnalyticsShell>
  );
}

// ─── Panel pieces ────────────────────────────────────────────────────────────

function Empty() {
  return (
    <p className="py-4 text-center text-sm text-muted-foreground">
      No data yet.
    </p>
  );
}

function Meter({ pct, barClass }: { pct: number | null; barClass: string }) {
  return (
    <div className="h-2 overflow-hidden rounded-full bg-muted">
      <div
        className={cn("h-full rounded-full transition-all", barClass)}
        style={{ width: `${pct ?? 0}%` }}
      />
    </div>
  );
}

function ConcernCallout({
  count,
  singular,
  plural,
}: {
  count: number;
  singular: string;
  plural: string;
}) {
  if (count === 0) return null;
  return (
    <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
      <TriangleAlert className="mt-0.5 size-4 shrink-0" />
      <span>
        {count} {count === 1 ? singular : plural}
      </span>
    </div>
  );
}

/**
 * The Dean-facing callout. This sentence is the one that closes an
 * accreditation concern, so it names the criterion explicitly rather than
 * saying "some COs are low".
 */
function COCallout({ cos }: { cos: COAttainment[] }) {
  const below = cos.filter(
    (c) => c.weighted_accuracy != null && c.weighted_accuracy * 100 < CO_TARGET_PCT
  );
  if (below.length === 0) return null;
  return (
    <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
      <TriangleAlert className="mt-0.5 size-4 shrink-0" />
      <span>
        <strong>
          {below.length} {below.length === 1 ? "CO" : "COs"} below{" "}
          {CO_TARGET_PCT}% attainment
        </strong>{" "}
        — this cohort would fail NAAC criterion 2 targets on current
        performance.
      </span>
    </div>
  );
}

function ModuleBar({ m }: { m: PerModule }) {
  const p = pct(m.accuracy);
  const s = scoreStyles(p);
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="min-w-0 truncate">
          <span className="text-muted-foreground">M{m.module_number}</span>{" "}
          {m.module_name}
        </span>
        <span className={cn("shrink-0 tabular-nums", s.text)}>
          {p == null ? "—" : `${p}%`}
          {m.weightage_percent != null && (
            <span className="ml-2 text-xs text-muted-foreground">
              {m.weightage_percent}% wt
            </span>
          )}
        </span>
      </div>
      <Meter pct={p} barClass={s.bar} />
      <p className="text-xs text-muted-foreground">
        {m.attempts} attempts · {m.students_count}{" "}
        {m.students_count === 1 ? "student" : "students"}
      </p>
    </div>
  );
}

function QuestionRow({ q }: { q: PerQuestion }) {
  const [open, setOpen] = useState(false);
  const p = pct(q.accuracy);
  return (
    <div className="rounded-md border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-muted/50"
      >
        <span className="min-w-0 flex-1 truncate">{q.question_text}</span>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          D{" "}
          <span
            className={cn(
              "font-medium",
              q.discrimination != null && q.discrimination < 0
                ? "text-amber-600"
                : "text-foreground"
            )}
          >
            {q.discrimination == null ? "—" : q.discrimination.toFixed(2)}
          </span>{" "}
          · {p ?? "—"}% · {q.times_served}×
        </span>
      </button>
      {open && (
        <div className="space-y-2 border-t px-3 py-2 text-sm">
          <p className="whitespace-pre-wrap">{q.question_text}</p>
          <p className="text-xs text-muted-foreground">
            {q.times_correct}/{q.times_served} correct
            {q.avg_time_seconds != null &&
              ` · ${Math.round(q.avg_time_seconds)}s average`}
          </p>
          <Link
            href={`/faculty/analytics/question/${q.question_id}`}
            className="inline-block text-xs font-medium underline underline-offset-2"
          >
            Full item analysis
          </Link>
        </div>
      )}
    </div>
  );
}

function WeeklyBars({ values, label }: { values: number[]; label: string }) {
  const max = Math.max(1, ...values);
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="flex h-16 items-end gap-1">
        {values.length === 0 && (
          <span className="text-xs text-muted-foreground">No data yet.</span>
        )}
        {values.map((v, i) => (
          <div
            key={i}
            className="flex-1 rounded-t bg-slate-300 dark:bg-slate-600"
            style={{ height: `${Math.max(2, (v / max) * 100)}%` }}
            title={`${v} student${v === 1 ? "" : "s"}`}
          />
        ))}
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>8 weeks ago</span>
        <span>This week</span>
      </div>
    </div>
  );
}

function StudentsTable({
  rows,
  subjectId,
  now,
}: {
  rows: StudentRow[];
  subjectId: string;
  now: Date;
}) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"name" | "sessions" | "accuracy" | "streak">(
    "name"
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = needle
      ? rows.filter((r) => (r.name ?? "").toLowerCase().includes(needle))
      : rows;
    return [...list].sort((a, b) => {
      switch (sort) {
        case "sessions":
          return b.sessionCount - a.sessionCount;
        case "accuracy":
          return (b.accuracy ?? -1) - (a.accuracy ?? -1);
        case "streak":
          return b.streakWeeks - a.streakWeeks;
        default:
          return (a.name ?? "").localeCompare(b.name ?? "");
      }
    });
  }, [rows, q, sort]);

  if (rows.length === 0) return <Empty />;

  return (
    <div className="space-y-3">
      <div className="relative max-w-xs">
        <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter students"
          className="pl-8"
        />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-140 text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              {(
                [
                  ["name", "Student"],
                  ["sessions", "Sessions"],
                  ["accuracy", "Accuracy"],
                  ["streak", "Streak"],
                ] as const
              ).map(([key, label]) => (
                <th key={key} className="py-2 pr-3 font-medium">
                  <button
                    type="button"
                    onClick={() => setSort(key)}
                    className={cn(
                      "hover:text-foreground",
                      sort === key && "text-foreground underline"
                    )}
                  >
                    {label}
                  </button>
                </th>
              ))}
              <th className="py-2 font-medium">Last active</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const p = pct(r.accuracy);
              return (
                <tr key={r.id} className="border-b last:border-0">
                  <td className="py-2 pr-3">
                    <Link
                      href={`/faculty/analytics/student/${r.id}?subjectId=${subjectId}`}
                      className="font-medium hover:underline"
                    >
                      {r.name ?? "Unnamed student"}
                    </Link>
                  </td>
                  <td className="py-2 pr-3 tabular-nums">{r.sessionCount}</td>
                  <td
                    className={cn(
                      "py-2 pr-3 tabular-nums",
                      scoreStyles(p).text
                    )}
                  >
                    {p == null ? "—" : `${p}%`}
                  </td>
                  <td className="py-2 pr-3 tabular-nums">
                    {r.streakWeeks === 0 ? "—" : `${r.streakWeeks}w`}
                  </td>
                  <td className="py-2 text-xs text-muted-foreground">
                    {r.lastActive
                      ? humanizeAge(r.lastActive, now).replace("Updated ", "")
                      : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
