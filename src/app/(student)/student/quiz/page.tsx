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
  useState,
} from "react";
import { cn } from "@/lib/utils";

type View = "setup" | "taking" | "results";

type SubjectRow = {
  id: string;
  name: string;
  code: string;
};

type ModuleRow = {
  id: string;
  name: string;
  module_number: number;
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

const QUESTION_COUNTS = [5, 10, 15, 20] as const;
const DIFFICULTIES = ["easy", "medium", "hard", "mixed"] as const;
const QUESTION_TYPE_OPTS = [
  { id: "mcq", label: "Multiple Choice" },
  { id: "true_false", label: "True / False" },
  { id: "short", label: "Short Answer" },
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
  const [selectedSubjectId, setSelectedSubjectId] = useState("");
  const [loadingModules, setLoadingModules] = useState(false);
  const [questionCount, setQuestionCount] = useState(10);
  const [difficulty, setDifficulty] = useState<"easy" | "medium" | "hard" | "mixed">("mixed");
  const [questionTypes, setQuestionTypes] = useState<("mcq" | "true_false" | "short")[]>(["mcq"]);
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

  const fetchProfileAndSubjects = useCallback(async () => {
    const supabase = createBrowserClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) return;

    const { data: profile } = await supabase
      .from("profiles")
      .select("branch, semester")
      .eq("id", user.id)
      .single();

    const branch = (profile as { branch?: string } | null)?.branch ?? null;
    const semester = (profile as { semester?: number } | null)?.semester ?? null;
    if (branch == null || semester == null) return;

    const { data: subs, error } = await supabase
      .from("subjects")
      .select("id, code, name")
      .eq("branch", branch)
      .eq("semester", semester)
      .order("code");

    if (!error && subs) {
      setSubjects((subs ?? []) as SubjectRow[]);
    }
  }, []);

  const fetchModules = useCallback(async (sid: string) => {
    if (!sid) {
      setModules([]);
      return;
    }
    setLoadingModules(true);
    try {
      const supabase = createBrowserClient();
      const { data, error } = await supabase
        .from("modules")
        .select("id, name, module_number")
        .eq("subject_id", sid)
        .order("module_number");
      if (!error && data) {
        setModules((data ?? []) as ModuleRow[]);
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

  useEffect(() => {
    if (selectedSubjectId) {
      fetchModules(selectedSubjectId);
      const sub = subjects.find((s) => s.id === selectedSubjectId);
      setSubjectName(sub?.name ?? "");
    } else {
      setModules([]);
      setSubjectName("");
    }
  }, [selectedSubjectId, fetchModules, subjects]);

  const toggleQuestionType = (id: "mcq" | "true_false" | "short") => {
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
    if (!selectedSubjectId) return;
    setIsGenerating(true);
    try {
      const res = await fetch("/api/quiz/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subjectId: selectedSubjectId,
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
    if (view !== "taking") return;
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, [view]);

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
    ? (answers[currentQuestion.id] ?? "").trim() !== ""
    : false;

  // ──── VIEW 1: SETUP ─────────────────────────────────────────
  if (view === "setup") {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-2">
          <Brain className="size-8 text-primary" />
          <h1 className="text-2xl font-semibold tracking-tight">Quiz</h1>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Create Your Quiz</CardTitle>
            <CardDescription>
              Select a subject and configure your quiz settings.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label>Subject</Label>
              <Select
                value={selectedSubjectId}
                onValueChange={setSelectedSubjectId}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select a subject" />
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

            {selectedSubjectId && (
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
              disabled={!selectedSubjectId || isGenerating}
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

  return (
    <div className="space-y-8">
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

      <Accordion type="multiple" defaultValue={breakdown.map((b) => b.questionId)}>
        {breakdown.map((b, i) => (
          <AccordionItem key={b.questionId} value={b.questionId}>
            <AccordionTrigger className="flex items-center gap-2 text-left">
              <span>Q{i + 1}: {truncate(b.question, 60)}</span>
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
        ))}
      </Accordion>

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
