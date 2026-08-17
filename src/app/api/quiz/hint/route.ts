import { buildSocraticHintPrompt } from "@/lib/quiz/generator";
import { routeAI } from "@/lib/ai/router";
import { checkRateLimit, releaseRateLimit, RATE_LIMITS } from "@/lib/utils/rate-limit";
import type { NextRequest } from "next/server";
import { requireRole, apiError } from "@/lib/api/helpers";

export async function POST(request: NextRequest) {
  // Hoisted above the try so the outer catch can release a reservation made
  // partway through — let/const declared inside `try {}` aren't visible in
  // its `catch` block.
  let releaseReservation: (() => Promise<void>) | null = null;
  try {
    const authResult = await requireRole(["student"]);
    if (authResult instanceof Response) return authResult;
    const { user, profile } = authResult;

    const body = await request
      .json()
      .catch(() => ({}) as Record<string, unknown>);
    const question = String(body?.question ?? "").trim();
    const subjectName = String(body?.subjectName ?? "").trim();
    const subjectIdRaw = String(body?.subjectId ?? "").trim();
    // Empty string means no subject context (e.g. a general practice hint) —
    // preserved as `null`, matching usage_analytics.subject_id's nullable
    // column and checkRateLimit's dedicated null-subject bucket.
    const subjectId = subjectIdRaw || null;
    const unit =
      body?.unit != null ? String(body.unit).trim() || undefined : undefined;

    if (!question || !subjectName) {
      return apiError("question and subjectName are required", 400);
    }

    const rateCheck = await checkRateLimit({
      userId: user.id,
      eventType: "hint",
      limit: RATE_LIMITS.hint,
      subjectId,
    });

    if (!rateCheck.allowed) {
      return Response.json(
        {
          error: "Daily limit reached",
          message: `You've used all ${RATE_LIMITS.hint} hints for today. ${rateCheck.resetAt}.`,
          limitReached: true,
        },
        { status: 429 }
      );
    }
    releaseReservation = () =>
      releaseRateLimit({ userId: user.id, eventType: "hint", subjectId });

    const prompt = buildSocraticHintPrompt({
      question,
      subjectName,
      unit,
    });

    const jobId = crypto.randomUUID();
    const ai = await routeAI("chat", {
      messages: [{ role: "user", content: prompt }],
      logContext: {
        userId: user.id,
        userEmail: user.email ?? null,
        userRole: profile.role,
        subjectId: subjectId || null,
        subjectCode: null,
        jobId,
        relatedContentId: null,
        feature: "chat",
      },
    });

    const hint = String(ai.content ?? "");

    if (!hint.trim()) {
      console.error("[quiz/hint] routeAI returned empty content");
      if (releaseReservation) await releaseReservation();
      return apiError("Failed to get hint", 500);
    }

    // Quota was reserved atomically in the check above (§ rate limit) —
    // nothing further to record here on success.

    return Response.json({ hint });
  } catch (err) {
    console.error("[quiz/hint] POST error:", err);
    if (releaseReservation) {
      await releaseReservation().catch(() => {});
    }
    const msg =
      err instanceof Error ? err.message : "Failed to get hint";
    return apiError(msg, 500);
  }
}
