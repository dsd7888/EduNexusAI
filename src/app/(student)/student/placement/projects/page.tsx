"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { createBrowserClient } from "@/lib/db/supabase-browser";
import {
  MINI_PROJECTS,
  getProjectsForBranch,
  type MiniProject,
} from "@/lib/placement/mini-projects";

type DifficultyFilter = "all" | "beginner" | "intermediate";

const DIFFICULTY_BADGE: Record<MiniProject["difficulty"], string> = {
  beginner: "bg-emerald-50 text-emerald-700",
  intermediate: "bg-blue-50 text-blue-700",
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
        <Loader2 className="size-8 animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className="max-w-5xl space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Mini-Project Guides</h1>
        <p className="mt-1 text-sm text-gray-500">
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
              "rounded-full border px-3 py-1.5 text-sm transition-colors",
              filter === t.id
                ? "border-blue-600 bg-blue-50 text-blue-700"
                : "border-gray-200 text-gray-600 hover:bg-gray-50"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Cards grid */}
      {showingAllFallback && (
        <p className="text-xs text-gray-400">Showing all projects</p>
      )}
      {visibleProjects.length === 0 ? (
        <p className="rounded-lg border border-dashed border-gray-200 p-6 text-center text-sm text-gray-400">
          No projects match this filter.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {visibleProjects.map((p) => (
            <div
              key={p.id}
              className="bg-white border border-gray-100 rounded-2xl overflow-hidden shadow-sm flex flex-col"
            >
              {/* Card body */}
              <div className="flex-1 p-5">
                <span
                  className={cn(
                    "inline-block rounded-full px-2 py-0.5 text-xs font-medium capitalize",
                    DIFFICULTY_BADGE[p.difficulty]
                  )}
                >
                  {p.difficulty}
                </span>
                <h2 className="mt-2 text-lg font-semibold text-gray-900">
                  {p.title}
                </h2>
                <p className="text-xs text-gray-500 mt-1 mb-3 leading-relaxed">
                  {p.tagline}
                </p>

                <div className="flex flex-wrap gap-1.5">
                  {p.tech_stack.map((t) => (
                    <span
                      key={t}
                      className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600"
                    >
                      {t}
                    </span>
                  ))}
                </div>

                <p className="mt-3 text-xs text-gray-400">
                  ~{p.estimated_days} days · {p.steps.length} steps
                </p>

                {p.prerequisite_subjects.length > 0 && (
                  <div className="text-xs text-gray-400 mt-2">
                    Uses your subjects:{" "}
                    <span className="text-gray-600">
                      {p.prerequisite_subjects.slice(0, 2).join(", ")}
                    </span>
                  </div>
                )}
              </div>

              {/* Card footer */}
              <div className="border-t border-gray-100 px-5 py-3 flex items-center justify-between">
                <span className="text-xs text-gray-400">
                  Adds:{" "}
                  <span className="text-gray-600">
                    {p.skills_to_add.slice(0, 2).join(", ")}
                  </span>
                </span>
                <Link
                  href={`/student/placement/projects/${p.id}`}
                  className="text-sm text-blue-600 font-medium"
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
