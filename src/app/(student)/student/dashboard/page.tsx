"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BookOpen, Brain, ChevronRight, MessageSquare, Target, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { scoreStyles } from "@/lib/ui/score";
import { createBrowserClient } from "@/lib/db/supabase-browser";
import { useCurrentUser, usePlacementHistory } from "@/hooks/useSupabaseData";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

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
  score: number;
  created_at: string;
  // Supabase join; can be object or array depending on relationship typing
  quizzes: any;
}

export default function StudentDashboard() {
  const [subjects, setSubjects] = useState<SubjectRow[]>([]);
  const [recentAttempts, setRecentAttempts] = useState<QuizAttemptRow[]>([]);
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
  const { attempts: placementHistory, isLoading: isLoadingPlacementHistory } =
    usePlacementHistory(3);
  const [companyNameById, setCompanyNameById] = useState<Record<string, string>>(
    {}
  );

  const placementAttempts = useMemo(
    () =>
      (placementHistory ?? []).map((a) => ({
        ...a,
        placement_companies: {
          name: companyNameById[a.company_id] ?? "Unknown Company",
        },
      })),
    [placementHistory, companyNameById]
  );

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

        // 3. Recent quiz attempts
        const { data: attemptRows } = await supabase
          .from("quiz_attempts")
          .select("score, created_at, quizzes(title)")
          .eq("student_id", userId)
          .order("created_at", { ascending: false })
          .limit(3);

        setRecentAttempts((attemptRows ?? []) as QuizAttemptRow[]);
      } catch (err) {
        console.error("[student/dashboard] load error:", err);
      } finally {
        setIsLoading(false);
      }
    };

    run();
  }, [isLoadingUser, isLoadingPlacementHistory, userId, profile?.branch]);

  useEffect(() => {
    const run = async () => {
      const ids = [...new Set((placementHistory ?? []).map((a) => a.company_id))].filter(
        Boolean
      ) as string[];
      if (ids.length === 0) {
        setCompanyNameById({});
        return;
      }
      try {
        const supabase = createBrowserClient();
        const { data } = await supabase
          .from("placement_companies")
          .select("id, name")
          .in("id", ids);
        const map: Record<string, string> = {};
        for (const row of data ?? []) {
          const id = String((row as any)?.id ?? "");
          const name = String((row as any)?.name ?? "");
          if (id) map[id] = name;
        }
        setCompanyNameById(map);
      } catch {
        setCompanyNameById({});
      }
    };
    run();
  }, [placementHistory]);

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
    if (!placementAttempts.length) return null;
    return Math.max(...placementAttempts.map((a) => a.score ?? 0));
  }, [placementAttempts]);

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
        <h1 className="text-2xl font-bold tracking-tight">
          Welcome back, {firstName} 👋
        </h1>
        <p className="text-sm text-muted-foreground">
          {profile?.branch
            ? `${profile.branch} Branch`
            : "Branch not set"}
          {" · "}
          Semester {profile?.semester ?? "—"}
        </p>
        <p className="mt-1 text-sm text-muted-foreground/90">{dailyLine}</p>
      </div>

      {/* DISMISSIBLE TIP — placed up top where it is actually seen */}
      {!tipDismissed && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50/60 px-4 py-3 text-sm">
          <span className="mt-0.5">💡</span>
          <p className="flex-1 text-amber-900">
            Use the AI Chat to understand a concept, then take a Quiz to lock it
            in. That loop is how scores climb fastest.
          </p>
          <button
            type="button"
            onClick={dismissTip}
            aria-label="Dismiss tip"
            className="-mr-1 rounded-md p-1 text-amber-700/70 transition-colors hover:bg-amber-100 hover:text-amber-900"
          >
            <X className="size-4" />
          </button>
        </div>
      )}

      {/* QUICK STATS */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              Subjects
            </CardTitle>
            <BookOpen className="size-5 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">
              {isLoading ? "—" : subjects.length}
            </div>
            <p className="text-xs text-muted-foreground">
              Available to study
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              Quiz Average
            </CardTitle>
            <Brain className="size-5 text-emerald-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">
              {isLoading
                ? "—"
                : quizAverage != null
                ? `${quizAverage}%`
                : "No quizzes yet"}
            </div>
            <p className="text-xs text-muted-foreground">
              Based on your last 3 quizzes
            </p>
          </CardContent>
        </Card>

        <Link href="/student/chat" className="group">
          <Card className="h-full border-sky-200 bg-sky-50/50 transition-colors group-hover:border-sky-300 group-hover:bg-sky-50">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-xs font-medium text-sky-700">
                AI Tutor
              </CardTitle>
              <MessageSquare className="size-5 text-sky-500" />
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-1 text-2xl font-semibold text-sky-900">
                Ask anything
                <ChevronRight className="size-5 translate-x-0 text-sky-500 transition-transform group-hover:translate-x-0.5" />
              </div>
              <p className="text-xs text-sky-700/80">
                Syllabus-locked help, available now
              </p>
            </CardContent>
          </Card>
        </Link>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              Best Placement Score
            </CardTitle>
            <Target className="size-5 text-purple-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">
              {isLoading
                ? "—"
                : bestPlacementScore != null
                  ? `${bestPlacementScore}%`
                  : "Not started"}
            </div>
            <p className="text-xs text-muted-foreground">
              Latest placement readiness peak
            </p>
          </CardContent>
        </Card>
      </div>

      {/* YOUR SUBJECTS */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Your Subjects</h2>
          <Button asChild variant="ghost" size="sm">
            <Link href="/student/subjects">
              View all
              <ChevronRight className="ml-1 size-4" />
            </Link>
          </Button>
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading subjects...</p>
        ) : subjects.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">
                No subjects found
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                No subjects found for your branch and semester. Please contact
                your admin.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {subjects.map((s) => (
              <Card
                key={s.id}
                className="flex flex-col justify-between border-border/80"
              >
                <CardHeader className="space-y-2">
                  <Badge variant="secondary" className="w-fit">
                    {s.code}
                  </Badge>
                  <CardTitle className="text-sm font-semibold">
                    {s.name}
                  </CardTitle>
                </CardHeader>
                <CardFooter className="flex gap-2 px-6 pb-4">
                  <Button asChild size="sm" className="flex-1">
                    <Link href={`/student/chat/${s.id}`}>Chat</Link>
                  </Button>
                  <Button
                    asChild
                    size="sm"
                    variant="outline"
                    className="flex-1"
                  >
                    <Link href={`/student/quiz?subjectId=${s.id}`}>Quiz</Link>
                  </Button>
                </CardFooter>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* PLACEMENT READINESS */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Placement Readiness</h2>
          <Button asChild variant="ghost" size="sm">
            <Link href="/student/placement">
              View All
              <ChevronRight className="ml-1 size-4" />
            </Link>
          </Button>
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading placement stats...</p>
        ) : placementAttempts.length === 0 ? (
          <Card>
            <CardHeader className="flex flex-row items-center gap-2">
              <Target className="size-5 text-primary" />
              <CardTitle className="text-sm font-medium">
                Start placement prep to see your readiness score
              </CardTitle>
            </CardHeader>
            <CardFooter>
              <Button asChild size="sm">
                <Link href="/student/placement">
                  Practice Now
                  <ChevronRight className="ml-1 size-4" />
                </Link>
              </Button>
            </CardFooter>
          </Card>
        ) : (
          <Card>
            <CardContent className="divide-y px-0">
              {placementAttempts.map((attempt, idx) => {
                const companyRel = attempt.placement_companies;
                const companyName =
                  (Array.isArray(companyRel)
                    ? companyRel[0]?.name
                    : companyRel?.name) ?? "Unknown Company";
                const score = attempt.score ?? 0;
                return (
                  <div
                    key={idx}
                    className="flex items-center justify-between px-6 py-3 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">{companyName}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(attempt.created_at)}
                      </p>
                    </div>
                    <span
                      className={cn(
                        "ml-3 shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold tabular-nums",
                        scoreStyles(score).badge
                      )}
                    >
                      {score.toFixed(1)}%
                    </span>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}
      </div>

      {/* RECENT QUIZ ACTIVITY */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Recent Quiz Results</h2>
          <Button asChild variant="ghost" size="sm">
            <Link href="/student/quiz">
              Take a Quiz
              <ChevronRight className="ml-1 size-4" />
            </Link>
          </Button>
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading quizzes...</p>
        ) : recentAttempts.length === 0 ? (
          <Card>
            <CardHeader className="flex flex-row items-center gap-2">
              <Brain className="size-5 text-primary" />
              <CardTitle className="text-sm font-medium">
                No quizzes taken yet
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Start with a quick quiz to check your understanding.
              </p>
            </CardContent>
            <CardFooter>
              <Button asChild size="sm">
                <Link href="/student/quiz">
                  Take a Quiz
                  <ChevronRight className="ml-1 size-4" />
                </Link>
              </Button>
            </CardFooter>
          </Card>
        ) : (
          <Card>
            <CardContent className="divide-y px-0">
              {recentAttempts.map((attempt, idx) => {
                const quizRel = attempt.quizzes;
                const title =
                  (Array.isArray(quizRel)
                    ? quizRel[0]?.title
                    : quizRel?.title) ?? "Untitled Quiz";
                const score = attempt.score ?? 0;
                return (
                  <div
                    key={idx}
                    className="flex items-center justify-between px-6 py-3 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">{title}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(attempt.created_at)}
                      </p>
                    </div>
                    <span
                      className={cn(
                        "ml-3 shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold tabular-nums",
                        scoreStyles(score).badge
                      )}
                    >
                      {score.toFixed(1)}%
                    </span>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}
      </div>

    </div>
  );
}

