import { buildSuggestedPromptsRequest } from "@/lib/ai/prompts";
import { routeAI } from "@/lib/ai/router";
import { requireAuth } from "@/lib/api/helpers";
import { checkRateLimit, releaseRateLimit, RATE_LIMITS } from "@/lib/utils/rate-limit";
import type { NextRequest } from "next/server";

const DEFAULT_SUGGESTIONS = [
  "Explain the most important concept in simple terms",
  "What are the key topics I should focus on for exams?",
  "Give me a real-world example of a core concept",
  "What's the difference between the main topics in this subject?",
] as const;

export async function POST(request: NextRequest) {
  const safeReturn = (suggestions?: string[]) =>
    Response.json({
      suggestions: suggestions && suggestions.length === 4 ? suggestions : [...DEFAULT_SUGGESTIONS],
    });

  try {
    let authUser: { id: string; email?: string } | null = null;
    // Auth check - user must be authenticated, but we never error; we just fall back to defaults if not.
    try {
      const authResult = await requireAuth();
      if (authResult instanceof Response) {
        return safeReturn();
      }
      authUser = authResult.user;
    } catch {
      // If auth fails for any reason, just return defaults.
      return safeReturn();
    }

    const body = (await request
      .json()
      .catch(() => ({}))) as { subjectId?: unknown; syllabusContent?: unknown };
    const subjectId = String(body?.subjectId ?? "").trim();
    const syllabusContent = String(body?.syllabusContent ?? "").trim();

    if (!authUser || !subjectId || !syllabusContent) {
      return safeReturn();
    }

    // Reserve BEFORE the AI call (CP-02 pattern) — this route is fired on every
    // chat-page mount without the student asking for it, so an uncapped version
    // bills Gemini on navigation alone. Exhausting the cap is not an error here:
    // the route's whole contract is "always return four usable prompts", so we
    // degrade to DEFAULT_SUGGESTIONS exactly as every other failure branch does.
    const rate = await checkRateLimit({
      userId: authUser.id,
      eventType: "chat_suggestions",
      limit: RATE_LIMITS.chat_suggestions,
      subjectId,
    });
    if (!rate.allowed) {
      return safeReturn();
    }

    const prompt = buildSuggestedPromptsRequest({ subjectId, syllabusContent });

    const jobId = crypto.randomUUID();
    let aiResponse;
    try {
      aiResponse = await routeAI("chat", {
        messages: [{ role: "user", content: prompt }],
        logContext: {
          userId: authUser.id,
          userEmail: authUser.email ?? null,
          userRole: null,
          subjectId,
          subjectCode: null,
          jobId,
          relatedContentId: null,
          feature: "chat",
        },
      });
    } catch (err) {
      // The provider call never landed, so the reservation bought nothing —
      // refund it rather than charging the student's daily allowance for our
      // own upstream failure.
      await releaseRateLimit({
        userId: authUser.id,
        eventType: "chat_suggestions",
        subjectId,
      });
      console.error("[chat/suggestions] routeAI failed:", err);
      return safeReturn();
    }

    let raw = String(aiResponse.content ?? "").trim();

    if (raw.startsWith("```")) {
      raw = raw.replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      console.error("[chat/suggestions] JSON.parse failed:", err, "raw:", raw);
      return safeReturn();
    }

    if (!Array.isArray(parsed)) {
      return safeReturn();
    }

    const suggestions = parsed.filter((v) => typeof v === "string") as string[];

    if (suggestions.length !== 4) {
      return safeReturn();
    }

    return safeReturn(suggestions);
  } catch (err) {
    console.error("[chat/suggestions] POST error:", err);
    return safeReturn();
  }
}

