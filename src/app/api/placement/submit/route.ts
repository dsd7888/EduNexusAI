import { createAdminClient, createServerClient } from "@/lib/db/supabase-server";
import { scorePlacementAttempt } from "@/lib/placement/generator";
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
    const { data: profile } = await adminClient
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if ((profile as { role?: string } | null)?.role !== "student") {
      return Response.json(
        { error: "Forbidden: Students only" },
        { status: 403 }
      );
    }

    const { companyId, questions, answers, timeTaken } = await request.json();

    if (!companyId || !Array.isArray(questions) || !answers) {
      return Response.json(
        { error: "companyId, questions, and answers are required" },
        { status: 400 }
      );
    }

    const { score, correctAnswers, categoryScores } = scorePlacementAttempt(
      questions,
      answers
    );

    const { data: company } = await adminClient
      .from("placement_companies")
      .select("name, aptitude_pattern, avg_package_lpa")
      .eq("id", companyId)
      .single();

    if (!company) {
      return Response.json({ error: "Company not found" }, { status: 404 });
    }

    const categoryGaps = Object.entries(categoryScores).map(([cat, catScore]) => {
      const target = 65;
      return {
        category: cat,
        studentScore: catScore,
        target,
        gap: Math.max(0, target - catScore),
        status:
          catScore >= target
            ? "good"
            : catScore >= target - 15
              ? "warning"
              : "weak",
      };
    });

    const subcategoryStats: Record<
      string,
      { total: number; correct: number }
    > = {};

    for (const q of questions) {
      const sub = String(q.subcategory ?? q.category ?? "general");
      if (!subcategoryStats[sub]) subcategoryStats[sub] = { total: 0, correct: 0 };

      const studentAns = String(answers[q.id] ?? "").trim().toUpperCase();
      const correctAns = String(q.answer ?? "").trim().toUpperCase();

      subcategoryStats[sub].total += 1;
      if (studentAns === correctAns) subcategoryStats[sub].correct += 1;
    }

    const subcategoryScores: Record<string, number> = {};
    for (const [sub, stats] of Object.entries(subcategoryStats)) {
      const pct = stats.total > 0 ? (stats.correct / stats.total) * 100 : 0;
      subcategoryScores[sub] = Math.round(pct);
    }

    const allSubcategoryGaps = Object.entries(subcategoryScores)
      .map(([sub, sc]) => ({
        subcategory: sub,
        score: sc as number,
        label: sub
          .replace(/_/g, " ")
          .replace(/\b\w/g, (c: string) => c.toUpperCase()),
        attempted: subcategoryStats[sub].total,
        correct: subcategoryStats[sub].correct,
        status:
          (sc as number) >= 65
            ? "good"
            : (sc as number) >= 50
              ? "warning"
              : "weak",
      }))
      .sort((a, b) => a.score - b.score);

    const subcategoryGaps = allSubcategoryGaps.filter((g) => g.status !== "good");

    const topStrengths = allSubcategoryGaps
      .filter((g) => g.status === "good")
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    const weaknesses = subcategoryGaps.slice(0, 5).map((w) => w.subcategory);

    const { error: insertError } = await adminClient
      .from("placement_attempts")
      .insert({
        student_id: user.id,
        company_id: companyId,
        score,
        category_scores: categoryScores,
        subcategory_scores: subcategoryScores,
        total_questions: questions.length,
        correct_answers: correctAnswers,
        time_taken: timeTaken,
        questions,
        answers,
        subcategory_gaps: subcategoryGaps,
        top_strengths: topStrengths,
        weaknesses,
      });

    if (insertError) {
      console.error("[placement/submit] insert error:", insertError);
      return Response.json(
        { error: "Failed to save attempt" },
        { status: 500 }
      );
    }

    void (async () => {
      try {
        const { data: allAttempts } = await adminClient
          .from("placement_attempts")
          .select("id, created_at")
          .eq("student_id", user.id)
          .eq("company_id", companyId)
          .order("created_at", { ascending: false });

        if (allAttempts && allAttempts.length > 3) {
          const toDelete = allAttempts.slice(3).map((a: { id: string }) => a.id);
          if (toDelete.length > 0) {
            await adminClient.from("placement_attempts").delete().in("id", toDelete);
          }
        }
      } catch (err) {
        console.error("[placement/submit] prune attempts:", err);
      }
    })();

    return Response.json({
      score,
      correctAnswers,
      totalQuestions: questions.length,
      categoryScores,
      gaps: categoryGaps,
      companyName: (company as any).name,
      timeTaken,

      subcategoryScores,
      subcategoryGaps,
      topStrengths,
      allSubcategoryGaps,
      strengths: topStrengths.map((s) => s.subcategory),
      weaknesses,
    });
  } catch (err) {
    console.error("[placement/submit] error:", err);
    return Response.json({ error: "Failed to submit test" }, { status: 500 });
  }
}
