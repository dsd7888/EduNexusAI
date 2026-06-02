"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { BookOpen, Clock, History, Info, Target } from "lucide-react";
import * as LucideIcons from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScoreMeter } from "@/components/ui/score-meter";
import { cn } from "@/lib/utils";
import { scoreStyles } from "@/lib/ui/score";
import { createBrowserClient } from "@/lib/db/supabase-browser";
import type { PlacementAttempt, PlacementCompany } from "@/lib/db/types";
import { getModulesForBranch, groupModulesByCategory } from "@/lib/placement/modules";
import { usePlacementHistory } from "@/hooks/useSupabaseData";

type AttemptWithCompany = PlacementAttempt & {
  company_name: string;
};

const CATEGORIES = ["quantitative", "logical", "verbal", "technical"] as const;

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

// Practice mastery badge — semantic colours (slate / amber / emerald, no red).
function getPracticeScoreBadgeClass(score: number): string {
  return scoreStyles(score).badge;
}

type RecentPracticeResult = {
  moduleId: string;
  moduleLabel: string;
  score: number;
  mastery: string;
  completedAt: number;
};

export default function PlacementPage() {
  const router = useRouter();
  const [companies, setCompanies] = useState<PlacementCompany[]>([]);
  const [recentAttempts, setRecentAttempts] = useState<AttemptWithCompany[]>([]);
  const [skillRadar, setSkillRadar] = useState<Record<string, number>>({});
  const [studentBranch, setStudentBranch] = useState<string | null>(null);
  const [practiceScores, setPracticeScores] = useState<Record<string, number>>(
    {}
  );
  const [isLoading, setIsLoading] = useState(true);
  const [inProgressTests, setInProgressTests] = useState<
    Array<{ companyId: string; companyName: string; answeredCount: number }>
  >([]);
  const [recentPracticeResults, setRecentPracticeResults] = useState<
    RecentPracticeResult[]
  >([]);

  const { attempts: placementHistory } = usePlacementHistory(5);

  useEffect(() => {
    const run = async () => {
      setIsLoading(true);
      try {
        const supabase = createBrowserClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
          setCompanies([]);
          setRecentAttempts([]);
          setSkillRadar({});
          setInProgressTests([]);
          return;
        }

        // 1) Fetch student profile (branch)
        const { data: profile } = await supabase
          .from("profiles")
          .select("branch")
          .eq("id", user.id)
          .single();
        const studentBranch =
          (profile as { branch?: string } | null)?.branch ?? null;
        setStudentBranch(studentBranch);

        // 2) Fetch all companies
        const { data: companyRows } = await supabase
          .from("placement_companies")
          .select("id, name, branches, aptitude_pattern, difficulty, avg_package_lpa")
          .order("name");

        const allCompanies = (companyRows ?? []) as PlacementCompany[];
        const filteredCompanies = studentBranch
          ? allCompanies.filter(
              (c) =>
                Array.isArray(c.branches) &&
                c.branches.includes(studentBranch)
            )
          : allCompanies;
        setCompanies(filteredCompanies);

        // Check for in-progress tests
        const foundInProgress: Array<{
          companyId: string;
          companyName: string;
          answeredCount: number;
        }> = [];

        for (const company of allCompanies) {
          try {
            const saved = localStorage.getItem(
              `placement_test_${company.id}`
            );
            if (saved) {
              const parsed = JSON.parse(saved);
              const ageMinutes = (Date.now() - parsed.savedAt) / 60000;
              if (ageMinutes < 60 && parsed.questions?.length > 0) {
                foundInProgress.push({
                  companyId: company.id,
                  companyName: company.name,
                  answeredCount: Object.keys(parsed.answers ?? {}).length,
                });
              }
            }
          } catch {}
        }

        setInProgressTests(foundInProgress);

        // 5) Fetch practice best scores by subcategory
        try {
          const { data: practiceData } = await supabase
            .from("practice_attempts")
            .select("subcategory, score")
            .eq("student_id", user.id);

          const next: Record<string, number> = {};
          for (const row of practiceData ?? []) {
            const subcategory = String((row as any)?.subcategory ?? "");
            const score = Number((row as any)?.score ?? 0);
            if (!subcategory) continue;
            next[subcategory] = Math.max(next[subcategory] ?? 0, score);
          }
          setPracticeScores(next);
        } catch (err) {
          console.warn("[placement] practice_attempts fetch failed:", err);
          setPracticeScores({});
        }
      } finally {
        setIsLoading(false);
      }
    };

    run();
  }, []);

  useEffect(() => {
    const companyNameById = new Map<string, string>(
      (companies ?? []).map((c) => [c.id, c.name])
    );

    const attempts = (placementHistory ?? []).map((row: any) => ({
      ...(row as PlacementAttempt),
      company_name:
        companyNameById.get(String((row as any)?.company_id ?? "")) ??
        "Unknown Company",
    })) as AttemptWithCompany[];
    setRecentAttempts(attempts);

    const radar: Record<string, number> = {};
    for (const attempt of attempts) {
      const scores = (attempt.category_scores ?? {}) as Record<string, number>;
      for (const [cat, score] of Object.entries(scores)) {
        radar[cat] = Math.max(radar[cat] ?? 0, Number(score));
      }
    }
    setSkillRadar(radar);
  }, [placementHistory, companies]);

  const hasAttempts = recentAttempts.length > 0;

  const categoryRows = useMemo(
    () =>
      CATEGORIES.map((category) => ({
        key: category,
        label: titleCase(category),
        score: skillRadar[category] ?? 0,
      })),
    [skillRadar]
  );

  // Best score per company, derived from already-loaded attempts (no new query).
  // Lets each company card show "your best so far" and a Retake CTA.
  const bestScoreByCompany = useMemo(() => {
    const map: Record<string, number> = {};
    for (const a of recentAttempts) {
      const id = String((a as { company_id?: string }).company_id ?? "");
      if (!id) continue;
      map[id] = Math.max(map[id] ?? 0, Number(a.score ?? 0));
    }
    return map;
  }, [recentAttempts]);

  const availableModules = useMemo(
    () => getModulesForBranch(studentBranch ?? ""),
    [studentBranch]
  );

  useEffect(() => {
    if (isLoading) return;

    const recent: RecentPracticeResult[] = [];
    for (const mod of availableModules) {
      try {
        const saved = localStorage.getItem(`practice_result_${mod.id}`);
        if (saved) {
          const parsed = JSON.parse(saved) as {
            completedAt?: number;
            score?: number;
            mastery?: string;
          };
          const ageHours = (Date.now() - (parsed.completedAt ?? 0)) / 3600000;
          if (ageHours < 24) {
            recent.push({
              moduleId: mod.id,
              moduleLabel: mod.label,
              score: Number(parsed.score ?? 0),
              mastery: String(parsed.mastery ?? ""),
              completedAt: Number(parsed.completedAt ?? 0),
            });
          }
        }
      } catch {}
    }

    setRecentPracticeResults(
      recent.sort((a, b) => b.completedAt - a.completedAt)
    );
  }, [isLoading, availableModules]);

  const grouped = useMemo(
    () => groupModulesByCategory(availableModules),
    [availableModules]
  );

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <Target className="size-6 shrink-0 text-primary" />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Placement Readiness
            </h1>
            <p className="text-sm text-muted-foreground">
              Prepare for campus placements with company-specific tests
            </p>
            <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
              <Info className="size-3" />
              Questions are modelled on real campus placement papers (TCS NQT,
              Infosys InfyTQ, and similar) with company-specific topic weightage
              and difficulty.
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0 self-start"
          onClick={() => router.push("/student/placement/history")}
        >
          <History className="mr-2 size-4" />
          View History
        </Button>
      </div>

      {inProgressTests.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/30">
          <div className="mb-2 flex items-center gap-2">
            <Clock className="size-4 text-amber-600" />
            <span className="text-sm font-semibold text-amber-800 dark:text-amber-200">
              Test in progress
            </span>
          </div>

          {inProgressTests.map((test) => (
            <div
              key={test.companyId}
              className="flex items-center justify-between"
            >
              <span className="text-sm text-amber-700 dark:text-amber-300">
                {test.companyName} — {test.answeredCount} questions answered
              </span>
              <Button
                size="sm"
                variant="outline"
                className="h-7 border-amber-400 text-xs text-amber-700"
                onClick={() =>
                  router.push(`/student/placement/test/${test.companyId}`)
                }
              >
                Resume →
              </Button>
            </div>
          ))}
        </div>
      )}

      <section className="space-y-3">
        <h2 className="text-base font-semibold">Your Skill Profile</h2>
        {isLoading ? (
          <Card>
            <CardContent className="p-4 text-sm text-muted-foreground">
              Loading your skill profile...
            </CardContent>
          </Card>
        ) : hasAttempts ? (
          <Card>
            <CardContent className="space-y-4 p-4">
              {/* Engagement data surfaced up top, not buried in fine print */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md bg-muted/50 px-3 py-2 text-xs">
                <span className="font-semibold text-foreground">
                  {recentAttempts.length} test
                  {recentAttempts.length !== 1 ? "s" : ""} taken
                </span>
                <span className="text-muted-foreground">
                  Last test {formatDate(recentAttempts[0].created_at)}
                </span>
              </div>
              {categoryRows.map(({ key, label, score }) => (
                // attempted=false when 0% so untried skills read as grey
                // "not started" (an invitation), never red failure.
                <ScoreMeter
                  key={key}
                  label={label}
                  score={score}
                  attempted={score > 0}
                />
              ))}
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-4 text-sm text-muted-foreground">
              Take your first test to see your skill profile
            </CardContent>
          </Card>
        )}
      </section>

      {recentPracticeResults.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Recent Practice Sessions</h3>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {recentPracticeResults.slice(0, 6).map((result) => (
              <div
                key={result.moduleId}
                role="button"
                tabIndex={0}
                className="flex cursor-pointer items-center justify-between rounded-lg border p-3 transition-colors hover:border-primary"
                onClick={() =>
                  router.push(`/student/placement/practice/${result.moduleId}`)
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    router.push(`/student/placement/practice/${result.moduleId}`);
                  }
                }}
              >
                <div>
                  <p className="text-sm font-medium">{result.moduleLabel}</p>
                  <p className="text-xs capitalize text-muted-foreground">
                    {result.mastery.replace(/_/g, " ")}
                  </p>
                </div>
                <Badge className={scoreStyles(result.score).badge}>
                  {result.score}%
                </Badge>
              </div>
            ))}
          </div>
        </div>
      )}

      <section className="space-y-3">
        <h2 className="text-base font-semibold">Choose a Company to Practice</h2>
        {isLoading ? (
          <Card>
            <CardContent className="p-4 text-sm text-muted-foreground">
              Loading companies...
            </CardContent>
          </Card>
        ) : companies.length === 0 ? (
          <Card>
            <CardContent className="p-4 text-sm text-muted-foreground">
              No companies available right now.
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {companies.map((company) => {
              const branches = Array.isArray(company.branches) ? company.branches : [];
              const visibleBranches = branches.slice(0, 3);
              const extraCount = Math.max(0, branches.length - 3);
              const pattern = company.aptitude_pattern ?? {
                quantitative: 0,
                logical: 0,
                verbal: 0,
                technical: 0,
              };

              const difficultyClass =
                company.difficulty === "easy"
                  ? "bg-green-100 text-green-700"
                  : company.difficulty === "medium"
                    ? "bg-amber-100 text-amber-700"
                    : "bg-red-100 text-red-700";

              return (
                <Card key={company.id} className="h-full">
                  <CardHeader className="space-y-2">
                    <CardTitle className="text-lg font-bold">{company.name}</CardTitle>
                    <div>
                      <Badge className={difficultyClass}>
                        {titleCase(company.difficulty)}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {company.avg_package_lpa !== null && (
                      <p className="text-sm text-muted-foreground">
                        Avg: Rs {company.avg_package_lpa}L
                      </p>
                    )}

                    <div className="flex flex-wrap gap-1.5">
                      {visibleBranches.map((branch) => (
                        <Badge key={branch} variant="outline" className="text-xs">
                          {branch}
                        </Badge>
                      ))}
                      {extraCount > 0 && (
                        <Badge variant="outline" className="text-xs">
                          +{extraCount} more
                        </Badge>
                      )}
                    </div>

                    <p className="text-xs text-muted-foreground">
                      Quant {pattern.quantitative}% · Logic {pattern.logical}% · Verbal{" "}
                      {pattern.verbal}% · Tech {pattern.technical}%
                    </p>

                    {(() => {
                      const last = bestScoreByCompany[company.id];
                      const attempted = last != null;
                      return (
                        <div className="space-y-2 pt-1">
                          {attempted && (
                            <div className="flex items-center justify-between text-xs">
                              <span className="text-muted-foreground">
                                Your best
                              </span>
                              <span
                                className={cn(
                                  "rounded-full px-2 py-0.5 font-semibold tabular-nums",
                                  scoreStyles(last).badge
                                )}
                              >
                                {Math.round(last)}%
                              </span>
                            </div>
                          )}
                          {/* Attempted companies fall back to a quieter outline
                              CTA so the grid is not a wall of identical dark
                              buttons; fresh ones stay primary to invite a try. */}
                          <Button
                            variant={attempted ? "outline" : "default"}
                            className="w-full"
                            onClick={() =>
                              router.push(`/student/placement/test/${company.id}`)
                            }
                          >
                            {attempted ? "Retake test" : "Start Test"}
                          </Button>
                        </div>
                      );
                    })()}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">Practice by Skill</h2>
        <p className="text-sm text-muted-foreground">
          Targeted practice to improve weak areas
        </p>

        {isLoading ? (
          <Card>
            <CardContent className="p-4 text-sm text-muted-foreground">
              Loading practice modules...
            </CardContent>
          </Card>
        ) : (
          <Tabs defaultValue="quantitative">
            <TabsList className="flex flex-wrap gap-2">
              <TabsTrigger value="quantitative">Quantitative</TabsTrigger>
              <TabsTrigger value="logical">Logical</TabsTrigger>
              <TabsTrigger value="verbal">Verbal</TabsTrigger>
              <TabsTrigger value="technical">Technical</TabsTrigger>
            </TabsList>

            {(
              [
                "quantitative",
                "logical",
                "verbal",
                "technical",
              ] as const
            ).map((cat) => {
              const modules = grouped[cat] ?? [];
              const emptyState =
                modules.length === 0 ? (
                  <Card>
                    <CardContent className="p-4 text-sm text-muted-foreground">
                      No practice modules available.
                    </CardContent>
                  </Card>
                ) : null;

              return (
                <TabsContent key={cat} value={cat} className="space-y-4">
                  {emptyState ?? (
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      {modules.map((mod) => {
                        const hasAttempt = Object.prototype.hasOwnProperty.call(
                          practiceScores,
                          mod.id
                        );
                        const bestScore = practiceScores[mod.id] ?? 0;
                        const Icon =
                          (LucideIcons as any)[mod.icon] ?? BookOpen;

                        return (
                          <Card key={mod.id} className="h-full">
                            <CardContent className="space-y-3 p-4">
                              <div className="flex items-start gap-2">
                                <Icon className="size-4 text-primary" />
                                <div className="min-w-0">
                                  <div className="text-sm font-semibold">
                                    {mod.label}
                                  </div>
                                  <p className="text-xs text-muted-foreground">
                                    {mod.description}
                                  </p>
                                </div>
                              </div>

                              {hasAttempt && (
                                <div className="space-y-1">
                                  <Badge
                                    variant="secondary"
                                    className={getPracticeScoreBadgeClass(bestScore)}
                                  >
                                    {bestScore}%
                                  </Badge>
                                  <p className="text-xs text-muted-foreground">
                                    Best: {bestScore}%
                                  </p>
                                </div>
                              )}

                              <Button
                                className="w-full"
                                onClick={() =>
                                  router.push(
                                    `/student/placement/practice/${mod.id}`
                                  )
                                }
                              >
                                Practice
                              </Button>
                            </CardContent>
                          </Card>
                        );
                      })}
                    </div>
                  )}
                </TabsContent>
              );
            })}
          </Tabs>
        )}
      </section>
    </div>
  );
}

