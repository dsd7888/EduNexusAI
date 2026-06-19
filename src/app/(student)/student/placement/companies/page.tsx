"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { TARGET_LABELS } from "@/types/placement";
import type { PlacementCompanyProfile, PlacementDrive, CompanyRound } from "@/types/placement";

// ─── Constants ────────────────────────────────────────────────────────────────

type FilterTab = "all" | "mass_recruiters" | "product" | "core";

const FILTER_TABS: { id: FilterTab; label: string }[] = [
  { id: "all", label: "All" },
  { id: "mass_recruiters", label: "Mass Recruiters" },
  { id: "product", label: "Product" },
  { id: "core", label: "Core" },
];

const ROUND_COLORS: Record<CompanyRound["type"], string> = {
  aptitude:      "bg-purple-50 text-purple-600",
  technical:     "bg-blue-50 text-blue-600",
  hr:            "bg-green-50 text-green-600",
  communication: "bg-amber-50 text-amber-600",
  mixed:         "bg-gray-100 text-gray-600",
  coding:        "bg-gray-100 text-gray-600",
};

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CompaniesPage() {
  const [companies, setCompanies] = useState<PlacementCompanyProfile[]>([]);
  const [drives, setDrives] = useState<PlacementDrive[]>([]);
  const [activeTab, setActiveTab] = useState<FilterTab>("all");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/placement/companies")
      .then((r) => r.json())
      .then((data) => {
        setCompanies(data.companies ?? []);
        setDrives(data.drives ?? []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const driveCompanyIds = useMemo(
    () => new Set(drives.filter((d) => d.drive_date >= today).map((d) => d.company_id)),
    [drives, today]
  );

  const filteredCompanies = useMemo(() => {
    switch (activeTab) {
      case "mass_recruiters": return companies.filter((c) => c.is_mass_recruiter);
      case "product":         return companies.filter((c) => c.company_type === "product");
      case "core":            return companies.filter((c) => c.company_type === "core_engineering");
      default:                return companies;
    }
  }, [companies, activeTab]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Company Intelligence</h1>
          <p className="mt-1 text-sm text-gray-500">
            Know what each company tests before you prep
          </p>
        </div>

        {/* Filter Tabs */}
        <div className="flex gap-0 border-b border-gray-200 sm:border-b-0 sm:border border-transparent">
          {FILTER_TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "px-3 py-2 text-sm font-medium transition-colors whitespace-nowrap border-b-2 -mb-px",
                activeTab === tab.id
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Company Grid */}
      {loading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-56 rounded-xl" />
          ))}
        </div>
      ) : filteredCompanies.length === 0 ? (
        <p className="py-16 text-center text-sm text-gray-400">
          No companies in this category yet.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {filteredCompanies.map((company) => (
            <CompanyCard
              key={company.id}
              company={company}
              hasDrive={driveCompanyIds.has(company.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Company Card ─────────────────────────────────────────────────────────────

function CompanyCard({
  company,
  hasDrive,
}: {
  company: PlacementCompanyProfile;
  hasDrive: boolean;
}) {
  const topSections = useMemo(() => {
    if (!company.oa_pattern?.sections?.length) return [];
    return [...company.oa_pattern.sections]
      .sort((a, b) => b.weight_percent - a.weight_percent)
      .slice(0, 2);
  }, [company.oa_pattern]);

  return (
    <div className="relative rounded-xl border border-gray-200 bg-white p-5 transition-colors hover:border-gray-300">
      {/* Drive badge */}
      {hasDrive && (
        <div className="absolute right-4 top-4 flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-red-500" />
          <span className="text-xs font-medium text-red-600">Drive Scheduled</span>
        </div>
      )}

      {/* Name + type badge */}
      <div className={cn("flex items-start gap-2", hasDrive && "pr-32")}>
        <div className="min-w-0">
          <h2 className="text-lg font-semibold leading-tight text-gray-900">
            {company.name}
          </h2>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
              {TARGET_LABELS[company.company_type]}
            </span>
            {company.is_mass_recruiter && (
              <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-600">
                Mass Recruiter
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Eligibility */}
      <p className="mt-3 text-sm text-gray-500">
        {company.min_cgpa !== null
          ? `Min CGPA: ${company.min_cgpa.toFixed(1)}`
          : "No CGPA cutoff"}
        {" · "}
        Backlogs: {company.backlogs_allowed ? "Allowed" : "Not allowed"}
      </p>

      {/* OA Snapshot */}
      {topSections.length > 0 && (
        <div className="mt-4 space-y-2">
          {topSections.map((section) => (
            <div key={section.name}>
              <span className="text-xs text-gray-500">
                {section.name} · {section.weight_percent}%
              </span>
              <div className="mt-0.5 h-1.5 w-full rounded bg-gray-100">
                <div
                  className="h-1.5 rounded bg-blue-400 transition-all"
                  style={{ width: `${section.weight_percent}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Rounds */}
      {company.rounds && company.rounds.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {company.rounds.map((round) => (
            <span
              key={round.round}
              className={cn("rounded-full px-2 py-0.5 text-xs", ROUND_COLORS[round.type])}
            >
              {round.name}
            </span>
          ))}
        </div>
      )}

      {/* Prep time + CTA */}
      <div className="mt-4 flex items-center justify-between">
        {company.avg_prep_weeks !== null ? (
          <span className="text-xs text-gray-400">
            ~{company.avg_prep_weeks} week{company.avg_prep_weeks !== 1 ? "s" : ""} to prepare
          </span>
        ) : (
          <span />
        )}
        <Link
          href={`/student/placement/companies/${company.slug}`}
          className="text-sm font-medium text-blue-600 hover:text-blue-700"
        >
          View Details →
        </Link>
      </div>
    </div>
  );
}
