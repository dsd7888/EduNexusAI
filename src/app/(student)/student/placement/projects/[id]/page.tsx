"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MINI_PROJECTS } from "@/lib/placement/mini-projects";

type ResourceType = "tutorial" | "docs" | "video" | "course";

const RESOURCE_BADGE: Record<ResourceType, string> = {
  tutorial: "bg-gray-100 text-gray-600",
  docs: "bg-blue-50 text-blue-700",
  video: "bg-red-50 text-red-600", // YouTube branding — intentionally red
  course: "bg-purple-50 text-purple-700",
};

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
        className="inline-flex text-sm text-gray-500 hover:text-gray-700"
      >
        ← Mini-Project Guides
      </Link>

      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">{project.title}</h1>
        <p className="mt-1 text-sm text-gray-500">{project.tagline}</p>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {project.tech_stack.map((t) => (
            <span
              key={t}
              className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600"
            >
              {t}
            </span>
          ))}
        </div>

        <p className="mt-3 text-xs text-gray-400">
          {project.estimated_days} days ·{" "}
          <span className="capitalize">{project.difficulty}</span>
        </p>

        <p className="mt-3 text-sm italic text-gray-600">
          {project.what_youll_build}
        </p>
      </div>

      {/* Prerequisites */}
      <div className="mb-6 rounded-lg border border-blue-200 bg-blue-50 p-4">
        <h2 className="text-sm font-semibold text-blue-800">Before you start</h2>
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <p className="mb-1 text-xs font-medium text-blue-800">
              Subjects you&rsquo;ll use
            </p>
            <ul className="space-y-1">
              {project.prerequisite_subjects.map((s) => (
                <li key={s} className="text-sm text-blue-700">
                  • {s}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="mb-1 text-xs font-medium text-blue-800">Concepts needed</p>
            <ul className="space-y-1">
              {project.prerequisite_concepts.map((c) => (
                <li key={c} className="text-sm text-blue-700">
                  • {c}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {/* Steps */}
      <div>
        <h2 className="text-base font-semibold text-gray-900">Step-by-Step Guide</h2>
        <div className="mt-4 space-y-5">
          {project.steps.map((step) => (
            <div key={step.step} className="flex gap-4">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-blue-600 text-sm font-medium text-white">
                {step.step}
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium text-gray-900">{step.title}</p>
                  <span className="text-xs text-gray-400">
                    {step.estimated_hours}h
                  </span>
                </div>
                <p className="mt-1 text-sm text-gray-600">{step.description}</p>
                {step.resource_url && step.resource_label && (
                  <a
                    href={step.resource_url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-flex items-center gap-1 text-sm text-blue-600 hover:underline"
                  >
                    <ExternalLink className="size-3.5" />
                    {step.resource_label}
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Resume output */}
      <div className="mt-6 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
        <h2 className="text-sm font-semibold text-emerald-800">
          What to add to your resume
        </h2>

        <div className="mt-3 rounded border border-emerald-200 bg-white p-3 font-mono text-sm text-gray-800">
          {project.resume_bullet_template}
        </div>

        <div className="mt-3">
          <p className="text-xs text-emerald-700">Add to Skills section:</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {project.skills_to_add.map((s) => (
              <span
                key={s}
                className="rounded bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800"
              >
                {s}
              </span>
            ))}
          </div>
        </div>

        <div className="mt-4">
          <Button
            onClick={() => router.push("/student/placement/resume")}
            className="bg-emerald-600 text-white hover:bg-emerald-700"
          >
            Add skills to my resume →
          </Button>
        </div>
      </div>

      {/* Reference resources */}
      <div>
        <h2 className="text-sm font-medium text-gray-500">External Resources</h2>
        <div className="mt-2 space-y-2">
          {project.reference_resources.map((r) => (
            <a
              key={r.url}
              href={r.url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 hover:border-blue-300 hover:bg-blue-50/30"
            >
              <ExternalLink className="size-4 shrink-0 text-gray-400" />
              <span className="min-w-0 flex-1 truncate">{r.label}</span>
              <span
                className={cn(
                  "shrink-0 rounded px-1.5 py-0.5 text-xs font-medium capitalize",
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
