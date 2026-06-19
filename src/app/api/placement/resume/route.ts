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

    const resume: ResumeData = body.resume;

    const completeness = computeCompleteness(resume);
    resume.completeness = completeness;
    resume.last_updated = new Date().toISOString();

    const adminClient = createAdminClient();
    const { error } = await adminClient
      .from("student_placement_profiles")
      .update({ resume_data: resume, resume_completeness: completeness })
      .eq("student_id", user.id);

    if (error) return apiError("Failed to save resume", 500);

    return apiSuccess({ resume, completeness });
  } catch {
    return apiError("Internal server error", 500);
  }
}
