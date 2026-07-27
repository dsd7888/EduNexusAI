"use client";

/**
 * /student/quiz/results/[sessionId] (CP-Q3 Part 5A).
 *
 * Both mode runners router.replace() here on submit — this closes the 404 that
 * existed since Part 4 shipped. Single fetch to
 * GET /api/assessment/results/[sessionId], which is a real server route (not a
 * client-side reconstruction) so this page survives a refresh.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import MasteryDeltaBars from "./_components/MasteryDeltaBars";
import QuestionReview from "./_components/QuestionReview";
import ResultCtas from "./_components/ResultCtas";
import ScoreSummaryCard from "./_components/ScoreSummaryCard";
import SectionalBreakdown from "./_components/SectionalBreakdown";
import type { ResultsPayload } from "./_components/types";

export default function ResultsPage() {
  const params = useParams<{ sessionId: string }>();
  const sessionId = String(params?.sessionId ?? "");
  const [results, setResults] = useState<ResultsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!sessionId) return;
    const run = async () => {
      try {
        const res = await fetch(`/api/assessment/results/${sessionId}`);
        const json = await res.json().catch(() => null);
        if (!mounted.current) return;
        if (!res.ok || !json) {
          setError(json?.error ?? "Could not load your results.");
          return;
        }
        setResults(json as ResultsPayload);
      } catch {
        if (mounted.current) setError("Network problem loading your results.");
      } finally {
        if (mounted.current) setLoading(false);
      }
    };
    void run();
  }, [sessionId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !results) {
    return (
      <div className="mx-auto max-w-md space-y-4 py-16 text-center">
        <p className="text-sm text-amber-600 dark:text-amber-500">
          {error ?? "Could not load your results."}
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

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <ScoreSummaryCard results={results} />

      {results.masteryDeltas && results.masteryDeltas.length > 0 ? (
        <MasteryDeltaBars deltas={results.masteryDeltas} />
      ) : null}

      {results.sectionalBreakdown && results.sectionalBreakdown.length > 0 ? (
        <SectionalBreakdown
          sections={results.sectionalBreakdown}
          negativeMarkingImpact={results.negativeMarkingImpact}
        />
      ) : null}

      <QuestionReview sessionId={results.sessionId} results={results.perQuestionResults} />

      <ResultCtas results={results} />
    </div>
  );
}
