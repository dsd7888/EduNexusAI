"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle,
  Clock,
  Download,
  Loader2,
  Lightbulb,
} from "lucide-react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  Radar,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { cn } from "@/lib/utils";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const activeGenerations = new Set<string>();

type View = "loading" | "test" | "results";

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

function GeneratingProgress() {
  const [progress, setProgress] = useState(5);

  useEffect(() => {
    // Simulate progress: fast at first, slows near end
    const stages = [
      { target: 20, delay: 3000 },
      { target: 40, delay: 8000 },
      { target: 60, delay: 20000 },
      { target: 75, delay: 40000 },
      { target: 88, delay: 80000 },
      { target: 95, delay: 120000 },
    ];

    const timers: Array<ReturnType<typeof setTimeout>> = [];
    stages.forEach(({ target, delay }) => {
      timers.push(setTimeout(() => setProgress(target), delay));
    });

    return () => timers.forEach(clearTimeout);
  }, []);

  return (
    <div className="space-y-1">
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-all duration-1000"
          style={{ width: `${progress}%` }}
        />
      </div>
      <p className="text-right text-xs text-muted-foreground">{progress}%</p>
    </div>
  );
}

export default function PlacementTestPage() {
  const router = useRouter();
  const params = useParams<{ companyId: string }>();

  const storageKey = `placement_test_${params.companyId}`;

  const [view, setView] = useState<View>("loading");
  const [companyName, setCompanyName] = useState("");
  const [questions, setQuestions] = useState<any[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [timeLeft, setTimeLeft] = useState(30 * 60);
  const [startTime, setStartTime] = useState(0);
  const [timerPaused, setTimerPaused] = useState(false);
  const [tabWarning, setTabWarning] = useState(false);
  const [tabSwitchCount, setTabSwitchCount] = useState(0);
  const tabWasHiddenRef = useRef(false);
  const [restoredState, setRestoredState] = useState<any>(null);
  const [showResumeDialog, setShowResumeDialog] = useState(false);
  const [results, setResults] = useState<any | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showEndDialog, setShowEndDialog] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [activeTab, setActiveTab] = useState<"summary" | "breakdown">("summary");
  const [showExplanation, setShowExplanation] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<
    "all" | "quantitative" | "logical" | "verbal" | "technical"
  >("all");
  const [correctFilter, setCorrectFilter] = useState<"all" | "correct" | "wrong">("all");

  const formatTime = (seconds: number) => {
    const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
    const ss = String(seconds % 60).padStart(2, "0");
    return `${mm}:${ss}`;
  };

  const handleSubmit = useCallback(async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      const timeTaken = Math.round((Date.now() - startTime) / 1000);
      const res = await fetch("/api/placement/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId: params.companyId,
          questions,
          answers,
          timeTaken,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        toast.error(data?.error ?? "Failed to submit test");
        return;
      }

      try {
        localStorage.removeItem(storageKey);
      } catch {}

      setResults(data);
      setActiveTab("summary");
      setShowExplanation(null);
      setCategoryFilter("all");
      setCorrectFilter("all");
      setView("results");
    } finally {
      setIsSubmitting(false);
    }
  }, [answers, isSubmitting, params.companyId, questions, startTime, storageKey]);

  const handleExport = useCallback(async () => {
    if (!results || !questions) return;
    setIsExporting(true);
    try {
      const res = await fetch("/api/placement/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyName: results.companyName,
          score: results.score,
          correctAnswers: results.correctAnswers,
          totalQuestions: results.totalQuestions,
          timeTaken: results.timeTaken,
          categoryScores: results.categoryScores,
          gaps: results.gaps,
          questions,
          answers,
          topStrengths: results.topStrengths ?? [],
          subcategoryGaps: results.subcategoryGaps ?? [],
        }),
      });

      if (!res.ok) throw new Error("Export failed");

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `placement-${results.companyName}-results.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("[placement/export]", err);
      toast.error("Could not generate PDF. Please try again.");
    } finally {
      setIsExporting(false);
    }
  }, [answers, questions, results]);

  const generateTest = useCallback(async () => {
    const lockKey = `placement_${params.companyId}`;
    if (activeGenerations.has(lockKey)) {
      console.log("[placement/test] Already generating, skipping");
      return;
    }
    activeGenerations.add(lockKey);
    setView("loading");
    try {
      const res = await fetch("/api/placement/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId: params.companyId }),
      });

      const data = await res.json().catch(() => ({} as any));

      if (!res.ok) {
        toast.error("Could not generate test", {
          description: data?.error ?? "Please try again.",
        });
        router.push("/student/placement");
        return;
      }

      const { questions: qs, companyName: name } = data as {
        questions?: any[];
        companyName?: string;
        partial?: boolean;
        error?: string;
      };

      if (!qs?.length) {
        toast.error("No questions generated");
        router.push("/student/placement");
        return;
      }

      if (data.partial) {
        toast.info(`Test ready — ${qs.length} questions`, {
          description: "Slightly shorter test due to generation limits.",
        });
      }

      setQuestions(qs);
      setCompanyName(String(name ?? "Placement Test"));
      setAnswers({});
      setCurrentIndex(0);
      setStartTime(Date.now());
      setTimeLeft(qs.length * 60);
      setTimerPaused(false);
      setTabSwitchCount(0);
      setTabWarning(false);
      setView("test");
    } catch (err) {
      console.error("[placement/test]", err);
      router.push("/student/placement");
    } finally {
      activeGenerations.delete(lockKey);
    }
  }, [params.companyId, router]);

  useEffect(() => {
    // Check for saved state first — single mount, no duplicate generateTest
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        const ageMinutes = (Date.now() - parsed.savedAt) / 60000;
        if (ageMinutes < 60 && parsed.questions?.length > 0) {
          setRestoredState(parsed);
          return;
        }
        localStorage.removeItem(storageKey);
      }
    } catch {}

    // No saved state — generate once
    void generateTest();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: run once on mount only
  }, []);

  useEffect(() => {
    if (restoredState) setShowResumeDialog(true);
  }, [restoredState]);

  useEffect(() => {
    if (view !== "test" || questions.length === 0) return;
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify({
          answers,
          currentIndex,
          timeLeft,
          startTime,
          questions,
          companyName,
          savedAt: Date.now(),
        })
      );
    } catch {}
  }, [answers, currentIndex, timeLeft, startTime, view, questions, companyName, storageKey]);

  useEffect(() => {
    if (view !== "test") return;

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "Your test progress is saved. Are you sure you want to leave?";
      return e.returnValue;
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [view]);

  useEffect(() => {
    if (view !== "test") return;

    const handleVisibilityChange = () => {
      if (document.hidden) {
        tabWasHiddenRef.current = true;
        setTimerPaused(true);
      } else {
        setTimerPaused(false);
        if (tabWasHiddenRef.current) {
          tabWasHiddenRef.current = false;
          setTabSwitchCount((prev) => {
            const newCount = prev + 1;
            if (newCount >= 1) setTabWarning(true);
            return newCount;
          });
        }
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [view]);

  useEffect(() => {
    if (view !== "test") return;
    const interval = setInterval(() => {
      setTimeLeft((prev) => {
        if (timerPaused) return prev;
        if (prev <= 1) {
          clearInterval(interval);
          void handleSubmit();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [view, handleSubmit, timerPaused]);

  useEffect(() => {
    if (view !== "loading") return;

    const handlePopState = (e: PopStateEvent) => {
      e.preventDefault();
      window.history.pushState(null, "", window.location.href);
    };

    window.history.pushState(null, "", window.location.href);
    window.addEventListener("popstate", handlePopState);

    return () => window.removeEventListener("popstate", handlePopState);
  }, [view]);

  const total = questions.length;
  const current = questions[currentIndex];
  const answeredCount = Object.keys(answers).length;
  const progressValue = total ? ((currentIndex + 1) / total) * 100 : 0;

  const dotIndexes = useMemo(() => {
    if (total <= 10) return Array.from({ length: total }, (_, i) => i);
    const start = Math.min(Math.max(0, currentIndex - 4), total - 10);
    return Array.from({ length: 10 }, (_, i) => start + i);
  }, [currentIndex, total]);

  if (view === "loading") {
    return (
      <>
        <AlertDialog open={showResumeDialog} onOpenChange={setShowResumeDialog}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Resume your test?</AlertDialogTitle>
              <AlertDialogDescription>
                You have an in-progress {restoredState?.companyName} test with{" "}
                {Object.keys(restoredState?.answers ?? {}).length} questions answered. Would you like
                to continue where you left off?
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel
                onClick={() => {
                  localStorage.removeItem(storageKey);
                  setRestoredState(null);
                  setShowResumeDialog(false);
                  void generateTest();
                }}
              >
                Start Fresh
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  if (!restoredState) return;
                  setQuestions(restoredState.questions);
                  setAnswers(restoredState.answers);
                  setCurrentIndex(restoredState.currentIndex);
                  setTimeLeft(restoredState.timeLeft);
                  setStartTime(restoredState.startTime ?? Date.now());
                  setCompanyName(restoredState.companyName);
                  setView("test");
                  setShowResumeDialog(false);
                  setRestoredState(null);
                }}
              >
                Resume Test
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-6 px-4 text-center">
          <div className="relative">
            <Loader2 className="size-14 animate-spin text-primary" />
          </div>
          <div className="space-y-2">
            <h2 className="text-xl font-semibold">Preparing your test...</h2>
            <p className="max-w-sm text-sm text-muted-foreground">
              Generating 20 questions tailored to your branch. This may take a couple of minutes —
              please don&apos;t close this page.
            </p>
          </div>
          <div className="w-64 space-y-2">
            <GeneratingProgress />
          </div>
          <p className="rounded-full border bg-muted/50 px-3 py-1 text-xs text-muted-foreground">
            🔒 Please wait — navigating away will cancel your test
          </p>
        </div>
      </>
    );
  }

  if (view === "results" && results) {
    const scoreColor =
      results.score >= 65
        ? "text-green-600"
        : results.score >= 50
          ? "text-amber-600"
          : "text-red-600";
    const categoryEntries = Object.entries(results.categoryScores ?? {});
    const subcategoryGaps = results.subcategoryGaps ?? [];
    const topStrengths = results.topStrengths ?? [];
    const totalTime = results.timeTaken ?? 0;
    const avgTimePerQ = questions.length > 0 ? Math.round(totalTime / questions.length) : 0;
    const avgTimeColor =
      avgTimePerQ <= 45 ? "text-green-600" : avgTimePerQ <= 75 ? "text-amber-600" : "text-red-600";
    const attemptedCount = Object.keys(answers).length;
    const sortedCategories = [...categoryEntries].sort(
      (a, b) => Number(b[1]) - Number(a[1])
    );
    const strongestCategory = sortedCategories[0]?.[0] ?? "N/A";
    const weakestCategory = sortedCategories[sortedCategories.length - 1]?.[0] ?? "N/A";
    const radarData = Object.entries(results.categoryScores ?? {}).map(
      ([cat, score]) => ({
        category: cat.charAt(0).toUpperCase() + cat.slice(1),
        score: score as number,
        target: 65,
      })
    );

    const filteredQuestions = questions
      .filter(
        (q) => categoryFilter === "all" || String(q.category ?? "").toLowerCase() === categoryFilter
      )
      .filter((q) => {
        const student = String(answers[q.id] ?? "").trim().toUpperCase();
        const correct = String(q.answer ?? "").trim().toUpperCase();
        if (correctFilter === "correct") return student === correct;
        if (correctFilter === "wrong") return student !== correct;
        return true;
      });

    const categoryBadgeClass = (category: string) => {
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
    };

    return (
      <div className="space-y-6">
        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as "summary" | "breakdown")}
          className="space-y-4"
        >
          <TabsList>
            <TabsTrigger value="summary">Summary</TabsTrigger>
            <TabsTrigger value="breakdown">Question Breakdown</TabsTrigger>
          </TabsList>

          <TabsContent value="summary" className="space-y-6">
            <Card>
              <CardContent className="space-y-3 p-6 text-center">
                <p className={cn("text-5xl font-bold", scoreColor)}>{results.score}%</p>
                <p className="text-sm text-muted-foreground">
                  {results.correctAnswers} / {results.totalQuestions} correct
                </p>
                <p className="text-sm text-muted-foreground">
                  Time: {Math.floor(results.timeTaken / 60)}m {results.timeTaken % 60}s
                </p>
                <div>
                  <Badge variant="secondary">{results.companyName}</Badge>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Category Breakdown</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="rounded-lg border p-3">
                  <ResponsiveContainer width="100%" height={220}>
                    <RadarChart data={radarData}>
                      <PolarGrid />
                      <PolarAngleAxis dataKey="category" tick={{ fontSize: 12 }} />
                      <Radar
                        name="Your Score"
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
                      <Tooltip formatter={(val) => `${val}%`} />
                    </RadarChart>
                  </ResponsiveContainer>
                  <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                    <div className="flex items-center gap-1.5">
                      <span className="inline-block size-2 rounded-full bg-[#2563EB]" />
                      Your score
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="inline-block h-0 w-4 border-t border-dashed border-[#16A34A]" />
                      Target (65%)
                    </div>
                  </div>
                </div>

                {categoryEntries.map(([cat, score]) => (
                  <div key={cat} className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium capitalize">{cat}</span>
                      <div className="text-right">
                        <span className="text-sm font-semibold">{Number(score)}%</span>
                        <p
                          className={cn(
                            "text-xs",
                            Number(score) - 65 > 0
                              ? "text-green-600"
                              : Number(score) - 65 < 0
                                ? "text-red-600"
                                : "text-amber-600"
                          )}
                        >
                          {Number(score) - 65 > 0
                            ? `▲ ${Number(score) - 65}% above target`
                            : Number(score) - 65 < 0
                              ? `▼ ${Math.abs(Number(score) - 65)}% below target`
                              : "At target"}
                        </p>
                      </div>
                    </div>
                    <div className="relative">
                      <Progress value={Number(score)} />
                      <div
                        className="pointer-events-none absolute inset-y-0 w-0.5 bg-green-500 opacity-70"
                        style={{ left: "65%" }}
                      />
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Skill Analysis</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <h4 className="flex items-center gap-1.5 text-sm font-semibold text-green-700 dark:text-green-400">
                        <CheckCircle className="size-4" />
                        Strong Topics
                      </h4>
                      {topStrengths?.map((topic: any) => (
                        <div
                          key={topic.subcategory}
                          className="flex items-center justify-between rounded-lg border border-green-100 bg-green-50 p-2 dark:border-green-900 dark:bg-green-950/30"
                        >
                          <div>
                            <span className="text-sm font-medium">
                              {topic.label}
                            </span>
                            <span className="ml-2 text-xs text-muted-foreground">
                              {topic.correct}/{topic.attempted} correct
                            </span>
                          </div>
                          <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                            {topic.score}%
                          </Badge>
                        </div>
                      ))}
                      {(!topStrengths || topStrengths.length === 0) && (
                        <p className="text-sm text-muted-foreground">
                          No strong topics yet — keep practicing!
                        </p>
                      )}
                    </div>

                    <div className="space-y-2">
                      <h4 className="flex items-center gap-1.5 text-sm font-semibold text-red-700 dark:text-red-400">
                        <AlertTriangle className="size-4" />
                        Topics to Focus On
                      </h4>
                      {(subcategoryGaps ?? []).map((topic: any) => (
                        <div
                          key={topic.subcategory}
                          className="space-y-2 rounded-lg border border-red-100 bg-red-50/50 p-3 dark:border-red-900 dark:bg-red-950/20"
                        >
                          <div className="flex items-center justify-between">
                            <div>
                              <span className="text-sm font-medium">
                                {topic.label}
                              </span>
                              <span className="ml-2 text-xs text-muted-foreground">
                                {topic.correct}/{topic.attempted} correct
                              </span>
                            </div>
                            <Badge
                              variant="outline"
                              className={
                                topic.score < 40
                                  ? "border-red-400 text-red-700 dark:border-red-400 dark:text-red-400"
                                  : "border-amber-400 text-amber-700 dark:border-amber-400 dark:text-amber-400"
                              }
                            >
                              {topic.score}%
                            </Badge>
                          </div>

                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 w-full border-primary text-xs text-primary hover:bg-primary/5"
                            onClick={() =>
                              router.replace(
                                `/student/placement/practice/${topic.subcategory}`
                              )
                            }
                          >
                            Practice {topic.label} →
                          </Button>
                        </div>
                      ))}

                      {(subcategoryGaps ?? []).length === 0 && (
                        <div className="rounded-lg border border-green-100 bg-green-50 p-3 dark:border-green-100 dark:bg-green-950/30">
                          <p className="text-sm text-green-700 dark:text-green-400">
                            Great! You met the target in all topics.
                          </p>
                        </div>
                      )}
                    </div>
                  </div>

                  {(subcategoryGaps ?? []).length > 0 && (
                    <Card className="mt-4 border-amber-200 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/20">
                      <CardContent className="space-y-3 pt-4">
                        <div className="flex items-center gap-2">
                          <Lightbulb className="size-4 text-amber-600" />
                          <span className="text-sm font-semibold">
                            What to study next
                          </span>
                        </div>
                        {(subcategoryGaps ?? [])
                          .slice(0, 3)
                          .map((gap: any, idx: number) => (
                            <div
                              key={gap.subcategory ?? idx}
                              className="flex items-center justify-between border-t border-amber-100 py-1.5 first:border-0 dark:border-amber-900"
                            >
                              <div>
                                <p className="text-sm font-medium">
                                  {gap.label}
                                </p>
                                <p className="pt-0.5 text-xs text-muted-foreground">
                                  {gap.score}% — {gap.correct} of{" "}
                                  {gap.attempted} correct · target 65%
                                </p>
                              </div>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 shrink-0 text-xs text-primary"
                                onClick={() =>
                                  router.replace(
                                    `/student/placement/practice/${gap.subcategory}`
                                  )
                                }
                              >
                                → Practice
                              </Button>
                            </div>
                          ))}
                        <p className="pt-1 text-xs text-muted-foreground">
                          Master these to meet the {results.companyName} benchmark (65%)
                        </p>
                      </CardContent>
                    </Card>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Performance Insights</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p>
                  Avg time per question:{" "}
                  <span className={cn("font-semibold", avgTimeColor)}>{avgTimePerQ}s</span>
                </p>
                <p>Accuracy: {results.score}%</p>
                <p>
                  Attempted: {attemptedCount} / {questions.length}
                </p>
                <p>Strongest category: <span className="capitalize">{strongestCategory}</span></p>
                <p>Weakest category: <span className="capitalize">{weakestCategory}</span></p>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="breakdown" className="space-y-4">
            <Card>
              <CardHeader className="space-y-3">
                <CardTitle>Question Breakdown</CardTitle>
                <div className="flex flex-wrap items-center gap-2">
                  {(["all", "quantitative", "logical", "verbal", "technical"] as const).map(
                    (cat) => (
                      <Button
                        key={cat}
                        size="sm"
                        variant={categoryFilter === cat ? "default" : "outline"}
                        onClick={() => setCategoryFilter(cat)}
                        className="capitalize"
                      >
                        {cat === "all" ? "All" : cat}
                      </Button>
                    )
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {(["all", "correct", "wrong"] as const).map((filter) => (
                    <Button
                      key={filter}
                      size="sm"
                      variant={correctFilter === filter ? "default" : "outline"}
                      onClick={() => setCorrectFilter(filter)}
                      className="capitalize"
                    >
                      {filter === "all"
                        ? "All"
                        : filter === "correct"
                          ? "Correct only"
                          : "Wrong only"}
                    </Button>
                  ))}
                </div>
              </CardHeader>
              <CardContent>
                <div className="max-h-[65vh] space-y-4 overflow-y-auto pr-1">
                  {filteredQuestions.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No questions match the selected filters.
                    </p>
                  ) : (
                    filteredQuestions.map((q, index) => {
                      const rowKey = `${String(q.id)}-${index}`;
                      const studentAns = String(answers[q.id] ?? "").trim().toUpperCase();
                      const correctAns = String(q.answer ?? "").trim().toUpperCase();
                      const isCorrect = studentAns === correctAns;
                      return (
                        <div key={rowKey} className="space-y-3 border-b pb-4 last:border-b-0">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <Badge variant="outline">Q{index + 1}</Badge>
                              <Badge className={cn("capitalize", categoryBadgeClass(String(q.category)))}>
                                {String(q.category ?? "general")}
                              </Badge>
                              {q.subcategory && (
                                <Badge variant="outline" className="text-xs capitalize font-normal">
                                  {String(q.subcategory).replace(/_/g, " ")}
                                </Badge>
                              )}
                            </div>
                            <span
                              className={cn(
                                "text-sm font-semibold",
                                isCorrect ? "text-green-600" : "text-red-600"
                              )}
                            >
                              {isCorrect ? "✓ Correct" : "✗ Wrong"}
                            </span>
                          </div>

                          <PlacementQuestionMarkdown text={String(q.question ?? "")} />

                          <div className="space-y-2">
                            {(q.options ?? []).map((opt: string, idx: number) => {
                              const letter = String(opt?.[0] ?? ["A", "B", "C", "D"][idx] ?? "");
                              const isStudent = studentAns === letter;
                              const isRight = correctAns === letter;
                              return (
                                <div
                                  key={`${rowKey}-opt-${idx}`}
                                  className={cn(
                                    "rounded-md border px-3 py-2 text-sm",
                                    isStudent && isCorrect && "border-green-200 bg-green-50",
                                    isStudent && !isCorrect && "border-red-200 bg-red-50",
                                    !isStudent && isRight && "border-green-200 bg-green-50"
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
                            })}
                          </div>

                          <button
                            type="button"
                            className="text-sm text-primary hover:underline"
                            onClick={() =>
                              setShowExplanation((prev) =>
                                prev === rowKey ? null : rowKey
                              )
                            }
                          >
                            {showExplanation === rowKey
                              ? "Hide Explanation"
                              : "Show Explanation"}
                          </button>

                          {showExplanation === rowKey && q.explanation && (
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
        </Tabs>

        <div className="flex flex-wrap gap-3">
          <Button onClick={() => router.push(`/student/placement/test/${params.companyId}`)}>
            Try Again
          </Button>
          <Button variant="outline" onClick={handleExport} disabled={isExporting}>
            {isExporting ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                Exporting...
              </>
            ) : (
              <>
                <Download className="mr-2 size-4" />
                Export Full Report
              </>
            )}
          </Button>
          <Button variant="outline" onClick={() => router.push("/student/placement")}>
            Back to Placement
          </Button>
        </div>
      </div>
    );
  }

  const selected = current ? answers[current.id] : undefined;

  return (
    <div className="space-y-4">
      {tabWarning && (
        <div
          className="fixed top-4 left-1/2 z-50 flex -translate-x-1/2 cursor-pointer items-center gap-2 rounded-lg bg-amber-500 px-4 py-2 text-white shadow-lg"
          onClick={() => setTabWarning(false)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") setTabWarning(false);
          }}
        >
          <AlertTriangle className="size-4 shrink-0" />
          <span className="text-sm font-medium">
            Tab switch detected. Timer was paused. Click to dismiss.
          </span>
        </div>
      )}
      <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
        <div className="font-semibold">{companyName} Placement Test</div>
        <div className="text-sm text-muted-foreground">
          {currentIndex + 1} / {questions.length}
        </div>
        <div className="flex items-center gap-2">
          <div
            className={cn(
              "flex items-center gap-1 text-sm font-semibold",
              timeLeft < 300 ? "text-red-600" : "text-foreground"
            )}
          >
            <Clock className="size-4" />
            {formatTime(timeLeft)}
          </div>
          <Button
            variant="outline"
            size="sm"
            className="border-destructive text-destructive hover:bg-destructive/10"
            onClick={() => setShowEndDialog(true)}
            disabled={isSubmitting}
          >
            End Test
          </Button>
        </div>
      </div>

      <AlertDialog open={showEndDialog} onOpenChange={setShowEndDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>End test early?</AlertDialogTitle>
            <AlertDialogDescription>
              You&apos;ve answered {Object.keys(answers).length} of {questions.length} questions.
              Unanswered questions will be marked wrong.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep Going</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleSubmit}
            >
              Submit Anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Progress value={progressValue} />

      <Card>
        <CardHeader className="space-y-2">
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="capitalize">
              {current?.category ?? "General"}
            </Badge>
            {current?.subcategory && (
              <span className="text-xs text-muted-foreground capitalize">
                {String(current.subcategory).replace(/_/g, " ")}
              </span>
            )}
          </div>
          <CardTitle className="text-base font-semibold">
            <PlacementQuestionMarkdown text={String(current?.question ?? "")} />
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {(current?.options ?? []).map((option: string, idx: number) => {
            const letter = String(option?.[0] ?? ["A", "B", "C", "D"][idx] ?? "A");
            const isSelected = selected === letter;
            return (
              <button
                key={`${current?.id}-${idx}`}
                type="button"
                className={cn(
                  "w-full rounded-md border px-3 py-2 text-left text-sm transition-colors",
                  isSelected ? "border-primary bg-primary/10" : "border-border bg-transparent"
                )}
                onClick={() =>
                  setAnswers((prev) => ({
                    ...prev,
                    [current.id]: letter,
                  }))
                }
              >
                {option}
              </button>
            );
          })}
        </CardContent>
      </Card>

      <div className="flex items-center justify-between gap-2">
        <Button
          variant="outline"
          disabled={currentIndex === 0}
          onClick={() => setCurrentIndex((p) => Math.max(0, p - 1))}
        >
          Previous
        </Button>

        <div className="flex items-center gap-1">
          {dotIndexes.map((i) => {
            const q = questions[i];
            const isCurrent = i === currentIndex;
            const isAnswered = q?.id ? Boolean(answers[q.id]) : false;
            return (
              <button
                key={i}
                type="button"
                onClick={() => setCurrentIndex(i)}
                className={cn(
                  "size-2.5 rounded-full border",
                  isCurrent
                    ? "border-primary bg-primary"
                    : isAnswered
                      ? "border-primary/70 bg-primary/40"
                      : "border-muted-foreground/40 bg-transparent"
                )}
                aria-label={`Go to question ${i + 1}`}
              />
            );
          })}
        </div>

        {currentIndex < questions.length - 1 ? (
          <Button onClick={() => setCurrentIndex((p) => Math.min(questions.length - 1, p + 1))}>
            Next
          </Button>
        ) : (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button disabled={isSubmitting}>
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 size-4 animate-spin" />
                    Submitting...
                  </>
                ) : (
                  "Submit Test"
                )}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Submit Test?</AlertDialogTitle>
                <AlertDialogDescription>
                  You&apos;ve answered {answeredCount} of {questions.length} questions.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleSubmit}>Submit</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>
    </div>
  );
}

