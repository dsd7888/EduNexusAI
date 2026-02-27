"use client";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { QuizQuestion } from "@/lib/quiz/generator";
import { createBrowserClient } from "@/lib/db/supabase-browser";
import {
  Brain,
  CheckCircle2,
  Clock,
  Lightbulb,
  Loader2,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { cn } from "@/lib/utils";

type View = "setup" | "taking" | "results" | "history";

type SubjectRow = {
  id: string;
  name: string;
  code: string;
  semester: number;
  department: string;
};

type ModuleRow = {
  id: string;
  name: string;
  module_number: number;
  subject_id: string;
  subject_name: string;
  subject_code: string;
};

type BreakdownItem = {
  questionId: string;
  question: string;
  type: string;
  studentAnswer: string;
  correctAnswer: string;
  correct: boolean;
  explanation?: string;
  difficulty?: string;
  unit?: string;
};

type HintState = {
  text: string | null;
  isLoading: boolean;
  used: boolean;
};

type HistoryAttempt = {
  id: string;
  score: number;
  timeTaken: number | null;
  createdAt: string;
  subjectName: string;
  title: string;
  breakdown: BreakdownItem[];
  correctCount: number;
  totalCount: number;
};

const QUESTION_COUNTS = [5, 10, 15, 20] as const;
const DIFFICULTIES = ["easy", "medium", "hard", "mixed"] as const;
const QUESTION_TYPE_OPTS = [
  { id: "mcq", label: "Multiple Choice" },
  { id: "true_false", label: "True / False" },
  { id: "short", label: "Short Answer" },
  { id: "multiple_correct", label: "Multiple Correct" },
  { id: "match", label: "Match the Following" },
] as const;

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

function truncate(str: string, len: number): string {
  if (str.length <= len) return str;
  return str.slice(0, len) + "...";
}

export default function StudentQuizPage() {
  // ── SETUP STATE ────────────────────────────────────────────
  const [subjects, setSubjects] = useState<SubjectRow[]>([]);
  const [modules, setModules] = useState<ModuleRow[]>([]);
  const [selectedSubjectIds, setSelectedSubjectIds] = useState<string[]>([]);
  const [loadingModules, setLoadingModules] = useState(false);
  const [questionCount, setQuestionCount] = useState(10);
  const [difficulty, setDifficulty] = useState<"easy" | "medium" | "hard" | "mixed">("mixed");
  const [questionTypes, setQuestionTypes] = useState<
    ("mcq" | "true_false" | "short" | "multiple_correct" | "match")[]
  >(["mcq"]);
  const [selectedTopics, setSelectedTopics] = useState<string[]>([]);
  const [focusTopic, setFocusTopic] = useState("");
  const [socraticMode, setSocraticMode] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [subjectName, setSubjectName] = useState("");

  // ── TAKING STATE ───────────────────────────────────────────
  const [view, setView] = useState<View>("setup");
  const [quizId, setQuizId] = useState("");
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [elapsed, setElapsed] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hints, setHints] = useState<Record<string, HintState>>({});

  // ── RESULTS STATE ──────────────────────────────────────────
  const [score, setScore] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [breakdown, setBreakdown] = useState<BreakdownItem[]>([]);
  const [resultsElapsed, setResultsElapsed] = useState(0);
  const [resultsPage, setResultsPage] = useState(1);
  const RESULTS_PER_PAGE = 10;
  const breakdownRef = useRef<HTMLDivElement | null>(null);
  // ── HISTORY STATE ──────────────────────────────────────────
  const [historyAttempts, setHistoryAttempts] = useState<HistoryAttempt[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);

  const fetchProfileAndSubjects = useCallback(async () => {
    const supabase = createBrowserClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) return;

    const { data: profile } = await supabase
      .from("profiles")
      .select("branch")
      .eq("id", user.id)
      .single();

    const branch = (profile as { branch?: string } | null)?.branch ?? null;
    if (branch == null) return;

    const { data: subs, error } = await supabase
      .from("subjects")
      .select("id, code, name, semester, department")
      .eq("branch", branch)
      .order("semester", { ascending: true })
      .order("name", { ascending: true });

    if (!error && subs) {
      setSubjects((subs ?? []) as SubjectRow[]);
    }
  }, []);

  const fetchModules = useCallback(async (ids: string[]) => {
    if (!ids.length) {
      setModules([]);
      return;
    }
    setLoadingModules(true);
    try {
      const supabase = createBrowserClient();
      const { data, error } = await supabase
        .from("modules")
        .select("id, name, module_number, subject_id, subjects(name, code)")
        .in("subject_id", ids);
      if (!error && data) {
        const rows: ModuleRow[] = (data as any[]).map((m) => {
          const subj = m.subjects as { name: string; code: string } | null;
          return {
            id: m.id as string,
            name: m.name as string,
            module_number: m.module_number as number,
            subject_id: m.subject_id as string,
            subject_name: subj?.name ?? "Subject",
            subject_code: subj?.code ?? "",
          };
        });
        rows.sort((a, b) => {
          const an = a.subject_name.toLowerCase();
          const bn = b.subject_name.toLowerCase();
          if (an !== bn) return an.localeCompare(bn);
          return a.module_number - b.module_number;
        });
        setModules(rows);
      } else {
        setModules([]);
      }
    } finally {
      setLoadingModules(false);
    }
  }, []);

  useEffect(() => {
    fetchProfileAndSubjects();
  }, [fetchProfileAndSubjects]);

  const computeBreakdown = useCallback(
    (qs: QuizQuestion[], ans: Record<string, string>) => {
      let correct = 0;
      const items: BreakdownItem[] = qs.map((q) => {
        const rawStudent = String(ans[q.id] ?? "").trim();
        const rawCorrect = String(q.correctAnswer ?? "").trim();

        let isCorrect = false;

        if (q.type === "multiple_correct") {
          const splitAndSort = (val: string) =>
            val
              .split("|")
              .map((s) => s.trim().toLowerCase())
              .filter(Boolean)
              .sort();
          const sArr = splitAndSort(rawStudent);
          const cArr = splitAndSort(rawCorrect);
          isCorrect =
            sArr.length > 0 &&
            sArr.length === cArr.length &&
            sArr.every((v, i) => v === cArr[i]);
        } else if (q.type === "match") {
          const toPairs = (val: string) =>
            val
              .split("|")
              .map((p) => p.trim())
              .filter(Boolean)
              .map((p) => p.toLowerCase());
          const sPairs = toPairs(rawStudent);
          const cPairs = toPairs(rawCorrect);
          const sSet = new Set(sPairs);
          const cSet = new Set(cPairs);
          isCorrect =
            sPairs.length > 0 &&
            sPairs.length === cPairs.length &&
            sPairs.every((p) => cSet.has(p)) &&
            cPairs.every((p) => sSet.has(p));
        } else {
          const studentAns = rawStudent.toLowerCase();
          const correctAns = rawCorrect.toLowerCase();
          isCorrect = studentAns === correctAns;
        }

        if (isCorrect) correct++;

        return {
          questionId: q.id,
          question: q.question,
          type: q.type,
          studentAnswer: ans[q.id] ?? "",
          correctAnswer: q.correctAnswer,
          correct: isCorrect,
          explanation: q.explanation,
          difficulty: q.difficulty,
          unit: q.unit,
        };
      });

      return { correct, total: qs.length, breakdown: items };
    },
    []
  );

  const fetchHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const supabase = createBrowserClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setHistoryAttempts([]);
        setHistoryLoaded(true);
        return;
      }

      const { data, error } = await supabase
        .from("quiz_attempts")
        .select(
          "id, score, time_taken, created_at, answers, quizzes(title, questions, subject_id, subjects(name))"
        )
        .eq("student_id", user.id)
        .order("created_at", { ascending: false })
        .limit(5);

      if (error || !data) {
        setHistoryAttempts([]);
        setHistoryLoaded(true);
        return;
      }

      const attempts: HistoryAttempt[] = (data as any[]).map((row) => {
        const quizRel = row.quizzes as any;
        const qs = ((quizRel?.questions ?? []) as QuizQuestion[]) || [];
        const answers =
          (row.answers as Record<string, string> | null) ?? {};
        const { correct, total, breakdown } = computeBreakdown(qs, answers);
        const subjectName: string =
          (Array.isArray(quizRel?.subjects)
            ? quizRel.subjects[0]?.name
            : quizRel?.subjects?.name) ?? "Subject";

        return {
          id: row.id as string,
          score: row.score ?? 0,
          timeTaken: row.time_taken ?? null,
          createdAt: row.created_at as string,
          subjectName,
          title: quizRel?.title ?? "Quiz",
          breakdown,
          correctCount: correct,
          totalCount: total,
        };
      });

      setHistoryAttempts(attempts);
      setHistoryLoaded(true);
    } catch (err) {
      console.error("[student/quiz] history load error:", err);
      setHistoryAttempts([]);
      setHistoryLoaded(true);
    } finally {
      setLoadingHistory(false);
    }
  }, [computeBreakdown]);

  useEffect(() => {
    if (selectedSubjectIds.length > 0) {
      fetchModules(selectedSubjectIds);
      const names = subjects
        .filter((s) => selectedSubjectIds.includes(s.id))
        .map((s) => s.name);
      setSubjectName(names.join(", "));
    } else {
      setModules([]);
      setSubjectName("");
    }
  }, [selectedSubjectIds, fetchModules, subjects]);

  const toggleQuestionType = (
    id: "mcq" | "true_false" | "short" | "multiple_correct" | "match"
  ) => {
    setQuestionTypes((prev) => {
      const next = prev.includes(id)
        ? prev.filter((t) => t !== id)
        : [...prev, id];
      return next.length > 0 ? next : prev;
    });
  };

  const toggleTopic = (name: string) => {
    setSelectedTopics((prev) =>
      prev.includes(name) ? prev.filter((t) => t !== name) : [...prev, name]
    );
  };

  const handleGenerate = async () => {
    if (!selectedSubjectIds.length) return;
    setIsGenerating(true);
    try {
      const res = await fetch("/api/quiz/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subjectIds: selectedSubjectIds,
          questionCount,
          difficulty,
          questionTypes,
          selectedTopics: selectedTopics.length > 0 ? selectedTopics : undefined,
          focusTopic: focusTopic.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Failed to generate");
      const qs = (data.questions ?? []) as QuizQuestion[];
      const hintInit: Record<string, HintState> = {};
      qs.forEach((q) => {
        hintInit[q.id] = { text: null, isLoading: false, used: false };
      });
      setQuizId(data.quizId ?? "");
      setQuestions(qs);
      setHints(hintInit);
      setAnswers({});
      setCurrentIndex(0);
      setElapsed(0);
      setView("taking");
    } catch (e) {
      console.error(e);
      alert(e instanceof Error ? e.message : "Failed to generate quiz");
    } finally {
      setIsGenerating(false);
    }
  };

  useEffect(() => {
    if (view === "taking") {
      const t = setInterval(() => setElapsed((e) => e + 1), 1000);
      return () => clearInterval(t);
    }
    if (view === "history" && !historyLoaded && !loadingHistory) {
      void fetchHistory();
    }
  }, [view, historyLoaded, loadingHistory, fetchHistory]);

  const handleGetHint = async (q: QuizQuestion) => {
    if (hints[q.id]?.used || hints[q.id]?.isLoading) return;
    setHints((prev) => ({
      ...prev,
      [q.id]: { ...prev[q.id], isLoading: true, used: false, text: null },
    }));
    try {
      const res = await fetch("/api/quiz/hint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: q.question,
          subjectName: subjectName || "Subject",
          unit: q.unit,
        }),
      });
      const data = await res.json();
      const hint = data?.hint ?? "";
      setHints((prev) => ({
        ...prev,
        [q.id]: { text: hint, isLoading: false, used: true },
      }));
    } catch {
      setHints((prev) => ({
        ...prev,
        [q.id]: {
          text: "Could not load hint.",
          isLoading: false,
          used: true,
        },
      }));
    }
  };

  const handleSubmit = async () => {
    if (!quizId) return;
    setIsSubmitting(true);
    try {
      const answersForSubmit: Record<string, string> = {};
      questions.forEach((q) => {
        const v = answers[q.id];
        if (v != null && v.trim() !== "") answersForSubmit[q.id] = v;
      });
      const res = await fetch("/api/quiz/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quizId,
          answers: answersForSubmit,
          timeTaken: elapsed,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Failed to submit");
      setScore(data.score ?? 0);
      setCorrectCount(data.correctCount ?? 0);
      setTotalCount(data.totalCount ?? 0);
      setBreakdown((data.breakdown ?? []) as BreakdownItem[]);
      setResultsElapsed(elapsed);
      setView("results");
    } catch (e) {
      console.error(e);
      alert(e instanceof Error ? e.message : "Failed to submit quiz");
    } finally {
      setIsSubmitting(false);
    }
  };

  const resetToSetup = () => {
    setView("setup");
    setQuestions([]);
    setQuizId("");
    setBreakdown([]);
  };

  const currentQuestion = questions[currentIndex];
  const progressPct = questions.length > 0 ? (currentIndex / questions.length) * 100 : 0;
  const hasAnswer = currentQuestion
    ? (() => {
        const val = answers[currentQuestion.id];
        if (!val) return false;
        if (currentQuestion.type === "multiple_correct") {
          return val
            .split("|")
            .map((s) => s.trim())
            .filter(Boolean).length > 0;
        }
        if (currentQuestion.type === "match") {
          return val
            .split("|")
            .map((s) => s.trim())
            .filter(Boolean).length > 0;
        }
        return val.trim() !== "";
      })()
    : false;

  const renderTabs = () => (
    <div className="mb-4 flex gap-2 border-b pb-2">
      <Button
        type="button"
        variant={view === "history" ? "ghost" : "default"}
        size="sm"
        onClick={() => setView("setup")}
      >
        Create Quiz
      </Button>
      <Button
        type="button"
        variant={view === "history" ? "default" : "ghost"}
        size="sm"
        onClick={() => setView("history")}
      >
        History
      </Button>
    </div>
  );

  // ──── VIEW 1: SETUP ─────────────────────────────────────────
  if (view === "setup") {
    return (
      <div className="space-y-6">
        {renderTabs()}
        <div className="flex items-center gap-2">
          <Brain className="size-8 text-primary" />
          <h1 className="text-2xl font-semibold tracking-tight">Quiz</h1>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Create Your Quiz</CardTitle>
            <CardDescription>
              Select subjects and configure your quiz settings.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label>Subjects (select one or more)</Label>
              <p className="text-xs text-muted-foreground">
                Mix questions from multiple subjects in one quiz
              </p>
              {subjects.length > 0 && (
                <div className="mb-1 flex items-center justify-between text-xs">
                  <button
                    type="button"
                    className="text-primary hover:underline"
                    onClick={() =>
                      setSelectedSubjectIds(subjects.map((s) => s.id))
                    }
                  >
                    Select All
                  </button>
                  <button
                    type="button"
                    className="text-muted-foreground hover:underline"
                    onClick={() => {
                      setSelectedSubjectIds([]);
                      setModules([]);
                    }}
                  >
                    Clear All
                  </button>
                </div>
              )}
              <div className="max-h-48 space-y-2 overflow-y-auto rounded-md border p-2">
                {subjects.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No subjects found for your branch.
                  </p>
                ) : (
                  subjects.map((s) => (
                    <div
                      key={s.id}
                      className="flex items-center justify-between gap-2"
                    >
                      <div className="flex items-center gap-2">
                        <Checkbox
                          id={`sub-${s.id}`}
                          checked={selectedSubjectIds.includes(s.id)}
                          onCheckedChange={() =>
                            setSelectedSubjectIds((prev) =>
                              prev.includes(s.id)
                                ? prev.filter((id) => id !== s.id)
                                : [...prev, s.id]
                            )
                          }
                        />
                        <Label
                          htmlFor={`sub-${s.id}`}
                          className="cursor-pointer text-sm font-normal"
                        >
                          {s.code} — {s.name}
                        </Label>
                      </div>
                      <Badge
                        variant="outline"
                        className="text-[10px] uppercase"
                      >
                        Sem {s.semester}
                      </Badge>
                    </div>
                  ))
                )}
              </div>
            </div>

            {selectedSubjectIds.length > 0 && (
              <div className="space-y-2">
                <Label>Focus Topics</Label>
                <p className="text-muted-foreground text-xs">
                  Leave all unchecked to cover full syllabus
                </p>
                {loadingModules ? (
                  <div className="space-y-2">
                    {[1, 2, 3].map((i) => (
                      <Skeleton key={i} className="h-5 w-full" />
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {modules.map((m) => (
                      <div
                        key={m.id}
                        className="flex items-center space-x-2"
                      >
                        <Checkbox
                          id={`topic-${m.id}`}
                          checked={selectedTopics.includes(m.name)}
                          onCheckedChange={() => toggleTopic(m.name)}
                        />
                        <Label
                          htmlFor={`topic-${m.id}`}
                          className="text-sm font-normal cursor-pointer"
                        >
                          Module {m.module_number}: {m.name}
                        </Label>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="space-y-2">
              <Label>Number of Questions</Label>
              <Select
                value={String(questionCount)}
                onValueChange={(v) => setQuestionCount(Number(v) as 5 | 10 | 15 | 20)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {QUESTION_COUNTS.map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Difficulty</Label>
              <RadioGroup
                value={difficulty}
                onValueChange={(v) =>
                  setDifficulty(v as "easy" | "medium" | "hard" | "mixed")
                }
                className="flex flex-wrap gap-4"
              >
                {DIFFICULTIES.map((d) => (
                  <div
                    key={d}
                    className="flex items-center space-x-2"
                  >
                    <RadioGroupItem value={d} id={`diff-${d}`} />
                    <Label
                      htmlFor={`diff-${d}`}
                      className="cursor-pointer capitalize"
                    >
                      {d}
                    </Label>
                  </div>
                ))}
              </RadioGroup>
            </div>

            <div className="space-y-2">
              <Label>Question Types</Label>
              <div className="flex flex-wrap gap-4">
                {QUESTION_TYPE_OPTS.map((opt) => (
                  <div
                    key={opt.id}
                    className="flex items-center space-x-2"
                  >
                    <Checkbox
                      id={`type-${opt.id}`}
                      checked={questionTypes.includes(opt.id)}
                      onCheckedChange={() => toggleQuestionType(opt.id)}
                      disabled={
                        questionTypes.length === 1 && questionTypes.includes(opt.id)
                      }
                    />
                    <Label
                      htmlFor={`type-${opt.id}`}
                      className="text-sm font-normal cursor-pointer"
                    >
                      {opt.label}
                    </Label>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="focus-topic">Focus Topic</Label>
              <Input
                id="focus-topic"
                placeholder="Narrow further, e.g. Carnot Cycle (optional)"
                value={focusTopic}
                onChange={(e) => setFocusTopic(e.target.value)}
              />
            </div>

            <div className="flex items-center justify-between rounded-lg border p-4">
              <div>
                <Label htmlFor="socratic" className="text-base">
                  Socratic Mode 💡
                </Label>
                <p className="text-muted-foreground text-sm">
                  Get a hint per question during the quiz
                </p>
              </div>
              <Switch
                id="socratic"
                checked={socraticMode}
                onCheckedChange={setSocraticMode}
              />
            </div>

            <Button
              className="w-full"
              disabled={selectedSubjectIds.length === 0 || isGenerating}
              onClick={handleGenerate}
            >
              {isGenerating ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Generating your quiz...
                </>
              ) : (
                "Generate Quiz"
              )}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ──── VIEW 2: TAKING ────────────────────────────────────────
  if (view === "taking" && currentQuestion) {
    const q = currentQuestion;
    const hintState = hints[q.id] ?? { text: null, isLoading: false, used: false };

    return (
      <div className="space-y-6">
        {renderTabs()}
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground text-sm">
            Question {currentIndex + 1} of {questions.length}
          </span>
          <div className="flex items-center gap-2 text-sm">
            <Clock className="size-4" />
            {formatElapsed(elapsed)}
          </div>
        </div>
        <Progress value={progressPct} />

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2 mb-2">
              <Badge variant="secondary" className="capitalize">
                {q.difficulty}
              </Badge>
              {q.unit && (
                <span className="text-muted-foreground text-xs">{q.unit}</span>
              )}
            </div>
            <CardTitle className="text-lg font-medium">{q.question}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {q.type === "mcq" && q.options && (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {q.options.map((opt) => {
                  const letMap: Record<number, string> = {
                    0: "A",
                    1: "B",
                    2: "C",
                    3: "D",
                  };
                  const letter = letMap[q.options!.indexOf(opt)] ?? opt;
                  const isSelected =
                    (answers[q.id] ?? "").trim().toLowerCase() ===
                    letter.toLowerCase();
                  return (
                    <Button
                      key={opt}
                      type="button"
                      variant="outline"
                      className={cn(
                        "h-auto justify-start text-left py-3 px-4",
                        isSelected &&
                          "border-primary bg-primary/10 text-primary"
                      )}
                      onClick={() =>
                        setAnswers((prev) => ({ ...prev, [q.id]: letter }))
                      }
                    >
                      {letter}. {opt}
                    </Button>
                  );
                })}
              </div>
            )}

            {q.type === "multiple_correct" && q.options && (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  Select all that apply
                </p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {q.options.map((opt, idx) => {
                    const letter = String.fromCharCode(65 + idx); // A, B, C...
                    const current = answers[q.id] ?? "";
                    const selectedLetters = current
                      .split("|")
                      .map((s) => s.trim().toLowerCase())
                      .filter(Boolean);
                    const isSelected = selectedLetters.includes(
                      letter.toLowerCase()
                    );
                    return (
                      <Button
                        key={opt}
                        type="button"
                        variant="outline"
                        className={cn(
                          "h-auto justify-start text-left py-3 px-4",
                          isSelected &&
                            "border-primary bg-primary/10 text-primary"
                        )}
                        onClick={() =>
                          setAnswers((prev) => {
                            const cur = prev[q.id] ?? "";
                            const arr = cur
                              .split("|")
                              .map((s) => s.trim())
                              .filter(Boolean);
                            const idxIn = arr
                              .map((s) => s.toLowerCase())
                              .indexOf(letter.toLowerCase());
                            if (idxIn >= 0) {
                              arr.splice(idxIn, 1);
                            } else {
                              arr.push(letter);
                            }
                            return {
                              ...prev,
                              [q.id]: arr.join("|"),
                            };
                          })
                        }
                      >
                        {letter}. {opt}
                      </Button>
                    );
                  })}
                </div>
              </div>
            )}

            {q.type === "true_false" && (
              <div className="grid grid-cols-2 gap-4">
                {["True", "False"].map((opt) => {
                  const isSelected =
                    (answers[q.id] ?? "").trim().toLowerCase() ===
                    opt.toLowerCase();
                  return (
                    <Button
                      key={opt}
                      type="button"
                      variant="outline"
                      size="lg"
                      className={cn(
                        "h-14",
                        isSelected && "border-primary bg-primary/10 text-primary"
                      )}
                      onClick={() =>
                        setAnswers((prev) => ({ ...prev, [q.id]: opt }))
                      }
                    >
                      {opt}
                    </Button>
                  );
                })}
              </div>
            )}

            {q.type === "short" && (
              <Textarea
                placeholder="Write your answer here..."
                rows={4}
                value={answers[q.id] ?? ""}
                onChange={(e) =>
                  setAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))
                }
              />
            )}

            {q.type === "match" && q.options && (
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  Match each item on the left with the correct option on the
                  right.
                </p>
                {(() => {
                  // Parse "Match: Left: [A, B, C] Right: [1, 2, 3]"
                  const text = q.question ?? "";
                  const leftMatch = text.match(/Left:\s*\[([^\]]+)\]/i);
                  const rightMatch = text.match(/Right:\s*\[([^\]]+)\]/i);
                  const leftItems = leftMatch
                    ? leftMatch[1]
                        .split(",")
                        .map((s) => s.trim())
                        .filter(Boolean)
                    : [];
                  const rightItems = rightMatch
                    ? rightMatch[1]
                        .split(",")
                        .map((s) => s.trim())
                        .filter(Boolean)
                    : [];

                  const current = answers[q.id] ?? "";
                  const mapping: Record<string, string> = {};
                  current
                    .split("|")
                    .map((p) => p.trim())
                    .filter(Boolean)
                    .forEach((p) => {
                      const [l, r] = p.split(":").map((s) => s.trim());
                      if (l && r) mapping[l] = r;
                    });

                  const updatePair = (left: string, right: string) => {
                    setAnswers((prev) => {
                      const cur = prev[q.id] ?? "";
                      const entries = cur
                        .split("|")
                        .map((p) => p.trim())
                        .filter(Boolean)
                        .map((p) => {
                          const [l, r] = p.split(":").map((s) => s.trim());
                          return { l, r };
                        })
                        .filter((e) => e.l && e.r);
                      const other = entries.filter((e) => e.l !== left);
                      if (right) {
                        other.push({ l: left, r: right });
                      }
                      const joined = other
                        .map((e) => `${e.l}:${e.r}`)
                        .join("|");
                      return { ...prev, [q.id]: joined };
                    });
                  };

                  return (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-2">
                        {leftItems.map((l) => (
                          <div
                            key={l}
                            className="flex items-center justify-between gap-2"
                          >
                            <span className="text-sm font-medium">{l}</span>
                            <Select
                              value={mapping[l] ?? ""}
                              onValueChange={(v) => updatePair(l, v)}
                            >
                              <SelectTrigger className="w-24">
                                <SelectValue placeholder="Select" />
                              </SelectTrigger>
                              <SelectContent>
                                {rightItems.map((r) => (
                                  <SelectItem key={r} value={r}>
                                    {r}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}

            {hintState.text && (
              <div
                className={cn(
                  "rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/50",
                  "animate-in fade-in duration-300"
                )}
              >
                <p className="text-amber-800 dark:text-amber-200 text-sm font-semibold mb-1">
                  💡 Hint
                </p>
                <p className="text-amber-700 dark:text-amber-300 text-sm">
                  {hintState.text}
                </p>
              </div>
            )}

            <Separator />

            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                {socraticMode && (
                  <>
                    {!hintState.used && !hintState.isLoading && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleGetHint(q)}
                      >
                        <Lightbulb className="size-4" />
                        Get Hint
                      </Button>
                    )}
                    {hintState.isLoading && (
                      <Button variant="outline" size="sm" disabled>
                        <Loader2 className="size-4 animate-spin" />
                        Getting hint...
                      </Button>
                    )}
                    {hintState.used && !hintState.isLoading && (
                      <span className="text-muted-foreground text-sm">
                        Hint used
                      </span>
                    )}
                  </>
                )}
              </div>
              <Button
                disabled={!hasAnswer || isSubmitting}
                onClick={() => {
                  if (currentIndex < questions.length - 1) {
                    setCurrentIndex((i) => i + 1);
                  } else {
                    handleSubmit();
                  }
                }}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Submitting...
                  </>
                ) : currentIndex < questions.length - 1 ? (
                  "Next →"
                ) : (
                  "Submit Quiz"
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ──── VIEW 3: RESULTS ────────────────────────────────────────
  const scoreColor =
    score > 75 ? "text-green-600" : score >= 50 ? "text-yellow-600" : "text-red-600";
  const message =
    score > 80
      ? "Excellent work! You've got this 🎉"
      : score >= 60
        ? "Good effort! Review the missed topics 📚"
        : "Keep practicing — you'll get there 💪";
  const totalPages =
    breakdown.length > 0
      ? Math.ceil(breakdown.length / RESULTS_PER_PAGE)
      : 1;
  const paginatedBreakdown = breakdown.slice(
    (resultsPage - 1) * RESULTS_PER_PAGE,
    resultsPage * RESULTS_PER_PAGE
  );

  if (view === "results") {
    return (
      <div className="space-y-8">
        {renderTabs()}
        <div className="text-center space-y-2">
          <p className={cn("text-5xl font-bold", scoreColor)}>{score}%</p>
          <p className="text-muted-foreground">
            {correctCount} of {totalCount} correct
          </p>
          <p className="text-muted-foreground text-sm">
            Time: {formatElapsed(resultsElapsed)}
          </p>
          <p className="text-lg font-medium">{message}</p>
        </div>

        <div ref={breakdownRef} className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Question Breakdown</h2>
            {breakdown.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Showing{" "}
                {(resultsPage - 1) * RESULTS_PER_PAGE + 1}-
                {Math.min(resultsPage * RESULTS_PER_PAGE, breakdown.length)} of{" "}
                {breakdown.length} questions
              </p>
            )}
          </div>

          <Accordion
            type="multiple"
            defaultValue={paginatedBreakdown.map((b) => b.questionId)}
          >
            {paginatedBreakdown.map((b, index) => {
              const globalIndex =
                (resultsPage - 1) * RESULTS_PER_PAGE + index + 1;
              return (
                <AccordionItem key={b.questionId} value={b.questionId}>
                  <AccordionTrigger className="flex items-center gap-2 text-left">
                    <span>
                      Q{globalIndex}: {truncate(b.question, 60)}
                    </span>
                    {b.correct ? (
                      <CheckCircle2 className="size-5 shrink-0 text-green-600" />
                    ) : (
                      <XCircle className="size-5 shrink-0 text-red-600" />
                    )}
                  </AccordionTrigger>
                  <AccordionContent className="space-y-2">
                    {b.correct ? (
                      <>
                        <Badge className="bg-green-600">✓ Correct!</Badge>
                        {b.explanation && (
                          <p className="text-sm">
                            <span className="font-medium">Explanation:</span>{" "}
                            {b.explanation}
                          </p>
                        )}
                        {b.unit && (
                          <Badge variant="outline">{b.unit}</Badge>
                        )}
                      </>
                    ) : (
                      <>
                        <Badge variant="destructive">✗ Incorrect</Badge>
                        <p className="text-sm">
                          <span className="font-medium">Your answer:</span>{" "}
                          {b.studentAnswer || "(empty)"}
                        </p>
                        <p className="text-sm">
                          <span className="font-medium">Correct answer:</span>{" "}
                          {b.correctAnswer}
                        </p>
                        {b.explanation && (
                          <p className="text-sm">
                            <span className="font-medium">Explanation:</span>{" "}
                            {b.explanation}
                          </p>
                        )}
                        {b.unit && (
                          <Badge variant="outline">{b.unit}</Badge>
                        )}
                      </>
                    )}
                  </AccordionContent>
                </AccordionItem>
              );
            })}
          </Accordion>

          {breakdown.length > RESULTS_PER_PAGE && (
            <div className="flex items-center justify-center gap-3 pt-2 text-xs">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={resultsPage === 1}
                onClick={() => {
                  setResultsPage((p) => Math.max(1, p - 1));
                  if (breakdownRef.current) {
                    breakdownRef.current.scrollIntoView({
                      behavior: "smooth",
                    });
                  }
                }}
              >
                ← Previous
              </Button>
              <span className="text-muted-foreground">
                Page {resultsPage} of {totalPages}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={resultsPage === totalPages}
                onClick={() => {
                  setResultsPage((p) => Math.min(totalPages, p + 1));
                  if (breakdownRef.current) {
                    breakdownRef.current.scrollIntoView({
                      behavior: "smooth",
                    });
                  }
                }}
              >
                Next →
              </Button>
            </div>
          )}
        </div>

        <div className="flex gap-3">
          <Button variant="outline" onClick={resetToSetup}>
            Try Another Quiz
          </Button>
          <Button variant="outline" asChild>
            <Link href="/student/subjects">Back to Subjects</Link>
          </Button>
        </div>
      </div>
    );
  }

  // ──── VIEW 4: HISTORY ────────────────────────────────────────
  return (
    <div className="space-y-6">
      {renderTabs()}
      <div className="flex items-center gap-2">
        <Brain className="size-6 text-primary" />
        <h1 className="text-xl font-semibold tracking-tight">
          Quiz History
        </h1>
      </div>

      {loadingHistory ? (
        <p className="text-sm text-muted-foreground">Loading history...</p>
      ) : historyAttempts.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No quiz attempts yet. Create a quiz to get started.
        </p>
      ) : (
        <div className="space-y-4">
          {historyAttempts.map((attempt) => {
            const scoreColor =
              attempt.score >= 80
                ? "text-green-600"
                : attempt.score >= 60
                ? "text-amber-600"
                : "text-red-600";
            return (
              <Card key={attempt.id}>
                <CardHeader className="space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-xs text-muted-foreground">
                        {attempt.subjectName}
                      </p>
                      <CardTitle className="text-sm font-semibold">
                        {attempt.title}
                      </CardTitle>
                    </div>
                    <span
                      className={cn(
                        "text-lg font-semibold",
                        scoreColor
                      )}
                    >
                      {attempt.score}%
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {new Date(attempt.createdAt).toLocaleString("en-IN")}{" "}
                    • {attempt.correctCount}/{attempt.totalCount} correct
                    {attempt.timeTaken != null
                      ? ` • ${attempt.timeTaken}s`
                      : ""}
                  </p>
                </CardHeader>
                <CardContent className="space-y-2">
                  <Accordion type="single" collapsible>
                    <AccordionItem value="details">
                      <AccordionTrigger className="text-sm">
                        View detailed breakdown
                      </AccordionTrigger>
                      <AccordionContent className="space-y-3">
                        {attempt.breakdown.map((b, idx) => (
                          <div
                            key={b.questionId}
                            className="rounded-md border p-3 text-sm"
                          >
                            <p className="font-medium mb-1">
                              Q{idx + 1}. {b.question}
                            </p>
                            <p
                              className={cn(
                                "text-xs",
                                b.correct
                                  ? "text-green-600"
                                  : "text-red-600"
                              )}
                            >
                              Your answer:{" "}
                              {b.studentAnswer || "(empty)"}
                            </p>
                            {!b.correct && (
                              <p className="text-xs">
                                Correct answer: {b.correctAnswer}
                              </p>
                            )}
                            {b.explanation && (
                              <p className="mt-1 text-xs text-muted-foreground">
                                Explanation: {b.explanation}
                              </p>
                            )}
                            {b.difficulty && (
                              <Badge
                                variant="outline"
                                className="mt-1 text-[10px] uppercase"
                              >
                                {b.difficulty}
                              </Badge>
                            )}
                          </div>
                        ))}
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                </CardContent>
                <CardHeader className="pt-0">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      try {
                        const res = await fetch("/api/quiz/export", {
                          method: "POST",
                          headers: {
                            "Content-Type": "application/json",
                          },
                          body: JSON.stringify({ attemptId: attempt.id }),
                        });
                        if (!res.ok) {
                          const err = await res
                            .json()
                            .catch(() => ({}));
                          throw new Error(
                            err?.error ?? "Failed to export PDF"
                          );
                        }
                        const blob = await res.blob();
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = "quiz-results.pdf";
                        document.body.appendChild(a);
                        a.click();
                        a.remove();
                        URL.revokeObjectURL(url);
                      } catch (e) {
                        console.error(e);
                        alert(
                          e instanceof Error
                            ? e.message
                            : "Failed to export PDF"
                        );
                      }
                    }}
                  >
                    Export PDF
                  </Button>
                </CardHeader>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
