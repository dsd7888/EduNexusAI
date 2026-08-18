"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { MonoTag } from "@/components/ui/mono-tag";
import { MINI_PROJECTS } from "@/lib/placement/mini-projects";

type ResourceType = "tutorial" | "docs" | "video" | "course";

// Resource kind is metadata, not primary chrome — keep the existing semantic
// color set (per DESIGN.md carve-out for meaningful, non-decorative color).
const RESOURCE_BADGE: Record<ResourceType, string> = {
  tutorial: "bg-ink-100 text-ink-600",
  docs: "bg-blue-50 text-blue-700",
  video: "bg-red-50 text-red-600", // YouTube branding — intentionally red
  course: "bg-purple-50 text-purple-700",
};

const PRIMARY_BUTTON =
  "inline-flex h-11 items-center justify-center gap-1.5 rounded-8 bg-ink px-5 font-plex-sans text-body font-medium text-paper transition-colors duration-180 ease-out hover:bg-ink-800 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-900 focus-visible:ring-offset-2";

export default function MiniProjectDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const project = MINI_PROJECTS.find((p) => p.id === id);

  useEffect(() => {
    if (!project) router.replace("/student/placement/projects");
  }, [project, router]);

  if (!project) return null;

  return (
    <div className="max-w-3xl space-y-6">
      <Link
        href="/student/placement/projects"
        className="inline-flex h-11 items-center gap-1.5 font-plex-sans text-body-sm font-medium text-ink-500 transition-colors duration-180 ease-out hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-900 focus-visible:ring-offset-2"
      >
        <ArrowLeft className="size-3.5" aria-hidden />
        Mini-Project Guides
      </Link>

      {/* Header */}
      <div>
        <h1 className="font-plex-serif text-display-sm font-semibold text-ink">
          {project.title}
        </h1>
        <p className="mt-1 font-plex-sans text-body-sm text-ink-500">{project.tagline}</p>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {project.tech_stack.map((t) => (
            <MonoTag key={t}>{t}</MonoTag>
          ))}
        </div>

        <p className="mt-3 font-plex-sans text-xs text-ink-400">
          {project.estimated_days} days ·{" "}
          <span className="capitalize">{project.difficulty}</span>
        </p>

        <p className="mt-3 font-plex-sans text-body-sm italic text-ink-600">
          {project.what_youll_build}
        </p>
      </div>

      {/* Prerequisites */}
      <div className="mb-6 rounded-8 border border-ink-200 bg-ink-50 p-4">
        <h2 className="font-plex-sans text-body-sm font-semibold text-ink">Before you start</h2>
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <p className="mb-1 font-plex-sans text-xs font-medium text-ink-600">
              Subjects you&rsquo;ll use
            </p>
            <ul className="space-y-1">
              {project.prerequisite_subjects.map((s) => (
                <li key={s} className="font-plex-sans text-body-sm text-ink-700">
                  • {s}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="mb-1 font-plex-sans text-xs font-medium text-ink-600">
              Concepts needed
            </p>
            <ul className="space-y-1">
              {project.prerequisite_concepts.map((c) => (
                <li key={c} className="font-plex-sans text-body-sm text-ink-700">
                  • {c}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {/* Steps */}
      <div>
        <h2 className="font-plex-sans text-body font-semibold text-ink">Step-by-Step Guide</h2>
        <div className="mt-4 space-y-5">
          {project.steps.map((step) => (
            <div key={step.step} className="flex gap-4">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-ink font-plex-sans text-body-sm font-medium text-paper">
                {step.step}
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-plex-sans text-body-sm font-medium text-ink">
                    {step.title}
                  </p>
                  <span className="font-plex-sans text-xs text-ink-400">
                    {step.estimated_hours}h
                  </span>
                </div>
                <p className="mt-1 font-plex-sans text-body-sm text-ink-600">
                  {step.description}
                </p>
                {step.resource_url && step.resource_label && (
                  <a
                    href={step.resource_url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-flex items-center gap-1 font-plex-sans text-body-sm text-ink underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-900"
                  >
                    <ExternalLink className="size-3.5" aria-hidden />
                    {step.resource_label}
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Resume output */}
      <div className="mt-6 rounded-8 border border-emerald-200 bg-emerald-50 p-4">
        <h2 className="font-plex-sans text-body-sm font-semibold text-emerald-800">
          What to add to your resume
        </h2>

        <div className="mt-3 rounded-4 border border-emerald-200 bg-paper p-3 font-plex-mono text-body-sm text-ink">
          {project.resume_bullet_template}
        </div>

        <div className="mt-3">
          <p className="font-plex-sans text-xs text-emerald-700">Add to Skills section:</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {project.skills_to_add.map((s) => (
              <span
                key={s}
                className="rounded-4 bg-emerald-100 px-2 py-0.5 font-plex-sans text-xs text-emerald-800"
              >
                {s}
              </span>
            ))}
          </div>
        </div>

        <div className="mt-4">
          <button
            type="button"
            onClick={() => router.push("/student/placement/resume")}
            className={PRIMARY_BUTTON}
          >
            Add skills to my resume →
          </button>
        </div>
      </div>

      {/* Reference resources */}
      <div>
        <h2 className="font-plex-sans text-body-sm font-medium text-ink-500">
          External Resources
        </h2>
        <div className="mt-2 space-y-2">
          {project.reference_resources.map((r) => (
            <a
              key={r.url}
              href={r.url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 rounded-8 border border-ink-200 px-3 py-2 font-plex-sans text-body-sm text-ink-700 transition-colors duration-180 ease-out hover:border-ink-400 hover:bg-ink-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-900"
            >
              <ExternalLink className="size-4 shrink-0 text-ink-400" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{r.label}</span>
              <span
                className={cn(
                  "shrink-0 rounded-4 px-1.5 py-0.5 font-plex-sans text-xs font-medium capitalize",
                  RESOURCE_BADGE[r.type]
                )}
              >
                {r.type}
              </span>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
