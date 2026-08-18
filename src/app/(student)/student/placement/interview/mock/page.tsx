"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Skeleton } from "@/components/ui/skeleton";
import { MonoTag, type MonoTagVariant } from "@/components/ui/mono-tag";
import { cn } from "@/lib/utils";
import { useCurrentUser } from "@/hooks/useSupabaseData";
import {
  buildMockRound,
  getMockRoundLabel,
  getCategoryLabel,
  type InterviewQuestion,
  type MockRound,
} from "@/lib/placement/interview-prep";
import { TARGET_LABELS, type StudentPlacementProfile } from "@/types/placement";

// ─── Types ──────────────────────────────────────────────────────────────────

interface EvaluationResult {
  score: number;
  what_worked: string;
  primary_issue: string;
  improved_answer: string;
  one_tip: string;
}

interface FollowUp {
  follow_up_question: string;
  why_it_probes: string;
  reactive_calls_used: number;
  reactive_calls_cap: number;
}

const GENERIC_FOLLOWUP_FRAMEWORK =
  "Answer the specific thing this question actually asks about your project — " +
  "reference a real detail, don't just repeat your first answer in general terms.";

const PRIMARY_BUTTON =
  "inline-flex h-11 items-center justify-center gap-1.5 rounded-8 bg-ink px-5 font-plex-sans text-body font-medium text-paper transition-colors duration-180 ease-out hover:bg-ink-800 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-900 focus-visible:ring-offset-2";

const SECONDARY_BUTTON =
  "inline-flex h-11 items-center justify-center gap-1.5 rounded-8 border border-ink-200 px-5 font-plex-sans text-body font-medium text-ink transition-colors duration-180 ease-out hover:bg-ink-50 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-900 focus-visible:ring-offset-2";

// ─── Helpers ────────────────────────────────────────────────────────────────

function scoreVariant(score: number): MonoTagVariant {
  // Never red for a performance indicator, per DESIGN.md — low scores stay
  // on the neutral `default` tag rather than escalating to brick-red.
  if (score >= 7) return "mastery-fill";
  if (score >= 4) return "amber-fill";
  return "default";
}

function buildProjectContext(
  resumeData: StudentPlacementProfile["resume_data"] | null | undefined
): string {
  const projects = resumeData?.projects ?? [];
  if (projects.length === 0) return "";
  const lines = projects.slice(0, 3).map((p) => {
    const stack = (p.tech_stack ?? []).join(", ");
    // `bullets` (current resume-builder shape) vs `description` (legacy
    // shape) — src/types/placement.ts has a known duplicate ResumeProject
    // declaration (flagged by CP-E1) that TS merges into a wider type than
    // any single code path actually produces; same defensive cast the ATS
    // route's buildResumeText already uses for this exact reason.
    const bullets = (
      (p as unknown as { bullets?: string[] }).bullets ?? []
    ).join("; ");
    return `${p.title} (${stack}): ${bullets}`;
  });
  return lines.join("\n").slice(0, 1200);
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function MockInterviewPage() {
  const router = useRouter();
  const { isLoading: userLoading } = useCurrentUser();
  const [placementProfile, setPlacementProfile] = useState<StudentPlacementProfile | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(true);

  const [round, setRound] = useState<MockRound | null>(null);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [answer, setAnswer] = useState("");
  const [evaluation, setEvaluation] = useState<EvaluationResult | null>(null);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [scores, setScores] = useState<number[]>([]);

  const [followUp, setFollowUp] = useState<FollowUp | null>(null);
  const [followUpLoading, setFollowUpLoading] = useState(false);
  const [followUpError, setFollowUpError] = useState<string | null>(null);
  const [followUpAnswer, setFollowUpAnswer] = useState("");
  const [followUpEvaluation, setFollowUpEvaluation] = useState<EvaluationResult | null>(null);
  const [followUpEvaluating, setFollowUpEvaluating] = useState(false);

  useEffect(() => {
    fetch("/api/placement/profile")
      .then((r) => r.json())
      .then((d) => {
        if (!d.profile) {
          router.replace("/student/placement/setup");
          return;
        }
        setPlacementProfile(d.profile as StudentPlacementProfile);
      })
      .catch(() => toast.error("Failed to load placement profile"))
      .finally(() => setLoadingProfile(false));
  }, [router]);

  const dataReady = !loadingProfile && !userLoading;

  const questions: InterviewQuestion[] = useMemo(() => {
    if (!round || !placementProfile) return [];
    return buildMockRound(placementProfile.primary_target, round);
  }, [round, placementProfile]);

  const currentQuestion = questions[questionIndex];
  const isProjectQuestion = currentQuestion?.category === "project_deep_dive";
  const projectContext = useMemo(
    () => buildProjectContext(placementProfile?.resume_data),
    [placementProfile]
  );

  function resetFollowUp() {
    setFollowUp(null);
    setFollowUpLoading(false);
    setFollowUpError(null);
    setFollowUpAnswer("");
    setFollowUpEvaluation(null);
    setFollowUpEvaluating(false);
  }

  function startRound(r: MockRound) {
    setRound(r);
    setQuestionIndex(0);
    setAnswer("");
    setEvaluation(null);
    setScores([]);
    resetFollowUp();
  }

  function exitRound() {
    setRound(null);
    setQuestionIndex(0);
    setAnswer("");
    setEvaluation(null);
    resetFollowUp();
  }

  function goToNextQuestion() {
    setQuestionIndex((i) => i + 1);
    setAnswer("");
    setEvaluation(null);
    resetFollowUp();
  }

  async function handleEvaluate() {
    if (!currentQuestion || answer.trim().length < 20 || isEvaluating) return;
    setIsEvaluating(true);
    setEvaluation(null);
    try {
      const res = await fetch("/api/placement/interview/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question_id: currentQuestion.id,
          question_text: currentQuestion.question,
          answer_framework: currentQuestion.answer_framework,
          student_answer: answer,
        }),
      });
      if (!res.ok) throw new Error("Evaluation failed");
      const data = (await res.json()) as EvaluationResult;
      setEvaluation(data);
      setScores((prev) => [...prev, data.score]);
    } catch {
      toast.error("Evaluation failed. Try again.");
    } finally {
      setIsEvaluating(false);
    }
  }

  async function handleGetFollowUp() {
    if (!currentQuestion || answer.trim().length < 20 || followUpLoading || followUp) return;
    setFollowUpLoading(true);
    setFollowUpError(null);
    try {
      const res = await fetch("/api/placement/interview/mock/follow-up", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          student_answer: answer,
          project_context: projectContext,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFollowUpError(
          typeof data?.error === "string" ? data.error : "Follow-up unavailable. Continue the round."
        );
        return;
      }
      setFollowUp(data as FollowUp);
    } catch {
      setFollowUpError("Follow-up unavailable. Continue the round.");
    } finally {
      setFollowUpLoading(false);
    }
  }

  async function handleEvaluateFollowUp() {
    if (!followUp || followUpAnswer.trim().length < 20 || followUpEvaluating) return;
    setFollowUpEvaluating(true);
    try {
      const res = await fetch("/api/placement/interview/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question_text: followUp.follow_up_question,
          answer_framework: GENERIC_FOLLOWUP_FRAMEWORK,
          student_answer: followUpAnswer,
        }),
      });
      if (!res.ok) throw new Error("Evaluation failed");
      const data = (await res.json()) as EvaluationResult;
      setFollowUpEvaluation(data);
      setScores((prev) => [...prev, data.score]);
    } catch {
      toast.error("Evaluation failed. Try again.");
    } finally {
      setFollowUpEvaluating(false);
    }
  }

  // ── Loading state ──────────────────────────────────────────────────────
  if (!dataReady || !placementProfile) {
    return (
      <div className="max-w-3xl space-y-6">
        <Skeleton className="h-4 w-56" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-48 rounded-8" />
      </div>
    );
  }

  // ── Round selection ────────────────────────────────────────────────────
  if (!round) {
    return (
      <div className="max-w-3xl space-y-6">
        <div>
          <p className="font-plex-sans text-label font-semibold uppercase tracking-[0.04em] text-ink-500">
            Stage 3 · Mock interview
          </p>
          <h1 className="mt-1 font-plex-serif text-display-lg font-bold text-ink">
            Run a mock round
          </h1>
          <p className="mt-2 max-w-2xl font-plex-sans text-body text-ink-600">
            A structured, ordered sequence pulled from the question bank — tailored to your
            target, {TARGET_LABELS[placementProfile.primary_target]}. Each answer gets scored
            feedback, same as the practice bank.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {(["hr", "technical"] as MockRound[]).map((r) => {
            const count = buildMockRound(placementProfile.primary_target, r).length;
            return (
              <button
                key={r}
                type="button"
                onClick={() => startRound(r)}
                className="rounded-8 border border-ink-200 bg-paper p-4 text-left transition-colors duration-180 ease-out hover:bg-ink-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-900 focus-visible:ring-offset-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="font-plex-sans text-body font-semibold text-ink">
                    {getMockRoundLabel(r)}
                  </p>
                  <MonoTag>{count} questions</MonoTag>
                </div>
                <p className="mt-1.5 font-plex-sans text-body-sm text-ink-600">
                  {r === "hr"
                    ? "Introduction, motivation, behavioral, situational, and one stress question."
                    : "Core CS fundamentals ending in a project deep-dive — this is where the reactive follow-up fires."}
                </p>
              </button>
            );
          })}
        </div>

        <Link
          href="/student/placement/interview"
          className="inline-flex h-11 items-center gap-1.5 font-plex-sans text-body-sm font-medium text-ink-600 transition-colors duration-180 ease-out hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-900 focus-visible:ring-offset-2"
        >
          <ArrowLeft className="size-3.5" aria-hidden />
          Back to the full question bank
        </Link>
      </div>
    );
  }

  // ── Empty round (defensive — buildMockRound always has an 'all' fallback,
  //    but never dead-end silently if a future bank edit ever breaks that) ──
  if (questions.length === 0) {
    return (
      <div className="max-w-3xl space-y-4">
        <p className="font-plex-sans text-body text-ink-600">
          No questions are available for this round right now.
        </p>
        <button type="button" onClick={exitRound} className={SECONDARY_BUTTON}>
          <ArrowLeft className="size-4" aria-hidden />
          Choose a different round
        </button>
      </div>
    );
  }

  // ── Round summary ──────────────────────────────────────────────────────
  if (questionIndex >= questions.length) {
    const avg = average(scores);
    return (
      <div className="max-w-3xl space-y-6">
        <div>
          <p className="font-plex-sans text-label font-semibold uppercase tracking-[0.04em] text-ink-500">
            {getMockRoundLabel(round)} · complete
          </p>
          <h1 className="mt-1 font-plex-serif text-display-lg font-bold text-ink">
            {scores.length} answer{scores.length === 1 ? "" : "s"} scored
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <MonoTag variant={scoreVariant(avg)}>Average {avg}/10</MonoTag>
          {scores.map((s, i) => (
            <MonoTag key={i} variant={scoreVariant(s)}>
              Q{i + 1}: {s}/10
            </MonoTag>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <button type="button" onClick={exitRound} className={PRIMARY_BUTTON}>
            Run another round
          </button>
          <Link href="/student/placement/interview" className={SECONDARY_BUTTON}>
            Back to question bank
          </Link>
        </div>
      </div>
    );
  }

  // ── Running a question ─────────────────────────────────────────────────
  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <div className="flex items-center justify-between gap-2">
          <p className="font-plex-sans text-label font-semibold uppercase tracking-[0.04em] text-ink-500">
            {getMockRoundLabel(round)} · Question {questionIndex + 1} of {questions.length}
          </p>
          <button
            type="button"
            onClick={exitRound}
            className="inline-flex h-11 items-center font-plex-sans text-body-sm text-ink-500 underline-offset-2 hover:text-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-900"
          >
            Change round
          </button>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <MonoTag variant="active">{getCategoryLabel(currentQuestion.category)}</MonoTag>
          <MonoTag>{currentQuestion.difficulty}</MonoTag>
        </div>
        <h2 className="mt-3 font-plex-serif text-display-sm font-semibold text-ink">
          {currentQuestion.question}
        </h2>
        <p className="mt-2 font-plex-sans text-body-sm text-ink-600">
          {currentQuestion.why_asked}
        </p>
      </div>

      <div>
        <textarea
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          disabled={!!evaluation}
          placeholder="Write your answer here."
          className="h-40 w-full resize-none rounded-8 border border-ink-200 bg-paper p-3 font-plex-sans text-body text-ink placeholder:text-ink-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-900 disabled:bg-ink-50 disabled:text-ink-600"
        />
      </div>

      {!evaluation ? (
        <button
          type="button"
          onClick={handleEvaluate}
          disabled={answer.trim().length < 20 || isEvaluating}
          className={PRIMARY_BUTTON}
        >
          {isEvaluating && <Loader2 className="size-4 animate-spin" aria-hidden />}
          Get feedback
        </button>
      ) : (
        <div className="space-y-4">
          <div className="rounded-8 border border-ink-200 bg-paper p-4">
            <div className="flex items-center gap-2">
              <MonoTag variant={scoreVariant(evaluation.score)}>{evaluation.score}/10</MonoTag>
              <span className="font-plex-sans text-body-sm text-ink-500">Practice score</span>
            </div>
            <p className="mt-3 font-plex-sans text-body-sm text-ink-700">
              <span className="font-semibold text-ink">What worked: </span>
              {evaluation.what_worked}
            </p>
            <p className="mt-1.5 font-plex-sans text-body-sm text-ink-700">
              <span className="font-semibold text-ink">Primary issue: </span>
              {evaluation.primary_issue}
            </p>
            <div className="mt-3 rounded-8 border border-ink-100 bg-ink-50 p-3">
              <p className="font-plex-sans text-label font-semibold uppercase tracking-[0.04em] text-ink-500">
                Stronger version
              </p>
              <p className="mt-1 font-plex-sans text-body-sm italic text-ink-700">
                {evaluation.improved_answer}
              </p>
            </div>
            <p className="mt-3 font-plex-sans text-body-sm text-ink-600">{evaluation.one_tip}</p>
          </div>

          {isProjectQuestion && (
            <ReactiveFollowUp
              hasProjectContext={projectContext.length >= 20}
              followUp={followUp}
              loading={followUpLoading}
              error={followUpError}
              onRequest={handleGetFollowUp}
              answer={followUpAnswer}
              onAnswerChange={setFollowUpAnswer}
              evaluation={followUpEvaluation}
              evaluating={followUpEvaluating}
              onEvaluate={handleEvaluateFollowUp}
            />
          )}

          <button type="button" onClick={goToNextQuestion} className={PRIMARY_BUTTON}>
            {questionIndex === questions.length - 1 ? "Finish round" : "Next question"}
            <ArrowRight className="size-4" aria-hidden />
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Reactive follow-up (project_deep_dive only, capped server-side) ───────

function ReactiveFollowUp({
  hasProjectContext,
  followUp,
  loading,
  error,
  onRequest,
  answer,
  onAnswerChange,
  evaluation,
  evaluating,
  onEvaluate,
}: {
  hasProjectContext: boolean;
  followUp: FollowUp | null;
  loading: boolean;
  error: string | null;
  onRequest: () => void;
  answer: string;
  onAnswerChange: (v: string) => void;
  evaluation: EvaluationResult | null;
  evaluating: boolean;
  onEvaluate: () => void;
}) {
  if (!hasProjectContext) {
    return (
      <div className="rounded-8 border border-ink-200 bg-paper p-4">
        <p className="font-plex-sans text-label font-semibold uppercase tracking-[0.04em] text-ochre">
          Reactive follow-up
        </p>
        <p className="mt-1.5 font-plex-sans text-body-sm text-ink-600">
          Add a project to your resume to unlock a personalized follow-up question that reacts
          to your real project details.{" "}
          <Link href="/student/placement/resume" className="font-medium text-ink underline underline-offset-2">
            Update resume
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-8 border border-ink-200 bg-paper p-4">
      <p className="font-plex-sans text-label font-semibold uppercase tracking-[0.04em] text-ink-500">
        Reactive follow-up
      </p>

      {!followUp && !error && (
        <>
          <p className="mt-1.5 font-plex-sans text-body-sm text-ink-600">
            A real interviewer would probe deeper on a project answer. See what they would ask
            next, based on your actual project.
          </p>
          <button
            type="button"
            onClick={onRequest}
            disabled={loading}
            className={cn(SECONDARY_BUTTON, "mt-3")}
          >
            {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {loading ? "Thinking…" : "Get the follow-up"}
          </button>
        </>
      )}

      {error && !followUp && (
        <p className="mt-1.5 font-plex-sans text-body-sm text-ink-600">{error}</p>
      )}

      {followUp && (
        <div className="mt-3 space-y-3">
          <div>
            <p className="font-plex-sans text-body font-medium text-ink">
              {followUp.follow_up_question}
            </p>
            <p className="mt-1 font-plex-sans text-body-sm text-ink-500">
              Probing: {followUp.why_it_probes}
            </p>
          </div>

          {!evaluation ? (
            <>
              <textarea
                value={answer}
                onChange={(e) => onAnswerChange(e.target.value)}
                placeholder="Write your answer here."
                className="h-28 w-full resize-none rounded-8 border border-ink-200 bg-paper p-3 font-plex-sans text-body-sm text-ink placeholder:text-ink-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-900"
              />
              <button
                type="button"
                onClick={onEvaluate}
                disabled={answer.trim().length < 20 || evaluating}
                className={SECONDARY_BUTTON}
              >
                {evaluating && <Loader2 className="size-4 animate-spin" aria-hidden />}
                Get feedback
              </button>
            </>
          ) : (
            <div className="rounded-8 border border-ink-100 bg-ink-50 p-3">
              <MonoTag variant={scoreVariant(evaluation.score)}>{evaluation.score}/10</MonoTag>
              <p className="mt-2 font-plex-sans text-body-sm text-ink-700">
                {evaluation.primary_issue}
              </p>
              <p className="mt-1.5 font-plex-sans text-body-sm italic text-ink-700">
                {evaluation.improved_answer}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
