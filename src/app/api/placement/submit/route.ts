import { createAdminClient, createServerClient } from "@/lib/db/supabase-server";
import { scorePlacementAttempt } from "@/lib/placement/generator";
import type { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  try {
    // 1. Auth check — student only
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

    // 2. Parse body
    const { companyId, questions, answers, timeTaken } = await request.json();

    if (!companyId || !Array.isArray(questions) || !answers) {
      return Response.json(
        { error: "companyId, questions, and answers are required" },
        { status: 400 }
      );
    }

    // 3. Score
    const { score, correctAnswers, categoryScores } = scorePlacementAttempt(
      questions,
      answers
    );

    // 4. Save attempt
    await adminClient.from("placement_attempts").insert({
      student_id: user.id,
      company_id: companyId,
      score,
      category_scores: categoryScores,
      total_questions: questions.length,
      correct_answers: correctAnswers,
      time_taken: timeTaken,
    });

    // 5. Fetch company benchmark
    const { data: company } = await adminClient
      .from("placement_companies")
      .select("name, aptitude_pattern, avg_package_lpa")
      .eq("id", companyId)
      .single();

    if (!company) {
      return Response.json({ error: "Company not found" }, { status: 404 });
    }

    // 6. Build gap analysis
    const categoryGaps = Object.entries(categoryScores).map(([cat, catScore]) => {
      const target = 65; // minimum passing bar for any category
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

    // 7. Subcategory-level analysis (drives topic UI)
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

    // Ensure subcategoryGaps includes ALL subcategories, sorted worst-first
    const allSubcategoryGaps = Object.entries(subcategoryScores)
      .map(([sub, score]) => ({
        subcategory: sub,
        score: score as number,
        label: sub
          .replace(/_/g, " ")
          .replace(/\b\w/g, (c: string) => c.toUpperCase()),
        attempted: subcategoryStats[sub].total,
        correct: subcategoryStats[sub].correct,
        status:
          (score as number) >= 65
            ? "good"
            : (score as number) >= 50
              ? "warning"
              : "weak",
      }))
      .sort((a, b) => a.score - b.score); // worst first

    const subcategoryGaps = allSubcategoryGaps.filter((g) => g.status !== "good");

    // Top 3 strongest topics
    const topStrengths = allSubcategoryGaps
      .filter((g) => g.status === "good")
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    // 8. Return result
    return Response.json({
      score,
      correctAnswers,
      totalQuestions: questions.length,
      categoryScores,
      // old category-level gaps preserved for overview usage
      gaps: categoryGaps,
      companyName: (company as any).name,
      timeTaken,

      subcategoryScores,
      subcategoryGaps, // all weak/warning topics
      topStrengths, // top 3 strong topics
      allSubcategoryGaps, // complete picture
      strengths: topStrengths.map((s) => s.subcategory),
      weaknesses: subcategoryGaps.slice(0, 5).map((w) => w.subcategory),
    });
  } catch (err) {
    console.error("[placement/submit] error:", err);
    return Response.json({ error: "Failed to submit test" }, { status: 500 });
  }
}

