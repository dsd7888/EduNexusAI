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
    const { user, adminClient } = authResult;

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

    const ai = await routeAI("chat", {
      messages: [{ role: "user", content: prompt }],
    });

    const hint = String(ai.content ?? "");

    return Response.json({ hint });
  } catch (err) {
    console.error("[quiz/hint] POST error:", err);
    const msg =
      err instanceof Error ? err.message : "Failed to get hint";
    return apiError(msg, 500);
  }
}
