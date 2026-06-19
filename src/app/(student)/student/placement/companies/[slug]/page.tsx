"use client";

import { useEffect, useState, useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Info, Circle, Loader2, ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { TARGET_LABELS } from "@/types/placement";
import type {
  PlacementCompanyProfile,
  PlacementDrive,
  OASection,
  CompanyRound,
} from "@/types/placement";

// ─── Constants ────────────────────────────────────────────────────────────────

const ROUND_COLORS: Record<CompanyRound["type"], string> = {
  aptitude:      "bg-purple-50 text-purple-600",
  technical:     "bg-blue-50 text-blue-600",
  hr:            "bg-green-50 text-green-600",
  communication: "bg-amber-50 text-amber-600",
  mixed:         "bg-gray-100 text-gray-600",
  coding:        "bg-gray-100 text-gray-600",
};

const TOPIC_MAP: { keywords: string[]; topics: string[] }[] = [
  {
    keywords: ["numerical", "quant", "arithmetic", "mathematics", "math"],
    topics: ["Time & Work", "Percentages", "Profit & Loss", "Ratio & Proportion", "Probability"],
  },
  {
    keywords: ["verbal", "english", "language", "grammar"],
    topics: ["Reading Comprehension", "Error Correction", "Sentence Completion", "Vocabulary"],
  },
  {
    keywords: ["reasoning", "logical", "logic"],
    topics: ["Seating Arrangement", "Blood Relations", "Syllogisms", "Coding-Decoding"],
  },
  {
    keywords: ["programming", "coding", "code"],
    topics: ["Pseudo Code", "Basic DSA", "Pattern Recognition"],
  },
  {
    keywords: ["technical", "domain", "computer"],
    topics: ["OS Concepts", "DBMS Basics", "OOP Principles", "Computer Networks"],
  },
];

function deriveKeyTopics(sections: OASection[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const section of sections) {
    const lower = section.name.toLowerCase();
    for (const { keywords, topics } of TOPIC_MAP) {
      if (keywords.some((k) => lower.includes(k))) {
        for (const topic of topics) {
          if (!seen.has(topic)) {
            seen.add(topic);
            result.push(topic);
          }
        }
      }
    }
  }
  return result;
}

function getPrepSteps(weeks: number): string[] {
  const steps = ["Focus on Verbal + Basic Quant"];
  if (weeks >= 2) steps.push("Logical Reasoning patterns");
  if (weeks >= 3) steps.push("OA mock tests + weak area revision");
  if (weeks >= 4) steps.push("Full mock drives + HR prep");
  return steps;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CompanyDetailPage() {
  const params = useParams();
  const slug = params.slug as string;

  const [company, setCompany] = useState<PlacementCompanyProfile | null>(null);
  const [drives, setDrives] = useState<PlacementDrive[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!slug) return;
    fetch(`/api/placement/companies/${slug}`)
      .then((r) => {
        if (r.status === 404) { setNotFound(true); return null; }
        return r.json();
      })
      .then((data) => {
        if (!data) return;
        setCompany(data.company ?? null);
        setDrives(data.drives ?? []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [slug]);

  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const upcomingDrives = useMemo(
    () => drives.filter((d) => d.drive_date >= today),
    [drives, today]
  );

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (notFound || !company) {
    return (
      <div className="py-24 text-center">
        <p className="text-sm text-gray-500">Company not found.</p>
        <Link
          href="/student/placement/companies"
          className="mt-4 inline-block text-sm font-medium text-blue-600 hover:text-blue-700"
        >
          ← Back to Company Intelligence
        </Link>
      </div>
    );
  }

  const sections = company.oa_pattern?.sections ?? [];
  const totalTime = sections.reduce((sum, s) => sum + s.time_minutes, 0);
  const keyTopics = deriveKeyTopics(sections);
  const prepSteps = company.avg_prep_weeks ? getPrepSteps(company.avg_prep_weeks) : null;

  return (
    <div className="pb-24 sm:pb-0">
      {/* Back link */}
      <Link
        href="/student/placement/companies"
        className="mb-6 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
      >
        <ChevronLeft className="size-4" />
        Company Intelligence
      </Link>

      {/* Header */}
      <div className="mt-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold text-gray-900">{company.name}</h1>
          <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-600">
            {TARGET_LABELS[company.company_type]}
          </span>
          {company.is_mass_recruiter && (
            <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-xs text-blue-600">
              Mass Recruiter
            </span>
          )}
        </div>

        {/* Eligibility row */}
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-500">
          <span>
            CGPA:{" "}
            <span className="font-medium text-gray-700">
              {company.min_cgpa !== null ? `${company.min_cgpa.toFixed(1)} minimum` : "No cutoff"}
            </span>
          </span>
          <span>
            Backlogs:{" "}
            <span className="font-medium text-gray-700">
              {company.backlogs_allowed ? "Allowed" : "Not allowed"}
            </span>
          </span>
          <span>
            Branches:{" "}
            <span className="font-medium text-gray-700">
              {company.allowed_branches?.length
                ? company.allowed_branches.join(", ")
                : "All branches"}
            </span>
          </span>
        </div>
      </div>

      <div className="mt-8 space-y-8">
        {/* Section 1 — OA Pattern */}
        {sections.length > 0 && (
          <section>
            <h2 className="mb-4 text-base font-semibold text-gray-900">OA Pattern</h2>
            <div className="rounded-xl border border-gray-200 bg-white divide-y divide-gray-100">
              {sections.map((section) => (
                <div key={section.name} className="px-5 py-4">
                  <div className="flex items-center justify-between gap-4 text-sm">
                    <span className="font-medium text-gray-800">{section.name}</span>
                    <div className="flex shrink-0 gap-4 text-gray-500">
                      {section.question_count !== null && (
                        <span>{section.question_count} Qs</span>
                      )}
                      <span>{section.time_minutes} min</span>
                      <span className="font-medium text-gray-700">{section.weight_percent}%</span>
                    </div>
                  </div>
                  <div className="mt-2 h-1.5 w-full rounded bg-gray-100">
                    <div
                      className="h-1.5 rounded bg-blue-500 transition-all"
                      style={{ width: `${section.weight_percent}%` }}
                    />
                  </div>
                </div>
              ))}
              {totalTime > 0 && (
                <div className="px-5 py-3">
                  <span className="text-sm text-gray-500">
                    Total:{" "}
                    <span className="font-medium text-gray-700">{totalTime} minutes</span>
                  </span>
                </div>
              )}
            </div>
          </section>
        )}

        {/* Section 2 — Selection Rounds */}
        {company.rounds && company.rounds.length > 0 && (
          <section>
            <h2 className="mb-4 text-base font-semibold text-gray-900">Selection Rounds</h2>
            <div className="space-y-0">
              {company.rounds.map((round, i) => (
                <div key={round.round} className="flex gap-4">
                  <div className="flex flex-col items-center">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-600 text-sm font-medium text-white">
                      {round.round}
                    </div>
                    {i < company.rounds!.length - 1 && (
                      <div className="my-1 w-px flex-1 bg-gray-200" />
                    )}
                  </div>
                  <div className={cn("pb-6", i === company.rounds!.length - 1 && "pb-0")}>
                    <p className="font-medium text-gray-900">{round.name}</p>
                    <span
                      className={cn(
                        "mt-1 inline-block rounded-full px-2 py-0.5 text-xs",
                        ROUND_COLORS[round.type]
                      )}
                    >
                      {round.type}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Section 3 — What to Prepare */}
        {(keyTopics.length > 0 || prepSteps) && (
          <section>
            <h2 className="mb-4 text-base font-semibold text-gray-900">What to Prepare</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {/* Key Topics */}
              {keyTopics.length > 0 && (
                <div className="rounded-xl border border-gray-200 bg-white p-5">
                  <h3 className="mb-3 text-sm font-semibold text-gray-700">Key Topics</h3>
                  <ul className="space-y-2">
                    {keyTopics.map((topic) => (
                      <li key={topic} className="flex items-center gap-2">
                        <Circle className="size-3.5 shrink-0 text-gray-300" />
                        <span className="text-sm text-gray-700">{topic}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Prep Timeline */}
              {prepSteps && (
                <div className="rounded-xl border border-gray-200 bg-white p-5">
                  <h3 className="mb-3 text-sm font-semibold text-gray-700">
                    Prep Timeline
                    <span className="ml-1.5 font-normal text-gray-400">
                      (~{company.avg_prep_weeks} week{company.avg_prep_weeks !== 1 ? "s" : ""})
                    </span>
                  </h3>
                  <ol className="space-y-2.5">
                    {prepSteps.map((step, i) => (
                      <li key={i} className="flex gap-3">
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-50 text-xs font-medium text-blue-600">
                          {i + 1}
                        </span>
                        <span className="text-sm text-gray-600">{step}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </div>
          </section>
        )}

        {/* Section 4 — Campus Notes */}
        {company.campus_notes && (
          <section>
            <h2 className="mb-4 text-base font-semibold text-gray-900">Campus Notes</h2>
            <div className="flex gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
              <Info className="mt-0.5 size-4 shrink-0 text-amber-600" />
              <p className="text-sm text-gray-700">{company.campus_notes}</p>
            </div>
          </section>
        )}

        {/* Section 5 — Upcoming Drives */}
        <section>
          <h2 className="mb-4 text-base font-semibold text-gray-900">Upcoming Drives</h2>
          {upcomingDrives.length === 0 ? (
            <p className="text-sm text-gray-400">
              No drives scheduled yet. Check back closer to placement season.
            </p>
          ) : (
            <div className="space-y-3">
              {upcomingDrives.map((drive) => (
                <div
                  key={drive.id}
                  className="rounded-xl border border-gray-200 bg-white px-5 py-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-gray-900">
                        Drive Date:{" "}
                        {new Date(drive.drive_date).toLocaleDateString("en-IN", {
                          day: "numeric",
                          month: "long",
                          year: "numeric",
                        })}
                      </p>
                      {drive.registration_deadline && (
                        <p className="text-xs text-gray-500">
                          Registration deadline:{" "}
                          {new Date(drive.registration_deadline).toLocaleDateString("en-IN", {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                          })}
                        </p>
                      )}
                    </div>
                    {drive.eligible_branches && drive.eligible_branches.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {drive.eligible_branches.map((branch) => (
                          <span
                            key={branch}
                            className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600"
                          >
                            {branch}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  {drive.notes && (
                    <p className="mt-2 text-xs text-gray-500">{drive.notes}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Bottom CTA */}
      <div className="sticky bottom-0 mt-8 border-t border-gray-200 bg-white py-4">
        <Link href={`/student/placement/prep/aptitude?company=${slug}`}>
          <Button className="w-full bg-blue-600 text-white hover:bg-blue-700 sm:w-auto">
            Start Preparing for {company.name}
          </Button>
        </Link>
      </div>
    </div>
  );
}
