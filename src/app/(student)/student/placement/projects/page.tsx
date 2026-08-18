"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { createBrowserClient } from "@/lib/db/supabase-browser";
import { MonoTag } from "@/components/ui/mono-tag";
import {
  MINI_PROJECTS,
  getProjectsForBranch,
  type MiniProject,
} from "@/lib/placement/mini-projects";

type DifficultyFilter = "all" | "beginner" | "intermediate";

// Difficulty is a meaningful status signal (not decorative chrome), so it
// keeps semantic color per DESIGN.md's mastery/performance-indicator carve-out
// — emerald for beginner (easy/mastered-adjacent), amber for intermediate.
const DIFFICULTY_BADGE: Record<MiniProject["difficulty"], string> = {
  beginner: "bg-emerald-50 text-emerald-700",
  intermediate: "bg-amber-50 text-amber-800",
};

export default function MiniProjectsPage() {
  const [loading, setLoading] = useState(true);
  const [branch, setBranch] = useState<string>("");
  const [filter, setFilter] = useState<DifficultyFilter>("all");

  useEffect(() => {
    let cancelled = false;

    async function init() {
      const supabase = createBrowserClient();

      const branchPromise = (async () => {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) return null;
        const { data } = await supabase
          .from("profiles")
          .select("branch")
          .eq("id", user.id)
          .single();
        return (data?.branch as string | null) ?? null;
      })();

      const [, profileBranch] = await Promise.all([
        fetch("/api/placement/profile").then((r) => (r.ok ? r.json() : null)),
        branchPromise,
      ]);

      if (cancelled) return;
      setBranch(profileBranch ?? "");
      setLoading(false);
    }

    void init();
    return () => {
      cancelled = true;
    };
  }, []);

  const branchProjects = useMemo(() => {
    const filtered = branch ? getProjectsForBranch(branch) : [];
    // Fall back to the full catalog if branch is unknown or matched nothing.
    return filtered.length > 0 ? filtered : MINI_PROJECTS;
  }, [branch]);

  const visibleProjects = useMemo(
    () =>
      filter === "all"
        ? branchProjects
        : branchProjects.filter((p) => p.difficulty === filter),
    [branchProjects, filter]
  );

  const showingAllFallback =
    branch !== "" && getProjectsForBranch(branch).length === 0;

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="size-8 animate-spin text-ink-400" aria-hidden />
      </div>
    );
  }

  return (
    <div className="max-w-5xl space-y-6">
      {/* Header */}
      <div>
        <h1 className="font-plex-serif text-display-sm font-semibold text-ink">
          Mini-Project Guides
        </h1>
        <p className="mt-1 font-plex-sans text-body-sm text-ink-500">
          Build real projects that interviewers ask about. Each guide connects to
          your syllabus.
        </p>
      </div>

      {/* Difficulty filter tabs */}
      <div className="flex gap-1">
        {(
          [
            { id: "all", label: "All" },
            { id: "beginner", label: "Beginner" },
            { id: "intermediate", label: "Intermediate" },
          ] as Array<{ id: DifficultyFilter; label: string }>
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setFilter(t.id)}
            className={cn(
              "min-h-11 rounded-8 border px-3 py-1.5 font-plex-sans text-body-sm transition-colors duration-180 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-900 focus-visible:ring-offset-2",
              filter === t.id
                ? "border-ochre bg-paper text-ink-900"
                : "border-ink-200 text-ink-600 hover:bg-ink-50"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Cards grid */}
      {showingAllFallback && (
        <p className="font-plex-sans text-xs text-ink-400">Showing all projects</p>
      )}
      {visibleProjects.length === 0 ? (
        <p className="rounded-8 border border-dashed border-ink-200 p-6 text-center font-plex-sans text-body-sm text-ink-400">
          No projects match this filter.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {visibleProjects.map((p) => (
            <div
              key={p.id}
              className="flex flex-col overflow-hidden rounded-8 border border-ink-100 bg-paper"
            >
              {/* Card body */}
              <div className="flex-1 p-5">
                <span
                  className={cn(
                    "inline-block rounded-4 px-2 py-0.5 font-plex-sans text-xs font-medium capitalize",
                    DIFFICULTY_BADGE[p.difficulty]
                  )}
                >
                  {p.difficulty}
                </span>
                <h2 className="mt-2 font-plex-sans text-body font-semibold text-ink">
                  {p.title}
                </h2>
                <p className="mb-3 mt-1 font-plex-sans text-xs leading-relaxed text-ink-500">
                  {p.tagline}
                </p>

                <div className="flex flex-wrap gap-1.5">
                  {p.tech_stack.map((t) => (
                    <MonoTag key={t}>{t}</MonoTag>
                  ))}
                </div>

                <p className="mt-3 font-plex-sans text-xs text-ink-400">
                  ~{p.estimated_days} days · {p.steps.length} steps
                </p>

                {p.prerequisite_subjects.length > 0 && (
                  <div className="mt-2 font-plex-sans text-xs text-ink-400">
                    Uses your subjects:{" "}
                    <span className="text-ink-600">
                      {p.prerequisite_subjects.slice(0, 2).join(", ")}
                    </span>
                  </div>
                )}
              </div>

              {/* Card footer */}
              <div className="flex items-center justify-between border-t border-ink-100 px-5 py-3">
                <span className="font-plex-sans text-xs text-ink-400">
                  Adds:{" "}
                  <span className="text-ink-600">
                    {p.skills_to_add.slice(0, 2).join(", ")}
                  </span>
                </span>
                <Link
                  href={`/student/placement/projects/${p.id}`}
                  className="font-plex-sans text-body-sm font-medium text-ink underline-offset-2 transition-colors duration-180 ease-out hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-900"
                >
                  Start guide →
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
