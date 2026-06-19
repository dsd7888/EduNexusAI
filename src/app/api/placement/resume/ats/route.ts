import type { NextRequest } from "next/server";
import { requireRole, apiError, apiSuccess } from "@/lib/api/helpers";
import { createAdminClient } from "@/lib/db/supabase-server";
import { routeAI } from "@/lib/ai/router";
import type { ResumeData, ATSAnalysis } from "@/types/placement";

export const maxDuration = 60;

// ─── Schema ───────────────────────────────────────────────────────────────────

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    overall_score: {
      type: "number",
      description: "ATS match score 0-100 based on keyword and skill alignment",
    },
    keyword_matches: {
      type: "array",
      description: "All keywords/skills from JD and whether found in resume",
      items: {
        type: "object",
        properties: {
          keyword: { type: "string", description: "Skill or keyword from JD" },
          found_in_resume: { type: "boolean" },
          importance: { type: "string", description: "high, medium, or low" },
          location_in_resume: {
            type: "string",
            description:
              "Where found e.g. skills>languages, or empty string if not found",
          },
        },
        required: ["keyword", "found_in_resume", "importance", "location_in_resume"],
      },
    },
    bullet_issues: {
      type: "array",
      description: "Resume bullets with quality issues",
      items: {
        type: "object",
        properties: {
          section: {
            type: "string",
            description: "e.g. projects[0].bullets[1]",
          },
          original: { type: "string", description: "Original bullet text" },
          issue: {
            type: "string",
            description:
              "Specific issue: vague verb, no outcome, AI language, too long",
          },
          suggested: {
            type: "string",
            description:
              "Rewritten bullet: strong verb + outcome/scope, under 15 words, no filler",
          },
        },
        required: ["section", "original", "issue", "suggested"],
      },
    },
    skill_gap_actions: {
      type: "array",
      description: "Actionable paths for missing high-priority skills only",
      items: {
        type: "object",
        properties: {
          skill: { type: "string" },
          how_to_add: {
            type: "string",
            description:
              "Specific honest steps: do X, build Y, then add to resume",
          },
          time_estimate: {
            type: "string",
            description: "e.g. 2 weekends, 1 week",
          },
          resource_url: {
            type: "string",
            description: "Specific URL or empty string",
          },
          prep_track: {
            type: "string",
            description:
              "aptitude/verbal/domain/communication or empty string",
          },
          prep_topic: {
            type: "string",
            description:
              "Exact topic name matching prep tracks or empty string",
          },
        },
        required: [
          "skill",
          "how_to_add",
          "time_estimate",
          "resource_url",
          "prep_track",
          "prep_topic",
        ],
      },
    },
    ats_tips: {
      type: "array",
      description:
        "3-5 specific actionable ATS tips for this resume+JD combination",
      items: { type: "string" },
    },
  },
  required: [
    "overall_score",
    "keyword_matches",
    "bullet_issues",
    "skill_gap_actions",
    "ats_tips",
  ],
};

// ─── Resume text builder ──────────────────────────────────────────────────────

function buildResumeText(resume: ResumeData): string {
  const parts: string[] = [];

  if (resume.full_name) parts.push(`Name: ${resume.full_name}`);

  const ts = resume.technical_skills ?? { languages: [], frameworks: [], tools: [], concepts: [] };
  const allSkills = [
    ...(ts.languages ?? []),
    ...(ts.frameworks ?? []),
    ...(ts.tools ?? []),
    ...(ts.concepts ?? []),
    ...(resume.soft_skills ?? []),
  ];
  if (allSkills.length > 0) parts.push(`Skills: ${allSkills.join(", ")}`);

  const projects = resume.projects ?? [];
  if (projects.length > 0) {
    const lines = projects.map((p) => {
      const stack = (p.tech_stack ?? []).join(", ");
      const bullets = ((p as unknown as { bullets?: string[] }).bullets ?? []).join("; ");
      return `- ${p.title} (${stack}): ${bullets}`;
    });
    parts.push(`Projects:\n${lines.join("\n")}`);
  }

  const internships = resume.internships ?? [];
  if (internships.length > 0) {
    const lines = internships.map(
      (i) => `- ${i.role} at ${i.company}: ${(i.bullets ?? []).join("; ")}`
    );
    parts.push(`Internships:\n${lines.join("\n")}`);
  }

  const certifications = resume.certifications ?? [];
  if (certifications.length > 0) {
    const lines = certifications.map((c) => `- ${c.name} (${c.issuer})`);
    parts.push(`Certifications:\n${lines.join("\n")}`);
  }

  const text = parts.join("\n\n");
  return text.length > 2000 ? text.slice(0, 2000) : text;
}

// ─── Route handler ────────────────────────────────────────────────────────────

type RawKeywordMatch = {
  keyword: string;
  found_in_resume: boolean;
  importance: string;
  location_in_resume: string;
};

type RawSkillGap = {
  skill: string;
  how_to_add: string;
  time_estimate: string;
  resource_url: string;
  prep_track: string;
  prep_topic: string;
};

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireRole(["student"]);
    if (authResult instanceof Response) return authResult;
    const { user } = authResult;

    const body = (await request.json()) as {
      resume?: ResumeData;
      jd_text?: string;
    };
    const resume = body.resume;
    const jd_text = typeof body.jd_text === "string" ? body.jd_text : "";

    if (!resume || typeof resume !== "object") {
      return apiError("Missing resume", 400);
    }
    if (jd_text.trim().length < 50) {
      return apiError("Job description too short. Paste the full JD.", 400);
    }

    const resumeText = buildResumeText(resume);

    const hasContent =
      resumeText.length > 100 &&
      ((resume.projects?.length ?? 0) > 0 ||
        (resume.technical_skills?.languages?.length ?? 0) > 0 ||
        (resume.internships?.length ?? 0) > 0);

    if (!hasContent) {
      return apiSuccess({
        overall_score: 0,
        keyword_matches: [],
        bullet_issues: [],
        skill_gap_actions: [],
        ats_tips: [
          "Add at least one project before analyzing",
          "Fill in your technical skills section",
          "A resume needs content before it can be ATS-analyzed",
        ],
        missing_high_priority: [],
        _empty: true,
      });
    }

    // Fetch student context
    const adminClient = createAdminClient();
    const { data: profileRow } = await adminClient
      .from("profiles")
      .select("branch, semester")
      .eq("id", user.id)
      .maybeSingle();

    const branch = (profileRow?.branch as string | null) ?? "Engineering";
    const semester = (profileRow?.semester as number | null) ?? null;

    const prompt =
      `You are an ATS and resume expert for Indian campus placements.\n` +
      `CRITICAL: If the resume has no projects and no meaningful skills, return overall_score of 0 and explain in ats_tips what the student needs to add first. Never score an empty resume above 10.\n` +
      `Analyze this fresher resume against the job description.\n\n` +
      `Resume:\n${resumeText}\n\n` +
      `Job Description:\n${jd_text.slice(0, 2000)}\n\n` +
      `Student: ${branch} student, Semester ${semester}\n\n` +
      `Rules for bullet analysis:\n` +
      `- Flag ANY bullet with these patterns as issues:\n` +
      `  * Vague verbs: worked on, helped, assisted, contributed,\n` +
      `    involved in, participated\n` +
      `  * AI filler: spearheaded, leveraged, utilized, synergized,\n` +
      `    passionate, results-driven, detail-oriented, dynamic\n` +
      `  * Missing outcome: no number, percentage, scale, or scope\n` +
      `  * Too long: over 20 words\n` +
      `- For each flagged bullet, rewrite it with:\n` +
      `  * Strong specific verb (Built, Reduced, Automated, Designed,\n` +
      `    Implemented, Migrated, Optimized, Achieved, Delivered)\n` +
      `  * Measurable outcome if inferable from context,\n` +
      `    OR scope if no metric available\n` +
      `  * Under 15 words\n` +
      `  * Zero filler adjectives\n` +
      `  * Sound like a human engineer wrote it, not an AI\n\n` +
      `Rules for skill gaps:\n` +
      `- Only flag skills that genuinely matter for this role\n` +
      `- For each missing skill, provide a SPECIFIC honest path:\n` +
      `  * Name a specific free resource (not "search online")\n` +
      `  * Realistic time estimate for a college student\n` +
      `  * Whether this connects to their existing coursework`;

    let result;
    try {
      result = await routeAI("placement_prep", {
        messages: [{ role: "user", content: prompt }],
        thinkingBudget: 0,
        maxTokens: 4000,
        responseSchema: RESPONSE_SCHEMA,
      });
    } catch (err) {
      console.error("[resume/ats] AI call failed:", err);
      return apiError("Analysis failed. Try again.", 500);
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(String(result.content ?? ""));
    } catch {
      console.error("[resume/ats] Failed to parse AI response");
      return apiError("Analysis failed. Try again.", 500);
    }

    const rawKeywords = Array.isArray(parsed.keyword_matches)
      ? (parsed.keyword_matches as RawKeywordMatch[])
      : [];

    const keyword_matches: ATSAnalysis["keyword_matches"] = rawKeywords.map(
      (km) => ({
        keyword: km.keyword,
        found_in_resume: km.found_in_resume,
        importance: km.importance as "high" | "medium" | "low",
        location_in_resume: km.location_in_resume || null,
      })
    );

    const missing_high_priority = keyword_matches
      .filter((km) => !km.found_in_resume && km.importance === "high")
      .map((km) => km.keyword);

    const rawGaps = Array.isArray(parsed.skill_gap_actions)
      ? (parsed.skill_gap_actions as RawSkillGap[])
      : [];

    const skill_gap_actions: ATSAnalysis["skill_gap_actions"] = rawGaps.map(
      (s) => ({
        skill: s.skill,
        how_to_add: s.how_to_add,
        time_estimate: s.time_estimate,
        resource_url: s.resource_url || null,
        prep_track: s.prep_track || null,
        prep_topic: s.prep_topic || null,
      })
    );

    const analysis: ATSAnalysis = {
      jd_text,
      overall_score: typeof parsed.overall_score === "number" ? parsed.overall_score : 0,
      keyword_matches,
      missing_high_priority,
      bullet_issues: Array.isArray(parsed.bullet_issues)
        ? (parsed.bullet_issues as ATSAnalysis["bullet_issues"])
        : [],
      skill_gap_actions,
      ats_tips: Array.isArray(parsed.ats_tips)
        ? (parsed.ats_tips as string[])
        : [],
    };

    return apiSuccess(analysis);
  } catch (error) {
    console.error(
      "[resume/ats] Error:",
      error instanceof Error ? error.message : error
    );
    return apiError("Analysis failed. Try again.", 500);
  }
}
