"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronRight,
  History,
  Loader2,
  Target,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { createBrowserClient } from "@/lib/db/supabase-browser";
import { cn } from "@/lib/utils";

const CATEGORIES = ["quantitative", "logical", "verbal", "technical"] as const;

type GapRow = {
  subcategory: string;
  score: number;
  label: string;
  attempted: number;
  correct: number;
  status: string;
};

export type PlacementHistoryAttempt = {
  id: string;
  company_id: string;
  score: number;
  correct_answers: number;
  total_questions: number;
  time_taken: number | null;
  created_at: string;
  category_scores: Record<string, number> | null;
  subcategory_scores: Record<string, number> | null;
  subcategory_gaps: GapRow[] | null;
  top_strengths: GapRow[] | null;
  weaknesses: string[] | null;
  questions: any[] | null;
  answers: Record<string, string> | null;
  placement_companies: { name: string; difficulty: string } | null;
};

function PlacementQuestionMarkdown({ text }: { text: string }) {
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          table: ({ children }) => (
            <div className="my-2 overflow-x-auto">
              <table className="w-full border-collapse text-sm">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border border-border bg-muted/60 px-2 py-1.5 text-left text-xs font-semibold">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border border-border px-2 py-1.5 text-sm">{children}</td>
          ),
          tr: ({ children }) => (
            <tr className="even:bg-muted/20">{children}</tr>
          ),
          p: ({ children }) => (
            <p className="mb-0 font-medium text-foreground">{children}</p>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

function categoryBadgeClass(category: string) {
  switch (category) {
    case "quantitative":
      return "bg-blue-100 text-blue-700";
    case "logical":
      return "bg-purple-100 text-purple-700";
    case "verbal":
      return "bg-amber-100 text-amber-700";
    case "technical":
      return "bg-teal-100 text-teal-700";
    default:
      return "bg-slate-100 text-slate-700";
  }
}

function scoreBadgeClass(score: number) {
  if (score >= 65) return "bg-green-100 text-green-800";
  if (score >= 50) return "bg-amber-100 text-amber-800";
  return "bg-red-100 text-red-800";
}

function headerScoreClass(score: number) {
  if (score >= 65) return "text-green-600";
  if (score >= 50) return "text-amber-600";
  return "text-red-600";
}

export default function PlacementHistoryPage() {
  const router = useRouter();
  const [attempts, setAttempts] = useState<PlacementHistoryAttempt[]>([]);
  const [selectedAttempt, setSelectedAttempt] =
    useState<PlacementHistoryAttempt | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"overview" | "questions" | "skills">(
    "overview"
  );
  const [categoryFilter, setCategoryFilter] = useState<
    "all" | "quantitative" | "logical" | "verbal" | "technical"
  >("all");
  const [correctFilter, setCorrectFilter] = useState<"all" | "correct" | "wrong">(
    "all"
  );
  const [showExplanation, setShowExplanation] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  useEffect(() => {
    const run = async () => {
      setIsLoading(true);
      try {
        const supabase = createBrowserClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) {
          setAttempts([]);
          return;
        }

        const { data, error } = await supabase
          .from("placement_attempts")
          .select(
            `
            id,
            company_id,
            score,
            correct_answers,
            total_questions,
            time_taken,
            created_at,
            category_scores,
            subcategory_scores,
            subcategory_gaps,
            top_strengths,
            weaknesses,
            questions,
            answers,
            placement_companies (name, difficulty)
          `
          )
          .eq("student_id", user.id)
          .not("questions", "is", null)
          .order("created_at", { ascending: false })
          .limit(3);

        if (error) {
          console.error("[placement/history]", error);
          setAttempts([]);
          return;
        }

        const rows = (data ?? []).map((row: Record<string, unknown>) => {
          const pc = row.placement_companies;
          const company =
            Array.isArray(pc) && pc[0]
              ? (pc[0] as { name: string; difficulty: string })
              : (pc as { name: string; difficulty: string } | null);
          return {
            ...row,
            placement_companies: company,
          };
        }) as unknown as PlacementHistoryAttempt[];
        setAttempts(rows);
        if (rows.length > 0) {
          setSelectedAttempt(rows[0]);
        } else {
          setSelectedAttempt(null);
        }
      } finally {
        setIsLoading(false);
      }
    };

    void run();
  }, []);

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });

  const answers = selectedAttempt?.answers ?? {};
  const questions = selectedAttempt?.questions ?? [];

  const filteredQuestions = useMemo(() => {
    return questions.filter((q) => {
      const catOk =
        categoryFilter === "all" ||
        String(q.category ?? "").toLowerCase() === categoryFilter;
      if (!catOk) return false;
      const student = String(answers[q.id] ?? "").trim().toUpperCase();
      const correct = String(q.answer ?? "").trim().toUpperCase();
      if (correctFilter === "correct") return student === correct;
      if (correctFilter === "wrong") return student !== correct;
      return true;
    });
  }, [questions, answers, categoryFilter, correctFilter]);

  const radarData = useMemo(() => {
    const cs = selectedAttempt?.category_scores ?? {};
    return Object.entries(cs).map(([cat, score]) => ({
      category: cat.charAt(0).toUpperCase() + cat.slice(1),
      score: Number(score),
      target: 65,
    }));
  }, [selectedAttempt?.category_scores]);

  const subcategoryTableRows = useMemo(() => {
    const sc = selectedAttempt?.subcategory_scores ?? {};
    return Object.entries(sc)
      .map(([slug, score]) => ({
        slug,
        score: Number(score),
        label: slug.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      }))
      .sort((a, b) => a.score - b.score);
  }, [selectedAttempt?.subcategory_scores]);

  const handleExport = useCallback(async () => {
    if (!selectedAttempt?.questions?.length) return;
    const companyName =
      selectedAttempt.placement_companies?.name ?? "Placement Test";
    setIsExporting(true);
    try {
      const res = await fetch("/api/placement/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyName,
          score: selectedAttempt.score,
          correctAnswers: selectedAttempt.correct_answers,
          totalQuestions: selectedAttempt.total_questions,
          timeTaken: selectedAttempt.time_taken,
          categoryScores: selectedAttempt.category_scores ?? {},
          gaps: [],
          questions: selectedAttempt.questions,
          answers: selectedAttempt.answers ?? {},
        }),
      });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `placement-${companyName}-results.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("[placement/history] export", e);
    } finally {
      setIsExporting(false);
    }
  }, [selectedAttempt]);

  const retakePath = selectedAttempt
    ? `/student/placement/test/${selectedAttempt.company_id}`
    : "/student/placement";

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <History className="mt-0.5 size-8 text-primary" />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Placement History
          </h1>
          <p className="text-sm text-muted-foreground">
            Review your last 3 test attempts
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2 md:col-span-1">
            <Skeleton className="h-24 w-full rounded-lg" />
            <Skeleton className="h-24 w-full rounded-lg" />
            <Skeleton className="h-24 w-full rounded-lg" />
          </div>
          <Skeleton className="h-96 rounded-lg md:col-span-2" />
        </div>
      ) : attempts.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
            <Target className="size-10 text-muted-foreground" />
            <p className="max-w-md text-sm text-muted-foreground">
              No completed tests yet. Take a placement test to see your history
              here.
            </p>
            <Button onClick={() => router.push("/student/placement")}>
              Go to Placement Prep
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex flex-col gap-4 md:flex-row md:items-stretch">
            <div className="md:w-1/3">
              <h2 className="mb-2 text-sm font-medium text-muted-foreground">
                Attempts
              </h2>
              <div className="space-y-2">
                {attempts.map((a) => {
                  const sel = selectedAttempt?.id === a.id;
                  const name = a.placement_companies?.name ?? "Company";
                  const t = a.time_taken ?? 0;
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => {
                        setSelectedAttempt(a);
                        setActiveTab("overview");
                        setShowExplanation(null);
                      }}
                      className={cn(
                        "w-full rounded-lg border p-3 text-left transition-colors",
                        sel
                          ? "border-primary bg-primary/5"
                          : "hover:bg-muted/50"
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-semibold leading-tight">{name}</span>
                        <Badge className={scoreBadgeClass(a.score)}>
                          {a.score}%
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {a.correct_answers}/{a.total_questions} correct
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(a.created_at)} · {Math.floor(t / 60)}m {t % 60}s
                      </p>
                      <ChevronRight className="mt-1 size-4 text-muted-foreground" />
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="min-h-[420px] flex-1 md:w-2/3">
              {!selectedAttempt ? (
                <Card className="flex h-full min-h-[320px] items-center justify-center">
                  <p className="text-sm text-muted-foreground">
                    Select an attempt to review
                  </p>
                </Card>
              ) : (
                <ScrollArea className="h-[min(70vh,720px)] pr-3">
                  <div className="space-y-4">
                    <div>
                      <h2
                        className={cn(
                          "text-2xl font-bold",
                          headerScoreClass(selectedAttempt.score)
                        )}
                      >
                        {selectedAttempt.placement_companies?.name ?? "Placement"}{" "}
                        — {selectedAttempt.score}%
                      </h2>
                      <p className="text-sm text-muted-foreground">
                        {formatDate(selectedAttempt.created_at)} ·{" "}
                        {Math.floor((selectedAttempt.time_taken ?? 0) / 60)}m{" "}
                        {(selectedAttempt.time_taken ?? 0) % 60}s
                      </p>
                    </div>

                    <Tabs
                      value={activeTab}
                      onValueChange={(v) =>
                        setActiveTab(v as "overview" | "questions" | "skills")
                      }
                    >
                      <TabsList className="flex flex-wrap">
                        <TabsTrigger value="overview">Overview</TabsTrigger>
                        <TabsTrigger value="questions">Questions</TabsTrigger>
                        <TabsTrigger value="skills">Skills</TabsTrigger>
                      </TabsList>

                      <TabsContent value="overview" className="space-y-4 pt-2">
                        <Card>
                          <CardHeader>
                            <CardTitle className="text-base">
                              Category performance
                            </CardTitle>
                          </CardHeader>
                          <CardContent className="space-y-4">
                            {CATEGORIES.map((cat) => {
                              const sc = Number(
                                selectedAttempt.category_scores?.[cat] ?? 0
                              );
                              return (
                                <div key={cat} className="space-y-1.5">
                                  <div className="flex justify-between text-sm">
                                    <span className="font-medium capitalize">
                                      {cat}
                                    </span>
                                    <span>{sc}%</span>
                                  </div>
                                  <Progress value={sc} />
                                  <p className="text-xs text-muted-foreground">
                                    Target: 65%
                                  </p>
                                </div>
                              );
                            })}
                          </CardContent>
                        </Card>

                        <Card className="border-green-200 bg-green-50/50 dark:border-green-900 dark:bg-green-950/20">
                          <CardHeader>
                            <CardTitle className="text-base text-green-800 dark:text-green-300">
                              Top strengths
                            </CardTitle>
                          </CardHeader>
                          <CardContent className="space-y-2">
                            {(selectedAttempt.top_strengths ?? []).length === 0 ? (
                              <p className="text-sm text-muted-foreground">
                                No strong areas yet
                              </p>
                            ) : (
                              (selectedAttempt.top_strengths ?? []).map((t) => (
                                <div
                                  key={t.subcategory}
                                  className="flex items-center justify-between rounded border border-green-100 bg-white/80 px-3 py-2 text-sm dark:border-green-900 dark:bg-green-950/40"
                                >
                                  <span>{t.label}</span>
                                  <Badge variant="secondary">{t.score}%</Badge>
                                </div>
                              ))
                            )}
                          </CardContent>
                        </Card>

                        <Card className="border-red-200 bg-red-50/40 dark:border-red-900 dark:bg-red-950/20">
                          <CardHeader>
                            <CardTitle className="text-base text-red-800 dark:text-red-300">
                              Focus areas
                            </CardTitle>
                          </CardHeader>
                          <CardContent className="space-y-3">
                            {(selectedAttempt.subcategory_gaps ?? [])
                              .slice(0, 3)
                              .map((gap) => (
                                <div
                                  key={gap.subcategory}
                                  className="flex flex-wrap items-center justify-between gap-2 rounded border border-red-100 px-3 py-2 dark:border-red-900"
                                >
                                  <div>
                                    <p className="text-sm font-medium">
                                      {gap.label}
                                    </p>
                                    <p className="text-xs text-muted-foreground">
                                      {gap.score}%
                                    </p>
                                  </div>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="shrink-0"
                                    onClick={() =>
                                      router.push(
                                        `/student/placement/practice/${gap.subcategory}`
                                      )
                                    }
                                  >
                                    Practice →
                                  </Button>
                                </div>
                              ))}
                            {(selectedAttempt.subcategory_gaps ?? []).length ===
                              0 && (
                              <p className="text-sm text-muted-foreground">
                                No focus gaps recorded for this attempt.
                              </p>
                            )}
                          </CardContent>
                        </Card>
                      </TabsContent>

                      <TabsContent value="questions" className="space-y-4 pt-2">
                        <Card>
                          <CardHeader className="space-y-3">
                            <CardTitle className="text-base">
                              Question breakdown
                            </CardTitle>
                            <div className="flex flex-wrap gap-2">
                              {(
                                [
                                  "all",
                                  "quantitative",
                                  "logical",
                                  "verbal",
                                  "technical",
                                ] as const
                              ).map((cat) => (
                                <Button
                                  key={cat}
                                  size="sm"
                                  variant={
                                    categoryFilter === cat ? "default" : "outline"
                                  }
                                  onClick={() => setCategoryFilter(cat)}
                                  className="capitalize"
                                >
                                  {cat === "all" ? "All" : cat}
                                </Button>
                              ))}
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {(["all", "correct", "wrong"] as const).map(
                                (f) => (
                                  <Button
                                    key={f}
                                    size="sm"
                                    variant={
                                      correctFilter === f ? "default" : "outline"
                                    }
                                    onClick={() => setCorrectFilter(f)}
                                    className="capitalize"
                                  >
                                    {f === "all"
                                      ? "All"
                                      : f === "correct"
                                        ? "Correct"
                                        : "Wrong"}
                                  </Button>
                                )
                              )}
                            </div>
                          </CardHeader>
                          <CardContent>
                            <div className="space-y-4">
                              {filteredQuestions.length === 0 ? (
                                <p className="text-sm text-muted-foreground">
                                  No questions match filters.
                                </p>
                              ) : (
                                filteredQuestions.map((q, index) => {
                                  const studentAns = String(
                                    answers[q.id] ?? ""
                                  )
                                    .trim()
                                    .toUpperCase();
                                  const correctAns = String(q.answer ?? "")
                                    .trim()
                                    .toUpperCase();
                                  const isCorrect = studentAns === correctAns;
                                  return (
                                    <div
                                      key={q.id}
                                      className="space-y-3 border-b pb-4 last:border-b-0"
                                    >
                                      <div className="flex items-center justify-between gap-2">
                                        <div className="flex flex-wrap items-center gap-2">
                                          <Badge variant="outline">
                                            Q{index + 1}
                                          </Badge>
                                          <Badge
                                            className={cn(
                                              "capitalize",
                                              categoryBadgeClass(
                                                String(q.category ?? "")
                                              )
                                            )}
                                          >
                                            {String(q.category ?? "general")}
                                          </Badge>
                                        </div>
                                        <span
                                          className={cn(
                                            "text-sm font-semibold",
                                            isCorrect
                                              ? "text-green-600"
                                              : "text-red-600"
                                          )}
                                        >
                                          {isCorrect ? "✓ Correct" : "✗ Wrong"}
                                        </span>
                                      </div>
                                      <PlacementQuestionMarkdown
                                        text={String(q.question ?? "")}
                                      />
                                      <div className="space-y-2">
                                        {(q.options ?? []).map(
                                          (opt: string, idx: number) => {
                                            const letter = String(
                                              opt?.[0] ??
                                                ["A", "B", "C", "D"][idx] ??
                                                ""
                                            );
                                            const isStudent =
                                              studentAns === letter;
                                            const isRight =
                                              correctAns === letter;
                                            return (
                                              <div
                                                key={`${q.id}-opt-${idx}`}
                                                className={cn(
                                                  "rounded-md border px-3 py-2 text-sm",
                                                  isStudent &&
                                                    isCorrect &&
                                                    "border-green-200 bg-green-50",
                                                  isStudent &&
                                                    !isCorrect &&
                                                    "border-red-200 bg-red-50",
                                                  !isStudent &&
                                                    isRight &&
                                                    "border-green-200 bg-green-50"
                                                )}
                                              >
                                                <span className="mr-1 font-semibold">
                                                  {isStudent && isCorrect
                                                    ? "✓"
                                                    : isStudent && !isCorrect
                                                      ? "✗"
                                                      : !isStudent && isRight
                                                        ? "✓"
                                                        : "•"}
                                                </span>
                                                {opt}
                                              </div>
                                            );
                                          }
                                        )}
                                      </div>
                                      <button
                                        type="button"
                                        className="text-sm text-primary hover:underline"
                                        onClick={() =>
                                          setShowExplanation((prev) =>
                                            prev === q.id ? null : q.id
                                          )
                                        }
                                      >
                                        {showExplanation === q.id
                                          ? "Hide Explanation"
                                          : "Show Explanation"}
                                      </button>
                                      {showExplanation === q.id &&
                                        q.explanation && (
                                          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                                            {q.explanation}
                                          </div>
                                        )}
                                    </div>
                                  );
                                })
                              )}
                            </div>
                          </CardContent>
                        </Card>
                      </TabsContent>

                      <TabsContent value="skills" className="space-y-4 pt-2">
                        <Card>
                          <CardContent className="space-y-4 p-4">
                            <div className="rounded-lg border p-3">
                              <ResponsiveContainer width="100%" height={240}>
                                <RadarChart data={radarData}>
                                  <PolarGrid />
                                  <PolarAngleAxis
                                    dataKey="category"
                                    tick={{ fontSize: 12 }}
                                  />
                                  <Radar
                                    name="Your score"
                                    dataKey="score"
                                    stroke="#2563EB"
                                    fill="#2563EB"
                                    fillOpacity={0.3}
                                  />
                                  <Radar
                                    name="Target"
                                    dataKey="target"
                                    stroke="#16A34A"
                                    fill="#16A34A"
                                    fillOpacity={0.1}
                                    strokeDasharray="4 4"
                                  />
                                  <Tooltip formatter={(v) => `${v}%`} />
                                </RadarChart>
                              </ResponsiveContainer>
                            </div>

                            <div>
                              <h3 className="mb-2 text-sm font-semibold">
                                Subcategory breakdown
                              </h3>
                              <div className="overflow-x-auto rounded-md border">
                                <table className="w-full text-sm">
                                  <thead>
                                    <tr className="border-b bg-muted/50">
                                      <th className="px-3 py-2 text-left font-medium">
                                        Topic
                                      </th>
                                      <th className="px-3 py-2 text-right font-medium">
                                        Score
                                      </th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {subcategoryTableRows.map((row) => (
                                      <tr key={row.slug} className="border-b">
                                        <td className="px-3 py-2">{row.label}</td>
                                        <td className="px-3 py-2 text-right">
                                          {row.score}%
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>

                            <Button
                              className="w-full sm:w-auto"
                              onClick={() => router.push(retakePath)}
                            >
                              Retake this test
                            </Button>
                          </CardContent>
                        </Card>
                      </TabsContent>
                    </Tabs>
                  </div>
                </ScrollArea>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-3 border-t pt-4">
            <Button
              variant="outline"
              disabled={!selectedAttempt?.questions?.length || isExporting}
              onClick={() => void handleExport()}
            >
              {isExporting ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Exporting…
                </>
              ) : (
                "Export Report"
              )}
            </Button>
            <Button
              disabled={!selectedAttempt}
              onClick={() => router.push(retakePath)}
            >
              Retake Test
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
