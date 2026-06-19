"use client";

import { useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  Search,
} from "lucide-react";

import { cn } from "@/lib/utils";
import {
  PLATFORMS,
  APPLICATION_STRATEGY,
  type InternshipPlatform,
} from "@/lib/placement/platform-guide";

// ─── Static content ───────────────────────────────────────────────────────────

const TYPE_LABELS: Record<InternshipPlatform["type"], string> = {
  job_portal: "Job Portal",
  freelance: "Freelance",
  company_direct: "Company Direct",
  community: "Community",
};

const SEARCH_TEMPLATES: string[] = [
  '"Software Engineer Intern" [city] last 24 hours',
  '"Developer Intern" Remote 2025',
  '"SDE Intern" "2026 passout"',
];

const JD_CHECKLIST: string[] = [
  "Company name is real and verifiable",
  "Stipend amount is mentioned (or clearly unpaid/academic)",
  "Duration and dates are specified",
  "Skills required match what you have or can learn in time",
  "No upfront payment required",
  "Contact is a company email, not Gmail/Yahoo",
];

// ─── Clipboard ────────────────────────────────────────────────────────────────

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to legacy path */
  }
  // Fallback for older browsers / insecure contexts.
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

// ─── Platform card ────────────────────────────────────────────────────────────

type SectionKey = "search" | "red_flags" | "profile";

function PlatformCard({ platform }: { platform: InternshipPlatform }) {
  const [open, setOpen] = useState<Set<SectionKey>>(new Set());

  function toggle(key: SectionKey) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const expandable: Array<{
    key: SectionKey;
    label: string;
    items: string[];
  }> = [
    { key: "search", label: "Search Tips", items: platform.search_tips },
    {
      key: "red_flags",
      label: "Red Flags to Avoid",
      items: platform.red_flags,
    },
    { key: "profile", label: "Profile Tips", items: platform.profile_tips },
  ];

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      {/* Header */}
      <div className="flex items-start gap-3">
        <span className="text-[2rem] leading-none">{platform.logo_emoji}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold text-gray-900">{platform.name}</h3>
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
              {TYPE_LABELS[platform.type]}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-gray-400">
            Typical response: {platform.typical_response_time}
          </p>
        </div>
      </div>

      {/* Best for */}
      <div className="mt-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
          Best for
        </p>
        <ul className="mt-1.5 space-y-1 text-sm text-gray-600">
          {platform.best_for.map((item) => (
            <li key={item} className="flex gap-2">
              <span className="mt-0.5 shrink-0 text-gray-300">•</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Expandable sections */}
      <div className="mt-4 divide-y divide-gray-100 border-y border-gray-100">
        {expandable.map(({ key, label, items }) => {
          const isOpen = open.has(key);
          const isRed = key === "red_flags";
          return (
            <div key={key}>
              <button
                type="button"
                onClick={() => toggle(key)}
                aria-expanded={isOpen}
                className="flex w-full items-center justify-between gap-2 py-2.5 text-left"
              >
                <span
                  className={cn(
                    "text-sm font-medium",
                    isRed ? "text-amber-700" : "text-gray-700"
                  )}
                >
                  {isRed ? "⚠ " : ""}{label}
                </span>
                <ChevronDown
                  className={cn(
                    "size-4 shrink-0 text-gray-400 transition-transform",
                    isOpen && "rotate-180"
                  )}
                />
              </button>
              <div
                className={cn(
                  "grid transition-all duration-200",
                  isOpen
                    ? "grid-rows-[1fr] opacity-100"
                    : "grid-rows-[0fr] opacity-0"
                )}
              >
                <div className="overflow-hidden">
                  <ul className="space-y-1 pb-3 text-sm text-gray-600">
                    {items.map((item) => (
                      <li key={item} className="flex gap-2">
                        <span
                          className={cn(
                            "mt-0.5 shrink-0",
                            isRed ? "text-red-300" : "text-gray-300"
                          )}
                        >
                          {isRed ? "✕" : "›"}
                        </span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* CTA */}
      {platform.url && (
        <a
          href={platform.url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:border-blue-300 hover:text-blue-600"
        >
          <ExternalLink className="size-3.5" />
          Open {platform.name}
        </a>
      )}
    </div>
  );
}

// ─── Copyable search template ─────────────────────────────────────────────────

function SearchTemplate({ query }: { query: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    const ok = await copyText(query);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="flex w-full items-center justify-between gap-2 rounded-lg border border-gray-200 px-3 py-2 text-left transition-colors hover:border-blue-300"
    >
      <span className="min-w-0 truncate font-mono text-xs text-gray-700">
        {query}
      </span>
      {copied ? (
        <Check className="size-4 shrink-0 text-emerald-500" />
      ) : (
        <Copy className="size-4 shrink-0 text-gray-400" />
      )}
    </button>
  );
}

// ─── JD checklist ─────────────────────────────────────────────────────────────

function JdChecklist() {
  const [checked, setChecked] = useState<Set<number>>(new Set());

  function toggle(i: number) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  return (
    <div className="space-y-2">
      {JD_CHECKLIST.map((item, i) => {
        const isChecked = checked.has(i);
        return (
          <button
            key={item}
            type="button"
            onClick={() => toggle(i)}
            className="flex w-full items-center gap-3 text-left"
          >
            <span
              className={cn(
                "flex size-5 shrink-0 items-center justify-center rounded border transition-colors",
                isChecked
                  ? "border-emerald-500 bg-emerald-500 text-white"
                  : "border-gray-300 bg-white"
              )}
            >
              {isChecked && <Check className="size-3.5" />}
            </span>
            <span
              className={cn(
                "text-sm",
                isChecked ? "text-gray-400 line-through" : "text-gray-700"
              )}
            >
              {item}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function FindInternshipPage() {
  return (
    <div className="max-w-6xl space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">
          Where to Find Internships
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          Step-by-step guide to the platforms that actually work for Indian
          college students.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left: platform cards */}
        <div className="space-y-4 lg:col-span-2">
          {["internshala", "linkedin", "unstop", "naukri", "company_careers"].map(
            (id) => {
              const platform = PLATFORMS.find((p) => p.id === id);
              return platform ? (
                <PlatformCard key={platform.id} platform={platform} />
              ) : null;
            }
          )}
        </div>

        {/* Right: roadmap + templates + checklist */}
        <div className="space-y-6">
          {/* Application roadmap */}
          <div className="rounded-xl border border-gray-200 bg-white p-5">
            <h2 className="text-base font-semibold text-gray-900">
              Your Application Roadmap
            </h2>
            <div className="mt-4 space-y-4">
              {APPLICATION_STRATEGY.map((phase) => (
                <div
                  key={phase.phase}
                  className="border-l-2 border-blue-100 pl-4"
                >
                  <p className="font-semibold text-gray-900">{phase.phase}</p>
                  <p className="text-xs text-gray-400">{phase.timeline}</p>
                  <ol className="mt-2 space-y-1.5">
                    {phase.actions.map((action, i) => (
                      <li
                        key={action}
                        className="flex gap-2 text-sm text-gray-600"
                      >
                        <span className="shrink-0 font-medium text-blue-500">
                          {i + 1}.
                        </span>
                        <span>{action}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              ))}
            </div>
          </div>

          {/* Quick search templates */}
          <div className="rounded-xl border border-gray-200 bg-white p-5">
            <div className="flex items-center gap-2">
              <Search className="size-4 text-gray-400" />
              <h2 className="text-base font-semibold text-gray-900">
                Quick Search Templates
              </h2>
            </div>
            <p className="mt-1 text-xs text-gray-500">
              Tap to copy — paste into LinkedIn Jobs search.
            </p>
            <p className="text-xs text-gray-400 mb-3 mt-2">
              Copy these into LinkedIn Jobs or Internshala search
            </p>
            <div className="space-y-2">
              {SEARCH_TEMPLATES.map((query) => (
                <SearchTemplate key={query} query={query} />
              ))}
            </div>
          </div>

          {/* JD quality checklist */}
          <div className="rounded-xl border border-gray-200 bg-white p-5">
            <div className="flex items-center gap-2">
              <AlertTriangle className="size-4 text-amber-500" />
              <h2 className="text-base font-semibold text-gray-900">
                Before you apply — quick check
              </h2>
            </div>
            <p className="mt-1 text-xs text-gray-500">
              Run through this before you spend time on an application.
            </p>
            <div className="mt-3">
              <JdChecklist />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
