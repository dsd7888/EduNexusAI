import { buildSuggestedPromptsRequest } from "@/lib/ai/prompts";
import { routeAI } from "@/lib/ai/router";
import { createServerClient } from "@/lib/db/supabase-server";
import { requireAuth, requireRole, apiError, apiSuccess } from "@/lib/api/helpers";
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

    const body = await request.json().catch(() => ({} as any));
    const subjectId = String(body?.subjectId ?? "").trim();
    const syllabusContent = String(body?.syllabusContent ?? "").trim();

    if (!authUser || !subjectId || !syllabusContent) {
      return safeReturn();
    }

    const prompt = buildSuggestedPromptsRequest({ subjectId, syllabusContent });

    const jobId = crypto.randomUUID();
    const aiResponse = await routeAI("chat", {
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

