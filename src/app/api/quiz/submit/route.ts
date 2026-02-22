import type { QuizQuestion } from "@/lib/quiz/generator";
import {
  createAdminClient,
  createServerClient,
} from "@/lib/db/supabase-server";
import type { NextRequest } from "next/server";

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

    const body = await request.json().catch(() => ({} as any));
    const quizId = String(body?.quizId ?? "").trim();
    const answers =
      body?.answers != null && typeof body.answers === "object"
        ? (body.answers as Record<string, string>)
        : {};
    const timeTaken =
      typeof body?.timeTaken === "number" ? body.timeTaken : undefined;

    if (!quizId) {
      return Response.json(
        { error: "quizId is required" },
        { status: 400 }
      );
    }

    const { data: quiz, error: quizError } = await adminClient
      .from("quizzes")
      .select("id, subject_id, questions")
      .eq("id", quizId)
      .single();

    if (quizError || !quiz) {
      return Response.json(
        { error: "Quiz not found" },
        { status: 404 }
      );
    }

    const questions = (quiz.questions ?? []) as QuizQuestion[];
    if (questions.length === 0) {
      return Response.json(
        { error: "Quiz has no questions" },
        { status: 400 }
      );
    }

    let correct = 0;
    const breakdown = questions.map((q) => {
      const studentAns = String(answers[q.id] ?? "").trim().toLowerCase();
      const correctAns = String(q.correctAnswer ?? "").trim().toLowerCase();
      const isCorrect = studentAns === correctAns;
      if (isCorrect) correct++;
      return {
        questionId: q.id,
        question: q.question,
        type: q.type,
        studentAnswer: answers[q.id] ?? "",
        correctAnswer: q.correctAnswer,
        correct: isCorrect,
        explanation: q.explanation,
        difficulty: q.difficulty,
        unit: q.unit,
      };
    });

    const score =
      Math.round((correct / questions.length) * 1000) / 10;

    const { error: insertError } = await adminClient
      .from("quiz_attempts")
      .insert({
        quiz_id: quizId,
        student_id: user.id,
        answers: answers,
        score,
        time_taken: timeTaken ?? null,
      });

    if (insertError) {
      console.error("[quiz/submit] insert error:", insertError);
      return Response.json(
        { error: "Failed to save attempt" },
        { status: 500 }
      );
    }

    const subjectId = quiz.subject_id;
    try {
      const today = new Date().toISOString().slice(0, 10);
      const { data: existingUsage } = await adminClient
        .from("usage_analytics")
        .select("id, event_count")
        .eq("date", today)
        .eq("user_id", user.id)
        .eq("subject_id", subjectId)
        .eq("event_type", "quiz")
        .maybeSingle();

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
          subject_id: subjectId,
          event_type: "quiz",
          event_count: 1,
        });
      }
    } catch (err) {
      console.error("[quiz/submit] usage_analytics error:", err);
    }

    return Response.json({
      score,
      correctCount: correct,
      totalCount: questions.length,
      breakdown,
    });
  } catch (err) {
    console.error("[quiz/submit] POST error:", err);
    const msg =
      err instanceof Error ? err.message : "Failed to submit quiz";
    return Response.json({ error: msg }, { status: 500 });
  }
}
