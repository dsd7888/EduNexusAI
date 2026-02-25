"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BookOpen, Brain, ChevronRight, MessageSquare } from "lucide-react";

import { createBrowserClient } from "@/lib/db/supabase-browser";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface Profile {
  full_name: string | null;
  branch: string | null;
  semester: number | null;
}

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
  const [profile, setProfile] = useState<Profile | null>(null);
  const [subjects, setSubjects] = useState<SubjectRow[]>([]);
  const [recentAttempts, setRecentAttempts] = useState<QuizAttemptRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const run = async () => {
      try {
        const supabase = createBrowserClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
          setIsLoading(false);
          return;
        }

        // 1. Profile
        const { data: profileRow } = await supabase
          .from("profiles")
          .select("full_name, branch, semester")
          .eq("id", user.id)
          .single();

        const profileData: Profile = {
          full_name: profileRow?.full_name ?? null,
          branch: profileRow?.branch ?? null,
          semester: profileRow?.semester ?? null,
        };
        setProfile(profileData);

        // 2. Subjects for branch+semester
        if (profileData.branch && profileData.semester != null) {
          const { data: subjectRows } = await supabase
            .from("subjects")
            .select("id, name, code")
            .eq("branch", profileData.branch)
            .eq("semester", profileData.semester)
            .limit(6);

          setSubjects((subjectRows ?? []) as SubjectRow[]);
        }

        // 3. Recent quiz attempts
        const { data: attemptRows } = await supabase
          .from("quiz_attempts")
          .select("score, created_at, quizzes(title)")
          .eq("student_id", user.id)
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
  }, []);

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

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });

  const scoreBadgeVariant = (
    score: number
  ): "default" | "secondary" | "destructive" => {
    if (score >= 80) return "default";
    if (score >= 60) return "secondary";
    return "destructive";
  };

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
      </div>

      {/* QUICK STATS */}
      <div className="grid gap-4 md:grid-cols-3">
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

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              AI Tutor
            </CardTitle>
            <MessageSquare className="size-5 text-sky-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">Always on</div>
            <p className="text-xs text-muted-foreground">
              Ask anything about your syllabus
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
                const variant = scoreBadgeVariant(score);
                return (
                  <div
                    // eslint-disable-next-line react/no-array-index-key
                    key={idx}
                    className="flex items-center justify-between px-6 py-3 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">{title}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(attempt.created_at)}
                      </p>
                    </div>
                    <Badge variant={variant} className="ml-3 shrink-0">
                      {score.toFixed(1)}%
                    </Badge>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}
      </div>

      {/* QUICK TIP */}
      <Card className="border-amber-200 bg-amber-50/60">
        <CardContent className="flex items-start gap-3 py-4 text-sm">
          <span className="mt-0.5">💡</span>
          <p className="text-amber-900">
            Tip: Use the AI Chat to understand concepts, then test yourself
            with a Quiz to check your understanding.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

