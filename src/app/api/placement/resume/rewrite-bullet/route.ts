import type { NextRequest } from "next/server";
import { requireRole, apiError, apiSuccess } from "@/lib/api/helpers";
import { routeAI } from "@/lib/ai/router";
import { checkRateLimit, releaseRateLimit, RATE_LIMITS } from "@/lib/utils/rate-limit";

export const maxDuration = 30;

// ─── Schema ───────────────────────────────────────────────────────────────────

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    variants: {
      type: "array",
      description: "Exactly 3 rewritten bullet variants",
      items: {
        type: "object",
        properties: {
          text: {
            type: "string",
            description: "Rewritten bullet under 15 words",
          },
          improvement: {
            type: "string",
            description:
              "One phrase explaining what was improved e.g. Added scope, Removed vague verb",
          },
        },
        required: ["text", "improvement"],
      },
    },
  },
  required: ["variants"],
};

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  let releaseReservation: (() => Promise<void>) | null = null;
  try {
    const authResult = await requireRole(["student"]);
    if (authResult instanceof Response) return authResult;
    const { user, profile } = authResult;
    const jobId = crypto.randomUUID();

    const body = (await request.json()) as {
      bullet?: string;
      context?: string;
      role_context?: string;
      jd_text?: string;
    };

    const bullet = typeof body.bullet === "string" ? body.bullet.trim() : "";
    const context = typeof body.context === "string" ? body.context : "";
    const role_context =
      typeof body.role_context === "string" ? body.role_context : "";
    const jdTextRaw = typeof body.jd_text === "string" ? body.jd_text.trim() : "";
    // Same 50-char floor the ATS route uses — below that a JD snippet isn't
    // meaningfully "pasted", so don't condition the rewrite on noise.
    const jdText = jdTextRaw.length >= 50 ? jdTextRaw : "";
    const tailored = Boolean(jdText);

    if (!bullet) return apiError("bullet is required", 400);

    const rateCheck = await checkRateLimit({
      userId: user.id,
      eventType: "placement_resume_rewrite",
      limit: RATE_LIMITS.placement_resume_rewrite,
      subjectId: null,
    });
    if (!rateCheck.allowed) {
      return Response.json(
        {
          error: "Daily limit reached",
          message: `You've used all ${RATE_LIMITS.placement_resume_rewrite} bullet rewrites for today. ${rateCheck.resetAt}.`,
          limitReached: true,
        },
        { status: 429 }
      );
    }
    releaseReservation = () =>
      releaseRateLimit({
        userId: user.id,
        eventType: "placement_resume_rewrite",
        subjectId: null,
      });

    const prompt =
      `Rewrite this resume bullet point for an Indian fresher's resume.\n\n` +
      `Original: "${bullet}"\n` +
      `Context: ${context}\n` +
      (role_context ? `Target role: ${role_context}\n` : "") +
      (jdText
        ? `\nTarget Job Description — mirror its language and priorities ` +
          `where genuinely true of the original bullet:\n${jdText.slice(0, 1500)}\n`
        : "") +
      `\nRules (non-negotiable):\n` +
      `1. Start with a strong action verb: Built, Reduced, Automated,\n` +
      `   Designed, Implemented, Migrated, Optimized, Achieved, Delivered,\n` +
      `   Developed, Integrated, Deployed, Configured, Refactored\n` +
      `2. Include measurable outcome (use numbers if inferable) OR\n` +
      `   clear scope (what it does, how many, what scale)\n` +
      `3. Under 15 words total\n` +
      `4. Zero filler: no "spearheaded", "leveraged", "passionate",\n` +
      `   "results-driven", "worked on", "helped with"\n` +
      `5. Sound like a human engineer wrote it\n` +
      `6. Do not invent metrics that aren't inferable from context\n` +
      (jdText
        ? `7. Prefer the JD's own terminology for a skill/technology ONLY ` +
          `when the original bullet genuinely already describes it — never ` +
          `introduce a tool, skill, or metric the original bullet doesn't ` +
          `support just because the JD mentions it\n\n`
        : `\n`) +
      `Generate exactly 3 variants. Different verbs, different angles.`;

    let result;
    try {
      result = await routeAI("placement_prep", {
        messages: [{ role: "user", content: prompt }],
        thinkingBudget: 0,
        maxTokens: 800,
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
      console.error("[resume/rewrite-bullet] AI call failed:", err);
      if (releaseReservation) await releaseReservation();
      return apiError("Rewrite failed. Try again.", 500);
    }

    let parsed: { variants?: Array<{ text: string; improvement: string }> };
    try {
      parsed = JSON.parse(String(result.content ?? ""));
    } catch {
      console.error("[resume/rewrite-bullet] Failed to parse AI response");
      if (releaseReservation) await releaseReservation();
      return apiError("Rewrite failed. Try again.", 500);
    }

    if (!Array.isArray(parsed.variants) || parsed.variants.length === 0) {
      if (releaseReservation) await releaseReservation();
      return apiError("Rewrite failed. Try again.", 500);
    }

    return apiSuccess({ variants: parsed.variants, tailored });
  } catch (error) {
    console.error(
      "[resume/rewrite-bullet] Error:",
      error instanceof Error ? error.message : error
    );
    if (releaseReservation) await releaseReservation().catch(() => {});
    return apiError("Internal server error", 500);
  }
}
