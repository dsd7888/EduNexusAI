"use client";

/**
 * /student/quiz/start — the generating step between the landing and a session.
 *
 * Why this is its own route rather than a spinner on the landing: session
 * creation is a 10–60 second AI call (batched generation plus a verifier pass
 * per NAT item), and the student must be able to refresh, understand what is
 * happening, and see a real error if it fails. A modal over the landing would
 * lose all three on the first refresh.
 *
 * Fires EXACTLY ONCE per mount. `startedRef` guards React's double-invoked
 * effects in development and any re-render — a duplicate call here costs real
 * money and burns the student's daily quota.
 */

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";

type ModeKey = "quick" | "mastery" | "exam_sim";

const ROUTE: Record<ModeKey, string> = {
  quick: "/api/assessment/quick",
  mastery: "/api/assessment/mastery",
  exam_sim: "/api/assessment/exam-sim",
};

const MODE_LABEL: Record<ModeKey, string> = {
  quick: "Quick Check",
  mastery: "Module Mastery",
  exam_sim: "Exam Simulation",
};

/** Cycled while the request is in flight, so the wait has texture. */
const HINTS = [
  "Choosing questions across your modules by syllabus weightage…",
  "Checking the question bank before generating anything new…",
  "Writing fresh questions for the slots the bank couldn't fill…",
  "Independently verifying every numerical answer…",
];

function StartInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const mode = (searchParams.get("mode") ?? "quick") as ModeKey;
  const subjectIds = (searchParams.get("subjectIds") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const moduleIds = (searchParams.get("moduleIds") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const preset = searchParams.get("preset");
  const questionCount = searchParams.get("count");

  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [hint, setHint] = useState(0);
  const startedRef = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const id = setInterval(() => setHint((h) => (h + 1) % HINTS.length), 3500);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (startedRef.current) return;
    if (!ROUTE[mode]) {
      setError("Unknown practice mode.");
      return;
    }
    if (subjectIds.length === 0) {
      setError("Pick at least one subject first.");
      return;
    }
    startedRef.current = true;

    const run = async () => {
      try {
        const res = await fetch(ROUTE[mode], {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            subjectIds,
            ...(moduleIds.length > 0 ? { moduleIds } : {}),
            ...(preset ? { preset } : {}),
            ...(questionCount ? { questionCount: Number(questionCount) } : {}),
          }),
        });
        const json = await res.json().catch(() => null);
        if (!mounted.current) return;
        if (!res.ok || !json?.sessionId) {
          setError(
            json?.error ??
              "Could not build a session for that selection. Try a different subject or a smaller question count."
          );
          // Allow a retry: the request definitively failed, so re-firing is
          // not a duplicate.
          startedRef.current = false;
          return;
        }
        if (Array.isArray(json.warnings) && json.warnings.length > 0) {
          setWarnings(json.warnings.map(String));
        }
        // replace(): Back from the session must return to the landing, never to
        // this route, which would fire a second generation.
        router.replace(`/student/quiz/session/${json.sessionId}`);
      } catch {
        if (mounted.current) {
          setError("Network problem. Nothing was charged — try again.");
          startedRef.current = false;
        }
      }
    };
    void run();
    // Intentionally keyed on the parsed params only — re-running this effect on
    // any other change would re-trigger generation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, searchParams]);

  if (error) {
    return (
      <div className="mx-auto max-w-md space-y-4 text-center">
        {/* Amber, never red (§16). */}
        <p className="text-sm text-amber-600 dark:text-amber-500">{error}</p>
        <Button asChild variant="outline" size="sm">
          <Link href="/student/quiz">
            <ArrowLeft className="mr-1.5 size-4" />
            Back to practice
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-16 text-center">
      <Loader2 className="size-8 animate-spin text-primary" />
      <div>
        <p className="font-medium">Building your {MODE_LABEL[mode] ?? "session"}</p>
        <p className="mt-1 min-h-[2.5rem] text-sm text-muted-foreground">
          {HINTS[hint]}
        </p>
      </div>
      {warnings.length > 0 ? (
        <ul className="space-y-1 text-xs text-amber-600 dark:text-amber-500">
          {warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export default function QuizStartPage() {
  return (
    <Suspense fallback={null}>
      <StartInner />
    </Suspense>
  );
}
