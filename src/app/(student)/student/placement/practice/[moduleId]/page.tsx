"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  BookOpen,
  CheckCircle,
  Download,
  Target,
  TrendingUp,
  Loader2,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { PRACTICE_MODULES } from "@/lib/placement/modules";

const activePracticeGenerations = new Set<string>();

type View = "loading" | "test" | "results";

type PracticeQuestion = {
  id: string;
  category?: string;
  subcategory?: string;
  question?: string;
  options?: string[];
  answer?: string;
  explanation?: string;
  difficulty_level?: "foundational" | "intermediate" | "advanced" | string;
};

type ModuleInfo = {
  id: string;
  label: string;
  category: string;
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

export default function PracticePlacementPage() {
  const router = useRouter();
  const params = useParams<{ moduleId: string }>();
  const moduleId = params?.moduleId;

  const [view, setView] = useState<View>("loading");
  const [questions, setQuestions] = useState<PracticeQuestion[]>([]);
  const [moduleInfo, setModuleInfo] = useState<ModuleInfo | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});

  const [currentIndex, setCurrentIndex] = useState(0);
  const [showExplanation, setShowExplanation] = useState(false);
  const [results, setResults] = useState<any | null>(null);

  const [startTime, setStartTime] = useState<number | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  const difficultyBadge = useCallback((lvl?: string) => {
    const normalized = String(lvl ?? "").toLowerCase();
    if (normalized === "foundational") {
      return { label: "Foundational", className: "bg-slate-100 text-slate-700" };
    }
    if (normalized === "advanced") {
      return { label: "Advanced", className: "bg-purple-100 text-purple-700" };
    }
    return { label: "Intermediate", className: "bg-blue-100 text-blue-700" };
  }, []);

  const categoryBadgeClass = useCallback((category: string) => {
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
  }, []);

  const segments = useMemo(() => {
    const total = questions.length;
    const segs = Array.from({ length: total }, (_, i) => {
      if (i > currentIndex) return "pending";
      if (i === currentIndex && !showExplanation) return "current";
      const q = questions[i];
      const ans = String(answers[q.id] ?? "").trim().toUpperCase();
      const correct = String(q.answer ?? "").trim().toUpperCase();
      return ans && correct && ans === correct ? "correct" : "wrong";
    });
    return segs;
  }, [answers, currentIndex, questions, showExplanation]);

  const progressValue = useMemo(() => {
    const total = questions.length;
    if (!total) return 0;
    return Math.min(100, ((currentIndex + 1) / total) * 100);
  }, [currentIndex, questions.length]);

  const generatePractice = useCallback(async () => {
    if (!moduleId) return;
    const lockKey = `practice_${moduleId}`;
    if (activePracticeGenerations.has(lockKey)) return;
    activePracticeGenerations.add(lockKey);
    setView("loading");
    setResults(null);
    setAnswers({});
    setCurrentIndex(0);
    setShowExplanation(false);
    setQuestions([]);
    setModuleInfo(null);
    setStartTime(null);

    try {
      const res = await fetch("/api/placement/practice/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ moduleId }),
      });

      const data = await res.json().catch(() => ({} as any));
      if (!res.ok) {
        toast.error("Failed to generate practice", {
          description: data?.error ?? "Please try again.",
        });
        router.push("/student/placement");
        return;
      }

      const qs = Array.isArray(data?.questions) ? data.questions : [];
      const m = data?.module;
      if (!qs.length) {
        toast.error("No questions generated");
        router.push("/student/placement");
        return;
      }

      setQuestions(qs);
      setModuleInfo(
        m
          ? { id: String(m.id), label: String(m.label ?? m.id), category: String(m.category ?? "") }
          : null
      );
      setStartTime(Date.now());
      setView("test");
    } catch (err) {
      console.error("[practice]", err);
      router.push("/student/placement");
    } finally {
      activePracticeGenerations.delete(lockKey);
    }
  }, [moduleId, router]);

  useEffect(() => {
    if (!moduleId) return;

    try {
      const savedResult = localStorage.getItem(`practice_result_${moduleId}`);
      if (savedResult) {
        const parsed = JSON.parse(savedResult) as {
          completedAt?: number;
          questions?: PracticeQuestion[];
          moduleLabel?: string;
          mastery?: string;
        };
        const ageMinutes = (Date.now() - (parsed.completedAt ?? 0)) / 60000;
        if (ageMinutes < 60) {
          const mid = String(moduleId);
          const mod =
            PRACTICE_MODULES.find((m) => m.id === mid) ??
            PRACTICE_MODULES.find(
              (m) => mid.includes(m.id) || m.id.includes(mid)
            );
          setModuleInfo(
            mod
              ? { id: mod.id, label: mod.label, category: mod.category }
              : {
                  id: mid,
                  label: String(parsed.moduleLabel ?? mid),
                  category: String(parsed.questions?.[0]?.category ?? "practice"),
                }
          );
          setResults(parsed);
          if (parsed.questions?.length) setQuestions(parsed.questions);
          setView("results");
          return;
        }
        localStorage.removeItem(`practice_result_${moduleId}`);
      }
    } catch {}

    void generatePractice();
  }, [moduleId, generatePractice]);

  useEffect(() => {
    if (view === "results") return;

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (view === "loading" || view === "test") {
        e.preventDefault();
        e.returnValue = "Your practice session will be lost.";
        return e.returnValue;
      }
    };

    const handlePopState = (e: PopStateEvent) => {
      e.preventDefault();
      window.history.pushState(null, "", window.location.href);
    };

    window.history.pushState(null, "", window.location.href);
    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("popstate", handlePopState);
    };
  }, [view]);

  const handleOptionLetter = useCallback((opt: string, idx: number) => {
    const trimmed = String(opt ?? "").trim();
    const m = trimmed.match(/^([A-D])[\.\)]\s*/i) || trimmed.match(/^([A-D])\s+/i);
    if (m?.[1]) return m[1].toUpperCase();
    const letters = ["A", "B", "C", "D"];
    return letters[idx] ?? "A";
  }, []);

  const handleAnswer = useCallback(
    (letter: string) => {
      if (showExplanation) return; // already answered
      const q = questions[currentIndex];
      if (!q) return;

      setAnswers((prev) => ({ ...prev, [q.id]: letter }));
      setShowExplanation(true); // immediately show explanation
    },
    [currentIndex, questions, showExplanation]
  );

  const handleSubmit = useCallback(async () => {
    if (!moduleInfo || !questions.length) return;
    if (!startTime) return;

    const timeTaken = Math.max(0, Math.round((Date.now() - startTime) / 1000));

    try {
      const res = await fetch("/api/placement/practice/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          moduleId: moduleInfo.id,
          questions,
          answers,
          timeTaken,
        }),
      });

      const data = await res.json().catch(() => ({} as any));
      if (!res.ok) {
        toast.error("Submit failed", {
          description: data?.error ?? "Please try again.",
        });
        router.push("/student/placement");
        return;
      }

      if (moduleId) {
        try {
          localStorage.setItem(
            `practice_result_${moduleId}`,
            JSON.stringify({
              ...data,
              questions,
              completedAt: Date.now(),
              moduleId,
            })
          );
        } catch {}
      }
      setResults(data);
      setView("results");
    } catch (err) {
      console.error("[placement/practice/submit]", err);
      toast.error("Submit failed. Please try again.");
    }
  }, [answers, moduleId, moduleInfo, questions, router, startTime]);

  const handleExport = useCallback(async () => {
    if (!results) return;
    setIsExporting(true);
    try {
      const res = await fetch("/api/placement/practice/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          moduleLabel: results.moduleLabel,
          score: results.score,
          correctAnswers: results.correctAnswers,
          totalQuestions: results.totalQuestions,
          mastery: results.mastery,
          masteryMessage: results.masteryMessage,
          questionAnalysis: results.questionAnalysis,
          timeTaken: results.timeTaken,
        }),
      });

      if (!res.ok) throw new Error("Export failed");

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `practice-${moduleId}-results.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("[practice/export]", err);
    } finally {
      setIsExporting(false);
    }
  }, [moduleId, results]);

  const handleNext = useCallback(() => {
    if (!questions.length) return;

    if (currentIndex < questions.length - 1) {
      setCurrentIndex((prev) => prev + 1);
      setShowExplanation(false);
      return;
    }

    // last question: submit learning session
    handleSubmit();
  }, [currentIndex, handleSubmit, questions.length]);

  const currentQ = questions[currentIndex];
  const selectedLetter = currentQ ? String(answers[currentQ.id] ?? "").toUpperCase() : "";
  const correctLetter = currentQ ? String(currentQ.answer ?? "").toUpperCase() : "";
  const isCorrect = selectedLetter && correctLetter ? selectedLetter === correctLetter : false;

  const masteryBadge = useMemo(() => {
    const m = String(results?.mastery ?? "");
    if (m === "mastered") return { label: "Mastered", className: "bg-green-100 text-green-700", icon: <TrendingUp className="mr-1 size-4" /> };
    if (m === "progressing")
      return { label: "Progressing", className: "bg-blue-100 text-blue-700", icon: <Target className="mr-1 size-4" /> };
    if (m === "developing")
      return { label: "Developing", className: "bg-amber-100 text-amber-700", icon: <BookOpen className="mr-1 size-4" /> };
    return { label: "Needs Work", className: "bg-red-100 text-red-700", icon: <XCircle className="mr-1 size-4" /> };
  }, [results]);

  if (view === "loading") {
    return (
      <div className="flex min-h-[70vh] flex-col items-center justify-center text-center">
        <Card className="w-full max-w-2xl">
          <CardHeader>
            <CardTitle className="text-base">Preparing your practice session...</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>Preparing your {moduleId} practice session...</p>
            <p>12 focused questions · Learning mode</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (view === "results" && results) {
    const totalQuestions = results.totalQuestions ?? questions.length;
    const score = results.score ?? 0;
    const correctAnswers = results.correctAnswers ?? 0;

    return (
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Badge className={moduleInfo ? categoryBadgeClass(moduleInfo.category) : ""} variant="secondary">
                {moduleInfo?.category ?? "practice"}
              </Badge>
              <h1 className="truncate text-lg font-semibold">{moduleInfo?.label ?? "Practice"}</h1>
            </div>
            <div className="mt-2">
              <Badge className={masteryBadge.className} variant="outline">
                {masteryBadge.icon}
                {masteryBadge.label}
              </Badge>
            </div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold">{score}%</div>
            <div className="text-sm text-muted-foreground">
              {correctAnswers}/{totalQuestions} correct
            </div>
          </div>
        </div>

        <div className="rounded-lg border bg-card p-4">
          <p className="text-sm font-medium">Mastery Message</p>
          <p className="mt-1 text-sm text-muted-foreground">{results.masteryMessage}</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Review All Questions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {(results.questionAnalysis ?? []).map((qa: any, idx: number) => {
                const qDiff = difficultyBadge(qa.difficulty_level);
                return (
                  <div key={qa.id ?? idx} className="space-y-2 rounded-lg border p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        {qa.isCorrect ? (
                          <CheckCircle className="size-4 text-green-600" />
                        ) : (
                          <XCircle className="size-4 text-red-600" />
                        )}
                        <Badge className={qDiff.className} variant="outline">
                          {qDiff.label}
                        </Badge>
                      </div>
                      <Badge variant="secondary" className="text-xs">
                        Q{idx + 1}
                      </Badge>
                    </div>
                    <PlacementQuestionMarkdown text={String(qa.question ?? "")} />
                    <p className="text-sm text-muted-foreground">
                      Your answer: <span className="font-medium">{qa.studentAnswer || "—"}</span> · Correct:{" "}
                      <span className="font-medium">{qa.correctAnswer || "—"}</span>
                    </p>
                    <div className="rounded-md border bg-amber-50 p-3 text-sm">
                      <p className="font-medium text-amber-900">Explanation</p>
                      <p className="mt-1 text-amber-900/90">{qa.explanation}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <div className="flex flex-wrap gap-3">
          <Button
            className="flex-1"
            variant="default"
            onClick={() => {
              if (moduleId) {
                try {
                  localStorage.removeItem(`practice_result_${moduleId}`);
                } catch {}
              }
              window.location.reload();
            }}
          >
            Practice Again
          </Button>
          <Button
            variant="outline"
            onClick={handleExport}
            disabled={isExporting}
            className="flex-1"
          >
            {isExporting ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                Exporting...
              </>
            ) : (
              <>
                <Download className="mr-2 size-4" />
                Export Report
              </>
            )}
          </Button>
          <Button
            onClick={() => router.push("/student/placement")}
            className="flex-1"
            variant="outline"
          >
            Back to Practice
          </Button>
        </div>
      </div>
    );
  }

  // view === "test"
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
        <div className="flex min-w-0 items-center gap-3">
          {moduleInfo && (
            <>
              <Badge className={categoryBadgeClass(moduleInfo.category)} variant="secondary">
                {moduleInfo.category}
              </Badge>
              <div className="truncate font-semibold">{moduleInfo.label}</div>
            </>
          )}
        </div>
        <div className="text-sm text-muted-foreground">
          {currentIndex + 1} / {questions.length}
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <div className="flex flex-1 items-center gap-1 overflow-x-auto">
            {segments.map((s, i) => {
              const base =
                "h-3 flex-1 min-w-[18px] rounded-full transition-colors";
              if (s === "pending") {
                return <div key={i} className={`${base} bg-muted`} />;
              }
              if (s === "correct") {
                return <div key={i} className={`${base} bg-green-500`} />;
              }
              if (s === "wrong") {
                return <div key={i} className={`${base} bg-red-500`} />;
              }
              return <div key={i} className={`${base} bg-blue-500 animate-pulse`} />;
            })}
          </div>
        </div>
        <Progress value={progressValue} />
      </div>

      <Card>
        <CardHeader className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="capitalize">
                {currentQ?.subcategory ?? currentQ?.category ?? "practice"}
              </Badge>
              {currentQ && (
                <Badge className={difficultyBadge(currentQ.difficulty_level).className} variant="outline">
                  {difficultyBadge(currentQ.difficulty_level).label}
                </Badge>
              )}
            </div>
          </div>

          <CardTitle className="text-base font-semibold">
            <PlacementQuestionMarkdown text={String(currentQ?.question ?? "")} />
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2">
            {(currentQ?.options ?? []).map((opt, idx) => {
              const letter = handleOptionLetter(opt, idx);
              const ans = selectedLetter;
              const correct = correctLetter;
              const isCorrectOpt = letter === correct;
              const isStudentOpt = letter === ans;

              const disabled = showExplanation;
              const buttonClass = (() => {
                if (!showExplanation) return "justify-start";
                if (isCorrectOpt) return "bg-green-50 border-green-200 text-green-700";
                if (isStudentOpt && !isCorrectOpt) return "bg-red-50 border-red-200 text-red-700";
                return "bg-muted text-muted-foreground cursor-not-allowed";
              })();

              const prefix = showExplanation
                ? isCorrectOpt
                  ? "✓ "
                  : isStudentOpt && !isCorrectOpt
                    ? "✗ "
                    : "• "
                : "";

              return (
                <Button
                  key={`${currentQ?.id}-${idx}`}
                  type="button"
                  variant="outline"
                  disabled={disabled}
                  className={`w-full justify-start rounded-md border px-3 py-2 text-left ${buttonClass}`}
                  onClick={() => handleAnswer(letter)}
                >
                  <span className="font-medium">{prefix}{opt}</span>
                </Button>
              );
            })}
          </div>

          {showExplanation && currentQ?.explanation && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm">
              <div className="flex items-center gap-2">
                {isCorrect ? (
                  <CheckCircle className="size-4 text-green-600" />
                ) : (
                  <XCircle className="size-4 text-red-600" />
                )}
                <span className={`font-semibold ${isCorrect ? "text-green-700" : "text-red-700"}`}>
                  {isCorrect ? "Correct!" : "Not quite"}
                </span>
              </div>

              <p className="mt-2 text-amber-950/90">{currentQ.explanation}</p>

              <div className="mt-4">
                {currentIndex < questions.length - 1 ? (
                  <Button onClick={handleNext} className="w-full">
                    Next Question →
                  </Button>
                ) : (
                  <Button onClick={handleNext} className="w-full">
                    See Results
                  </Button>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center justify-between gap-3">
        <Button variant="outline" onClick={() => router.push("/student/placement")}>
          Back to Practice
        </Button>
        <div className="flex-1" />
        <Button
          onClick={handleNext}
          disabled={!showExplanation}
          className="ml-auto"
        >
          {currentIndex < questions.length - 1 ? "Next" : "Finish"}
        </Button>
      </div>
    </div>
  );
}

