"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BookOpen, Brain, ChevronRight, MessageSquare, Target, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { scoreStyles } from "@/lib/ui/score";
import { createBrowserClient } from "@/lib/db/supabase-browser";
import { useCurrentUser, usePlacementHistory } from "@/hooks/useSupabaseData";
import { MonoTag } from "@/components/ui/mono-tag";

// Rotates daily — zero cost, deterministic, one small moment of warmth so the
// dashboard never feels purely clinical.
const DAILY_LINES = [
  "Small steps beat big plans. Open one quiz today.",
  "Ask the AI “why”, not just “what” — understanding sticks longer.",
  "Every concept you chat about today is one less surprise in the exam.",
  "Progress, not perfection. Showing up is the hard part, and you did.",
  "Revise one weak topic now while it is fresh.",
  "Consistency compounds. A little today beats a lot never.",
  "Curiosity is your best study tool. Follow one question down the rabbit hole.",
];

interface SubjectRow {
  id: string;
  name: string;
  code: string;
}

interface QuizAttemptRow {
  id: string;
  score: number;
  completed_at: string;
  mode: string;
  subject_ids: string[];
}

export default function StudentDashboard() {
  const [subjects, setSubjects] = useState<SubjectRow[]>([]);
  const [recentAttempts, setRecentAttempts] = useState<QuizAttemptRow[]>([]);
  const [attemptSubjectNames, setAttemptSubjectNames] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [tipDismissed, setTipDismissed] = useState(true);

  // Dismissible tip: remembered per-browser so it never nags after the first read.
  useEffect(() => {
    setTipDismissed(localStorage.getItem("dash_tip_dismissed") === "1");
  }, []);
  const dismissTip = () => {
    localStorage.setItem("dash_tip_dismissed", "1");
    setTipDismissed(true);
  };

  const dailyLine = useMemo(
    () => DAILY_LINES[new Date().getDate() % DAILY_LINES.length],
    []
  );

  const { profile, userId, isLoading: isLoadingUser } = useCurrentUser();
  const {
    attempts: placementHistory,
    isLoading: isLoadingPlacementHistory,
    error: placementHistoryError,
  } = usePlacementHistory(3);

  useEffect(() => {
    const run = async () => {
      try {
        if (isLoadingUser || isLoadingPlacementHistory) {
          return;
        }

        const supabase = createBrowserClient();
        if (!userId) {
          setIsLoading(false);
          return;
        }

        // 2. Subjects for full branch (all semesters). Resolved via
        // subject_offerings — a subject's content can be offered under multiple
        // branches, so branch lives on the offering, not the subjects row itself.
        if (profile?.branch) {
          const { data: offeringRows } = await supabase
            .from("subject_offerings")
            .select("subject:subjects(id, name, code)")
            .eq("branch", profile.branch);

          // Dedupe by subject id — the same content can have multiple offerings
          // (different semesters) within one branch — before slicing to a preview.
          type OfferingRow = { subject: SubjectRow | null };
          const seen = new Set<string>();
          const rows: SubjectRow[] = [];
          for (const r of (offeringRows ?? []) as unknown as OfferingRow[]) {
            if (!r.subject || seen.has(r.subject.id)) continue;
            seen.add(r.subject.id);
            rows.push(r.subject);
            if (rows.length >= 6) break;
          }
          setSubjects(rows);
        }

        // 3. Recent quiz sessions (quiz_attempts/quizzes are dead v1 tables —
        // the assessment engine writes quiz_sessions instead).
        const { data: attemptRows } = await supabase
          .from("quiz_sessions")
          .select("id, score, completed_at, mode, subject_ids")
          .eq("student_id", userId)
          .eq("status", "completed")
          .order("completed_at", { ascending: false })
          .limit(3);

        const attempts = (attemptRows ?? []) as QuizAttemptRow[];
        setRecentAttempts(attempts);

        const attemptSubjectIds = [
          ...new Set(attempts.flatMap((a) => a.subject_ids ?? [])),
        ];
        if (attemptSubjectIds.length > 0) {
          const { data: subjRows } = await supabase
            .from("subjects")
            .select("id, name")
            .in("id", attemptSubjectIds);
          const map: Record<string, string> = {};
          for (const row of (subjRows ?? []) as Array<{ id: string; name: string }>) {
            map[row.id] = row.name;
          }
          setAttemptSubjectNames(map);
        } else {
          setAttemptSubjectNames({});
        }
      } catch (err) {
        console.error("[student/dashboard] load error:", err);
      } finally {
        setIsLoading(false);
      }
    };

    run();
  }, [isLoadingUser, isLoadingPlacementHistory, userId, profile?.branch]);

  const firstName = useMemo(() => {
    if (!profile?.full_name) return "Student";
    const parts = profile.full_name.trim().split(" ");
    return parts[0] || "Student";
  }, [profile]);

  const quizAverage = useMemo(() => {
    if (!recentAttempts.length) return null;
    const total = recentAttempts.reduce((sum, a) => sum + (a.score ?? 0), 0);
    return Math.round((total / recentAttempts.length) * 10) / 10;
  }, [recentAttempts]);

  const bestPlacementScore = useMemo(() => {
    if (!placementHistory.length) return null;
    return Math.max(...placementHistory.map((a) => a.recent_accuracy ?? 0));
  }, [placementHistory]);

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });

  return (
    <div className="space-y-8">
      {/* HEADER */}
      <div>
        <h1 className="font-plex-serif text-display-sm font-semibold text-ink">
          Welcome back, {firstName}
        </h1>
        <p className="mt-1 font-plex-sans text-body-sm text-ink-500">
          {profile?.branch
            ? `${profile.branch} Branch`
            : "Branch not set"}
          {" · "}
          Semester {profile?.semester ?? "—"}
        </p>
        <p className="mt-1 font-plex-sans text-body-sm text-ink-400">{dailyLine}</p>
      </div>

      {/* DISMISSIBLE TIP — placed up top where it is actually seen */}
      {!tipDismissed && (
        <div className="flex items-start gap-3 rounded-8 border border-ochre bg-paper px-4 py-3">
          <p className="flex-1 font-plex-sans text-body-sm text-ink-700">
            Use the AI Chat to understand a concept, then take a Quiz to lock it
            in. That loop is how scores climb fastest.
          </p>
          <button
            type="button"
            onClick={dismissTip}
            aria-label="Dismiss tip"
            className="-mr-1 rounded-4 p-1 text-ink-500 transition-colors duration-180 ease-out hover:bg-ink-50 hover:text-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-900"
          >
            <X className="size-4" />
          </button>
        </div>
      )}

      {/* QUICK STATS */}
      <div className="grid gap-4 md:grid-cols-4">
        <div className="rounded-8 border border-ink-200 bg-paper p-4">
          <div className="flex items-center justify-between">
            <p className="font-plex-sans text-label font-semibold uppercase tracking-[0.04em] text-ink-500">
              Subjects
            </p>
            <BookOpen className="size-5 text-ink-400" />
          </div>
          <div className="mt-2 font-plex-serif text-display-sm font-semibold text-ink">
            {isLoading ? "—" : subjects.length}
          </div>
          <p className="mt-1 font-plex-sans text-body-sm text-ink-500">
            Available to study
          </p>
        </div>

        <div className="rounded-8 border border-ink-200 bg-paper p-4">
          <div className="flex items-center justify-between">
            <p className="font-plex-sans text-label font-semibold uppercase tracking-[0.04em] text-ink-500">
              Quiz Average
            </p>
            <Brain className="size-5 text-mastery-green" />
          </div>
          <div className="mt-2 font-plex-serif text-display-sm font-semibold text-ink">
            {isLoading
              ? "—"
              : quizAverage != null
              ? `${quizAverage}%`
              : "No quizzes yet"}
          </div>
          <p className="mt-1 font-plex-sans text-body-sm text-ink-500">
            Based on your last 3 quizzes
          </p>
        </div>

        <Link
          href="/student/chat"
          className="group rounded-8 border border-ochre bg-paper p-4 transition-colors duration-180 ease-out hover:bg-ink-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-900"
        >
          <div className="flex items-center justify-between">
            <p className="font-plex-sans text-label font-semibold uppercase tracking-[0.04em] text-ink-900">
              AI Tutor
            </p>
            <MessageSquare className="size-5 text-ochre" />
          </div>
          <div className="mt-2 flex items-center gap-1 font-plex-serif text-display-sm font-semibold text-ink-900">
            Ask anything
            <ChevronRight className="size-5 text-ochre transition-transform duration-180 ease-out group-hover:translate-x-0.5" />
          </div>
          <p className="mt-1 font-plex-sans text-body-sm text-ink-600">
            Syllabus-locked help, available now
          </p>
        </Link>

        <div className="rounded-8 border border-ink-200 bg-paper p-4">
          <div className="flex items-center justify-between">
            <p className="font-plex-sans text-label font-semibold uppercase tracking-[0.04em] text-ink-500">
              Best Placement Score
            </p>
            <Target className="size-5 text-ink-400" />
          </div>
          <div className="mt-2 font-plex-serif text-display-sm font-semibold text-ink">
            {isLoading
              ? "—"
              : placementHistoryError
                ? "Unavailable"
                : bestPlacementScore != null
                  ? `${Math.round(bestPlacementScore)}%`
                  : "Not started"}
          </div>
          <p className="mt-1 font-plex-sans text-body-sm text-ink-500">
            {placementHistoryError
              ? "Couldn't load placement data"
              : "Latest placement readiness peak"}
          </p>
        </div>
      </div>

      {/* YOUR SUBJECTS */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-plex-serif text-display-sm font-semibold text-ink">Your Subjects</h2>
          <Link
            href="/student/subjects"
            className="flex h-11 items-center gap-1 rounded-4 px-2 font-plex-sans text-body-sm font-medium text-ink-600 transition-colors duration-180 ease-out hover:text-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-900"
          >
            View all
            <ChevronRight className="size-4" />
          </Link>
        </div>

        {isLoading ? (
          <p className="font-plex-sans text-body-sm text-ink-500">Loading subjects...</p>
        ) : subjects.length === 0 ? (
          <div className="rounded-8 border border-ink-200 bg-paper p-4">
            <p className="font-plex-sans text-body-sm font-medium text-ink">
              No subjects found
            </p>
            <p className="mt-1 font-plex-sans text-body-sm text-ink-500">
              No subjects found for your branch and semester. Please contact
              your admin.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {subjects.map((s) => (
              <div
                key={s.id}
                className="flex flex-col justify-between gap-3 rounded-8 border border-ink-200 bg-paper p-4"
              >
                <div className="space-y-2">
                  <MonoTag>{s.code}</MonoTag>
                  <p className="font-plex-sans text-body-sm font-semibold text-ink">
                    {s.name}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Link
                    href={`/student/chat/${s.id}`}
                    className="flex h-11 flex-1 items-center justify-center rounded-8 bg-ink px-3 font-plex-sans text-body-sm font-medium text-paper transition-colors duration-180 ease-out hover:bg-ink-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-900 focus-visible:ring-offset-2"
                  >
                    Chat
                  </Link>
                  <Link
                    href={`/student/quiz?subjectId=${s.id}`}
                    className="flex h-11 flex-1 items-center justify-center rounded-8 border border-ink-200 px-3 font-plex-sans text-body-sm font-medium text-ink-700 transition-colors duration-180 ease-out hover:border-ink-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-900 focus-visible:ring-offset-2"
                  >
                    Quiz
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* PLACEMENT READINESS */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-plex-serif text-display-sm font-semibold text-ink">Placement Readiness</h2>
          <Link
            href="/student/placement"
            className="flex h-11 items-center gap-1 rounded-4 px-2 font-plex-sans text-body-sm font-medium text-ink-600 transition-colors duration-180 ease-out hover:text-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-900"
          >
            View all
            <ChevronRight className="size-4" />
          </Link>
        </div>

        {isLoading ? (
          <p className="font-plex-sans text-body-sm text-ink-500">Loading placement stats...</p>
        ) : placementHistoryError ? (
          <div className="flex items-center gap-2 rounded-8 border border-ink-200 bg-paper p-4">
            <Target className="size-5 text-ink-400" />
            <p className="font-plex-sans text-body-sm font-medium text-ink">
              Couldn&apos;t load your placement readiness right now
            </p>
          </div>
        ) : placementHistory.length === 0 ? (
          <div className="rounded-8 border border-ink-200 bg-paper p-4">
            <div className="flex items-center gap-2">
              <Target className="size-5 text-ochre" />
              <p className="font-plex-sans text-body-sm font-medium text-ink">
                Start placement prep to see your readiness score
              </p>
            </div>
            <Link
              href="/student/placement"
              className="mt-3 inline-flex h-11 items-center gap-1.5 rounded-8 bg-ink px-4 font-plex-sans text-body-sm font-medium text-paper transition-colors duration-180 ease-out hover:bg-ink-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-900 focus-visible:ring-offset-2"
            >
              Practice Now
              <ChevronRight className="size-4" />
            </Link>
          </div>
        ) : (
          <div className="rounded-8 border border-ink-200 bg-paper">
            <div className="divide-y divide-ink-100">
              {placementHistory.map((row) => {
                const score = row.recent_accuracy ?? 0;
                const trackLabel =
                  row.track.charAt(0).toUpperCase() + row.track.slice(1);
                return (
                  <div
                    key={row.id}
                    className="flex items-center justify-between px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-plex-sans text-body-sm font-medium text-ink">
                        {trackLabel} · {row.topic}
                      </p>
                      <p className="font-plex-sans text-xs text-ink-500">
                        {row.last_practiced_at
                          ? formatDate(row.last_practiced_at)
                          : "—"}
                      </p>
                    </div>
                    <span
                      className={cn(
                        "ml-3 shrink-0 rounded-full px-2.5 py-0.5 font-plex-mono text-xs font-semibold tabular-nums",
                        scoreStyles(score).badge
                      )}
                    >
                      {score.toFixed(1)}%
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* RECENT QUIZ ACTIVITY */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-plex-serif text-display-sm font-semibold text-ink">Recent Quiz Results</h2>
          <Link
            href="/student/quiz"
            className="flex h-11 items-center gap-1 rounded-4 px-2 font-plex-sans text-body-sm font-medium text-ink-600 transition-colors duration-180 ease-out hover:text-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-900"
          >
            Take a Quiz
            <ChevronRight className="size-4" />
          </Link>
        </div>

        {isLoading ? (
          <p className="font-plex-sans text-body-sm text-ink-500">Loading quizzes...</p>
        ) : recentAttempts.length === 0 ? (
          <div className="rounded-8 border border-ink-200 bg-paper p-4">
            <div className="flex items-center gap-2">
              <Brain className="size-5 text-ochre" />
              <p className="font-plex-sans text-body-sm font-medium text-ink">
                No quizzes taken yet
              </p>
            </div>
            <p className="mt-2 font-plex-sans text-body-sm text-ink-500">
              Start with a quick quiz to check your understanding.
            </p>
            <Link
              href="/student/quiz"
              className="mt-3 inline-flex h-11 items-center gap-1.5 rounded-8 bg-ink px-4 font-plex-sans text-body-sm font-medium text-paper transition-colors duration-180 ease-out hover:bg-ink-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-900 focus-visible:ring-offset-2"
            >
              Take a Quiz
              <ChevronRight className="size-4" />
            </Link>
          </div>
        ) : (
          <div className="rounded-8 border border-ink-200 bg-paper">
            <div className="divide-y divide-ink-100">
              {recentAttempts.map((attempt) => {
                const subjectName = attemptSubjectNames[attempt.subject_ids?.[0]] ?? "";
                const modeLabel = attempt.mode.replace("_", " ");
                const title = subjectName ? `${modeLabel} · ${subjectName}` : modeLabel;
                const score = attempt.score ?? 0;
                return (
                  <div
                    key={attempt.id}
                    className="flex items-center justify-between px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-plex-sans text-body-sm font-medium capitalize text-ink">{title}</p>
                      <p className="font-plex-sans text-xs text-ink-500">
                        {formatDate(attempt.completed_at)}
                      </p>
                    </div>
                    <span
                      className={cn(
                        "ml-3 shrink-0 rounded-full px-2.5 py-0.5 font-plex-mono text-xs font-semibold tabular-nums",
                        scoreStyles(score).badge
                      )}
                    >
                      {score.toFixed(1)}%
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

    </div>
  );
}

