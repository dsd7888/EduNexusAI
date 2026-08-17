import { createAdminClient } from "@/lib/db/supabase-server";
import { requireRole, apiError, apiSuccess } from "@/lib/api/helpers";
import type { NextRequest } from "next/server";
import type { ResumeData, ResumeVersion } from "@/types/placement";

// ─── Default ──────────────────────────────────────────────────────────────────

const DEFAULT_RESUME: ResumeData = {
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Mirrors the caps enforced client-side in resume/page.tsx (MAX_PROJECTS, MAX_BULLETS,
// MAX_ACHIEVEMENTS, MAX_COURSES) — those are UI-only and don't stop a direct API call.
const MAX_PROJECTS = 4;
const MAX_BULLETS = 3;
const MAX_ACHIEVEMENTS = 5;
const MAX_COURSES = 6;

/** Returns the name of the first malformed field, or null if the shape is valid. */
function validateResumeShape(resume: unknown): string | null {
  if (!resume || typeof resume !== "object") return "resume";
  const r = resume as Record<string, unknown>;

  if (!Array.isArray(r.education)) return "education";
  if (!Array.isArray(r.projects)) return "projects";
  if (!Array.isArray(r.internships)) return "internships";
  if (!Array.isArray(r.certifications)) return "certifications";
  if (!Array.isArray(r.achievements)) return "achievements";
  if (!Array.isArray(r.soft_skills)) return "soft_skills";

  if (!r.technical_skills || typeof r.technical_skills !== "object") return "technical_skills";
  const ts = r.technical_skills as Record<string, unknown>;
  if (
    !Array.isArray(ts.languages) ||
    !Array.isArray(ts.frameworks) ||
    !Array.isArray(ts.tools) ||
    !Array.isArray(ts.concepts)
  ) {
    return "technical_skills";
  }

  return null;
}

function capArraySizes(resume: ResumeData): ResumeData {
  return {
    ...resume,
    projects: resume.projects.slice(0, MAX_PROJECTS).map((p) => ({
      ...p,
      bullets: Array.isArray(p.bullets) ? p.bullets.slice(0, MAX_BULLETS) : p.bullets,
    })),
    internships: resume.internships.map((it) => ({
      ...it,
      bullets: Array.isArray(it.bullets) ? it.bullets.slice(0, MAX_BULLETS) : it.bullets,
    })),
    achievements: resume.achievements.slice(0, MAX_ACHIEVEMENTS),
    education: resume.education.map((ed) => ({
      ...ed,
      relevant_courses: Array.isArray(ed.relevant_courses)
        ? ed.relevant_courses.slice(0, MAX_COURSES)
        : ed.relevant_courses,
    })),
  };
}

function computeCompleteness(resume: ResumeData): number {
  const fields = [
    resume.full_name,
    resume.email,
    resume.phone,
    resume.education.length > 0,
    resume.technical_skills.languages.length > 0,
    resume.technical_skills.concepts.length > 0,
    resume.projects.length > 0,
    resume.projects.length >= 2,
    resume.linkedin_url,
    resume.github_url,
  ];
  return Math.round((fields.filter(Boolean).length / fields.length) * 100);
}

// ─── GET ─────────────────────────────────────────────────────────────────────

export async function GET() {
  try {
    const authResult = await requireRole(["student"]);
    if (authResult instanceof Response) return authResult;
    const { user } = authResult;

    const adminClient = createAdminClient();
    const { data, error } = await adminClient
      .from("student_placement_profiles")
      .select("resume_data, resume_versions")
      .eq("student_id", user.id)
      .maybeSingle();

    if (error) return apiError("Failed to fetch resume", 500);

    const resume = (data?.resume_data as ResumeData | null) ?? DEFAULT_RESUME;
    const versions = (data?.resume_versions as ResumeVersion[] | null) ?? [];

    return apiSuccess({ resume, versions });
  } catch {
    return apiError("Internal server error", 500);
  }
}

// ─── POST ────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireRole(["student"]);
    if (authResult instanceof Response) return authResult;
    const { user } = authResult;

    const body = (await request.json()) as { resume?: ResumeData };
    if (!body.resume || typeof body.resume !== "object") {
      return apiError("Missing resume data", 400);
    }

    const shapeError = validateResumeShape(body.resume);
    if (shapeError) {
      return apiError(`Invalid or missing field: ${shapeError}`, 400);
    }

    const resume: ResumeData = capArraySizes(body.resume);

    const completeness = computeCompleteness(resume);
    resume.completeness = completeness;
    resume.last_updated = new Date().toISOString();

    const adminClient = createAdminClient();
    const { error } = await adminClient
      .from("student_placement_profiles")
      .upsert(
        { student_id: user.id, resume_data: resume, resume_completeness: completeness },
        { onConflict: "student_id" }
      );

    if (error) return apiError("Failed to save resume", 500);

    return apiSuccess({ resume, completeness });
  } catch {
    return apiError("Internal server error", 500);
  }
}
