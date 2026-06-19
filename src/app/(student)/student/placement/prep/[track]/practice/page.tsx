"use client";

import React, { useEffect, useState, useCallback, useRef, Suspense } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Check, X, ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type {
  PlacementBankQuestion,
  PlacementTopicMastery,
} from "@/types/placement";

// ─── Types ────────────────────────────────────────────────────────────────────

interface StoredSession {
  questions: PlacementBankQuestion[];
  selectedAnswers: Record<number, string>;
  lockedAnswers: number[];
  questionTimes: Record<number, number>;
  currentIndex: number;
  timeElapsed: number;
  generatedAt: string;
}

type SubmitResult = {
  mastery: PlacementTopicMastery | null;
  difficulty_changed: boolean;
  new_difficulty: string;
  warnings: string[];
};

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

// Next-topic suggestions for the "strong performance" guidance.
const NEXT_TOPIC: Record<string, string> = {
  "Time & Work": "Time, Speed & Distance",
  "Ratio, Proportion & Mixtures": "Probability & Permutations",
  "Percentages & Profit/Loss": "Time & Work",
};

const TRACK_HUB_NAMES: Record<string, string> = {
  aptitude: "Aptitude & Reasoning",
  verbal: "Verbal Ability",
  domain: "Core Domain",
  communication: "Communication & HR",
};

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60).toString().padStart(2, "0");
  const s = (seconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function shortTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = (seconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function scoreColorClass(correct: number, total: number): string {
  const r = total === 0 ? 0 : correct / total;
  if (r >= 0.7) return "text-emerald-600";
  if (r >= 0.5) return "text-amber-600";
  return "text-amber-500";
}

function isValidQuestion(q: unknown): q is PlacementBankQuestion {
  if (!q || typeof q !== "object") return false;
  const cand = q as Partial<PlacementBankQuestion>;
  return (
    typeof cand.question_text === "string" &&
    cand.question_text.trim() !== "" &&
    Array.isArray(cand.options) &&
    cand.options.length === 4 &&
    typeof cand.correct_answer === "string" &&
    ["A", "B", "C", "D"].includes(cand.correct_answer)
  );
}

// Split a Step-1 / Step-2 / Answer explanation into individual lines.
function splitExplanation(text: string): string[] {
  return text
    .replace(/\s*(Step\s*\d+\s*:|Answer\s*:)/gi, "\n$1")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

// ─── Syntax highlighting ───────────────────────────────────────────────────────

const KEYWORDS = new Set([
  "def", "class", "for", "if", "elif", "else", "return", "while", "in",
  "import", "from", "True", "False", "None", "and", "or", "not", "with",
  "as", "try", "except", "finally", "pass", "break", "continue", "lambda",
  "yield", "public", "private", "protected", "static", "void", "int",
  "String", "boolean", "new", "this", "super", "extends", "implements",
]);

function colorLine(line: string, lineIdx: number): React.ReactNode {
  if (/^\s*(#|\/\/)/.test(line)) {
    return <span key={lineIdx} className="text-gray-500">{line}</span>;
  }
  const parts: React.ReactNode[] = [];
  let partIdx = 0;
  let buf = "";
  let i = 0;

  const flushBuf = () => {
    if (!buf) return;
    buf.split(/(\b[a-zA-Z_]\w*\b)/).forEach((piece) => {
      if (!piece) return;
      if (KEYWORDS.has(piece)) {
        parts.push(<span key={`${lineIdx}-${partIdx++}`} className="text-purple-400">{piece}</span>);
      } else {
        parts.push(<span key={`${lineIdx}-${partIdx++}`} className="text-gray-100">{piece}</span>);
      }
    });
    buf = "";
  };

  while (i < line.length) {
    if (line[i] === "#" || (line[i] === "/" && line[i + 1] === "/")) {
      flushBuf();
      parts.push(<span key={`${lineIdx}-cmt`} className="text-gray-500">{line.slice(i)}</span>);
      i = line.length;
      continue;
    }
    if (line[i] === '"' || line[i] === "'") {
      flushBuf();
      const q = line[i];
      let j = i + 1;
      while (j < line.length && line[j] !== q) {
        if (line[j] === "\\") j++;
        j++;
      }
      parts.push(<span key={`${lineIdx}-${partIdx++}`} className="text-amber-300">{line.slice(i, j + 1)}</span>);
      i = j + 1;
      continue;
    }
    buf += line[i];
    i++;
  }
  flushBuf();
  return <>{parts}</>;
}

function SyntaxBlock({ code, highlightLine: hlLine }: { code: string; highlightLine?: string }) {
  const lines = code.split("\n");
  return (
    <div className="font-mono text-sm">
      {lines.map((line, li) => (
        <div
          key={li}
          className={cn(
            "leading-6",
            hlLine !== undefined && line === hlLine
              ? "bg-emerald-900/30 border-l-2 border-emerald-500 pl-2"
              : ""
          )}
        >
          {colorLine(line, li)}
        </div>
      ))}
    </div>
  );
}

// ─── Inner component (uses useSearchParams) ───────────────────────────────────

function PracticeInner() {
  const params       = useParams();
  const searchParams = useSearchParams();
  const router       = useRouter();

  const rawTrack    = params.track as string;
  const topic       = searchParams.get("topic") ?? "";
  const companySlug = searchParams.get("company");
  const fromSource  = searchParams.get("from");

  const isFromJdAnalyzer = fromSource === "jd-analyzer";
  const backHref = isFromJdAnalyzer
    ? "/student/placement/jd-analyzer"
    : `/student/placement/prep/${rawTrack}`;
  const backLabel = isFromJdAnalyzer
    ? "← Back to JD Analyzer"
    : `← ${TRACK_HUB_NAMES[rawTrack] ?? rawTrack}`;

  const storageKey = topic
    ? `placement_practice_${rawTrack}_${encodeURIComponent(topic)}_${companySlug || "none"}`
    : "";

  const [questions,        setQuestions]        = useState<PlacementBankQuestion[]>([]);
  const [currentIndex,     setCurrentIndex]     = useState(0);
  const [selectedAnswers,  setSelectedAnswers]  = useState<Record<number, string>>({});
  const [lockedAnswers,    setLockedAnswers]    = useState<Set<number>>(new Set());
  const [questionTimes,    setQuestionTimes]    = useState<Record<number, number>>({});
  const [sessionComplete,  setSessionComplete]  = useState(false);
  const [timeElapsed,      setTimeElapsed]      = useState(0);
  const [loading,          setLoading]          = useState(true);
  const [error,            setError]            = useState<string | null>(null);
  const [openReview,       setOpenReview]       = useState<Set<number>>(new Set());
  const [showResumeBanner, setShowResumeBanner] = useState(false);
  const [showTabBanner,    setShowTabBanner]    = useState(false);
  const [sessionSource,    setSessionSource]    = useState<"bank" | "generated" | null>(null);
  const [submitResult,     setSubmitResult]     = useState<SubmitResult | null>(null);
  const [masteryTimedOut,  setMasteryTimedOut]  = useState(false);

  const generatedAtRef    = useRef<string>("");
  const tabSwitchCount    = useRef(0);
  const tabBannerDismissed = useRef(false);
  const initializedKey    = useRef<string>("");
  const submittedRef       = useRef(false);

  // Redirect if topic is missing
  useEffect(() => {
    if (!topic) router.replace(`/student/placement/prep/${rawTrack}`);
  }, [topic, rawTrack, router]);

  const clearStorage = useCallback(() => {
    if (!storageKey) return;
    try {
      sessionStorage.removeItem(storageKey);
    } catch {
      /* ignore */
    }
  }, [storageKey]);

  const loadQuestions = useCallback(async () => {
    setLoading(true);
    setError(null);
    let retried = false;

    const fetchWithRetry = async (url: string, options: RequestInit) => {
      const res = await fetch(url, options);
      if ((res.status === 500 || res.status === 503) && !retried) {
        retried = true;
        await new Promise((r) => setTimeout(r, 2000));
        return fetch(url, options);
      }
      return res;
    };

    try {
      const res = await fetchWithRetry("/api/placement/prep/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          track: rawTrack,
          topic,
          count: 10,
          ...(companySlug ? { company_slug: companySlug } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError("Failed to generate questions. This is usually a temporary issue.");
        return;
      }
      // Validate + filter (Change 9)
      const valid = (Array.isArray(data.questions) ? data.questions : []).filter(
        isValidQuestion
      );
      if (valid.length < 3) {
        setError("Failed to generate questions. This is usually a temporary issue.");
        return;
      }
      generatedAtRef.current = new Date().toISOString();
      setSessionSource(
        data.source === "bank" || data.source === "generated" ? data.source : null
      );
      setQuestions(valid);
    } catch {
      setError("Failed to generate questions. This is usually a temporary issue.");
    } finally {
      setLoading(false);
    }
  }, [rawTrack, topic, companySlug]);

  // Submit completed session — fire-and-forget; failure is non-fatal (Addition 1).
  const submitSession = useCallback(
    async (
      qs: PlacementBankQuestion[],
      answers: Record<number, string>,
      times: Record<number, number>,
      elapsed: number
    ): Promise<SubmitResult | null> => {
      const attempts = qs.map((qq, i) => ({
        question_id: qq.id,
        selected_answer: answers[i] ?? null,
        is_correct: answers[i] === qq.correct_answer,
        is_skipped: answers[i] === undefined,
        time_spent_seconds: times[i] ?? 0,
      }));

      try {
        const res = await fetch("/api/placement/prep/submit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            attempts,
            track: rawTrack,
            topic,
            company_context: companySlug ?? undefined,
            session_duration_seconds: elapsed,
          }),
        });
        if (!res.ok) return null;
        return (await res.json()) as SubmitResult;
      } catch {
        return null; // non-fatal — results screen still renders
      }
    },
    [rawTrack, topic, companySlug]
  );

  // Full state reset (keeps questions untouched — callers decide those).
  const resetState = useCallback(() => {
    setCurrentIndex(0);
    setSelectedAnswers({});
    setLockedAnswers(new Set());
    setQuestionTimes({});
    setSessionComplete(false);
    setTimeElapsed(0);
    setOpenReview(new Set());
    setShowResumeBanner(false);
    setShowTabBanner(false);
    setSubmitResult(null);
    setMasteryTimedOut(false);
    submittedRef.current = false;
    tabSwitchCount.current = 0;
    tabBannerDismissed.current = false;
  }, []);

  // ── Init: restore from storage or fetch fresh (re-runs on topic/company change) ──
  useEffect(() => {
    if (!topic) return;
    if (initializedKey.current === storageKey) return;
    initializedKey.current = storageKey;

    try {
      const stored = sessionStorage.getItem(storageKey);
      if (stored) {
        const parsed = JSON.parse(stored) as StoredSession;
        const ageMs = Date.now() - new Date(parsed.generatedAt).getTime();
        if (
          Array.isArray(parsed.questions) &&
          parsed.questions.length > 0 &&
          Number.isFinite(ageMs) &&
          ageMs < TWO_HOURS_MS
        ) {
          setQuestions(parsed.questions);
          setSelectedAnswers(parsed.selectedAnswers ?? {});
          setLockedAnswers(new Set(parsed.lockedAnswers ?? []));
          setQuestionTimes(parsed.questionTimes ?? {});
          setCurrentIndex(parsed.currentIndex ?? 0);
          setTimeElapsed(parsed.timeElapsed ?? 0);
          setSessionComplete(false);
          setOpenReview(new Set());
          setShowTabBanner(false);
          tabSwitchCount.current = 0;
          tabBannerDismissed.current = false;
          generatedAtRef.current = parsed.generatedAt;
          setShowResumeBanner(true);
          setLoading(false);
          return;
        }
      }
    } catch {
      /* corrupt/unavailable storage — fall through to fetch */
    }

    resetState();
    loadQuestions();
  }, [topic, storageKey, loadQuestions, resetState]);

  // Global timer: ticks the overall time AND the current question's time.
  useEffect(() => {
    if (loading || sessionComplete || questions.length === 0) return;
    const id = setInterval(() => {
      setTimeElapsed((t) => t + 1);
      setQuestionTimes((prev) => ({
        ...prev,
        [currentIndex]: (prev[currentIndex] ?? 0) + 1,
      }));
    }, 1000);
    return () => clearInterval(id);
  }, [loading, sessionComplete, questions.length, currentIndex]);

  // Persist on every selection / navigation change (Change 13).
  useEffect(() => {
    if (loading || sessionComplete || questions.length === 0 || !storageKey) return;
    try {
      const payload: StoredSession = {
        questions,
        selectedAnswers,
        lockedAnswers: Array.from(lockedAnswers),
        questionTimes,
        currentIndex,
        timeElapsed,
        generatedAt: generatedAtRef.current,
      };
      sessionStorage.setItem(storageKey, JSON.stringify(payload));
    } catch {
      /* ignore */
    }
  }, [
    questions,
    selectedAnswers,
    lockedAnswers,
    questionTimes,
    currentIndex,
    timeElapsed,
    loading,
    sessionComplete,
    storageKey,
  ]);

  // Tab-switch detection (Change 12).
  useEffect(() => {
    function onVisibility() {
      if (document.visibilityState === "hidden") {
        tabSwitchCount.current += 1;
        if (!tabBannerDismissed.current) setShowTabBanner(true);
      }
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  // Submit the session exactly once when it completes (Addition 1).
  useEffect(() => {
    if (!sessionComplete || submittedRef.current) return;
    submittedRef.current = true;
    submitSession(questions, selectedAnswers, questionTimes, timeElapsed).then(
      setSubmitResult
    );
  }, [sessionComplete, submitSession, questions, selectedAnswers, questionTimes, timeElapsed]);

  // 5s fallback: if mastery hasn't resolved, show a minimal card (Addition 2).
  useEffect(() => {
    if (!sessionComplete || submitResult !== null) return;
    const id = setTimeout(() => setMasteryTimedOut(true), 5000);
    return () => clearTimeout(id);
  }, [sessionComplete, submitResult]);

  if (!topic) return null;

  // ── Handlers ────────────────────────────────────────────────────────────────

  function selectOption(key: string) {
    if (lockedAnswers.has(currentIndex)) return; // locked — can't change
    setSelectedAnswers((prev) => ({ ...prev, [currentIndex]: key }));
  }

  function goNext() {
    setLockedAnswers((prev) => new Set(prev).add(currentIndex));
    if (currentIndex < questions.length - 1) {
      setCurrentIndex((i) => i + 1);
    } else {
      setSessionComplete(true);
      clearStorage();
    }
  }

  function goBack() {
    if (currentIndex === 0) return;
    const prev = currentIndex - 1;
    setLockedAnswers((s) => {
      const next = new Set(s);
      next.delete(prev); // unlock the question we return to
      return next;
    });
    setCurrentIndex(prev);
  }

  function skipQuestion() {
    if (currentIndex < questions.length - 1) {
      setCurrentIndex((i) => i + 1);
    } else {
      setSessionComplete(true);
      clearStorage();
    }
  }

  function endSession() {
    const ok = window.confirm(
      "End session early? You'll see results for answered questions only."
    );
    if (ok) {
      setSessionComplete(true);
      clearStorage();
    }
  }

  function toggleReview(i: number) {
    setOpenReview((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  function handlePracticeAgain() {
    clearStorage();
    resetState();
    loadQuestions();
  }

  function retryWrongOnly() {
    const wrong = questions.filter(
      (qq, i) =>
        selectedAnswers[i] !== undefined && selectedAnswers[i] !== qq.correct_answer
    );
    if (wrong.length === 0) return;
    clearStorage();
    resetState();
    setQuestions(wrong);
    generatedAtRef.current = new Date().toISOString();
    setLoading(false);
  }

  function navigateToTopic(t: string) {
    const qs = new URLSearchParams({ topic: t });
    if (companySlug) qs.set("company", companySlug);
    router.push(`/student/placement/prep/${rawTrack}/practice?${qs.toString()}`);
  }

  // ── Phase: Loading ───────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3">
        <Loader2 className="size-8 animate-spin text-blue-500" />
        <p className="text-sm text-gray-500">
          Generating questions on{" "}
          <span className="font-medium text-gray-700">{topic}</span>…
        </p>
      </div>
    );
  }

  // ── Phase: Error (Change 8) ──────────────────────────────────────────────────

  if (error || questions.length === 0) {
    return (
      <div className="space-y-4">
        <Link
          href={backHref}
          className="inline-flex text-sm text-gray-500 hover:text-gray-700"
        >
          {backLabel}
        </Link>
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
        <p className="max-w-md text-sm text-gray-500">
          {error ?? "Failed to generate questions. This is usually a temporary issue."}
        </p>
        <div className="flex gap-3">
          <Button
            onClick={loadQuestions}
            className="bg-blue-600 text-white hover:bg-blue-700"
          >
            Try Again
          </Button>
          <Link href={`/student/placement/prep/${rawTrack}`}>
            <Button variant="outline">Choose Different Topic</Button>
          </Link>
        </div>
        </div>
      </div>
    );
  }

  // ── Shared pre-computes ──────────────────────────────────────────────────────

  const totalQ         = questions.length;
  const q              = questions[currentIndex];
  const selected       = selectedAnswers[currentIndex];
  const isLocked       = lockedAnswers.has(currentIndex);
  const isLastQuestion = currentIndex === totalQ - 1;
  const showEndSession = !sessionComplete && selectedAnswers[0] !== undefined;

  // ── Shared: sticky header ────────────────────────────────────────────────────

  const StickyHeader = (
    <div className="sticky top-0 z-10 -mx-4 mb-6 flex items-center justify-between gap-2 border-b border-gray-200 bg-white/95 px-4 py-3 backdrop-blur-sm sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
      <span className="max-w-[28%] truncate text-sm text-gray-500">{topic}</span>

      <div className="flex items-center gap-1.5">
        {questions.map((_, i) => (
          <div
            key={i}
            className={cn(
              "size-2.5 rounded-full border transition-colors",
              selectedAnswers[i] !== undefined
                ? "border-blue-500 bg-blue-500"
                : i === currentIndex && !sessionComplete
                ? "border-blue-500 bg-white"
                : "border-gray-300 bg-white"
            )}
          />
        ))}
      </div>

      <div className="flex items-center gap-3">
        <span className="text-sm tabular-nums text-gray-400">{formatTime(timeElapsed)}</span>
        {sessionSource === "bank" && (
          <span className="rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs text-emerald-600">
            From Question Bank
          </span>
        )}
        {sessionSource === "generated" && (
          <span className="rounded border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs text-blue-600">
            AI Generated
          </span>
        )}
        {showEndSession && (
          <button
            type="button"
            onClick={endSession}
            className="rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 hover:text-gray-700"
          >
            End Session
          </button>
        )}
      </div>
    </div>
  );

  // ── Phase: Results ────────────────────────────────────────────────────────────

  if (sessionComplete) {
    const correctCount  = questions.filter((qq, i) => selectedAnswers[i] === qq.correct_answer).length;
    const wrongCount    = totalQ - correctCount;
    const accuracy      = Math.round((correctCount / totalQ) * 100);
    const ratio         = correctCount / totalQ;
    const avgSeconds    = (timeElapsed / totalQ).toFixed(1);
    const completedMins = Math.floor(timeElapsed / 60);
    const completedSecs = timeElapsed % 60;

    const wrongAnsweredCount = questions.filter(
      (qq, i) => selectedAnswers[i] !== undefined && selectedAnswers[i] !== qq.correct_answer
    ).length;

    const nextTopic = NEXT_TOPIC[topic];

    return (
      <div className="space-y-6">
        <Link
          href={backHref}
          className="inline-flex text-sm text-gray-500 hover:text-gray-700"
        >
          {backLabel}
        </Link>
        {StickyHeader}

        {/* Score card */}
        <div className="flex flex-col items-center gap-2 rounded-xl border border-gray-200 bg-white py-10 text-center">
          <span className={cn("text-5xl font-bold", scoreColorClass(correctCount, totalQ))}>
            {correctCount}/{totalQ}
          </span>
          <p className="text-sm text-gray-500">Correct answers</p>
          <p className="mt-1 text-xl font-medium text-gray-600">{accuracy}% accuracy</p>
          <p className="mt-1 text-sm text-gray-400">
            Completed in {completedMins}m {completedSecs}s
          </p>
        </div>

        {/* Topic mastery (Addition 2) */}
        {submitResult === null && !masteryTimedOut ? (
          <div className="h-20 animate-pulse rounded-lg bg-gray-100" />
        ) : (
          <div className="rounded-xl border border-gray-200 p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-gray-700">Topic Mastery</span>
              <span className="text-xs text-gray-400">{topic}</span>
            </div>

            <div className="mt-3 flex flex-wrap gap-x-8 gap-y-2">
              <div>
                <p className="text-xs text-gray-400">Sessions</p>
                <p className="text-sm font-semibold text-gray-800">
                  {submitResult ? submitResult.mastery?.sessions_count ?? 1 : "–"}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-400">Accuracy</p>
                <p className="text-sm font-semibold text-gray-800">
                  {submitResult
                    ? `${(submitResult.mastery?.recent_accuracy ?? 0).toFixed(1)}%`
                    : "–"}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-400">Level</p>
                <p className="text-sm font-semibold text-gray-800">
                  {submitResult && submitResult.mastery
                    ? submitResult.mastery.current_difficulty.charAt(0).toUpperCase() +
                      submitResult.mastery.current_difficulty.slice(1)
                    : "–"}
                </p>
              </div>
            </div>

            {submitResult?.difficulty_changed && (
              <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                🎯 Difficulty upgraded to {submitResult.new_difficulty}! Next session will
                have harder questions.
              </div>
            )}
          </div>
        )}

        {/* Post-score guidance (Change 6) */}
        {ratio >= 0.7 ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
            <p className="text-sm text-emerald-800">
              Strong performance on {topic}. Ready to try a harder topic or test under
              company conditions.
            </p>
            <div className="mt-3">
              {nextTopic ? (
                <Button
                  onClick={() => navigateToTopic(nextTopic)}
                  className="bg-emerald-600 text-white hover:bg-emerald-700"
                >
                  Try {nextTopic}
                </Button>
              ) : (
                <Link href={`/student/placement/prep/${rawTrack}`}>
                  <Button className="bg-emerald-600 text-white hover:bg-emerald-700">
                    Try Another Topic
                  </Button>
                </Link>
              )}
            </div>
          </div>
        ) : ratio >= 0.4 ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
            <p className="text-sm text-amber-800">
              Moderate performance. Review the explanations below, then retry this topic.
            </p>
            <div className="mt-3">
              <Button
                onClick={handlePracticeAgain}
                className="bg-amber-600 text-white hover:bg-amber-700"
              >
                Retry {topic}
              </Button>
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
            <p className="text-sm text-amber-800">
              This topic needs more work. Study the explanations carefully before retrying.
            </p>
            <p className="mt-1 text-xs text-amber-700">Tip: Focus on wrong answers first.</p>
            <div className="mt-3">
              <Button
                onClick={handlePracticeAgain}
                className="bg-amber-500 text-white hover:bg-amber-600"
              >
                Retry {topic}
              </Button>
            </div>
          </div>
        )}

        {/* Tab-switch warning (Change 12) */}
        {tabSwitchCount.current > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-sm text-amber-700">
            ⚠ {tabSwitchCount.current} tab switch
            {tabSwitchCount.current === 1 ? "" : "es"} detected during this session
          </div>
        )}

        {/* Performance pills */}
        <div className="flex flex-wrap justify-center gap-3">
          <div className="rounded-lg bg-emerald-50 px-5 py-3 text-center">
            <p className="text-xl font-semibold text-emerald-700">{correctCount}</p>
            <p className="text-xs text-emerald-600">Correct</p>
          </div>
          <div className="rounded-lg bg-amber-50 px-5 py-3 text-center">
            <p className="text-xl font-semibold text-amber-600">{wrongCount}</p>
            <p className="text-xs text-amber-500">Wrong</p>
          </div>
          <div className="rounded-lg bg-gray-50 px-5 py-3 text-center">
            <p className="text-xl font-semibold text-gray-600">{avgSeconds}s</p>
            <p className="text-xs text-gray-500">Avg per Q</p>
          </div>
        </div>

        {/* Review All Answers (Change 11) */}
        <div>
          <p className="mb-3 text-sm font-medium text-gray-700">Review All Answers</p>
          <div className="space-y-2">
            {questions.map((qq, i) => {
              const answered  = selectedAnswers[i] !== undefined;
              const isCorrect = answered && selectedAnswers[i] === qq.correct_answer;
              const status: "correct" | "wrong" | "skipped" = isCorrect
                ? "correct"
                : answered
                ? "wrong"
                : "skipped";
              const isOpen = openReview.has(i);
              return (
                <div key={i} className="overflow-hidden rounded-lg border border-gray-200 bg-white">
                  <button
                    type="button"
                    onClick={() => toggleReview(i)}
                    className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span
                        className={cn(
                          "shrink-0 rounded px-2 py-0.5 text-xs font-medium",
                          status === "correct"
                            ? "bg-emerald-50 text-emerald-600"
                            : status === "wrong"
                            ? "bg-red-50 text-red-500"
                            : "bg-amber-50 text-amber-600"
                        )}
                      >
                        Q{i + 1}
                      </span>
                      {status === "skipped" && (
                        <span className="shrink-0 rounded bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-600">
                          Skipped
                        </span>
                      )}
                      <span className="min-w-0 truncate text-sm text-gray-700">
                        {qq.question_text.slice(0, 60)}
                        {qq.question_text.length > 60 ? "…" : ""}
                      </span>
                    </div>
                    {isOpen ? (
                      <ChevronDown className="size-4 shrink-0 text-gray-400" />
                    ) : (
                      <ChevronRight className="size-4 shrink-0 text-gray-400" />
                    )}
                  </button>

                  {isOpen && (
                    <div className="space-y-3 border-t border-gray-100 px-4 py-3 text-sm">
                      {/* Full question text */}
                      <p className="font-medium leading-relaxed text-gray-900">
                        {qq.question_text}
                      </p>

                      {/* fill_code: show code block with blank */}
                      {qq.question_type === "fill_code" && qq.code_context && (
                        <div className="rounded-xl bg-gray-900 p-4 font-mono text-sm text-gray-100">
                          <SyntaxBlock code={qq.code_context.before_blank} />
                          <div className="my-0.5 rounded bg-blue-900/50 border border-blue-500/50 px-2 py-0.5 text-blue-300 italic">
                            ← complete this line
                          </div>
                          <SyntaxBlock code={qq.code_context.after_blank} />
                        </div>
                      )}

                      {/* All options, colour-coded */}
                      <div className="space-y-1.5">
                        {qq.options.map((opt) => {
                          const isCorrectOpt    = opt.key === qq.correct_answer;
                          const isWrongSelected = selectedAnswers[i] === opt.key && !isCorrectOpt;
                          return (
                            <div
                              key={opt.key}
                              className={cn(
                                "flex items-center justify-between gap-2 rounded-md border px-3 py-2",
                                isCorrectOpt
                                  ? "border-emerald-300 bg-emerald-50"
                                  : isWrongSelected
                                  ? "border-red-300 bg-red-50"
                                  : "border-gray-200"
                              )}
                            >
                              <span className={cn("text-gray-800", qq.question_type === "fill_code" && "font-mono text-sm")}>
                                <span className="font-medium text-gray-500">{opt.key}.</span>{" "}
                                {opt.text}
                              </span>
                              {isCorrectOpt ? (
                                <Check className="size-4 shrink-0 text-emerald-600" />
                              ) : isWrongSelected ? (
                                <X className="size-4 shrink-0 text-red-500" />
                              ) : null}
                            </div>
                          );
                        })}
                      </div>

                      {/* Explanation */}
                      {qq.explanation && (
                        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                          <p className="mb-1 text-xs font-medium text-gray-500">
                            💡 Explanation
                          </p>
                          <div className="space-y-0.5 text-sm text-gray-700">
                            {splitExplanation(qq.explanation).map((line, li) => (
                              <p key={li}>{line}</p>
                            ))}
                          </div>

                          {/* fill_code: show complete code with correct line highlighted */}
                          {qq.question_type === "fill_code" && qq.code_context && (() => {
                            const correctText = qq.options.find((o) => o.key === qq.correct_answer)?.text ?? "";
                            return (
                              <div className="mt-2 rounded-xl bg-gray-900 p-4 font-mono text-sm text-gray-100">
                                <p className="mb-2 text-xs text-gray-500">Correct code:</p>
                                <SyntaxBlock code={qq.code_context.before_blank} />
                                <div className="my-0.5 bg-emerald-900/30 border-l-2 border-emerald-500 pl-2 leading-6">
                                  {colorLine(correctText, -1)}
                                </div>
                                <SyntaxBlock code={qq.code_context.after_blank} />
                              </div>
                            );
                          })()}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-wrap gap-3 pb-6">
          <Button
            onClick={handlePracticeAgain}
            className="bg-blue-600 text-white hover:bg-blue-700"
          >
            Practice Again
          </Button>
          {wrongAnsweredCount > 0 && (
            <Button variant="outline" onClick={retryWrongOnly}>
              Retry Wrong Answers Only
            </Button>
          )}
          <Link href={`/student/placement/prep/${rawTrack}`}>
            <Button variant="outline">Try Another Topic</Button>
          </Link>
          <Link href={backHref}>
            <Button variant="ghost">{backLabel}</Button>
          </Link>
        </div>
      </div>
    );
  }

  // ── Phase: Practice ───────────────────────────────────────────────────────────

  const qTime = questionTimes[currentIndex] ?? 0;
  let qTimerClass = "text-gray-400";
  let qTimerText = `${shortTime(qTime)} on this question`;
  if (qTime >= 120) {
    qTimerClass = "text-red-400";
    qTimerText = `${shortTime(qTime)} ✕ Move on`;
  } else if (qTime >= 90) {
    qTimerClass = "text-amber-500";
    qTimerText = `${shortTime(qTime)} ⚠ Taking long`;
  }

  function getOptionClass(optionKey: string): string {
    return selected === optionKey
      ? "border-blue-500 bg-blue-50"
      : isLocked
      ? "border-gray-200"
      : "border-gray-200 hover:border-blue-300 cursor-pointer";
  }

  return (
    <div className="space-y-4">
      <Link
        href={backHref}
        className="inline-flex text-sm text-gray-500 hover:text-gray-700"
      >
        {backLabel}
      </Link>
      {/* Tab-switch banner during drill (Change 12) */}
      {showTabBanner && (
        <div className="-mx-4 flex items-center justify-between gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-700 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
          <span>⚠ Tab switch detected — stay focused for best results</span>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => {
              setShowTabBanner(false);
              tabBannerDismissed.current = true;
            }}
            className="shrink-0 rounded p-0.5 hover:bg-amber-100"
          >
            <X className="size-4" />
          </button>
        </div>
      )}

      {StickyHeader}

      {/* Resume banner (Change 13) */}
      {showResumeBanner && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded bg-blue-50 px-3 py-2 text-sm text-blue-700">
          <span>Resuming your previous session</span>
          <button
            type="button"
            onClick={handlePracticeAgain}
            aria-label="Start fresh"
            className="shrink-0 rounded p-0.5 hover:bg-blue-100"
          >
            <X className="size-4" />
          </button>
        </div>
      )}

      {/* Question card */}
      <div className="rounded-xl border border-gray-200 bg-white p-5">
        {/* Badge row */}
        <div className="mb-3 flex items-center gap-2">
          <span className="rounded bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-600">
            Q{currentIndex + 1}
          </span>
          {q.difficulty && (
            <span className="text-xs capitalize text-gray-400">{q.difficulty}</span>
          )}
          {isLocked && (
            <span className="text-xs text-gray-400">· locked</span>
          )}
        </div>

        {q.question_type === "fill_code" && q.code_context ? (
          <>
            {/* Context */}
            <p className="text-base font-medium leading-relaxed text-gray-900">
              {q.question_text}
            </p>

            {/* Code block with blank */}
            <div className="mt-4 rounded-xl bg-gray-900 p-4 font-mono text-sm text-gray-100">
              <SyntaxBlock code={q.code_context.before_blank} />
              <div className="my-0.5 rounded bg-blue-900/50 border border-blue-500/50 px-2 py-0.5 text-blue-300 italic">
                ← complete this line
              </div>
              <SyntaxBlock code={q.code_context.after_blank} />
            </div>

            {/* Blank description */}
            <p className="mt-2 text-xs text-gray-500">
              Complete: {q.code_context.blank_description}
            </p>

            {/* Options — monospace */}
            <div className="mt-4 space-y-2">
              {q.options.map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => selectOption(opt.key)}
                  disabled={isLocked}
                  className={cn(
                    "flex w-full items-center justify-between rounded-lg border px-4 py-3 text-left transition-colors",
                    selected === opt.key
                      ? "border-blue-500 bg-blue-900/10"
                      : isLocked
                      ? "border-gray-200"
                      : "border-gray-200 hover:border-blue-300 cursor-pointer"
                  )}
                >
                  <div className="flex items-center gap-3">
                    <span className="shrink-0 text-sm font-medium text-gray-500">
                      {opt.key}.
                    </span>
                    <span className="font-mono text-sm text-gray-800">{opt.text}</span>
                  </div>
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            {/* Question text */}
            <p className="text-base font-medium leading-relaxed text-gray-900">
              {q.question_text}
            </p>

            {/* Options */}
            <div className="mt-4 space-y-2">
              {q.options.map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => selectOption(opt.key)}
                  disabled={isLocked}
                  className={cn(
                    "flex w-full items-center justify-between rounded-lg border px-4 py-3 text-left transition-colors",
                    getOptionClass(opt.key)
                  )}
                >
                  <div className="flex items-center gap-3">
                    <span className="shrink-0 text-sm font-medium text-gray-500">
                      {opt.key}.
                    </span>
                    <span className="text-sm text-gray-800">{opt.text}</span>
                  </div>
                </button>
              ))}
            </div>
          </>
        )}

        {/* Per-question timer (Change 4) */}
        <p className={cn("mt-3 text-xs", qTimerClass)}>{qTimerText}</p>

        {/* Skip (Change 3) */}
        {!isLocked && (
          <button
            type="button"
            onClick={skipQuestion}
            className="mt-2 text-sm text-gray-400 hover:text-gray-600"
          >
            Skip
          </button>
        )}
      </div>

      {/* Navigation (Change 2) */}
      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={goBack} disabled={currentIndex === 0}>
          ← Back
        </Button>
        <Button
          onClick={goNext}
          disabled={selected === undefined}
          className="bg-blue-600 text-white hover:bg-blue-700"
        >
          {isLastQuestion ? "Finish" : "Next →"}
        </Button>
      </div>
    </div>
  );
}

// ─── Page (Suspense for useSearchParams) ─────────────────────────────────────

export default function PracticePage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[60vh] items-center justify-center">
          <Loader2 className="size-8 animate-spin text-blue-500" />
        </div>
      }
    >
      <PracticeInner />
    </Suspense>
  );
}
