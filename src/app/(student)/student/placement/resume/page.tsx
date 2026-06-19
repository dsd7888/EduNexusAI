"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import {
  ChevronDown,
  ChevronRight,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { createBrowserClient } from "@/lib/db/supabase-browser";
import type {
  ATSAnalysis,
  ResumeAchievement,
  ResumeCertification,
  ResumeData,
  ResumeEducation,
  ResumeInternship,
  ResumeProject,
} from "@/types/placement";

// ─── Constants ────────────────────────────────────────────────────────────────

type SectionId =
  | "personal"
  | "education"
  | "skills"
  | "projects"
  | "internships"
  | "certifications"
  | "achievements";

const SECTIONS: Array<{ id: SectionId; label: string }> = [
  { id: "personal", label: "Personal Info" },
  { id: "education", label: "Education" },
  { id: "skills", label: "Skills" },
  { id: "projects", label: "Projects" },
  { id: "internships", label: "Internships" },
  { id: "certifications", label: "Certifications" },
  { id: "achievements", label: "Achievements" },
];

const MAX_PROJECTS = 4;
const MAX_BULLETS = 3;
const MAX_ACHIEVEMENTS = 5;
const MAX_COURSES = 6;

const JD_STORAGE_KEY = "jd_analysis_last";
const JD_STORAGE_TTL_MS = 2 * 60 * 60 * 1000;

const CERT_SUGGESTIONS: Array<{ name: string; issuer: string }> = [
  { name: "Google Cloud Fundamentals", issuer: "Google Cloud" },
  { name: "AWS Cloud Practitioner", issuer: "Amazon Web Services" },
  { name: "Meta Front-End Developer", issuer: "Meta" },
  { name: "HackerRank SQL (Basic)", issuer: "HackerRank" },
];

const ACHIEVEMENT_PLACEHOLDERS = [
  "Ranked in top 10% in college placement aptitude test",
  "Solved 50+ problems on LeetCode",
  "Won 2nd place in college hackathon (team of 4)",
];

// ─── Factories ────────────────────────────────────────────────────────────────

function uid(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : Date.now().toString();
}

function makeEmptyResume(): ResumeData {
  return {
    full_name: "",
    email: "",
    phone: "",
    linkedin_url: null,
    github_url: null,
    portfolio_url: null,
    education: [],
    technical_skills: { languages: [], frameworks: [], tools: [], concepts: [] },
    soft_skills: [],
    projects: [],
    internships: [],
    certifications: [],
    achievements: [],
    summary: "",
    skills: [],
    last_updated: "",
    completeness: 0,
  } as unknown as ResumeData;
}

function newEducation(branch: string, cgpa: string): ResumeEducation {
  return {
    degree: "B.Tech",
    branch: branch || "",
    university: "P.P. Savani University",
    cgpa: cgpa || "",
    year_of_passing: "",
    relevant_courses: [],
  };
}

function newProject(): ResumeProject {
  return {
    id: uid(),
    title: "",
    tech_stack: [],
    bullets: [],
    github_url: null,
    live_url: null,
    duration: null,
    description: "",
    from_mini_project: false,
  } as unknown as ResumeProject;
}

function newInternship(): ResumeInternship {
  return {
    id: uid(),
    company: "",
    role: "",
    duration: "",
    bullets: [],
    location: null,
  };
}

function newCertification(name = "", issuer = ""): ResumeCertification {
  return { id: uid(), name, issuer, year: "", url: null } as ResumeCertification;
}

function newAchievement(): ResumeAchievement {
  return { id: uid(), text: "" };
}

// ─── Completeness (mirrors server formula) ────────────────────────────────────

function computeCompleteness(resume: ResumeData): number {
  const ts = resume.technical_skills ?? { languages: [], frameworks: [], tools: [], concepts: [] };
  const fields = [
    resume.full_name,
    resume.email,
    resume.phone,
    (resume.education ?? []).length > 0,
    ts.languages.length > 0,
    ts.concepts.length > 0,
    (resume.projects ?? []).length > 0,
    (resume.projects ?? []).length >= 2,
    resume.linkedin_url,
    resume.github_url,
  ];
  return Math.round((fields.filter(Boolean).length / fields.length) * 100);
}

function sectionHasData(id: SectionId, r: ResumeData): boolean {
  const ts = r.technical_skills ?? { languages: [], frameworks: [], tools: [], concepts: [] };
  switch (id) {
    case "personal":
      return Boolean(r.full_name && r.email);
    case "education":
      return (r.education ?? []).some((e) => e.branch || e.university);
    case "skills":
      return (
        ts.languages.length > 0 ||
        ts.frameworks.length > 0 ||
        ts.tools.length > 0 ||
        ts.concepts.length > 0
      );
    case "projects":
      return (r.projects ?? []).length > 0;
    case "internships":
      return (r.internships ?? []).length > 0;
    case "certifications":
      return (r.certifications ?? []).length > 0;
    case "achievements":
      return (r.achievements ?? []).length > 0;
  }
}

// ─── Reusable: Tag input ──────────────────────────────────────────────────────

function TagInput({
  values,
  onChange,
  placeholder,
  max,
}: {
  values: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  max?: number;
}) {
  const [draft, setDraft] = useState("");
  const atMax = max !== undefined && values.length >= max;

  function add(raw: string) {
    const t = raw.trim();
    if (!t || atMax || values.includes(t)) return;
    onChange([...values, t]);
    setDraft("");
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-gray-200 p-2 focus-within:border-blue-400">
      {values.map((v, i) => (
        <span
          key={`${v}-${i}`}
          className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700"
        >
          {v}
          <button
            type="button"
            onClick={() => onChange(values.filter((_, idx) => idx !== i))}
            className="text-gray-400 hover:text-gray-700"
            aria-label={`Remove ${v}`}
          >
            ×
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add(draft);
          } else if (e.key === "Backspace" && !draft && values.length > 0) {
            onChange(values.slice(0, -1));
          }
        }}
        onBlur={() => add(draft)}
        disabled={atMax}
        placeholder={values.length === 0 ? placeholder : ""}
        className="min-w-[7rem] flex-1 bg-transparent text-sm text-gray-800 outline-none placeholder:text-gray-400"
      />
    </div>
  );
}

function SuggestionChips({
  suggestions,
  exclude,
  onPick,
}: {
  suggestions: string[];
  exclude: string[];
  onPick: (s: string) => void;
}) {
  const available = suggestions.filter((s) => !exclude.includes(s)).slice(0, 8);
  if (available.length === 0) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {available.map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => onPick(s)}
          className="rounded-full border border-gray-200 px-2 py-0.5 text-xs text-gray-500 hover:border-blue-300 hover:text-blue-600"
        >
          + {s}
        </button>
      ))}
    </div>
  );
}

// ─── Reusable: labelled text field ────────────────────────────────────────────

function Field({
  label,
  value,
  onChange,
  onBlur,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-gray-600">{label}</span>
      <input
        type={type}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        placeholder={placeholder}
        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800 outline-none focus:border-blue-400 placeholder:text-gray-400"
      />
    </label>
  );
}

// ─── Reusable: bullet rewrite variant picker (the wow moment) ──────────────────

function VariantCards({
  variants,
  onUse,
  onKeep,
}: {
  variants: Array<{ text: string; improvement: string }>;
  onUse: (text: string) => void;
  onKeep: () => void;
}) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShown(true), 10);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="mt-2 rounded-lg border border-blue-100 bg-blue-50/40 p-2">
      <div className="grid gap-2 md:grid-cols-3">
        {variants.map((v, i) => (
          <div
            key={i}
            style={{ transitionDelay: `${i * 150}ms` }}
            className={cn(
              "flex flex-col rounded-lg border border-gray-200 bg-white p-2 transition-all duration-150 ease-out",
              shown ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
            )}
          >
            <p className="text-sm text-gray-800">{v.text}</p>
            <p className="mt-1 text-xs text-blue-600">{v.improvement}</p>
            <button
              type="button"
              onClick={() => onUse(v.text)}
              className="mt-2 w-full rounded-md border border-blue-500 px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50"
            >
              Use this
            </button>
          </div>
        ))}
      </div>
      <div className="mt-1.5 text-right">
        <button
          type="button"
          onClick={onKeep}
          className="text-xs text-gray-400 hover:text-gray-600"
        >
          Keep original
        </button>
      </div>
    </div>
  );
}

// ─── Reusable: ATS score ring ─────────────────────────────────────────────────

function ScoreRing({ score }: { score: number }) {
  const stroke = score >= 75 ? "#10b981" : score >= 50 ? "#f59e0b" : "#64748b";
  return (
    <div className="flex flex-col items-center">
      <svg width="96" height="96" viewBox="0 0 80 80">
        <circle cx="40" cy="40" r="34" fill="none" stroke="#e5e7eb" strokeWidth="8" />
        <circle
          cx="40"
          cy="40"
          r="34"
          fill="none"
          stroke={stroke}
          strokeWidth="8"
          strokeDasharray={`${(Math.max(0, Math.min(100, score)) / 100) * 213.6} 213.6`}
          strokeLinecap="round"
          transform="rotate(-90 40 40)"
        />
        <text x="40" y="44" textAnchor="middle" fontSize="20" fontWeight="700" fill="#111827">
          {score}
        </text>
      </svg>
      <span className="mt-1 text-xs font-medium text-gray-500">ATS Match Score</span>
    </div>
  );
}

// ─── Bullet editor (shared by projects + internships) ─────────────────────────

function BulletList({
  bullets,
  context,
  keyPrefix,
  rewritingBullet,
  bulletVariants,
  onChangeBullet,
  onAddBullet,
  onRemoveBullet,
  onRewrite,
  onUseVariant,
  onKeepOriginal,
}: {
  bullets: string[];
  context: string;
  keyPrefix: string;
  rewritingBullet: string | null;
  bulletVariants: Array<{ text: string; improvement: string }> | null;
  onChangeBullet: (idx: number, text: string) => void;
  onAddBullet: () => void;
  onRemoveBullet: (idx: number) => void;
  onRewrite: (bulletKey: string, text: string, context: string) => void;
  onUseVariant: (idx: number, text: string) => void;
  onKeepOriginal: () => void;
}) {
  return (
    <div className="space-y-2">
      <span className="block text-xs font-medium text-gray-600">
        Bullets ({bullets.length}/{MAX_BULLETS})
      </span>
      {bullets.map((b, idx) => {
        const bulletKey = `${keyPrefix}:${idx}`;
        const isRewriting = rewritingBullet === bulletKey;
        const isLoading = isRewriting && bulletVariants === null;
        return (
          <div key={idx}>
            <div className="flex items-start gap-2">
              <textarea
                rows={1}
                value={b}
                onChange={(e) => onChangeBullet(idx, e.target.value)}
                placeholder="Built X that did Y, reducing Z by N%"
                className="min-h-[2.25rem] flex-1 resize-y rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800 outline-none focus:border-blue-400 placeholder:text-gray-400"
              />
              <button
                type="button"
                onClick={() => onRewrite(bulletKey, b, context)}
                disabled={isLoading || !b.trim()}
                className="mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-md border border-blue-200 px-2 py-1.5 text-xs font-medium text-blue-600 hover:bg-blue-50 disabled:opacity-40"
              >
                {isLoading ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Sparkles className="size-3.5" />
                )}
                Rewrite
              </button>
              <button
                type="button"
                onClick={() => onRemoveBullet(idx)}
                className="mt-1.5 shrink-0 text-gray-300 hover:text-red-500"
                aria-label="Remove bullet"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
            {isLoading && (
              <div className="mt-2 h-16 animate-pulse rounded-lg bg-gray-100" />
            )}
            {isRewriting && bulletVariants && (
              <VariantCards
                variants={bulletVariants}
                onUse={(text) => onUseVariant(idx, text)}
                onKeep={onKeepOriginal}
              />
            )}
          </div>
        );
      })}
      {bullets.length < MAX_BULLETS && (
        <button
          type="button"
          onClick={onAddBullet}
          className="text-xs text-blue-600 hover:underline"
        >
          + Add bullet
        </button>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ResumeBuilderPage() {
  const [resume, setResume] = useState<ResumeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeSection, setActiveSection] = useState<SectionId>("personal");

  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [, setIsDirty] = useState(false);

  const [subjectSuggestions, setSubjectSuggestions] = useState<string[]>([]);
  const [conceptSuggestions, setConceptSuggestions] = useState<string[]>([]);

  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [expandedInterns, setExpandedInterns] = useState<Set<string>>(new Set());

  const [rewritingBullet, setRewritingBullet] = useState<string | null>(null);
  const [bulletVariants, setBulletVariants] = useState<
    Array<{ text: string; improvement: string }> | null
  >(null);

  const [jdText, setJdText] = useState("");
  const [jdRoleTitle, setJdRoleTitle] = useState<string>("");
  const [atsAnalysis, setAtsAnalysis] = useState<ATSAnalysis | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [atsError, setAtsError] = useState<string | null>(null);

  const [achPlaceholders, setAchPlaceholders] = useState<Record<string, string>>({});

  const [exporting, setExporting] = useState<null | "pdf" | "docx">(null);

  // Refs for debounced + unmount save
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resumeRef = useRef<ResumeData | null>(null);
  const dirtyRef = useRef(false);
  useEffect(() => {
    resumeRef.current = resume;
  }, [resume]);

  // ── Save ────────────────────────────────────────────────────────────────────

  const saveResume = useCallback(async () => {
    const r = resumeRef.current;
    if (!r) return;
    setSaveStatus("saving");
    try {
      const res = await fetch("/api/placement/resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resume: r }),
      });
      if (res.ok) {
        const data = (await res.json()) as { completeness: number };
        setResume((prev) =>
          prev ? { ...prev, completeness: data.completeness } : prev
        );
        dirtyRef.current = false;
        setIsDirty(false);
        setSaveStatus("saved");
      } else {
        setSaveStatus("idle");
      }
    } catch {
      setSaveStatus("idle");
    }
  }, []);

  const scheduleSave = useCallback(() => {
    dirtyRef.current = true;
    setIsDirty(true);
    setSaveStatus("saving");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void saveResume();
    }, 2000);
  }, [saveResume]);

  const updateResume = useCallback(
    (updater: (r: ResumeData) => ResumeData) => {
      setResume((prev) => (prev ? updater(prev) : prev));
      scheduleSave();
    },
    [scheduleSave]
  );

  // Save on unmount if dirty (keepalive so it survives navigation)
  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (dirtyRef.current && resumeRef.current) {
        try {
          fetch("/api/placement/resume", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ resume: resumeRef.current }),
            keepalive: true,
          });
        } catch {
          /* best effort */
        }
      }
    };
  }, []);

  // ── ATS analysis ──────────────────────────────────────────────────────────────

  const runAnalysis = useCallback(
    async (text: string, currentResume: ResumeData | null) => {
      if (!currentResume) return;
      if (text.trim().length < 50) {
        setAtsError("Paste a longer job description (50+ characters).");
        return;
      }
      setIsAnalyzing(true);
      setAtsError(null);
      try {
        const res = await fetch("/api/placement/resume/ats", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ resume: currentResume, jd_text: text }),
        });
        const data = await res.json();
        if (res.ok) {
          setAtsAnalysis(data as ATSAnalysis);
        } else {
          setAtsError(data.error ?? "Analysis failed. Try again.");
        }
      } catch {
        setAtsError("Analysis failed. Try again.");
      } finally {
        setIsAnalyzing(false);
      }
    },
    []
  );

  const clearAnalysis = useCallback(() => setAtsAnalysis(null), []);

  // ── Mount: parallel pre-population ─────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;

    async function init() {
      const supabase = createBrowserClient();

      const profilePromise = (async () => {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) return null;
        const { data } = await supabase
          .from("profiles")
          .select("full_name, email, branch, semester")
          .eq("id", user.id)
          .single();
        return data as {
          full_name: string | null;
          email: string | null;
          branch: string | null;
          semester: number | null;
        } | null;
      })();

      const [resumeRes, placementRes, masteryRes, profileRow] =
        await Promise.all([
          fetch("/api/placement/resume").then((r) => (r.ok ? r.json() : null)),
          fetch("/api/placement/profile").then((r) => (r.ok ? r.json() : null)),
          fetch("/api/placement/prep/mastery").then((r) =>
            r.ok ? r.json() : null
          ),
          profilePromise,
        ]);

      if (cancelled) return;

      const branch = profileRow?.branch ?? "";
      const cgpaRaw = placementRes?.profile?.cgpa;
      const cgpa = cgpaRaw !== null && cgpaRaw !== undefined ? String(cgpaRaw) : "";

      // Base resume from server (already a full default when empty)
      const base: ResumeData = resumeRes?.resume ?? makeEmptyResume();

      // Pre-populate empty fields only
      const next: ResumeData = {
        ...base,
        technical_skills: base.technical_skills ?? { languages: [], frameworks: [], tools: [], concepts: [] },
        projects: base.projects ?? [],
        education: base.education ?? [],
        internships: base.internships ?? [],
        certifications: base.certifications ?? [],
        achievements: base.achievements ?? [],
      };
      if (!next.full_name && profileRow?.full_name) next.full_name = profileRow.full_name;
      if (!next.email && profileRow?.email) next.email = profileRow.email;

      if (!next.education || next.education.length === 0) {
        next.education = [newEducation(branch, cgpa)];
      } else {
        const ed = { ...next.education[0] };
        if (!ed.branch && branch) ed.branch = branch;
        if (!ed.cgpa && cgpa) ed.cgpa = cgpa;
        if (!ed.degree) ed.degree = "B.Tech";
        if (!ed.university) ed.university = "P.P. Savani University";
        next.education = [ed, ...next.education.slice(1)];
      }

      setResume(next);

      // Concept suggestions from practiced topics (recent_accuracy >= 40)
      const masteryRows: Array<{ topic: string; recent_accuracy: number }> =
        masteryRes?.mastery ?? [];
      const concepts = Array.from(
        new Set(
          masteryRows
            .filter((m) => (m.recent_accuracy ?? 0) >= 40)
            .map((m) => m.topic)
            .filter(Boolean)
        )
      ).slice(0, 8);
      setConceptSuggestions(concepts);

      // Subject suggestions for relevant courses
      if (branch) {
        try {
          const { data: subjectRows } = await supabase
            .from("subjects")
            .select("name")
            .eq("branch", branch)
            .limit(6);
          if (!cancelled && subjectRows) {
            setSubjectSuggestions(
              (subjectRows as Array<{ name: string }>)
                .map((s) => s.name)
                .filter(Boolean)
            );
          }
        } catch {
          /* suggestions are optional */
        }
      }

      setLoading(false);

      // Auto-trigger ATS from last JD analyzer result (within 2h, completeness > 40)
      try {
        const stored = sessionStorage.getItem(JD_STORAGE_KEY);
        if (stored) {
          const parsed = JSON.parse(stored) as {
            analysis?: { job_title?: string };
            jdText?: string;
            savedAt?: number;
          };
          if (
            parsed.jdText &&
            parsed.savedAt &&
            Date.now() - parsed.savedAt < JD_STORAGE_TTL_MS
          ) {
            setJdText(parsed.jdText);
            if (parsed.analysis?.job_title) setJdRoleTitle(parsed.analysis.job_title);
            if (computeCompleteness(next) > 40) {
              void runAnalysis(parsed.jdText, next);
            }
          }
        }
      } catch {
        /* ignore corrupt storage */
      }
    }

    void init();
    return () => {
      cancelled = true;
    };
  }, [runAnalysis]);

  // ── Mutators ──────────────────────────────────────────────────────────────────

  const updatePersonal = (field: keyof ResumeData, value: string) => {
    updateResume((r) => ({ ...r, [field]: value }));
  };

  const updateEducation = (field: keyof ResumeEducation, value: string | string[]) => {
    updateResume((r) => {
      const ed = r.education.length > 0 ? { ...r.education[0] } : newEducation("", "");
      (ed as unknown as Record<string, unknown>)[field] = value;
      return { ...r, education: [ed, ...r.education.slice(1)] };
    });
  };

  const updateSkillCategory = (
    cat: "languages" | "frameworks" | "tools" | "concepts",
    next: string[]
  ) => {
    updateResume((r) => ({
      ...r,
      technical_skills: { ...r.technical_skills, [cat]: next },
    }));
  };

  // Projects
  const addProject = () =>
    updateResume((r) => {
      if (r.projects.length >= MAX_PROJECTS) return r;
      const p = newProject();
      setExpandedProjects((prev) => new Set(prev).add(p.id));
      return { ...r, projects: [...r.projects, p] };
    });

  const removeProject = (id: string) =>
    updateResume((r) => ({ ...r, projects: r.projects.filter((p) => p.id !== id) }));

  const updateProject = (id: string, patch: Partial<ResumeProject>) =>
    updateResume((r) => ({
      ...r,
      projects: r.projects.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    }));

  // Internships
  const addInternship = () =>
    updateResume((r) => {
      const it = newInternship();
      setExpandedInterns((prev) => new Set(prev).add(it.id));
      return { ...r, internships: [...r.internships, it] };
    });

  const removeInternship = (id: string) =>
    updateResume((r) => ({
      ...r,
      internships: r.internships.filter((it) => it.id !== id),
    }));

  const updateInternship = (id: string, patch: Partial<ResumeInternship>) =>
    updateResume((r) => ({
      ...r,
      internships: r.internships.map((it) =>
        it.id === id ? { ...it, ...patch } : it
      ),
    }));

  // Certifications
  const addCertification = (name = "", issuer = "") =>
    updateResume((r) => ({
      ...r,
      certifications: [...r.certifications, newCertification(name, issuer)],
    }));

  const updateCertification = (id: string, patch: Partial<ResumeCertification>) =>
    updateResume((r) => ({
      ...r,
      certifications: r.certifications.map((c) =>
        c.id === id ? { ...c, ...patch } : c
      ),
    }));

  const removeCertification = (id: string) =>
    updateResume((r) => ({
      ...r,
      certifications: r.certifications.filter((c) => c.id !== id),
    }));

  // Achievements
  const addAchievement = () =>
    updateResume((r) => {
      if (r.achievements.length >= MAX_ACHIEVEMENTS) return r;
      return { ...r, achievements: [...r.achievements, newAchievement()] };
    });

  const updateAchievement = (id: string, text: string) =>
    updateResume((r) => ({
      ...r,
      achievements: r.achievements.map((a) => (a.id === id ? { ...a, text } : a)),
    }));

  const removeAchievement = (id: string) =>
    updateResume((r) => ({
      ...r,
      achievements: r.achievements.filter((a) => a.id !== id),
    }));

  // ── Bullet rewrite flow ─────────────────────────────────────────────────────

  function parseBulletKey(key: string): {
    kind: "proj" | "intern";
    id: string;
    idx: number;
  } | null {
    const [kind, id, idxStr] = key.split(":");
    if ((kind !== "proj" && kind !== "intern") || !id) return null;
    return { kind, id, idx: Number(idxStr) };
  }

  function replaceBulletAt(key: string, text: string) {
    const parsed = parseBulletKey(key);
    if (!parsed) return;
    if (parsed.kind === "proj") {
      updateResume((r) => ({
        ...r,
        projects: r.projects.map((p) =>
          p.id === parsed.id
            ? {
                ...p,
                bullets: p.bullets.map((b, i) => (i === parsed.idx ? text : b)),
              }
            : p
        ),
      }));
    } else {
      updateResume((r) => ({
        ...r,
        internships: r.internships.map((it) =>
          it.id === parsed.id
            ? {
                ...it,
                bullets: it.bullets.map((b, i) => (i === parsed.idx ? text : b)),
              }
            : it
        ),
      }));
    }
  }

  async function rewriteBullet(bulletKey: string, text: string, context: string) {
    if (!text.trim()) return;
    setRewritingBullet(bulletKey);
    setBulletVariants(null);
    try {
      const res = await fetch("/api/placement/resume/rewrite-bullet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bullet: text,
          context,
          role_context: jdText && jdRoleTitle ? jdRoleTitle : undefined,
        }),
      });
      const data = await res.json();
      if (res.ok && Array.isArray(data.variants) && data.variants.length > 0) {
        setBulletVariants(data.variants);
      } else {
        setRewritingBullet(null);
      }
    } catch {
      setRewritingBullet(null);
    }
  }

  function closeRewrite() {
    setRewritingBullet(null);
    setBulletVariants(null);
  }

  // ── Apply an ATS bullet suggestion back into the form ──────────────────────────

  function applyBulletIssue(original: string, suggested: string) {
    updateResume((r) => ({
      ...r,
      projects: r.projects.map((p) => ({
        ...p,
        bullets: p.bullets.map((b) => (b === original ? suggested : b)),
      })),
      internships: r.internships.map((it) => ({
        ...it,
        bullets: it.bullets.map((b) => (b === original ? suggested : b)),
      })),
    }));
  }

  // ── Use last JD analyzer result into the textarea ──────────────────────────────

  function useLastJD() {
    try {
      const stored = sessionStorage.getItem(JD_STORAGE_KEY);
      if (!stored) return;
      const parsed = JSON.parse(stored) as {
        analysis?: { job_title?: string };
        jdText?: string;
      };
      if (parsed.jdText) setJdText(parsed.jdText);
      if (parsed.analysis?.job_title) setJdRoleTitle(parsed.analysis.job_title);
    } catch {
      /* ignore */
    }
  }

  // ── Export ──────────────────────────────────────────────────────────────────

  async function handleExport(format: "pdf" | "docx") {
    const r = resumeRef.current;
    if (!r || exporting) return;
    setExporting(format);
    try {
      const res = await fetch(`/api/placement/resume/export/${format}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resume: r }),
      });
      if (!res.ok) {
        toast.error("Export failed");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `resume_${(r.full_name || "resume").replace(/\s+/g, "_")}.${format}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Export failed");
    } finally {
      setExporting(null);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  if (loading || !resume) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="size-8 animate-spin text-blue-500" />
      </div>
    );
  }

  const completeness = computeCompleteness(resume);
  const canExport = completeness >= 40;
  const ts = resume.technical_skills;
  const edu = resume.education[0] ?? newEducation("", "");

  const navItems = (
    <ul className="space-y-1">
      {SECTIONS.map((s) => {
        const active = s.id === activeSection;
        const has = sectionHasData(s.id, resume);
        return (
          <li key={s.id}>
            <button
              type="button"
              onClick={() => setActiveSection(s.id)}
              className={cn(
                "flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm transition-colors",
                active
                  ? "border-l-2 border-blue-600 bg-blue-50 text-blue-700"
                  : "border-l-2 border-transparent text-gray-600 hover:bg-gray-50"
              )}
            >
              <span>{s.label}</span>
              <span
                className={cn(
                  "size-2 rounded-full",
                  has ? "bg-emerald-500" : "bg-gray-200"
                )}
              />
            </button>
          </li>
        );
      })}
    </ul>
  );

  const completenessFooter = (
    <div className="mt-4 border-t border-gray-100 pt-4">
      <div className="mb-1 flex items-center justify-between text-xs text-gray-500">
        <span>Completeness</span>
        <span className="font-medium text-gray-700">{completeness}%</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
        <div
          className={cn(
            "h-full rounded-full transition-all duration-500",
            completeness >= 75
              ? "bg-emerald-500"
              : completeness >= 40
                ? "bg-amber-500"
                : "bg-gray-300"
          )}
          style={{ width: `${completeness}%` }}
        />
      </div>
      <div className="mt-3 space-y-2">
        <Button
          variant="outline"
          disabled={!canExport || exporting !== null}
          onClick={() => void handleExport("pdf")}
          className="w-full gap-2"
        >
          {exporting === "pdf" && <Loader2 className="size-4 animate-spin" />}
          Download PDF
        </Button>
        <Button
          variant="outline"
          disabled={!canExport || exporting !== null}
          onClick={() => void handleExport("docx")}
          className="w-full gap-2"
        >
          {exporting === "docx" && <Loader2 className="size-4 animate-spin" />}
          Download Word
        </Button>
        {!canExport && (
          <p className="text-center text-xs text-gray-400">
            Reach 40% to enable downloads
          </p>
        )}
      </div>
    </div>
  );

  return (
    <div className="max-w-7xl">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Resume Builder</h1>
          <p className="mt-1 text-sm text-gray-500">
            Build an ATS-friendly fresher resume and match it to any job description.
          </p>
        </div>
        <span className="text-xs text-gray-400">
          {saveStatus === "saving"
            ? "Saving…"
            : saveStatus === "saved"
              ? "Saved"
              : ""}
        </span>
      </div>

      {/* Mobile: horizontal section tabs */}
      <div className="lg:hidden">
        <div className="flex gap-1 overflow-x-auto pb-2">
          {SECTIONS.map((s) => {
            const active = s.id === activeSection;
            const has = sectionHasData(s.id, resume);
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setActiveSection(s.id)}
                className={cn(
                  "flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs",
                  active
                    ? "border-blue-600 bg-blue-50 text-blue-700"
                    : "border-gray-200 text-gray-600"
                )}
              >
                <span
                  className={cn(
                    "size-1.5 rounded-full",
                    has ? "bg-emerald-500" : "bg-gray-300"
                  )}
                />
                {s.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left nav */}
        <nav className="hidden lg:col-span-2 lg:block">
          {navItems}
          {completenessFooter}
        </nav>

        {/* Main editor */}
        <main className="lg:col-span-6">
          <div className="rounded-xl border border-gray-200 bg-white p-5">
            {/* ── Personal ── */}
            {activeSection === "personal" && (
              <div className="space-y-4">
                <h2 className="text-sm font-semibold text-gray-700">Personal Info</h2>
                <Field
                  label="Full Name"
                  value={resume.full_name}
                  onChange={(v) => updatePersonal("full_name", v)}
                  onBlur={() => void saveResume()}
                />
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field
                    label="Email"
                    type="email"
                    value={resume.email}
                    onChange={(v) => updatePersonal("email", v)}
                    onBlur={() => void saveResume()}
                  />
                  <Field
                    label="Phone"
                    value={resume.phone}
                    onChange={(v) => updatePersonal("phone", v)}
                    onBlur={() => void saveResume()}
                  />
                </div>
                <Field
                  label="LinkedIn URL"
                  value={resume.linkedin_url ?? ""}
                  onChange={(v) => updatePersonal("linkedin_url", v)}
                  onBlur={() => void saveResume()}
                  placeholder="linkedin.com/in/yourname"
                />
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field
                    label="GitHub URL"
                    value={resume.github_url ?? ""}
                    onChange={(v) => updatePersonal("github_url", v)}
                    onBlur={() => void saveResume()}
                    placeholder="github.com/yourname"
                  />
                  <Field
                    label="Portfolio URL"
                    value={resume.portfolio_url ?? ""}
                    onChange={(v) => updatePersonal("portfolio_url", v)}
                    onBlur={() => void saveResume()}
                    placeholder="yourname.dev"
                  />
                </div>
              </div>
            )}

            {/* ── Education ── */}
            {activeSection === "education" && (
              <div className="space-y-4">
                <h2 className="text-sm font-semibold text-gray-700">Education</h2>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field
                    label="Degree"
                    value={edu.degree}
                    onChange={(v) => updateEducation("degree", v)}
                  />
                  <Field
                    label="Branch"
                    value={edu.branch}
                    onChange={(v) => updateEducation("branch", v)}
                  />
                </div>
                <Field
                  label="University"
                  value={edu.university}
                  onChange={(v) => updateEducation("university", v)}
                />
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field
                    label="CGPA"
                    value={edu.cgpa}
                    onChange={(v) => updateEducation("cgpa", v)}
                    placeholder="7.8"
                  />
                  <Field
                    label="Year of Passing"
                    value={edu.year_of_passing}
                    onChange={(v) => updateEducation("year_of_passing", v)}
                    placeholder="2026"
                  />
                </div>
                <div>
                  <span className="mb-1 block text-xs font-medium text-gray-600">
                    Relevant Courses (max {MAX_COURSES})
                  </span>
                  <TagInput
                    values={edu.relevant_courses}
                    onChange={(next) => updateEducation("relevant_courses", next)}
                    placeholder="Type a course and press Enter"
                    max={MAX_COURSES}
                  />
                  <SuggestionChips
                    suggestions={subjectSuggestions}
                    exclude={edu.relevant_courses}
                    onPick={(s) =>
                      updateEducation(
                        "relevant_courses",
                        [...edu.relevant_courses, s].slice(0, MAX_COURSES)
                      )
                    }
                  />
                </div>
              </div>
            )}

            {/* ── Skills ── */}
            {activeSection === "skills" && (
              <div className="space-y-4">
                <h2 className="text-sm font-semibold text-gray-700">Skills</h2>
                <div>
                  <span className="mb-1 block text-xs font-medium text-gray-600">
                    Languages
                  </span>
                  <TagInput
                    values={ts.languages}
                    onChange={(next) => updateSkillCategory("languages", next)}
                    placeholder="Java, Python, SQL…"
                  />
                </div>
                <div>
                  <span className="mb-1 block text-xs font-medium text-gray-600">
                    Frameworks &amp; Libraries
                  </span>
                  <TagInput
                    values={ts.frameworks}
                    onChange={(next) => updateSkillCategory("frameworks", next)}
                    placeholder="Spring Boot, React…"
                  />
                </div>
                <div>
                  <span className="mb-1 block text-xs font-medium text-gray-600">
                    Tools
                  </span>
                  <TagInput
                    values={ts.tools}
                    onChange={(next) => updateSkillCategory("tools", next)}
                    placeholder="Git, VS Code, Postman…"
                  />
                </div>
                <div>
                  <span className="mb-1 block text-xs font-medium text-gray-600">
                    Core Concepts
                  </span>
                  <TagInput
                    values={ts.concepts}
                    onChange={(next) => updateSkillCategory("concepts", next)}
                    placeholder="DSA, OOP, DBMS, OS…"
                  />
                  <SuggestionChips
                    suggestions={conceptSuggestions}
                    exclude={ts.concepts}
                    onPick={(s) =>
                      updateSkillCategory("concepts", [...ts.concepts, s])
                    }
                  />
                  <p className="mt-2 text-xs text-amber-600">
                    Only add concepts you can discuss confidently in an interview.
                  </p>
                </div>
              </div>
            )}

            {/* ── Projects ── */}
            {activeSection === "projects" && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-gray-700">
                    Projects ({resume.projects.length}/{MAX_PROJECTS})
                  </h2>
                </div>

                {resume.projects.length === 0 && (
                  <p className="rounded-lg border border-dashed border-gray-200 p-4 text-center text-sm text-gray-400">
                    Add your strongest projects. Quality over quantity — 2 solid
                    projects beat 4 weak ones.
                  </p>
                )}

                {resume.projects.map((p) => {
                  const isOpen = expandedProjects.has(p.id);
                  return (
                    <div
                      key={p.id}
                      className="overflow-hidden rounded-lg border border-gray-200"
                    >
                      {/* Collapsed header */}
                      <div className="flex items-start justify-between gap-3 px-4 py-3">
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedProjects((prev) => {
                              const n = new Set(prev);
                              if (n.has(p.id)) n.delete(p.id);
                              else n.add(p.id);
                              return n;
                            })
                          }
                          className="flex min-w-0 flex-1 items-start gap-2 text-left"
                        >
                          {isOpen ? (
                            <ChevronDown className="mt-0.5 size-4 shrink-0 text-gray-400" />
                          ) : (
                            <ChevronRight className="mt-0.5 size-4 shrink-0 text-gray-400" />
                          )}
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-gray-800">
                              {p.title || "Untitled project"}
                            </p>
                            {!isOpen && (
                              <>
                                {p.tech_stack.length > 0 && (
                                  <div className="mt-1 flex flex-wrap gap-1">
                                    {p.tech_stack.slice(0, 5).map((t) => (
                                      <span
                                        key={t}
                                        className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-600"
                                      >
                                        {t}
                                      </span>
                                    ))}
                                  </div>
                                )}
                                {p.bullets.slice(0, 2).map((b, i) => (
                                  <p
                                    key={i}
                                    className="mt-1 truncate text-xs text-gray-500"
                                  >
                                    • {b}
                                  </p>
                                ))}
                              </>
                            )}
                          </div>
                        </button>
                        <button
                          type="button"
                          onClick={() => removeProject(p.id)}
                          className="shrink-0 text-gray-300 hover:text-red-500"
                          aria-label="Delete project"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </div>

                      {/* Expanded form */}
                      {isOpen && (
                        <div className="space-y-3 border-t border-gray-100 px-4 py-3">
                          <Field
                            label="Title"
                            value={p.title}
                            onChange={(v) => updateProject(p.id, { title: v })}
                          />
                          <div>
                            <span className="mb-1 block text-xs font-medium text-gray-600">
                              Tech Stack
                            </span>
                            <TagInput
                              values={p.tech_stack}
                              onChange={(next) =>
                                updateProject(p.id, { tech_stack: next })
                              }
                              placeholder="React, Node.js, PostgreSQL…"
                            />
                          </div>
                          <div className="grid gap-3 sm:grid-cols-3">
                            <Field
                              label="Duration"
                              value={p.duration ?? ""}
                              onChange={(v) =>
                                updateProject(p.id, { duration: v || null })
                              }
                              placeholder="Jan 2024 – Mar 2024"
                            />
                            <Field
                              label="GitHub URL"
                              value={p.github_url ?? ""}
                              onChange={(v) =>
                                updateProject(p.id, { github_url: v || null })
                              }
                            />
                            <Field
                              label="Live URL"
                              value={p.live_url ?? ""}
                              onChange={(v) =>
                                updateProject(p.id, { live_url: v || null })
                              }
                            />
                          </div>
                          <BulletList
                            bullets={p.bullets}
                            context={`${p.title || "Project"} using ${p.tech_stack.join(", ")}`}
                            keyPrefix={`proj:${p.id}`}
                            rewritingBullet={rewritingBullet}
                            bulletVariants={bulletVariants}
                            onChangeBullet={(idx, text) =>
                              updateProject(p.id, {
                                bullets: p.bullets.map((b, i) =>
                                  i === idx ? text : b
                                ),
                              })
                            }
                            onAddBullet={() =>
                              updateProject(p.id, {
                                bullets: [...p.bullets, ""].slice(0, MAX_BULLETS),
                              })
                            }
                            onRemoveBullet={(idx) =>
                              updateProject(p.id, {
                                bullets: p.bullets.filter((_, i) => i !== idx),
                              })
                            }
                            onRewrite={rewriteBullet}
                            onUseVariant={(idx, text) => {
                              replaceBulletAt(`proj:${p.id}:${idx}`, text);
                              closeRewrite();
                            }}
                            onKeepOriginal={closeRewrite}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}

                <Button
                  variant="outline"
                  onClick={addProject}
                  disabled={resume.projects.length >= MAX_PROJECTS}
                  className="gap-1"
                >
                  <Plus className="size-4" />
                  Add Project
                </Button>
              </div>
            )}

            {/* ── Internships ── */}
            {activeSection === "internships" && (
              <div className="space-y-4">
                <h2 className="text-sm font-semibold text-gray-700">Internships</h2>

                {resume.internships.length === 0 && (
                  <div className="rounded-lg border border-dashed border-gray-200 p-4 text-center">
                    <p className="text-sm font-medium text-gray-600">
                      No internships yet
                    </p>
                    <p className="mt-1 text-xs text-gray-400">
                      Internship experience strengthens your profile significantly.
                      Even a 1-month internship counts.
                    </p>
                  </div>
                )}

                {resume.internships.map((it) => {
                  const isOpen = expandedInterns.has(it.id);
                  return (
                    <div
                      key={it.id}
                      className="overflow-hidden rounded-lg border border-gray-200"
                    >
                      <div className="flex items-start justify-between gap-3 px-4 py-3">
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedInterns((prev) => {
                              const n = new Set(prev);
                              if (n.has(it.id)) n.delete(it.id);
                              else n.add(it.id);
                              return n;
                            })
                          }
                          className="flex min-w-0 flex-1 items-start gap-2 text-left"
                        >
                          {isOpen ? (
                            <ChevronDown className="mt-0.5 size-4 shrink-0 text-gray-400" />
                          ) : (
                            <ChevronRight className="mt-0.5 size-4 shrink-0 text-gray-400" />
                          )}
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-gray-800">
                              {it.role || "Role"}{" "}
                              {it.company && (
                                <span className="text-gray-400">· {it.company}</span>
                              )}
                            </p>
                            {!isOpen &&
                              it.bullets.slice(0, 2).map((b, i) => (
                                <p
                                  key={i}
                                  className="mt-1 truncate text-xs text-gray-500"
                                >
                                  • {b}
                                </p>
                              ))}
                          </div>
                        </button>
                        <button
                          type="button"
                          onClick={() => removeInternship(it.id)}
                          className="shrink-0 text-gray-300 hover:text-red-500"
                          aria-label="Delete internship"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </div>

                      {isOpen && (
                        <div className="space-y-3 border-t border-gray-100 px-4 py-3">
                          <div className="grid gap-3 sm:grid-cols-2">
                            <Field
                              label="Company"
                              value={it.company}
                              onChange={(v) =>
                                updateInternship(it.id, { company: v })
                              }
                            />
                            <Field
                              label="Role"
                              value={it.role}
                              onChange={(v) => updateInternship(it.id, { role: v })}
                            />
                          </div>
                          <div className="grid gap-3 sm:grid-cols-2">
                            <Field
                              label="Duration"
                              value={it.duration}
                              onChange={(v) =>
                                updateInternship(it.id, { duration: v })
                              }
                              placeholder="May 2024 – Jul 2024"
                            />
                            <Field
                              label="Location"
                              value={it.location ?? ""}
                              onChange={(v) =>
                                updateInternship(it.id, { location: v || null })
                              }
                            />
                          </div>
                          <BulletList
                            bullets={it.bullets}
                            context={`${it.role || "Intern"} at ${it.company || "company"}`}
                            keyPrefix={`intern:${it.id}`}
                            rewritingBullet={rewritingBullet}
                            bulletVariants={bulletVariants}
                            onChangeBullet={(idx, text) =>
                              updateInternship(it.id, {
                                bullets: it.bullets.map((b, i) =>
                                  i === idx ? text : b
                                ),
                              })
                            }
                            onAddBullet={() =>
                              updateInternship(it.id, {
                                bullets: [...it.bullets, ""].slice(0, MAX_BULLETS),
                              })
                            }
                            onRemoveBullet={(idx) =>
                              updateInternship(it.id, {
                                bullets: it.bullets.filter((_, i) => i !== idx),
                              })
                            }
                            onRewrite={rewriteBullet}
                            onUseVariant={(idx, text) => {
                              replaceBulletAt(`intern:${it.id}:${idx}`, text);
                              closeRewrite();
                            }}
                            onKeepOriginal={closeRewrite}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}

                <Button variant="outline" onClick={addInternship} className="gap-1">
                  <Plus className="size-4" />
                  Add Internship
                </Button>
              </div>
            )}

            {/* ── Certifications ── */}
            {activeSection === "certifications" && (
              <div className="space-y-4">
                <h2 className="text-sm font-semibold text-gray-700">
                  Certifications
                </h2>

                {resume.certifications.map((c) => (
                  <div
                    key={c.id}
                    className="space-y-3 rounded-lg border border-gray-200 p-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-xs font-medium text-gray-500">
                        Certification
                      </span>
                      <button
                        type="button"
                        onClick={() => removeCertification(c.id)}
                        className="text-gray-300 hover:text-red-500"
                        aria-label="Delete certification"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field
                        label="Name"
                        value={c.name}
                        onChange={(v) => updateCertification(c.id, { name: v })}
                      />
                      <Field
                        label="Issuer"
                        value={c.issuer}
                        onChange={(v) => updateCertification(c.id, { issuer: v })}
                      />
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field
                        label="Year"
                        value={c.year}
                        onChange={(v) => updateCertification(c.id, { year: v })}
                        placeholder="2025"
                      />
                      <Field
                        label="URL"
                        value={c.url ?? ""}
                        onChange={(v) =>
                          updateCertification(c.id, { url: v || null })
                        }
                      />
                    </div>
                  </div>
                ))}

                <Button
                  variant="outline"
                  onClick={() => addCertification()}
                  className="gap-1"
                >
                  <Plus className="size-4" />
                  Add Certification
                </Button>

                <div>
                  <p className="mb-1 text-xs text-gray-400">Popular for freshers:</p>
                  <div className="flex flex-wrap gap-1.5">
                    {CERT_SUGGESTIONS.map((s) => (
                      <button
                        key={s.name}
                        type="button"
                        onClick={() => addCertification(s.name, s.issuer)}
                        className="rounded-full border border-gray-200 px-2 py-0.5 text-xs text-gray-500 hover:border-blue-300 hover:text-blue-600"
                      >
                        + {s.name}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* ── Achievements ── */}
            {activeSection === "achievements" && (
              <div className="space-y-4">
                <h2 className="text-sm font-semibold text-gray-700">
                  Achievements ({resume.achievements.length}/{MAX_ACHIEVEMENTS})
                </h2>

                {resume.achievements.map((a) => (
                  <div key={a.id} className="flex items-center gap-2">
                    <input
                      value={a.text}
                      onChange={(e) => updateAchievement(a.id, e.target.value)}
                      onFocus={() =>
                        setAchPlaceholders((prev) => ({
                          ...prev,
                          [a.id]:
                            ACHIEVEMENT_PLACEHOLDERS[
                              Math.floor(
                                Math.random() * ACHIEVEMENT_PLACEHOLDERS.length
                              )
                            ],
                        }))
                      }
                      placeholder={
                        achPlaceholders[a.id] ?? ACHIEVEMENT_PLACEHOLDERS[0]
                      }
                      className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800 outline-none focus:border-blue-400 placeholder:text-gray-400"
                    />
                    <button
                      type="button"
                      onClick={() => removeAchievement(a.id)}
                      className="shrink-0 text-gray-300 hover:text-red-500"
                      aria-label="Delete achievement"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                ))}

                <p className="text-xs text-gray-400">
                  Be specific. &lsquo;Won hackathon&rsquo; &lt; &lsquo;Won 2nd place
                  among 40 teams&rsquo;
                </p>

                <Button
                  variant="outline"
                  onClick={addAchievement}
                  disabled={resume.achievements.length >= MAX_ACHIEVEMENTS}
                  className="gap-1"
                >
                  <Plus className="size-4" />
                  Add Achievement
                </Button>
              </div>
            )}
          </div>

          {/* Mobile completeness footer */}
          <div className="lg:hidden">{completenessFooter}</div>
        </main>

        {/* Right panel: ATS */}
        <aside className="lg:col-span-4 lg:sticky lg:top-16 lg:self-start lg:max-h-[calc(100vh-4rem)] lg:overflow-y-auto">
          <AtsPanel
            analysis={atsAnalysis}
            jdText={jdText}
            setJdText={setJdText}
            isAnalyzing={isAnalyzing}
            error={atsError}
            onAnalyze={() => void runAnalysis(jdText, resume)}
            onReanalyze={() => void runAnalysis(jdText, resume)}
            onUseLastJD={useLastJD}
            onApplyBullet={applyBulletIssue}
            onClearAnalysis={clearAnalysis}
          />
        </aside>
      </div>
    </div>
  );
}

// ─── ATS panel ────────────────────────────────────────────────────────────────

function AtsPanel({
  analysis,
  jdText,
  setJdText,
  isAnalyzing,
  error,
  onAnalyze,
  onReanalyze,
  onUseLastJD,
  onApplyBullet,
  onClearAnalysis,
}: {
  analysis: ATSAnalysis | null;
  jdText: string;
  setJdText: (v: string) => void;
  isAnalyzing: boolean;
  error: string | null;
  onAnalyze: () => void;
  onReanalyze: () => void;
  onUseLastJD: () => void;
  onApplyBullet: (original: string, suggested: string) => void;
  onClearAnalysis: () => void;
}) {
  const [hasStoredJD, setHasStoredJD] = useState(false);

  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(JD_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as { jdText?: string; savedAt?: number };
        setHasStoredJD(
          Boolean(parsed.jdText) &&
            Boolean(parsed.savedAt) &&
            Date.now() - (parsed.savedAt ?? 0) < JD_STORAGE_TTL_MS
        );
      }
    } catch {
      /* ignore */
    }
  }, []);

  const wrap = (children: ReactNode) => (
    <div className="rounded-xl border border-gray-200 bg-white p-4 lg:sticky lg:top-4">
      {children}
    </div>
  );

  const jdPreview = jdText.slice(0, 60) + (jdText.length > 60 ? "..." : "");

  if (isAnalyzing) {
    return wrap(
      <div className="flex min-h-[16rem] flex-col items-center justify-center gap-3 text-center">
        <Loader2 className="size-7 animate-spin text-blue-500" />
        <p className="text-sm text-gray-500">Scoring your resume…</p>
      </div>
    );
  }

  if (!analysis) {
    return wrap(
      <div className="flex flex-col gap-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-700">
            Attach a Job Description
          </h3>
          <p className="mb-3 text-xs text-gray-400">
            Paste any JD to get ATS score and gap analysis
          </p>
        </div>
        <textarea
          value={jdText}
          onChange={(e) => setJdText(e.target.value)}
          placeholder="Paste the full job description here..."
          maxLength={5000}
          className="h-56 w-full resize-none rounded-xl border border-gray-200 p-3 text-sm text-gray-700 placeholder:text-gray-400 focus:border-blue-400 focus:outline-none"
        />
        <p className="text-right text-xs text-gray-400">
          {jdText.length}/5000 characters
        </p>
        {error && <p className="text-xs text-amber-600">{error}</p>}
        <Button
          onClick={onAnalyze}
          disabled={jdText.trim().length < 50}
          className="w-full bg-blue-600 text-white hover:bg-blue-700"
        >
          Analyze Resume
        </Button>
        {hasStoredJD && (
          <p
            role="button"
            tabIndex={0}
            onClick={onUseLastJD}
            onKeyDown={(e) => e.key === "Enter" && onUseLastJD()}
            className="cursor-pointer text-center text-sm text-blue-600 hover:underline"
          >
            Use last JD Analyzer result →
          </p>
        )}
      </div>
    );
  }

  if (analysis._empty) {
    return wrap(
      <div>
        <div className="mb-4 flex items-center justify-between gap-2">
          <p className="max-w-[70%] truncate text-xs text-gray-400">{jdPreview}</p>
          <button
            type="button"
            onClick={onClearAnalysis}
            className="shrink-0 text-xs text-blue-600 hover:underline"
          >
            Change JD
          </button>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-center">
          <p className="mb-3 text-sm font-medium text-gray-700">
            Your resume needs content before ATS analysis
          </p>
          <ul className="space-y-1 text-left">
            {analysis.ats_tips.map((tip, i) => (
              <li key={i} className="text-sm text-gray-600">
                • {tip}
              </li>
            ))}
          </ul>
        </div>
        <button
          type="button"
          onClick={onReanalyze}
          className="mt-4 w-full text-center text-xs text-blue-500 hover:underline"
        >
          Re-analyze after adding content
        </button>
      </div>
    );
  }

  const found = analysis.keyword_matches.filter((k) => k.found_in_resume);
  const missing = analysis.keyword_matches.filter((k) => !k.found_in_resume);

  return wrap(
    <div className="space-y-4">
      {/* JD anchor */}
      <div className="flex items-center justify-between gap-2">
        <p className="max-w-[70%] truncate text-xs text-gray-400">{jdPreview}</p>
        <button
          type="button"
          onClick={onClearAnalysis}
          className="shrink-0 text-xs text-blue-600 hover:underline"
        >
          Change JD
        </button>
      </div>

      {/* Score ring */}
      <ScoreRing score={analysis.overall_score} />

      {/* Keyword coverage */}
      <div>
        <h3 className="text-sm font-semibold text-gray-700">Keyword Coverage</h3>
        <div className="mt-2 space-y-2">
          <div>
            <p className="mb-1 text-xs text-gray-500">Found ({found.length})</p>
            <div className="flex flex-wrap gap-1">
              {found.slice(0, 8).map((k, i) => (
                <span
                  key={`${k.keyword}-${i}`}
                  className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700"
                >
                  {k.keyword}
                </span>
              ))}
              {found.length > 8 && (
                <span className="text-xs text-gray-400">
                  + {found.length - 8} more
                </span>
              )}
              {found.length === 0 && (
                <span className="text-xs text-gray-400">None matched yet</span>
              )}
            </div>
          </div>
          <div>
            <p className="mb-1 text-xs text-gray-500">Missing ({missing.length})</p>
            <div className="flex flex-wrap gap-1">
              {missing.slice(0, 8).map((k, i) => (
                <span
                  key={`${k.keyword}-${i}`}
                  className="inline-flex items-center gap-1 rounded-full bg-slate-50 px-2 py-0.5 text-xs text-slate-600"
                >
                  {k.importance === "high" && (
                    <span className="size-1.5 rounded-full bg-amber-500" />
                  )}
                  {k.keyword}
                </span>
              ))}
              {missing.length > 8 && (
                <span className="text-xs text-gray-400">
                  + {missing.length - 8} more
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Bullet quality */}
      <div>
        <h3 className="text-sm font-semibold text-gray-700">Bullet Quality</h3>
        {analysis.bullet_issues.length === 0 ? (
          <p className="mt-1 text-sm text-emerald-600">✓ All bullets look strong</p>
        ) : (
          <div className="mt-2 space-y-2">
            {analysis.bullet_issues.map((b, i) => (
              <div key={i} className="rounded-lg border border-gray-200 p-3">
                <p className="truncate text-xs text-gray-500">
                  {b.original.slice(0, 60)}
                  {b.original.length > 60 ? "…" : ""}
                </p>
                <p className="mt-0.5 text-xs text-amber-600">{b.issue}</p>
                <p className="mt-1 text-sm font-medium text-gray-800">
                  {b.suggested}
                </p>
                <button
                  type="button"
                  onClick={() => onApplyBullet(b.original, b.suggested)}
                  className="mt-2 rounded-md border border-blue-500 px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50"
                >
                  Apply
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Skill gaps */}
      {analysis.skill_gap_actions.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-700">Skills to Add</h3>
          <div className="mt-2 space-y-2">
            {analysis.skill_gap_actions.map((g, i) => (
              <div key={i} className="rounded-lg border border-gray-200 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-gray-800">
                    {g.skill}
                  </span>
                  {g.time_estimate && (
                    <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                      {g.time_estimate}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm text-gray-600">{g.how_to_add}</p>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  {g.resource_url && (
                    <a
                      href={g.resource_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-blue-600 hover:underline"
                    >
                      Learn →
                    </a>
                  )}
                  {g.prep_track && g.prep_topic && (
                    <Link
                      href={`/student/placement/prep/${g.prep_track}/practice?topic=${encodeURIComponent(
                        g.prep_topic
                      )}&from=resume`}
                      className="text-xs text-blue-600 hover:underline"
                    >
                      Practice in EduNexus →
                    </Link>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Quick wins */}
      {analysis.ats_tips.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-700">Quick Wins</h3>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-gray-600">
            {analysis.ats_tips.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ol>
        </div>
      )}

      {/* Re-analyze */}
      <div className="border-t border-gray-100 pt-3">
        <button
          type="button"
          onClick={onReanalyze}
          className="w-full text-center text-sm text-blue-600 hover:underline"
        >
          Re-analyze
        </button>
      </div>
    </div>
  );
}
