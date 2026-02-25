import { buildQuizPrompt, parseQuizResponse } from "@/lib/quiz/generator";
import { routeAI } from "@/lib/ai/router";
import {
  createAdminClient,
  createServerClient,
} from "@/lib/db/supabase-server";
import { checkRateLimit, RATE_LIMITS } from "@/lib/utils/rate-limit";
import type { NextRequest } from "next/server";

const VALID_DIFFICULTIES = ["easy", "medium", "hard", "mixed"] as const;
const VALID_TYPES = ["mcq", "true_false", "short"] as const;

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const adminClient = createAdminClient();
    const { data: profile, error: profileError } = await adminClient
      .from("profiles")
      .select("id, role")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      return Response.json(
        { error: "Failed to load profile" },
        { status: 500 }
      );
    }

    if (profile.role !== "student") {
      return Response.json(
        { error: "Forbidden: Students only" },
        { status: 403 }
      );
    }

    const rateCheck = await checkRateLimit({
      userId: user.id,
      eventType: "quiz",
      limit: RATE_LIMITS.quiz,
    });

    if (!rateCheck.allowed) {
      return Response.json(
        {
          error: "Daily limit reached",
          message: `You've used all ${RATE_LIMITS.quiz} quiz generations for today. ${rateCheck.resetAt}.`,
          limitReached: true,
        },
        { status: 429 }
      );
    }

    const body = await request.json().catch(() => ({} as any));
    const subjectId = String(body?.subjectId ?? "").trim();
    const questionCount = Math.min(
      Math.max(1, Number(body?.questionCount) || 10),
      20
    );
    const difficultyRaw = String(body?.difficulty ?? "mixed").toLowerCase();
    const difficulty = VALID_DIFFICULTIES.includes(difficultyRaw as any)
      ? (difficultyRaw as (typeof VALID_DIFFICULTIES)[number])
      : "mixed";
    const rawTypes = Array.isArray(body?.questionTypes) ? body.questionTypes : ["mcq"];
    const questionTypes = rawTypes
      .map((t: unknown) => String(t).toLowerCase())
      .filter((t: string) => VALID_TYPES.includes(t as any)) as (
      | "mcq"
      | "true_false"
      | "short"
    )[];
    const questionTypesFinal: ("mcq" | "true_false" | "short")[] =
      questionTypes.length > 0 ? questionTypes : ["mcq"];
    const selectedTopics = Array.isArray(body?.selectedTopics)
      ? body.selectedTopics.map(String).filter(Boolean)
      : undefined;
    const focusTopic =
      body?.focusTopic != null ? String(body.focusTopic).trim() || undefined : undefined;

    if (!subjectId) {
      return Response.json(
        { error: "subjectId is required" },
        { status: 400 }
      );
    }

    const { data: contentRow, error: contentError } = await adminClient
      .from("subject_content")
      .select("content")
      .eq("subject_id", subjectId)
      .maybeSingle();

    if (contentError) {
      console.error("[quiz/generate] subject_content error:", contentError);
      return Response.json(
        { error: "Failed to load syllabus" },
        { status: 500 }
      );
    }

    if (!contentRow) {
      return Response.json(
        { error: "No syllabus content found for this subject" },
        { status: 404 }
      );
    }

    const { data: subject, error: subjectError } = await adminClient
      .from("subjects")
      .select("id, name")
      .eq("id", subjectId)
      .single();

    if (subjectError || !subject) {
      return Response.json(
        { error: "Subject not found" },
        { status: 404 }
      );
    }

    const { data: moduleRows } = await adminClient
      .from("modules")
      .select("id")
      .eq("subject_id", subjectId)
      .limit(1);

    const moduleId = Array.isArray(moduleRows) && moduleRows[0]
      ? (moduleRows[0] as { id: string }).id
      : null;

    if (!moduleId) {
      return Response.json(
        { error: "Subject has no modules; cannot create quiz" },
        { status: 400 }
      );
    }

    const prompt = buildQuizPrompt({
      subjectName: subject.name,
      syllabusContent: contentRow.content ?? "",
      questionCount,
      difficulty,
      questionTypes: questionTypesFinal,
      selectedTopics,
      focusTopic,
    });

    const ai = await routeAI("quiz_gen", {
      messages: [{ role: "user", content: prompt }],
    });

    const rawText = String(ai.content ?? "");
    const questions = parseQuizResponse(rawText);

    if (!questions || questions.length === 0) {
      console.error("[quiz/generate] parseQuizResponse returned null or empty");
      return Response.json(
        { error: "Failed to generate valid quiz" },
        { status: 500 }
      );
    }

    let title = "Quiz";
    try {
      let text = rawText.trim();
      if (text.startsWith("```")) {
        text = text
          .replace(/^```(?:json)?\s*/i, "")
          .replace(/```\s*$/i, "")
          .trim();
      }
      const parsed = JSON.parse(text) as Record<string, unknown>;
      if (typeof parsed?.title === "string" && parsed.title) {
        title = parsed.title;
      }
    } catch {
      // keep default title
    }

    const storedDifficulty =
      difficulty === "mixed" ? "medium" : difficulty;

    const { data: quiz, error: insertError } = await adminClient
      .from("quizzes")
      .insert({
        subject_id: subjectId,
        module_id: moduleId,
        title,
        difficulty: storedDifficulty,
        questions: questions,
        generated_by: user.id,
      })
      .select("id")
      .single();

    if (insertError) {
      console.error("[quiz/generate] insert error:", insertError);
      return Response.json(
        { error: "Failed to save quiz" },
        { status: 500 }
      );
    }

    return Response.json({
      quizId: quiz?.id,
      title,
      questions,
    });
  } catch (err) {
    console.error("[quiz/generate] POST error:", err);
    const msg =
      err instanceof Error ? err.message : "Failed to generate quiz";
    return Response.json({ error: msg }, { status: 500 });
  }
}
