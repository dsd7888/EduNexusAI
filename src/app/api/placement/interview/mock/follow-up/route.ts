import type { NextRequest } from "next/server";
import { requireRole, apiError, apiSuccess } from "@/lib/api/helpers";
import { routeAI } from "@/lib/ai/router";
import { repairGeminiJsonEscapes } from "@/lib/text/latexSegments";

export const maxDuration = 30;

// ─── Per-session AI ceiling (SPEC §8 — "cost gate, not a nicety") ───────────
// A mock round has no server-persisted "session" row to key a counter off of,
// so the cap is enforced as a rolling window per student instead of a literal
// client-supplied session id — a client can't defeat it just by minting a new
// id or reloading the page, since the count is derived entirely from this
// student's own ai_call_logs history, which only grows when the AI is
// actually called. `metadata.kind` tags these calls distinctly from the
// (unlimited) plain-evaluate calls every question already gets, which share
// the same task/feature bucket.
const REACTIVE_FOLLOWUP_CAP = 5;
const REACTIVE_FOLLOWUP_WINDOW_HOURS = 3;
const REACTIVE_FOLLOWUP_KIND = "interview_reactive_followup";

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    follow_up_question: {
      type: "string",
      description:
        "ONE probing follow-up question a real interviewer would ask next, " +
        "referencing a specific, real detail from the student's own project " +
        "text (a tech choice, a claimed outcome, a specific feature). Do not " +
        "invent details the project text doesn't contain.",
    },
    why_it_probes: {
      type: "string",
      description:
        "One short phrase: what this follow-up is checking for (e.g. " +
        "'depth behind the tech-stack claim').",
    },
  },
  required: ["follow_up_question", "why_it_probes"],
};

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireRole(["student"]);
    if (authResult instanceof Response) return authResult;
    const { user, profile, adminClient } = authResult;
    const jobId = crypto.randomUUID();

    const body = (await request.json()) as {
      student_answer?: unknown;
      project_context?: unknown;
    };

    const studentAnswer =
      typeof body.student_answer === "string" ? body.student_answer.trim() : "";
    const projectContext =
      typeof body.project_context === "string" ? body.project_context.trim() : "";

    if (studentAnswer.length < 20) {
      return apiError("Answer must be at least 20 characters.", 400);
    }
    if (projectContext.length < 20) {
      return apiError(
        "Add at least one real project to your resume to unlock the reactive follow-up.",
        400
      );
    }

    // Cap check FIRST — no AI call at all once the ceiling is hit.
    const windowStart = new Date(
      Date.now() - REACTIVE_FOLLOWUP_WINDOW_HOURS * 60 * 60 * 1000
    ).toISOString();

    const { data: recentCalls, error: recentCallsError } = await adminClient
      .from("ai_call_logs")
      .select("id, metadata")
      .eq("user_id", user.id)
      .eq("task", "placement_prep")
      .gte("created_at", windowStart);

    if (recentCallsError) {
      console.error(
        "[interview/mock/follow-up] cap check query failed:",
        recentCallsError
      );
      return apiError("Follow-up unavailable right now. Try again.", 500);
    }

    const reactiveCallsUsed = (recentCalls ?? []).filter(
      (row) =>
        row.metadata &&
        typeof row.metadata === "object" &&
        (row.metadata as Record<string, unknown>).kind === REACTIVE_FOLLOWUP_KIND
    ).length;

    if (reactiveCallsUsed >= REACTIVE_FOLLOWUP_CAP) {
      return apiError(
        `You've used all ${REACTIVE_FOLLOWUP_CAP} reactive follow-ups for this session. ` +
          `Continue with the structured questions — this resets in a few hours.`,
        429
      );
    }

    const prompt =
      `You are a technical interviewer probing a fresher's project answer. ` +
      `Below is the project detail from their actual resume and the answer ` +
      `they just gave to "explain your project" style question.\n\n` +
      `Resume project detail:\n"${projectContext}"\n\n` +
      `Their answer:\n"${studentAnswer}"\n\n` +
      `Write ONE sharp, specific follow-up question that digs into a detail ` +
      `they mentioned (a technology, a claim, a design choice) — the kind of ` +
      `question that reveals whether they actually understand their own ` +
      `project or just described it at a surface level. Do not invent facts ` +
      `not present in the resume detail or their answer.`;

    let result;
    try {
      result = await routeAI("placement_prep", {
        messages: [{ role: "user", content: prompt }],
        thinkingBudget: 0,
        maxTokens: 500,
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
          metadata: { kind: REACTIVE_FOLLOWUP_KIND },
        },
      });
    } catch (err) {
      console.error("[interview/mock/follow-up] AI call failed:", err);
      return apiError("Follow-up generation failed. Try again.", 500);
    }

    let followUp: Record<string, unknown>;
    try {
      followUp = JSON.parse(repairGeminiJsonEscapes(String(result.content ?? "")));
    } catch {
      console.error("[interview/mock/follow-up] Failed to parse AI response");
      return apiError("Follow-up generation failed. Try again.", 500);
    }

    if (typeof (followUp as { follow_up_question?: unknown }).follow_up_question !== "string") {
      return apiError("Follow-up generation failed. Try again.", 500);
    }

    return apiSuccess({
      ...followUp,
      reactive_calls_used: reactiveCallsUsed + 1,
      reactive_calls_cap: REACTIVE_FOLLOWUP_CAP,
    });
  } catch (error) {
    console.error(
      "[interview/mock/follow-up] Error:",
      error instanceof Error ? error.message : error
    );
    return apiError("Follow-up generation failed. Try again.", 500);
  }
}
