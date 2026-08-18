"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { MonoTag, type MonoTagVariant } from "@/components/ui/mono-tag";
import {
  INTERVIEW_QUESTIONS,
  type InterviewQuestion,
  type InterviewRound,
  type InterviewQuestionCategory,
} from "@/lib/placement/interview-prep";

interface EvaluationResult {
  score: number;
  what_worked: string;
  primary_issue: string;
  improved_answer: string;
  one_tip: string;
}

const CATEGORY_LABELS: Record<InterviewQuestionCategory, string> = {
  introduction: "Introduction",
  motivation: "Motivation",
  behavioral: "Behavioral",
  situational: "Situational",
  technical_cs: "Technical CS",
  project_deep_dive: "Project Deep Dive",
  stress: "Stress",
};

// Difficulty dot is a meaningful signal, not decoration — kept semantic
// (never red for a performance-adjacent indicator, per DESIGN.md).
const DIFFICULTY_DOT: Record<InterviewQuestion["difficulty"], string> = {
  easy: "bg-emerald-400",
  medium: "bg-amber-400",
  hard: "bg-slate-400",
};

const ROUND_LABELS: Record<InterviewRound, string> = {
  hr: "HR",
  technical: "Technical",
  aptitude_discussion: "Aptitude",
};

const PRIMARY_BUTTON =
  "inline-flex h-11 items-center justify-center gap-1.5 rounded-8 bg-ink px-5 font-plex-sans text-body font-medium text-paper transition-colors duration-180 ease-out hover:bg-ink-800 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-900 focus-visible:ring-offset-2";

const SECONDARY_BUTTON =
  "inline-flex h-11 items-center justify-center gap-1.5 rounded-8 border border-ink-200 px-5 font-plex-sans text-body font-medium text-ink transition-colors duration-180 ease-out hover:bg-ink-50 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-900 focus-visible:ring-offset-2";

function scoreVariant(score: number): MonoTagVariant {
  // Never red for a performance indicator, per DESIGN.md — low scores stay
  // on the neutral `default` tag rather than escalating to brick-red.
  if (score >= 7) return "mastery-fill";
  if (score >= 4) return "amber-fill";
  return "default";
}

function wordCount(text: string): number {
  return text.trim() === "" ? 0 : text.trim().split(/\s+/).length;
}

export default function InterviewPrepPage() {
  const [selectedRound, setSelectedRound] = useState<InterviewRound | "all">(
    "all"
  );
  const [selectedCategory, setSelectedCategory] = useState<
    InterviewQuestionCategory | "all"
  >("all");
  const [activeQuestion, setActiveQuestion] =
    useState<InterviewQuestion | null>(null);
  const [studentAnswer, setStudentAnswer] = useState("");
  const [evaluation, setEvaluation] = useState<EvaluationResult | null>(null);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [practiceMode, setPracticeMode] = useState(false);
  const [jdContext, setJdContext] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("jd_analysis_last");
      if (raw) {
        const parsed = JSON.parse(raw) as { job_title?: string };
        if (parsed.job_title) {
          setJdContext(parsed.job_title);
        }
      }
    } catch {
      // sessionStorage not available or invalid JSON — ignore
    }
  }, []);

  const filteredQuestions = useMemo(() => {
    let qs = INTERVIEW_QUESTIONS;
    if (selectedRound !== "all") {
      qs = qs.filter((q) => q.round === selectedRound);
    }
    if (selectedCategory !== "all") {
      qs = qs.filter((q) => q.category === selectedCategory);
    }
    if (jdContext) {
      const serviceFirst = qs.filter((q) =>
        q.company_types.includes("service_it")
      );
      const allOnly = qs.filter(
        (q) =>
          !q.company_types.includes("service_it") &&
          q.company_types.includes("all")
      );
      qs = [...serviceFirst, ...allOnly];
    }
    return qs;
  }, [selectedRound, selectedCategory, jdContext]);

  const wCount = wordCount(studentAnswer);

  async function handleEvaluate() {
    if (!activeQuestion || studentAnswer.trim().length < 20) return;
    setIsEvaluating(true);
    setEvaluation(null);
    try {
      const res = await fetch("/api/placement/interview/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question_id: activeQuestion.id,
          question_text: activeQuestion.question,
          answer_framework: activeQuestion.answer_framework,
          student_answer: studentAnswer,
          role_context: jdContext ?? undefined,
        }),
      });
      if (!res.ok) throw new Error("Evaluation failed");
      const data = (await res.json()) as EvaluationResult;
      setEvaluation(data);
    } catch {
      // show nothing on error — user can retry
    } finally {
      setIsEvaluating(false);
    }
  }

  function selectQuestion(q: InterviewQuestion) {
    setActiveQuestion(q);
    setStudentAnswer("");
    setEvaluation(null);
    setPracticeMode(false);
  }

  return (
    <div className="min-h-screen bg-paper">
      <div className="mx-auto max-w-6xl px-4 py-6">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-plex-serif text-display-sm font-semibold text-ink">
              Interview Prep Bank
            </h1>
            <p className="mt-1 font-plex-sans text-body-sm text-ink-500">
              Practice common placement interview questions with structured
              feedback
            </p>
          </div>
          <Link
            href="/student/placement/interview/mock"
            className={cn(PRIMARY_BUTTON, "shrink-0")}
          >
            Run a mock round
          </Link>
        </div>

        {/* JD Context Banner */}
        {jdContext && (
          <div className="mb-4 flex items-center justify-between rounded-8 border border-ink-200 bg-ink-50 px-4 py-2">
            <span className="font-plex-sans text-body-sm text-ink-700">
              Preparing for:{" "}
              <span className="font-medium text-ink">{jdContext}</span> role · Questions
              tailored to this role
            </span>
            <button
              type="button"
              onClick={() => setJdContext(null)}
              className="ml-3 rounded-4 text-ink-500 transition-colors duration-180 ease-out hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-900"
              aria-label="Dismiss"
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-5">
          {/* ── Left: Question Browser ── */}
          <div className="lg:col-span-2">
            {/* Round tabs */}
            <div className="mb-3 flex gap-1 border-b border-ink-200">
              {(["all", "hr", "technical"] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setSelectedRound(r)}
                  className={cn(
                    "min-h-11 px-3 py-2 font-plex-sans text-body-sm font-medium transition-colors duration-180 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-900",
                    selectedRound === r
                      ? "border-b-2 border-ochre text-ink-900"
                      : "text-ink-500 hover:text-ink-700"
                  )}
                >
                  {r === "all" ? "All" : r === "hr" ? "HR" : "Technical"}
                </button>
              ))}
            </div>

            {/* Category filter */}
            <div className="mb-4">
              <select
                value={selectedCategory}
                onChange={(e) =>
                  setSelectedCategory(
                    e.target.value as InterviewQuestionCategory | "all"
                  )
                }
                className="w-full rounded-8 border border-ink-200 bg-paper px-3 py-2 font-plex-sans text-body-sm text-ink-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-900"
              >
                <option value="all">All Categories</option>
                {(
                  Object.keys(CATEGORY_LABELS) as InterviewQuestionCategory[]
                ).map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABELS[c]}
                  </option>
                ))}
              </select>
            </div>

            {/* Question list */}
            <div className="space-y-2">
              {filteredQuestions.length === 0 && (
                <p className="py-6 text-center font-plex-sans text-body-sm text-ink-400">
                  No questions match this filter.
                </p>
              )}
              {filteredQuestions.map((q) => (
                <button
                  key={q.id}
                  type="button"
                  onClick={() => selectQuestion(q)}
                  className={cn(
                    "w-full rounded-8 border p-3 text-left transition-colors duration-180 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-900",
                    activeQuestion?.id === q.id
                      ? "border-ochre bg-paper"
                      : "border-ink-200 hover:border-ink-400 hover:bg-ink-50"
                  )}
                >
                  <div className="flex items-start gap-2">
                    <span
                      className={cn(
                        "mt-1.5 size-2 shrink-0 rounded-full",
                        DIFFICULTY_DOT[q.difficulty]
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="font-plex-sans text-body-sm leading-snug text-ink">
                        {q.question.length > 80
                          ? q.question.slice(0, 80) + "…"
                          : q.question}
                      </p>
                      <div className="mt-1.5 flex items-center gap-1.5">
                        <MonoTag>{ROUND_LABELS[q.round]}</MonoTag>
                        <span className="font-plex-sans text-xs text-ink-400">
                          {CATEGORY_LABELS[q.category]}
                        </span>
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* ── Right: Active Question View ── */}
          <div className="lg:col-span-3">
            {!activeQuestion ? (
              <div className="flex h-64 flex-col items-center justify-center text-center">
                <p className="font-plex-sans text-body text-ink-400">
                  Select a question to start practicing
                </p>
                <p className="mt-1 font-plex-sans text-body-sm text-ink-400">
                  Start with Introduction questions — they set the tone
                </p>
              </div>
            ) : !practiceMode ? (
              <div className="space-y-4">
                {/* Question header */}
                <div>
                  <div className="mb-2 flex items-center gap-2">
                    <MonoTag>{ROUND_LABELS[activeQuestion.round]}</MonoTag>
                    <span className="font-plex-sans text-xs text-ink-500">
                      {CATEGORY_LABELS[activeQuestion.category]}
                    </span>
                    <span className="font-plex-sans text-xs capitalize text-ink-400">
                      · {activeQuestion.difficulty}
                    </span>
                  </div>
                  <h2 className="font-plex-serif text-display-sm font-semibold text-ink">
                    {activeQuestion.question}
                  </h2>
                </div>

                {/* Why they ask this */}
                <div className="rounded-8 border border-amber-200 bg-amber-50 p-3">
                  <p className="mb-1 font-plex-sans text-xs font-medium text-amber-700">
                    Why interviewers ask this
                  </p>
                  <p className="font-plex-sans text-body-sm text-ink-700">
                    {activeQuestion.why_asked}
                  </p>
                </div>

                {/* Answer framework */}
                <div className="rounded-8 border border-ink-200 bg-ink-50 p-3">
                  <p className="mb-1 font-plex-sans text-xs font-medium text-ink-600">
                    How to structure your answer
                  </p>
                  <p className="font-plex-sans text-body-sm text-ink-700">
                    {activeQuestion.answer_framework}
                  </p>
                </div>

                {/* Dos and Don'ts */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="mb-2 font-plex-sans text-xs font-medium text-emerald-700">
                      ✓ Do
                    </p>
                    <ul className="space-y-1.5">
                      {activeQuestion.dos.map((d, i) => (
                        <li key={i} className="flex items-start gap-1.5">
                          <span className="mt-0.5 text-xs text-emerald-500">
                            ✓
                          </span>
                          <span className="font-plex-sans text-body-sm text-ink-700">{d}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <p className="mb-2 font-plex-sans text-xs font-medium text-amber-700">
                      ✗ Avoid
                    </p>
                    <ul className="space-y-1.5">
                      {activeQuestion.donts.map((d, i) => (
                        <li key={i} className="flex items-start gap-1.5">
                          <span className="mt-0.5 text-xs text-amber-500">
                            ✗
                          </span>
                          <span className="font-plex-sans text-body-sm text-ink-700">{d}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                {/* CTA */}
                <button
                  type="button"
                  onClick={() => setPracticeMode(true)}
                  className={cn(PRIMARY_BUTTON, "w-full")}
                >
                  Practice answering →
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Question header */}
                <div>
                  <div className="mb-2 flex items-center gap-2">
                    <MonoTag>{ROUND_LABELS[activeQuestion.round]}</MonoTag>
                    <span className="font-plex-sans text-xs text-ink-500">
                      {CATEGORY_LABELS[activeQuestion.category]}
                    </span>
                  </div>
                  <h2 className="font-plex-serif text-display-sm font-semibold text-ink">
                    {activeQuestion.question}
                  </h2>
                </div>

                {/* Answer textarea */}
                <div>
                  <textarea
                    value={studentAnswer}
                    onChange={(e) => setStudentAnswer(e.target.value)}
                    placeholder={`Write your answer here. \nAim for 100-150 words for HR questions.`}
                    className="h-40 w-full resize-none rounded-8 border border-ink-200 bg-paper p-3 font-plex-sans text-body-sm text-ink placeholder:text-ink-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-900"
                  />
                  <div className="mt-1 flex items-center justify-end">
                    {wCount < 30 ? (
                      <span className="font-plex-sans text-xs text-amber-600">Too short</span>
                    ) : wCount > 200 ? (
                      <span className="font-plex-sans text-xs text-amber-600">
                        Too long — keep it concise
                      </span>
                    ) : (
                      <span className="font-plex-sans text-xs text-ink-400">
                        {wCount} words
                      </span>
                    )}
                  </div>
                </div>

                {/* Buttons */}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleEvaluate}
                    disabled={studentAnswer.trim().length < 20 || isEvaluating}
                    className={cn(PRIMARY_BUTTON, "flex-1")}
                  >
                    {isEvaluating && (
                      <Loader2 className="size-4 animate-spin" aria-hidden />
                    )}
                    Get Feedback
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPracticeMode(false);
                      setEvaluation(null);
                    }}
                    className={SECONDARY_BUTTON}
                  >
                    ← Back to question
                  </button>
                </div>

                {/* Evaluation result */}
                {evaluation && (
                  <div className="space-y-4 rounded-12 border border-ink-200 bg-paper p-4">
                    {/* Score */}
                    <div className="flex items-baseline gap-2">
                      <MonoTag variant={scoreVariant(evaluation.score)}>
                        {evaluation.score}/10
                      </MonoTag>
                      <span className="font-plex-sans text-body-sm text-ink-400">
                        Practice Score
                      </span>
                    </div>

                    {/* What worked / Primary issue */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-8 border border-emerald-200 bg-emerald-50 p-3">
                        <p className="mb-1 font-plex-sans text-xs font-medium text-emerald-700">
                          What worked
                        </p>
                        <p className="font-plex-sans text-body-sm text-ink-700">
                          {evaluation.what_worked}
                        </p>
                      </div>
                      <div className="rounded-8 border border-amber-200 bg-amber-50 p-3">
                        <p className="mb-1 font-plex-sans text-xs font-medium text-amber-700">
                          Primary issue
                        </p>
                        <p className="font-plex-sans text-body-sm text-ink-700">
                          {evaluation.primary_issue}
                        </p>
                      </div>
                    </div>

                    {/* Improved answer */}
                    <div className="rounded-8 border border-ink-100 bg-ink-50 p-4">
                      <p className="mb-2 font-plex-sans text-xs font-medium text-ink-500">
                        Stronger version
                      </p>
                      <p className="font-plex-sans text-body-sm italic leading-relaxed text-ink-700">
                        {evaluation.improved_answer}
                      </p>
                    </div>

                    {/* One tip */}
                    <p className="font-plex-sans text-body-sm text-ink-600">
                      💡 {evaluation.one_tip}
                    </p>

                    {/* Try again */}
                    <button
                      type="button"
                      onClick={() => {
                        setStudentAnswer("");
                        setEvaluation(null);
                      }}
                      className={cn(SECONDARY_BUTTON, "w-full")}
                    >
                      Try again →
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
