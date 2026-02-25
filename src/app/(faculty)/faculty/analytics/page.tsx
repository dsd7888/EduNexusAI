"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { PageSkeleton } from "@/components/layout/PageSkeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  BarChart2,
  Brain,
  FileText,
  MessageSquare,
  Presentation,
  Sparkles,
  Trophy,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";

interface SubjectRow {
  id: string;
  name: string;
  code: string;
}

interface QuizStat {
  title: string;
  attempt_count: number;
  avg_score: number | null;
  min_score: number | null;
  max_score: number | null;
}

interface DailyActivityPoint {
  date: string;
  sessions: number;
}

interface TopQuestion {
  content: string;
  frequency: number;
}

interface CacheStats {
  total_entries: number;
  total_hits: number;
  avg_hits_per_entry: number;
}

interface GeneratedContentRow {
  type: string;
  title: string;
  created_at: string;
  slide_count: number | null;
  question_count: number | null;
}

interface ScoreBucket {
  range: string;
  count: number;
}

interface AnalyticsResponse {
  subjects: SubjectRow[];
  selectedSubjectId: string | null;
  quizStats: QuizStat[];
  dailyActivity: DailyActivityPoint[];
  topQuestions: TopQuestion[];
  cacheStats: CacheStats;
  generatedContent: GeneratedContentRow[];
  scoreDistribution: ScoreBucket[];
}

type SortKey = "attempts" | "avg";

export default function FacultyAnalyticsPage() {
  const [subjects, setSubjects] = useState<SubjectRow[]>([]);
  const [selectedSubjectId, setSelectedSubjectId] = useState<string | null>(
    null
  );
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [sortBy, setSortBy] = useState<SortKey>("attempts");

  const fetchData = async (subjectId?: string | null) => {
    setIsLoading(true);
    try {
      const url = subjectId
        ? `/api/analytics?subjectId=${encodeURIComponent(subjectId)}`
        : "/api/analytics";
      const res = await fetch(url);
      const json = (await res.json()) as AnalyticsResponse & { error?: string };
      if (!res.ok) {
        console.error("[analytics] API error:", json.error);
        setData(null);
        setSubjects([]);
        setSelectedSubjectId(null);
        setIsLoading(false);
        return;
      }
      setData(json);
      setSubjects(json.subjects || []);
      setSelectedSubjectId(json.selectedSubjectId);
    } catch (err) {
      console.error("[analytics] fetch error:", err);
      setData(null);
      setSubjects([]);
      setSelectedSubjectId(null);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totalAttempts = useMemo(
    () =>
      data?.quizStats.reduce(
        (sum, q) => sum + (q.attempt_count ?? 0),
        0
      ) ?? 0,
    [data]
  );

  const avgScore = useMemo(() => {
    if (!data?.quizStats.length) return null;
    const weighted = data.quizStats.filter(
      (q) => q.avg_score != null && q.attempt_count > 0
    );
    const totalAttemptsLocal = weighted.reduce(
      (sum, q) => sum + q.attempt_count,
      0
    );
    if (!totalAttemptsLocal) return null;
    const weightedSum = weighted.reduce(
      (sum, q) => sum + (q.avg_score ?? 0) * q.attempt_count,
      0
    );
    return weightedSum / totalAttemptsLocal;
  }, [data]);

  const avgScoreDisplay =
    avgScore != null ? `${avgScore.toFixed(1)}%` : "—";
  const avgScoreColor =
    avgScore == null
      ? "text-muted-foreground"
      : avgScore > 70
      ? "text-green-600"
      : avgScore >= 50
      ? "text-amber-600"
      : "text-red-600";

  const chatSessions =
    data?.dailyActivity.reduce(
      (sum, d) => sum + (d.sessions ?? 0),
      0
    ) ?? 0;

  const sortedQuizStats = useMemo(() => {
    if (!data?.quizStats) return [];
    const arr = [...data.quizStats];
    if (sortBy === "attempts") {
      arr.sort((a, b) => b.attempt_count - a.attempt_count);
    } else {
      arr.sort(
        (a, b) =>
          (b.avg_score ?? 0) - (a.avg_score ?? 0)
      );
    }
    return arr;
  }, [data, sortBy]);

  const handleSubjectChange = (id: string) => {
    setSelectedSubjectId(id);
    fetchData(id);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <BarChart2 className="size-7 text-primary" />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Analytics Dashboard
            </h1>
            <p className="text-muted-foreground text-sm">
              Understand how students are using quizzes and chat for{" "}
              {subjects.find((s) => s.id === selectedSubjectId)?.name ??
                "your subjects"}
              .
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Subject</span>
          <Select
            value={selectedSubjectId ?? ""}
            onValueChange={handleSubjectChange}
          >
            <SelectTrigger className="w-56">
              <SelectValue placeholder="Select subject..." />
            </SelectTrigger>
            <SelectContent>
              {subjects.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.code} — {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {isLoading ? (
        <PageSkeleton />
      ) : !data ? (
        <p className="text-muted-foreground text-sm">
          No analytics data available.
        </p>
      ) : (
        <>
          {/* STAT CARDS */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground">
                  Quiz Attempts
                </CardTitle>
                <Brain className="size-5 text-blue-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-semibold">
                  {totalAttempts}
                </div>
                <p className="text-xs text-muted-foreground">
                  Total quiz attempts
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground">
                  Average Quiz Score
                </CardTitle>
                <Trophy className="size-5 text-amber-500" />
              </CardHeader>
              <CardContent>
                <div className={cn("text-2xl font-semibold", avgScoreColor)}>
                  {avgScoreDisplay}
                </div>
                <p className="text-xs text-muted-foreground">
                  Across all quiz attempts
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground">
                  Chat Sessions (14 days)
                </CardTitle>
                <MessageSquare className="size-5 text-purple-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-semibold">
                  {chatSessions}
                </div>
                <p className="text-xs text-muted-foreground">
                  Distinct sessions in last 14 days
                </p>
              </CardContent>
            </Card>

          </div>

          {/* CHARTS ROW */}
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-sm font-medium">
                  Student Activity — Last 14 Days
                </CardTitle>
              </CardHeader>
              <CardContent className="h-[260px]">
                {data.dailyActivity.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                    No chat activity yet
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={data.dailyActivity}>
                      <defs>
                        <linearGradient
                          id="activity"
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop
                            offset="5%"
                            stopColor="#2563EB"
                            stopOpacity={0.4}
                          />
                          <stop
                            offset="95%"
                            stopColor="#DBEAFE"
                            stopOpacity={0}
                          />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis
                        dataKey="date"
                        tickFormatter={(d) =>
                          new Date(d).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                          })
                        }
                        tick={{ fontSize: 10 }}
                      />
                      <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                      <Tooltip
                        formatter={(value: any) => [`${value} sessions`, ""]}
                        labelFormatter={(label) =>
                          new Date(label).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                          })
                        }
                      />
                      <Area
                        type="monotone"
                        dataKey="sessions"
                        stroke="#2563EB"
                        fill="url(#activity)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium">
                  Quiz Score Distribution
                </CardTitle>
              </CardHeader>
              <CardContent className="h-[260px]">
                {data.scoreDistribution.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                    No quiz attempts yet
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.scoreDistribution}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis
                        dataKey="range"
                        tick={{ fontSize: 10 }}
                      />
                      <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                      <Tooltip />
                      <Bar
                        dataKey="count"
                        radius={[4, 4, 0, 0]}
                        fill="#16A34A"
                      >
                        {data.scoreDistribution.map((entry, index) => {
                          let color = "#16A34A";
                          if (entry.range === "60-79") color = "#D97706";
                          else if (entry.range === "40-59")
                            color = "#EA580C";
                          else if (entry.range === "0-39") color = "#DC2626";
                          return (
                            <Cell
                              // eslint-disable-next-line react/no-array-index-key
                              key={`cell-${index}`}
                              fill={color}
                            />
                          );
                        })}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>

          {/* QUIZ PERFORMANCE TABLE */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-sm font-medium">
                Quiz Performance by Topic
              </CardTitle>
              <div className="flex items-center gap-2 text-xs">
                <span className="text-muted-foreground">Sort by</span>
                <Button
                  type="button"
                  variant={sortBy === "attempts" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSortBy("attempts")}
                >
                  Attempts
                </Button>
                <Button
                  type="button"
                  variant={sortBy === "avg" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSortBy("avg")}
                >
                  Avg Score
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {sortedQuizStats.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No quizzes generated yet.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Quiz Title</TableHead>
                      <TableHead className="text-right">
                        Attempts
                      </TableHead>
                      <TableHead className="text-right">
                        Avg Score
                      </TableHead>
                      <TableHead className="text-right">Min</TableHead>
                      <TableHead className="text-right">Max</TableHead>
                      <TableHead className="text-right">
                        Performance
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedQuizStats.map((q) => {
                      const avg = q.avg_score ?? 0;
                      let perfLabel = "Needs Review";
                      let perfVariant:
                        | "default"
                        | "secondary"
                        | "outline"
                        | "destructive"
                        | null
                        | undefined = "destructive";
                      if (avg > 70) {
                        perfLabel = "Good";
                        perfVariant = "default";
                      } else if (avg >= 50) {
                        perfLabel = "Fair";
                        perfVariant = "secondary";
                      }
                      return (
                        <TableRow key={q.title}>
                          <TableCell className="max-w-xs truncate">
                            {q.title}
                          </TableCell>
                          <TableCell className="text-right">
                            {q.attempt_count}
                          </TableCell>
                          <TableCell className="text-right">
                            {q.avg_score != null
                              ? `${q.avg_score.toFixed(1)}%`
                              : "—"}
                          </TableCell>
                          <TableCell className="text-right">
                            {q.min_score != null ? q.min_score : "—"}
                          </TableCell>
                          <TableCell className="text-right">
                            {q.max_score != null ? q.max_score : "—"}
                          </TableCell>
                          <TableCell className="text-right">
                            <Badge variant={perfVariant} className="text-xs">
                              {perfLabel}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* BOTTOM ROW */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium">
                  Most Asked Questions
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {data.topQuestions.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No chat data yet.
                  </p>
                ) : (
                  data.topQuestions.map((q) => (
                    <div
                      key={q.content}
                      className="flex items-start justify-between gap-2 border-b border-dashed border-muted-foreground/30 pb-1 last:border-b-0"
                    >
                      <p className="text-xs text-muted-foreground max-w-xs truncate">
                        {q.content.length > 80
                          ? `${q.content.slice(0, 80)}…`
                          : q.content}
                      </p>
                      <Badge
                        variant="secondary"
                        className="text-[10px] px-1.5 py-0"
                      >
                        {q.frequency}x
                      </Badge>
                    </div>
                  ))
                )}
                <p className="text-[10px] text-muted-foreground mt-2">
                  Repeated questions indicate concepts needing more coverage.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium">
                  Generated Content
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {data.generatedContent.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No content generated yet.
                  </p>
                ) : (
                  data.generatedContent.map((row) => {
                    let icon = <Presentation className="size-4" />;
                    if (row.type === "qpaper") {
                      icon = <FileText className="size-4" />;
                    } else if (row.type === "refine") {
                      icon = <Sparkles className="size-4" />;
                    }
                    const date = new Date(row.created_at).toLocaleDateString(
                      "en-US",
                      { month: "short", day: "numeric" }
                    );
                    const detail =
                      row.slide_count != null
                        ? `${row.slide_count} slides`
                        : row.question_count != null
                        ? `${row.question_count} questions`
                        : "";
                    return (
                      <div
                        key={`${row.type}-${row.created_at}-${row.title}`}
                        className="flex items-center justify-between gap-2 border-b border-dashed border-muted-foreground/30 pb-1 last:border-b-0"
                      >
                        <div className="flex items-center gap-2">
                          <div className="text-muted-foreground">
                            {icon}
                          </div>
                          <div className="space-y-0.5">
                            <p className="text-xs font-medium max-w-xs truncate">
                              {row.title}
                            </p>
                            <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                              <span>{date}</span>
                              {detail && <span>• {detail}</span>}
                            </div>
                          </div>
                        </div>
                        <Badge
                          variant="outline"
                          className="text-[10px] uppercase tracking-wide"
                        >
                          {row.type}
                        </Badge>
                      </div>
                    );
                  })
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

