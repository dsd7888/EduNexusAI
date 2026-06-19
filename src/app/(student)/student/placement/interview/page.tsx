"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, X } from "lucide-react";
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

const DIFFICULTY_DOT: Record<InterviewQuestion["difficulty"], string> = {
  easy: "bg-emerald-400",
  medium: "bg-amber-400",
  hard: "bg-slate-400",
};

const ROUND_BADGE: Record<InterviewRound, string> = {
  hr: "bg-purple-100 text-purple-700",
  technical: "bg-blue-100 text-blue-700",
  aptitude_discussion: "bg-gray-100 text-gray-700",
};

const ROUND_LABELS: Record<InterviewRound, string> = {
  hr: "HR",
  technical: "Technical",
  aptitude_discussion: "Aptitude",
};

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
    <div className="min-h-screen bg-white">
      <div className="mx-auto max-w-6xl px-4 py-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">
            Interview Prep Bank
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Practice common placement interview questions with structured
            feedback
          </p>
        </div>

        {/* JD Context Banner */}
        {jdContext && (
          <div className="mb-4 flex items-center justify-between rounded-lg border border-blue-200 bg-blue-50 px-4 py-2">
            <span className="text-sm text-blue-700">
              Preparing for:{" "}
              <span className="font-medium">{jdContext}</span> role · Questions
              tailored to this role
            </span>
            <button
              type="button"
              onClick={() => setJdContext(null)}
              className="ml-3 text-blue-500 hover:text-blue-700"
              aria-label="Dismiss"
            >
              <X className="size-4" />
            </button>
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-5">
          {/* ── Left: Question Browser ── */}
          <div className="lg:col-span-2">
            {/* Round tabs */}
            <div className="mb-3 flex gap-1 border-b border-gray-200">
              {(["all", "hr", "technical"] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setSelectedRound(r)}
                  className={`px-3 py-2 text-sm font-medium transition-colors ${
                    selectedRound === r
                      ? "border-b-2 border-blue-600 text-blue-600"
                      : "text-gray-500 hover:text-gray-700"
                  }`}
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
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 focus:border-blue-400 focus:outline-none"
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
                <p className="py-6 text-center text-sm text-gray-400">
                  No questions match this filter.
                </p>
              )}
              {filteredQuestions.map((q) => (
                <button
                  key={q.id}
                  type="button"
                  onClick={() => selectQuestion(q)}
                  className={`w-full rounded-lg border p-3 text-left transition-colors ${
                    activeQuestion?.id === q.id
                      ? "border-blue-500 bg-blue-50"
                      : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <span
                      className={`mt-1.5 size-2 shrink-0 rounded-full ${DIFFICULTY_DOT[q.difficulty]}`}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-gray-800 leading-snug">
                        {q.question.length > 80
                          ? q.question.slice(0, 80) + "…"
                          : q.question}
                      </p>
                      <div className="mt-1.5 flex items-center gap-1.5">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${ROUND_BADGE[q.round]}`}
                        >
                          {ROUND_LABELS[q.round]}
                        </span>
                        <span className="text-xs text-gray-400">
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
                <p className="text-gray-400">
                  Select a question to start practicing
                </p>
                <p className="mt-1 text-sm text-gray-400">
                  Start with Introduction questions — they set the tone
                </p>
              </div>
            ) : !practiceMode ? (
              <div className="space-y-4">
                {/* Question header */}
                <div>
                  <div className="mb-2 flex items-center gap-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${ROUND_BADGE[activeQuestion.round]}`}
                    >
                      {ROUND_LABELS[activeQuestion.round]}
                    </span>
                    <span className="text-xs text-gray-500">
                      {CATEGORY_LABELS[activeQuestion.category]}
                    </span>
                    <span className="text-xs text-gray-400 capitalize">
                      · {activeQuestion.difficulty}
                    </span>
                  </div>
                  <h2 className="text-lg font-semibold text-gray-900">
                    {activeQuestion.question}
                  </h2>
                </div>

                {/* Why they ask this */}
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <p className="mb-1 text-xs font-medium text-amber-700">
                    Why interviewers ask this
                  </p>
                  <p className="text-sm text-gray-700">
                    {activeQuestion.why_asked}
                  </p>
                </div>

                {/* Answer framework */}
                <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
                  <p className="mb-1 text-xs font-medium text-blue-700">
                    How to structure your answer
                  </p>
                  <p className="text-sm text-gray-700">
                    {activeQuestion.answer_framework}
                  </p>
                </div>

                {/* Dos and Don'ts */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="mb-2 text-xs font-medium text-emerald-700">
                      ✓ Do
                    </p>
                    <ul className="space-y-1.5">
                      {activeQuestion.dos.map((d, i) => (
                        <li key={i} className="flex items-start gap-1.5">
                          <span className="mt-0.5 text-emerald-500 text-xs">
                            ✓
                          </span>
                          <span className="text-sm text-gray-700">{d}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <p className="mb-2 text-xs font-medium text-amber-700">
                      ✗ Avoid
                    </p>
                    <ul className="space-y-1.5">
                      {activeQuestion.donts.map((d, i) => (
                        <li key={i} className="flex items-start gap-1.5">
                          <span className="mt-0.5 text-amber-500 text-xs">
                            ✗
                          </span>
                          <span className="text-sm text-gray-700">{d}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                {/* CTA */}
                <button
                  type="button"
                  onClick={() => setPracticeMode(true)}
                  className="w-full rounded-xl bg-blue-600 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700"
                >
                  Practice answering →
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Question header */}
                <div>
                  <div className="mb-2 flex items-center gap-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${ROUND_BADGE[activeQuestion.round]}`}
                    >
                      {ROUND_LABELS[activeQuestion.round]}
                    </span>
                    <span className="text-xs text-gray-500">
                      {CATEGORY_LABELS[activeQuestion.category]}
                    </span>
                  </div>
                  <h2 className="text-lg font-semibold text-gray-900">
                    {activeQuestion.question}
                  </h2>
                </div>

                {/* Answer textarea */}
                <div>
                  <textarea
                    value={studentAnswer}
                    onChange={(e) => setStudentAnswer(e.target.value)}
                    placeholder={`Write your answer here. \nAim for 100-150 words for HR questions.`}
                    className="h-40 w-full resize-none rounded-xl border border-gray-200 p-3 text-sm text-gray-800 focus:border-blue-400 focus:outline-none"
                  />
                  <div className="mt-1 flex items-center justify-end">
                    {wCount < 30 ? (
                      <span className="text-xs text-amber-500">Too short</span>
                    ) : wCount > 200 ? (
                      <span className="text-xs text-amber-500">
                        Too long — keep it concise
                      </span>
                    ) : (
                      <span className="text-xs text-gray-400">
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
                    className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-blue-600 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isEvaluating && (
                      <Loader2 className="size-4 animate-spin" />
                    )}
                    Get Feedback
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPracticeMode(false);
                      setEvaluation(null);
                    }}
                    className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm text-gray-600 transition-colors hover:bg-gray-50"
                  >
                    ← Back to question
                  </button>
                </div>

                {/* Evaluation result */}
                {evaluation && (
                  <div className="space-y-4 rounded-xl border border-gray-200 bg-white p-4">
                    {/* Score */}
                    <div className="flex items-baseline gap-2">
                      <span
                        className={`text-3xl font-bold ${
                          evaluation.score >= 7
                            ? "text-emerald-600"
                            : evaluation.score >= 4
                              ? "text-amber-600"
                              : "text-slate-500"
                        }`}
                      >
                        {evaluation.score}/10
                      </span>
                      <span className="text-sm text-gray-400">
                        Practice Score
                      </span>
                    </div>

                    {/* What worked / Primary issue */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                        <p className="mb-1 text-xs font-medium text-emerald-700">
                          What worked
                        </p>
                        <p className="text-sm text-gray-700">
                          {evaluation.what_worked}
                        </p>
                      </div>
                      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                        <p className="mb-1 text-xs font-medium text-amber-700">
                          Primary issue
                        </p>
                        <p className="text-sm text-gray-700">
                          {evaluation.primary_issue}
                        </p>
                      </div>
                    </div>

                    {/* Improved answer */}
                    <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                      <p className="mb-2 text-xs font-medium text-gray-500">
                        Stronger version
                      </p>
                      <p className="text-sm italic leading-relaxed text-gray-700">
                        {evaluation.improved_answer}
                      </p>
                    </div>

                    {/* One tip */}
                    <p className="text-sm text-gray-600">
                      💡 {evaluation.one_tip}
                    </p>

                    {/* Try again */}
                    <button
                      type="button"
                      onClick={() => {
                        setStudentAnswer("");
                        setEvaluation(null);
                      }}
                      className="w-full rounded-xl border border-gray-200 py-2 text-sm text-gray-600 transition-colors hover:bg-gray-50"
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
