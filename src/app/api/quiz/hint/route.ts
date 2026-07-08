import { buildSocraticHintPrompt } from "@/lib/quiz/generator";
import { routeAI } from "@/lib/ai/router";
import {
  createAdminClient,
  createServerClient,
} from "@/lib/db/supabase-server";
import { checkRateLimit, RATE_LIMITS } from "@/lib/utils/rate-limit";
import type { NextRequest } from "next/server";
import { requireRole, apiError } from "@/lib/api/helpers";

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireRole(["student"]);
    if (authResult instanceof Response) return authResult;
    const { user, profile, adminClient } = authResult;

    const rateCheck = await checkRateLimit({
      userId: user.id,
      eventType: "hint",
      limit: RATE_LIMITS.hint,
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

    const body = await request.json().catch(() => ({} as any));
    const question = String(body?.question ?? "").trim();
    const subjectName = String(body?.subjectName ?? "").trim();
    const subjectId = String(body?.subjectId ?? "").trim();
    const unit =
      body?.unit != null ? String(body.unit).trim() || undefined : undefined;

    if (!question || !subjectName) {
      return apiError("question and subjectName are required", 400);
    }

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

    try {
      const today = new Date().toISOString().slice(0, 10);
      let usageQuery = adminClient
        .from("usage_analytics")
        .select("id, event_count")
        .eq("date", today)
        .eq("user_id", user.id)
        .eq("event_type", "hint");
      usageQuery = subjectId
        ? usageQuery.eq("subject_id", subjectId)
        : usageQuery.is("subject_id", null);
      const { data: existingUsage } = await usageQuery.maybeSingle();

      if (existingUsage) {
        await adminClient
          .from("usage_analytics")
          .update({
            event_count: (existingUsage.event_count ?? 0) + 1,
          })
          .eq("id", existingUsage.id);
      } else {
        await adminClient.from("usage_analytics").insert({
          date: today,
          user_id: user.id,
          subject_id: subjectId || null,
          event_type: "hint",
          event_count: 1,
        });
      }
    } catch (err) {
      console.error("[quiz/hint] usage_analytics error:", err);
    }

    return Response.json({ hint });
  } catch (err) {
    console.error("[quiz/hint] POST error:", err);
    const msg =
      err instanceof Error ? err.message : "Failed to get hint";
    return apiError(msg, 500);
  }
}
