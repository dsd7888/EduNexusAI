"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { FileSearch, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// ─── Types (match /api/placement/jd-analyze response) ──────────────────────────

type RequirementCategory = "knows" | "partial" | "missing";
type Importance = "high" | "medium" | "low";

interface JDRequirement {
  skill: string;
  category: RequirementCategory;
  evidence: string;
  importance: Importance;
}

interface JDAnalysis {
  job_title: string;
  company_name?: string;
  experience_level?: string;
  requirements: JDRequirement[];
  action_items: string[];
  overall_fit: string;
  fit_summary: string;
  analyzed_at?: string;
  student_branch?: string | null;
  student_semester?: number | null;
}

const MAX_CHARS = 5000;

const SAMPLE_JD =
  "We are looking for a Software Development Engineer (SDE) " +
  "Intern/Fresher to join our engineering team. " +
  "Required Skills: Data Structures and Algorithms, " +
  "Object-Oriented Programming, Database Management (SQL), " +
  "Operating Systems concepts, Computer Networks basics. " +
  "Good to have: REST APIs, Git, any web framework. " +
  "CGPA: 7.0 or above. Backlogs: Not allowed.";

// ─── Style maps ───────────────────────────────────────────────────────────────

const FIT_BANNER: Record<string, string> = {
  strong: "bg-emerald-50 border-emerald-200 text-emerald-800",
  moderate: "bg-blue-50 border-blue-200 text-blue-800",
  developing: "bg-amber-50 border-amber-200 text-amber-800",
};

const IMPORTANCE_BADGE: Record<Importance, string> = {
  high: "bg-emerald-100 text-emerald-700",
  medium: "bg-gray-100 text-gray-600",
  low: "bg-gray-50 text-gray-400",
};

interface GroupStyle {
  header: string;
  itemBorder: string;
  label: (count: number) => string;
}

const GROUP_STYLES: Record<RequirementCategory, GroupStyle> = {
  knows: {
    header:
      "bg-emerald-50 text-emerald-700 border border-emerald-100",
    itemBorder: "border-x border-b border-emerald-100",
    label: (c) => `✓ ${c} skills covered`,
  },
  partial: {
    header: "bg-amber-50 text-amber-700 border border-amber-100",
    itemBorder: "border-x border-b border-amber-100",
    label: (c) => `~ ${c} skills partially covered`,
  },
  missing: {
    header: "bg-slate-50 text-slate-600 border border-slate-200",
    itemBorder: "border-x border-b border-slate-200",
    label: (c) => `○ ${c} skills to develop`,
  },
};

const GROUP_ORDER: RequirementCategory[] = ["knows", "partial", "missing"];

const JD_STORAGE_KEY = "jd_analysis_last";
const JD_STORAGE_TTL_MS = 2 * 60 * 60 * 1000;

type PrepAction = {
  label: string;
  description: string;
  href: string;
  priority: "immediate" | "soon" | "later";
};

const SKILL_TO_PREP: Array<{
  keywords: string[];
  track: string;
  topic: string;
}> = [
  {
    keywords: [
      "operating system",
      "os concept",
      "process",
      "scheduling",
      "deadlock",
      "memory management",
      "paging",
      "file system",
    ],
    track: "domain",
    topic: "Process Management & Scheduling",
  },
  {
    keywords: [
      "computer network",
      "network",
      "tcp",
      "ip",
      "http",
      "dns",
      "osi",
      "routing",
      "subnetting",
    ],
    track: "domain",
    topic: "OSI & TCP/IP Model",
  },
  {
    keywords: [
      "sql",
      "database",
      "dbms",
      "query",
      "normalization",
      "join",
      "transaction",
      "acid",
      "indexing",
    ],
    track: "domain",
    topic: "SQL Queries & Joins",
  },
  {
    keywords: [
      "oop",
      "object oriented",
      "object-oriented",
      "class",
      "inheritance",
      "polymorphism",
      "abstraction",
      "encapsulation",
    ],
    track: "domain",
    topic: "Classes, Objects, Inheritance",
  },
  {
    keywords: [
      "data structure",
      "algorithm",
      "dsa",
      "array",
      "linked list",
      "tree",
      "graph",
      "sorting",
      "searching",
      "dynamic programming",
    ],
    track: "domain",
    topic: "SQL Queries & Joins",
  },
  {
    keywords: [
      "rest",
      "api",
      "web framework",
      "backend",
      "frontend",
      "react",
      "node",
      "spring",
      "flask",
      "django",
    ],
    track: "domain",
    topic: "OSI & TCP/IP Model",
  },
  {
    keywords: [
      "aptitude",
      "quantitative",
      "logical",
      "reasoning",
      "verbal",
      "analytical",
    ],
    track: "aptitude",
    topic: "Time & Work (Easy → Medium → Hard)",
  },
  {
    keywords: [
      "communication",
      "presentation",
      "written",
      "interpersonal",
      "teamwork",
      "leadership",
    ],
    track: "communication",
    topic: "Tell me about yourself",
  },
];

function mapSkillToPrep(skill: string): { track: string; topic: string } {
  const s = skill.toLowerCase();
  for (const entry of SKILL_TO_PREP) {
    if (entry.keywords.some((k) => s.includes(k))) {
      return { track: entry.track, topic: entry.topic };
    }
  }
  return { track: "domain", topic: "" };
}

function buildPrepActions(requirements: JDRequirement[]): PrepAction[] {
  const prepActions: PrepAction[] = [];
  const seenTopics = new Set<string>();

  requirements
    .filter((r) => r.category === "missing" && r.importance === "high")
    .forEach((r) => {
      const { track, topic } = mapSkillToPrep(r.skill);
      const key = `${track}:${topic}`;
      if (!seenTopics.has(key)) {
        seenTopics.add(key);
        prepActions.push({
          label: topic || r.skill,
          description: `Required for this role — ${r.evidence}`,
          href: topic
            ? `/student/placement/prep/${track}/practice?topic=${encodeURIComponent(topic)}&from=jd-analyzer`
            : `/student/placement/prep/${track}`,
          priority: "immediate",
        });
      }
    });

  requirements
    .filter((r) => r.category === "partial")
    .forEach((r) => {
      const { track, topic } = mapSkillToPrep(r.skill);
      const key = `${track}:${topic}`;
      if (!seenTopics.has(key) && prepActions.length < 4) {
        seenTopics.add(key);
        prepActions.push({
          label: topic || r.skill,
          description: `Strengthen your knowledge — ${r.evidence}`,
          href: topic
            ? `/student/placement/prep/${track}/practice?topic=${encodeURIComponent(topic)}&from=jd-analyzer`
            : `/student/placement/prep/${track}`,
          priority: "soon",
        });
      }
    });

  requirements
    .filter((r) => r.category === "missing" && r.importance === "medium")
    .forEach((r) => {
      const { track, topic } = mapSkillToPrep(r.skill);
      const key = `${track}:${topic}`;
      if (!seenTopics.has(key) && prepActions.length < 4) {
        seenTopics.add(key);
        prepActions.push({
          label: topic || r.skill,
          description: r.evidence,
          href: topic
            ? `/student/placement/prep/${track}/practice?topic=${encodeURIComponent(topic)}&from=jd-analyzer`
            : `/student/placement/prep/${track}`,
          priority: "later",
        });
      }
    });

  return prepActions.slice(0, 4);
}

// ─── Requirement group ────────────────────────────────────────────────────────

function RequirementGroup({
  category,
  items,
}: {
  category: RequirementCategory;
  items: JDRequirement[];
}) {
  if (items.length === 0) return null;
  const style = GROUP_STYLES[category];

  return (
    <div className="mb-4">
      <div
        className={cn(
          "rounded-t-lg px-3 py-1.5 text-xs font-medium",
          style.header
        )}
      >
        {style.label(items.length)}
      </div>
      {items.map((req, i) => (
        <div
          key={`${req.skill}-${i}`}
          className={cn(
            "px-3 py-2.5",
            style.itemBorder,
            i === items.length - 1 && "rounded-b-lg"
          )}
        >
          <div className="flex items-start justify-between gap-2">
            <span className="text-sm font-medium text-gray-800">{req.skill}</span>
            <span
              className={cn(
                "shrink-0 rounded px-1.5 text-xs",
                IMPORTANCE_BADGE[req.importance] ?? IMPORTANCE_BADGE.low
              )}
            >
              {req.importance}
            </span>
          </div>
          {req.evidence && (
            <p className="mt-0.5 text-xs text-gray-500">{req.evidence}</p>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function JDAnalyzerPage() {
  const [jdText, setJdText] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<JDAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canAnalyze = jdText.trim().length >= 50 && !isAnalyzing;

  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(JD_STORAGE_KEY);
      if (stored) {
        const { analysis: savedAnalysis, jdText: savedJdText, savedAt } =
          JSON.parse(stored) as {
            analysis: JDAnalysis;
            jdText: string;
            savedAt: number;
          };
        if (Date.now() - savedAt < JD_STORAGE_TTL_MS) {
          setAnalysis(savedAnalysis);
          setJdText(savedJdText);
        }
      }
    } catch {
      // ignore corrupt storage
    }
  }, []);

  function handleNewAnalysis() {
    setAnalysis(null);
    setJdText("");
    sessionStorage.removeItem(JD_STORAGE_KEY);
  }

  async function handleAnalyze() {
    if (jdText.trim().length < 50) return;
    sessionStorage.removeItem(JD_STORAGE_KEY);
    setIsAnalyzing(true);
    setError(null);
    try {
      const res = await fetch("/api/placement/jd-analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jd_text: jdText }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Analysis failed. Try again.");
        return;
      }
      const result = data as JDAnalysis;
      setAnalysis(result);
      sessionStorage.setItem(
        JD_STORAGE_KEY,
        JSON.stringify({ analysis: result, jdText, savedAt: Date.now() })
      );
    } catch {
      setError("Analysis failed. Try again.");
    } finally {
      setIsAnalyzing(false);
    }
  }

  return (
    <div className="max-w-6xl space-y-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        {/* ── Left panel: Input ── */}
        <div className="lg:col-span-2">
          <h1 className="text-2xl font-semibold text-gray-900">JD Analyzer</h1>
          <p className="mt-1 text-sm text-gray-500">
            Paste any job description to see how your academic background maps to
            the role
          </p>

          <div className="mt-4">
            <textarea
              value={jdText}
              onChange={(e) => setJdText(e.target.value.slice(0, MAX_CHARS))}
              placeholder="Paste the full job description here..."
              className="h-64 w-full resize-none rounded-xl border border-gray-200 p-3 text-sm text-gray-800 focus:border-blue-400 focus:outline-none"
            />
            <p className="mt-1 text-right text-xs text-gray-400">
              {jdText.length}/{MAX_CHARS}
            </p>
          </div>

          <Button
            onClick={handleAnalyze}
            disabled={!canAnalyze}
            className="mt-2 w-full bg-blue-600 text-white hover:bg-blue-700"
          >
            {isAnalyzing ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Analyzing...
              </>
            ) : (
              "Analyze"
            )}
          </Button>

          {error && (
            <p className="mt-2 text-center text-sm text-amber-600">{error}</p>
          )}

          {!isAnalyzing && !error && (
            <p className="mt-2 text-center text-xs text-gray-400">
              Analysis takes ~10 seconds
            </p>
          )}

          <button
            type="button"
            onClick={() => setJdText(SAMPLE_JD)}
            className="mt-3 cursor-pointer text-xs text-blue-500 hover:underline"
          >
            Try a sample JD →
          </button>
        </div>

        {/* ── Right panel: Results ── */}
        <div className="lg:col-span-3">
          {isAnalyzing ? (
            <ResultsSkeleton />
          ) : analysis ? (
            <AnalysisResults
              analysis={analysis}
              onNewAnalysis={handleNewAnalysis}
            />
          ) : (
            <EmptyState />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex min-h-[20rem] flex-col items-center justify-center rounded-xl border border-dashed border-gray-200 text-center text-gray-400">
      <FileSearch className="mb-3 h-12 w-12 text-gray-200" />
      <p className="text-sm font-medium text-gray-500">
        Your analysis will appear here
      </p>
      <p className="text-xs text-gray-400">
        Paste a job description and click Analyze
      </p>
    </div>
  );
}

// ─── Loading skeleton ─────────────────────────────────────────────────────────

function ResultsSkeleton() {
  return (
    <div className="rounded-xl border border-gray-200 p-5">
      <div className="h-8 w-48 animate-pulse rounded bg-gray-100" />
      <div className="mt-2 h-4 w-32 animate-pulse rounded bg-gray-100" />
      <div className="mt-6 space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-2 w-full animate-pulse rounded bg-gray-100" />
        ))}
      </div>
    </div>
  );
}

// ─── Results ──────────────────────────────────────────────────────────────────

function AnalysisResults({
  analysis,
  onNewAnalysis,
}: {
  analysis: JDAnalysis;
  onNewAnalysis: () => void;
}) {
  const fitClass =
    FIT_BANNER[analysis.overall_fit] ?? FIT_BANNER.developing;

  const grouped: Record<RequirementCategory, JDRequirement[]> = {
    knows: [],
    partial: [],
    missing: [],
  };
  for (const req of analysis.requirements ?? []) {
    if (grouped[req.category]) grouped[req.category].push(req);
  }

  const uniqueActions = buildPrepActions(analysis.requirements ?? []);

  return (
    <div className="rounded-xl border border-gray-200 p-5">
      {/* Header block */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h2 className="text-xl font-bold text-gray-900">{analysis.job_title}</h2>
          {analysis.experience_level && (
            <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700">
              {analysis.experience_level}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onNewAnalysis}
          className="rounded border border-gray-200 px-2 py-1 text-xs text-gray-400 hover:text-gray-600"
        >
          Clear → New Analysis
        </button>
      </div>
      {analysis.company_name && (
        <p className="text-sm text-gray-500">{analysis.company_name}</p>
      )}

      {/* Overall fit banner */}
      {analysis.fit_summary && (
        <div className={cn("mt-3 rounded-lg border px-4 py-3 text-sm", fitClass)}>
          {analysis.fit_summary}
        </div>
      )}

      {/* Requirements breakdown */}
      <h3 className="mb-3 mt-6 text-sm font-semibold text-gray-700">
        Skills &amp; Knowledge Match
      </h3>
      {GROUP_ORDER.map((cat) => (
        <RequirementGroup key={cat} category={cat} items={grouped[cat]} />
      ))}

      {/* Action items */}
      {(analysis.action_items ?? []).length > 0 && (
        <>
          <h3 className="mb-3 mt-6 text-sm font-semibold text-gray-700">
            Your Action Plan
          </h3>
          <ol className="space-y-2.5">
            {analysis.action_items.map((item, i) => (
              <li key={i} className="flex items-start gap-3">
                <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs text-white">
                  {i + 1}
                </span>
                <span className="text-sm text-gray-700">{item}</span>
              </li>
            ))}
          </ol>
        </>
      )}

      {/* Recommended prep */}
      <div className="mt-6 border-t border-gray-100 pt-4">
        <h3 className="mb-3 text-sm font-semibold text-gray-700">
          Recommended Next Steps
        </h3>
        {uniqueActions.length > 0 ? (
          <div className="space-y-2">
            {uniqueActions.map((action, i) => (
              <Link
                key={i}
                href={action.href}
                className="group flex items-start justify-between rounded-lg border border-gray-200 p-3 transition-colors hover:border-blue-300 hover:bg-blue-50/30"
              >
                <div className="flex items-start gap-3">
                  <span
                    className={cn(
                      "mt-0.5 h-2 w-2 shrink-0 rounded-full",
                      action.priority === "immediate"
                        ? "bg-amber-500"
                        : action.priority === "soon"
                          ? "bg-blue-400"
                          : "bg-gray-300"
                    )}
                  />
                  <div>
                    <p className="text-sm font-medium text-gray-800">
                      {action.label}
                    </p>
                    <p className="mt-0.5 text-xs text-gray-500">
                      {action.description}
                    </p>
                  </div>
                </div>
                <span className="ml-3 shrink-0 text-sm text-blue-600 transition-transform group-hover:translate-x-0.5">
                  →
                </span>
              </Link>
            ))}
          </div>
        ) : (
          <Link
            href="/student/placement/prep/aptitude"
            className="text-sm text-blue-600 hover:underline"
          >
            Start with Aptitude prep →
          </Link>
        )}
      </div>
    </div>
  );
}
