"use client";

/**
 * /student/quiz/session/[sessionId] — the taking-a-quiz experience.
 *
 * This file is a LOADER AND A SWITCH, nothing else: fetch the session, decide
 * which runner it needs, hand off. The two runners (PracticeRunner for
 * quick/mastery, ExamRunner for exam_sim) are genuinely different experiences —
 * immediate feedback with a reveal in place vs. a deferred-feedback timed paper
 * — and forcing them into one component would produce a file that is a chain of
 * `mode === 'exam_sim'` branches around every interaction.
 *
 * Resume is free: GET /api/assessment/session/[id] returns the questions stored
 * at plan time, so a refresh mid-quiz costs no generation and burns no bank
 * questions (CP-Q2 §4). Answers already persisted by /api/assessment/answer are
 * NOT rehydrated into the UI — see the note in the load effect.
 *
 * The legacy taking-a-quiz path (/student/quiz/legacy) is untouched.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { createBrowserClient } from "@/lib/db/supabase-browser";
import ExamRunner from "./_components/ExamRunner";
import PracticeRunner from "./_components/PracticeRunner";
import type { SessionPayload } from "./_components/types";

export default function QuizSessionPage() {
  const params = useParams<{ sessionId: string }>();
  const router = useRouter();
  const sessionId = String(params?.sessionId ?? "");

  const [session, setSession] = useState<SessionPayload | null>(null);
  const [subjectNames, setSubjectNames] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // ── load ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!sessionId) return;
    const run = async () => {
      try {
        const res = await fetch(`/api/assessment/session/${sessionId}`);
        const json = await res.json().catch(() => null);
        if (!mounted.current) return;
        if (!res.ok || !json) {
          setError(json?.error ?? "Could not load this session.");
          return;
        }
        const payload = json as SessionPayload;

        // A completed session has nothing to take — send the student to the
        // results they actually want. Replace, not push, so Back doesn't
        // bounce them into a finished quiz.
        if (payload.status === "completed") {
          router.replace(`/student/quiz/results/${sessionId}`);
          return;
        }
        if (payload.status === "abandoned") {
          setError(
            "This session was closed after being idle. Your answers were kept — start a fresh one when you're ready."
          );
          return;
        }
        setSession(payload);
      } catch {
        if (mounted.current) setError("Could not load this session.");
      } finally {
        if (mounted.current) setLoading(false);
      }
    };
    void run();
  }, [sessionId, router]);

  // Subject names for the exam-sim section navigator. Read with the browser
  // client: `subjects` is public-read, and this is display-only text.
  useEffect(() => {
    const ids = session?.subjectIds ?? [];
    if (ids.length === 0) return;
    const run = async () => {
      const supabase = createBrowserClient();
      const { data } = await supabase
        .from("subjects")
        .select("id, name, code")
        .in("id", ids);
      if (!mounted.current || !data) return;
      setSubjectNames(
        Object.fromEntries(
          (data as Array<{ id: string; name: string; code: string }>).map((s) => [
            s.id,
            s.code,
          ])
        )
      );
    };
    void run();
  }, [session?.subjectIds]);

  const onSubmitted = useCallback(
    (id: string) => {
      // replace(): the session is closed, so Back must not return to it.
      router.replace(`/student/quiz/results/${id}`);
    },
    [router]
  );

  if (loading) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (error || !session) {
    return (
      <div className="mx-auto max-w-md space-y-4 text-center">
        {/* Amber, never red (§16). */}
        <p className="text-sm text-amber-600 dark:text-amber-500">
          {error ?? "Session unavailable."}
        </p>
        <Button asChild variant="outline" size="sm">
          <Link href="/student/quiz">
            <ArrowLeft className="mr-1.5 size-4" />
            Back to practice
          </Link>
        </Button>
      </div>
    );
  }

  return session.mode === "exam_sim" ? (
    <ExamRunner
      session={session}
      subjectNames={subjectNames}
      onSubmitted={onSubmitted}
    />
  ) : (
    <PracticeRunner session={session} onSubmitted={onSubmitted} />
  );
}
