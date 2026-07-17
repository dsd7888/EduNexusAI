import type { NextRequest } from "next/server";
import { requireRole, apiError, apiSuccess } from "@/lib/api/helpers";
import { routeAI } from "@/lib/ai/router";

export const maxDuration = 60;

// ─── Constants ────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT =
  "You are a placement mentor analyzing a job description against a student's syllabus. " +
  "Be factual and grounded — map requirements to what the student has actually studied. " +
  "Never make predictive or guaranteed-outcome claims.";

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    job_title: { type: "string", description: "Extracted job title" },
    company_name: {
      type: "string",
      description: "Company name if mentioned, else empty string",
    },
    experience_level: {
      type: "string",
      description: "fresher, junior, mid, senior",
    },
    requirements: {
      type: "array",
      description: "Skills and knowledge required by the JD",
      items: {
        type: "object",
        properties: {
          skill: { type: "string", description: "Skill or concept name" },
          category: {
            type: "string",
            description: "knows, partial, or missing",
          },
          evidence: {
            type: "string",
            description: "Which subject/module covers this, or why it is missing",
          },
          importance: {
            type: "string",
            description: "high, medium, or low — how critical for this role",
          },
        },
        required: ["skill", "category", "evidence", "importance"],
      },
    },
    action_items: {
      type: "array",
      description: "3-5 specific actionable steps for the student",
      items: { type: "string" },
    },
    overall_fit: {
      type: "string",
      description: "strong, moderate, or developing — overall preparedness",
    },
    fit_summary: {
      type: "string",
      description: "One sentence summary of fit. No predictive claims.",
    },
  },
  required: [
    "job_title",
    "requirements",
    "action_items",
    "overall_fit",
    "fit_summary",
  ],
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

interface SubjectRow {
  name: string;
  modules: Array<{ name: string; module_number: number | null }> | null;
}

// Build a compact "Subject: mod1, mod2, ..." context, bounded to ~2000 chars.
function buildSubjectContext(rows: SubjectRow[]): string {
  const lines: string[] = [];
  for (const row of rows.slice(0, 50)) {
    const mods = (row.modules ?? [])
      .slice()
      .sort((a, b) => (a.module_number ?? 0) - (b.module_number ?? 0))
      .slice(0, 5)
      .map((m) => m.name)
      .filter(Boolean);
    lines.push(mods.length > 0 ? `${row.name}: ${mods.join(", ")}` : row.name);
  }
  const ctx = lines.join("\n");
  return ctx.length > 2000 ? ctx.slice(0, 2000) : ctx;
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireRole(["student"]);
    if (authResult instanceof Response) return authResult;

    const { user, profile, adminClient } = authResult;
    const jobId = crypto.randomUUID();

    // ── Validate input ─────────────────────────────────────────────────────────
    const body = (await request.json()) as { jd_text?: unknown };
    const rawJd = typeof body.jd_text === "string" ? body.jd_text : "";
    if (rawJd.trim().length < 50) {
      return apiError("Job description too short. Paste the full JD.", 400);
    }
    const jdText = rawJd.slice(0, 5000); // truncate silently past 5000

    // ── Step 1: Fetch student context ──────────────────────────────────────────
    // profile + placement profile in parallel; subjects depend on branch.
    const [{ data: profileRow }, { data: placementRow }] = await Promise.all([
      adminClient
        .from("profiles")
        .select("branch, semester")
        .eq("id", user.id)
        .maybeSingle(),
      adminClient
        .from("student_placement_profiles")
        .select("primary_target, dream_companies")
        .eq("student_id", user.id)
        .maybeSingle(),
    ]);

    const branch = (profileRow?.branch as string | null) ?? null;
    const semester = (profileRow?.semester as number | null) ?? null;
    const primaryTarget =
      (placementRow?.primary_target as string | null) ?? null;

    // ── Step 2: Build subject context (non-fatal). Resolved via subject_offerings
    // — a subject's content can be offered under multiple branches, so branch
    // lives on the offering, not the subjects row itself. ──────────────────────
    let subjectContext = "";
    if (branch) {
      try {
        const { data: offeringRows, error: subjectsError } = await adminClient
          .from("subject_offerings")
          .select("subject:subjects(name, modules(name, module_number))")
          .eq("branch", branch);
        if (!subjectsError && offeringRows) {
          type OfferingRow = { subject: SubjectRow | null };
          const seen = new Set<string>();
          const subjectRows: SubjectRow[] = [];
          for (const r of offeringRows as unknown as OfferingRow[]) {
            if (!r.subject || seen.has(r.subject.name)) continue;
            seen.add(r.subject.name);
            subjectRows.push(r.subject);
          }
          subjectContext = buildSubjectContext(subjectRows);
        }
      } catch (err) {
        console.error("[jd-analyze] Subject fetch failed:", err);
        // proceed with empty context — partial analysis still useful
      }
    }

    // ── Step 3: Gemini Flash analysis ──────────────────────────────────────────
    const targetLine = primaryTarget
      ? `\nStudent's career target: ${primaryTarget}.\n`
      : "";

    const prompt =
      `Analyze this job description for a ${branch ?? "engineering"} student ` +
      `in semester ${semester ?? "unknown"}.\n\n` +
      `Job Description:\n${jdText.slice(0, 3000)}\n\n` +
      `Student's Academic Subjects:\n${subjectContext || "No subject data available."}\n` +
      targetLine +
      `\nIdentify the skills and knowledge required by this JD.\n` +
      `Map each requirement to one of three categories:\n` +
      `- knows: student has studied this in their syllabus\n` +
      `- partial: student has adjacent knowledge but not direct coverage\n` +
      `- missing: not covered in their syllabus at all\n\n` +
      `Also extract: job title, company name (if mentioned), ` +
      `required experience level, and 3-5 key action items ` +
      `the student should take.`;

    let result;
    try {
      result = await routeAI("placement_prep", {
        messages:       [{ role: "user", content: prompt }],
        systemPrompt:   SYSTEM_PROMPT,
        thinkingBudget: 0,
        maxTokens:      3000,
        responseSchema: RESPONSE_SCHEMA,
        logContext: {
          userId: user.id,
          userEmail: user.email ?? null,
          userRole: profile.role,
          subjectId: null,
          subjectCode: null,
          jobId,
          relatedContentId: null,
          feature: "placement",
        },
      });
    } catch (err) {
      console.error("[jd-analyze] AI call failed:", err);
      return apiError("Analysis failed. Try again.", 500);
    }

    let analysis: Record<string, unknown>;
    try {
      analysis = JSON.parse(String(result.content ?? ""));
    } catch {
      console.error("[jd-analyze] Failed to parse AI response");
      return apiError("Analysis failed. Try again.", 500);
    }

    if (!Array.isArray((analysis as { requirements?: unknown }).requirements)) {
      return apiError("Analysis failed. Try again.", 500);
    }

    // ── Response ───────────────────────────────────────────────────────────────
    return apiSuccess({
      ...analysis,
      analyzed_at: new Date().toISOString(),
      student_branch: branch,
      student_semester: semester,
    });
  } catch (error) {
    console.error(
      "[jd-analyze] Error:",
      error instanceof Error ? error.message : error
    );
    return apiError("Analysis failed. Try again.", 500);
  }
}
