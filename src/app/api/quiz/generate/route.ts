import {
  buildQuizPrompt,
  normalizeQuizQuestions,
} from "@/lib/quiz/generator";
import { routeAI } from "@/lib/ai/router";
import { backfillRelatedContentId } from "@/lib/ai/costLogger";
import { checkRateLimit, releaseRateLimit, RATE_LIMITS } from "@/lib/utils/rate-limit";
import { requireRole, apiError } from "@/lib/api/helpers";
import type { NextRequest } from "next/server";

const VALID_DIFFICULTIES = ["easy", "medium", "hard", "mixed"] as const;
const VALID_TYPES = ["mcq", "true_false", "short", "multiple_correct", "match"] as const;

function parseQuizResponse(raw: string): Record<string, unknown>[] | null {
  const cleaned = raw
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/gi, "")
    .trim();

  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed) && parsed.length >= 1) return parsed;
    if (parsed?.questions && Array.isArray(parsed.questions))
      return parsed.questions;
  } catch {}

  try {
    const start = cleaned.indexOf("[");
    const end = cleaned.lastIndexOf("]");
    if (start !== -1 && end > start) {
      const fixed = cleaned
        .slice(start, end + 1)
        .replace(/,\s*}/g, "}")
        .replace(/,\s*]/g, "]");
      const parsed = JSON.parse(fixed);
      if (Array.isArray(parsed) && parsed.length >= 1) return parsed;
    }
  } catch {}

  try {
    const objects: Record<string, unknown>[] = [];
    const search = cleaned;
    let depth = 0;
    let objStart = -1;
    for (let i = 0; i < search.length; i++) {
      if (search[i] === "{") {
        if (depth === 0) objStart = i;
        depth++;
      } else if (search[i] === "}") {
        depth--;
        if (depth === 0 && objStart !== -1) {
          try {
            const obj = JSON.parse(search.slice(objStart, i + 1)) as Record<
              string,
              unknown
            >;
            if (obj.question || obj.text) objects.push(obj);
          } catch {}
          objStart = -1;
        }
      }
    }
    if (objects.length >= 1) return objects;
  } catch {}

  return null;
}

export async function POST(request: NextRequest) {
  // Hoisted above the try so the outer catch can release a reservation made
  // partway through — let/const declared inside `try {}` aren't visible in
  // its `catch` block.
  let releaseReservation: (() => Promise<void>) | null = null;
  try {
    const authResult = await requireRole(["student"]);
    if (authResult instanceof Response) return authResult;
    const { user, profile, adminClient } = authResult;

    const body = await request
      .json()
      .catch(() => ({}) as Record<string, unknown>);
    const subjectIdsRaw = Array.isArray(body?.subjectIds)
      ? body.subjectIds
      : body?.subjectId
      ? [body.subjectId]
      : [];
    const subjectIds = subjectIdsRaw
      .map((id: unknown) => String(id ?? "").trim())
      .filter(Boolean);

    if (!subjectIds.length) {
      return apiError("subjectIds is required", 400);
    }

    // Multi-subject requests anchor the reservation on the first subject —
    // checkRateLimit's cap is enforced globally per user/event/day (it sums
    // usage across ALL of a user's subject rows), so subjectId only picks
    // which row absorbs the CAS write, not which subject "counts."
    const rateCheck = await checkRateLimit({
      userId: user.id,
      eventType: "quiz",
      limit: RATE_LIMITS.quiz,
      subjectId: subjectIds[0],
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
    releaseReservation = () =>
      releaseRateLimit({ userId: user.id, eventType: "quiz", subjectId: subjectIds[0] });
    const questionCount = Math.min(
      Math.max(1, Number(body?.questionCount) || 10),
      20
    );
    const difficultyRaw = String(body?.difficulty ?? "mixed").toLowerCase();
    const difficulty = (
      VALID_DIFFICULTIES as readonly string[]
    ).includes(difficultyRaw)
      ? (difficultyRaw as (typeof VALID_DIFFICULTIES)[number])
      : "mixed";
    const rawTypes = Array.isArray(body?.questionTypes)
      ? body.questionTypes
      : ["mcq"];
    const questionTypes = rawTypes
      .map((t: unknown) => String(t).toLowerCase())
      .filter((t: string) => (VALID_TYPES as readonly string[]).includes(t)) as (
      | "mcq"
      | "true_false"
      | "short"
      | "multiple_correct"
      | "match"
    )[];
    const questionTypesFinal: (
      "mcq" | "true_false" | "short" | "multiple_correct" | "match"
    )[] = questionTypes.length > 0 ? questionTypes : ["mcq"];
    const selectedTopics = Array.isArray(body?.selectedTopics)
      ? body.selectedTopics.map(String).filter(Boolean)
      : undefined;
    const focusTopic =
      body?.focusTopic != null ? String(body.focusTopic).trim() || undefined : undefined;

    const { data: contentRows, error: contentError } = await adminClient
      .from("subject_content")
      .select("content, subject_id, subjects(name, code)")
      .in("subject_id", subjectIds);

    if (contentError) {
      console.error("[quiz/generate] subject_content error:", contentError);
      if (releaseReservation) await releaseReservation();
      return apiError("Failed to load syllabus", 500);
    }

    if (!contentRows || contentRows.length === 0) {
      if (releaseReservation) await releaseReservation();
      return Response.json(
        {
          error: "no_content",
          message:
            "No syllabus content found for the selected subjects. Ask your admin to add content first.",
        },
        { status: 404 }
      );
    }

    type ContentRow = {
      content: string | null;
      subject_id: string;
      subjects: { name: string; code: string }[] | null;
    };
    const subjectBlocks = (contentRows as unknown as ContentRow[]).map((row) => {
      const subj = row.subjects?.[0] ?? null;
      return {
        subjectId: row.subject_id,
        name: subj?.name ?? "Subject",
        code: subj?.code ?? "",
        content: String(row.content ?? ""),
      };
    });

    const combinedSyllabus = subjectBlocks
      .map(
        (s) =>
          `=== ${s.name} (${s.code}) ===\n${s.content}`
      )
      .join("\n\n");

    const syllabusForPrompt = (combinedSyllabus ?? "").slice(0, 2000);

    const subjectNameForPrompt = subjectBlocks
      .map((s) => s.name)
      .join(", ");

    // Use first subject block for FK/module lookup
    const primary = subjectBlocks[0];

    const { data: moduleRows } = await adminClient
      .from("modules")
      .select("id")
      .eq("subject_id", primary.subjectId)
      .limit(1);

    const moduleId = Array.isArray(moduleRows) && moduleRows[0]
      ? (moduleRows[0] as { id: string }).id
      : null;

    if (!moduleId) {
      if (releaseReservation) await releaseReservation();
      return apiError(
        "Primary subject has no modules; cannot create quiz",
        400
      );
    }

    const prompt = buildQuizPrompt({
      subjectName: subjectNameForPrompt,
      syllabusContent: syllabusForPrompt,
      questionCount,
      difficulty,
      questionTypes: questionTypesFinal,
      selectedTopics,
      focusTopic,
    });

    const jobId = crypto.randomUUID();
    const ai = await routeAI("quiz_gen", {
      messages: [{ role: "user", content: prompt }],
      logContext: {
        userId: user.id,
        userEmail: user.email ?? null,
        userRole: profile.role,
        subjectId: primary.subjectId,
        subjectCode: primary.code || null,
        jobId,
        relatedContentId: null,
        feature: "quiz",
      },
    });

    const rawText = String(ai.content ?? "");
    const rawItems = parseQuizResponse(rawText);
    if (rawItems === null) {
      console.error("[quiz/generate] parseQuizResponse returned null");
      if (releaseReservation) await releaseReservation();
      return apiError(
        "Failed to generate quiz. Please try again.",
        500
      );
    }

    const questions = normalizeQuizQuestions(rawItems);

    if (!questions || questions.length === 0) {
      console.error("[quiz/generate] normalizeQuizQuestions returned null or empty");
      if (releaseReservation) await releaseReservation();
      return Response.json(
        {
          error: "generation_failed",
          message:
            "Could not generate quiz questions. Please try again or select different modules.",
        },
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

    const isPartial = questions.length < questionCount;
    if (isPartial && questions.length < 3) {
      if (releaseReservation) await releaseReservation();
      return Response.json(
        {
          error: "generation_failed",
          message:
            "Could not generate quiz questions. Please try again or select different modules.",
        },
        { status: 500 }
      );
    }

    if (isPartial) {
      console.warn(
        `[quiz/generate] Partial: got ${questions.length} questions`
      );
    }

    const { data: quiz, error: insertError } = await adminClient
      .from("quizzes")
      .insert({
        subject_id: primary.subjectId,
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
      if (releaseReservation) await releaseReservation();
      return apiError("Failed to save quiz", 500);
    }

    await backfillRelatedContentId(jobId, quiz.id);

    return Response.json({
      quizId: quiz.id,
      title,
      questions,
      ...(isPartial ? { partial: true } : {}),
    });
  } catch (err) {
    console.error("[quiz/generate] POST error:", err);
    if (releaseReservation) {
      await releaseReservation().catch(() => {});
    }
    const msg =
      err instanceof Error ? err.message : "Failed to generate quiz";
    return apiError(msg, 500);
  }
}
