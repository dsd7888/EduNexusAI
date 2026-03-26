import type { NextRequest } from "next/server";

import { createAdminClient, createServerClient } from "@/lib/db/supabase-server";
import { scorePlacementAttempt } from "@/lib/placement/generator";
import { PRACTICE_MODULES } from "@/lib/placement/modules";

export async function POST(request: NextRequest) {
  try {
    // 1) Auth check — student only
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
      .select("branch")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      return Response.json({ error: "Profile not found" }, { status: 404 });
    }

    // 2) Parse body
    const body = await request.json().catch(() => ({} as any));
    const moduleId: string = typeof body?.moduleId === "string" ? body.moduleId.trim() : "";
    const questions: any[] = Array.isArray(body?.questions) ? body.questions : [];
    const answers: Record<string, string> =
      body?.answers && typeof body.answers === "object" ? body.answers : {};
    const timeTaken: number | null =
      typeof body?.timeTaken === "number" ? body.timeTaken : null;

    if (!moduleId) {
      return Response.json({ error: "moduleId is required" }, { status: 400 });
    }
    if (!questions.length) {
      return Response.json({ error: "questions are required" }, { status: 400 });
    }

    // 3) Find module from PRACTICE_MODULES
    let module = PRACTICE_MODULES.find((m) => m.id === moduleId);

    if (!module) {
      module = PRACTICE_MODULES.find(
        (m) =>
          moduleId.includes(m.id) ||
          m.id.includes(moduleId) ||
          moduleId.replace(/_/g, "") === m.id.replace(/_/g, "")
      );
    }

    if (!module) {
      const technicalSubcategoryMap: Record<string, string> = {
        carnot: "thermodynamics",
        carnot_cycle: "thermodynamics",
        heat_engine: "thermodynamics",
        second_law: "thermodynamics",
        first_law: "thermodynamics",
        entropy: "thermodynamics",
        venturimeter: "fluid_mechanics",
        bernoulli: "fluid_mechanics",
        bernoullis_equation: "fluid_mechanics",
        continuity_equation: "fluid_mechanics",
        archimedes: "fluid_mechanics",
        archimedes_principle: "fluid_mechanics",
        buoyancy: "fluid_mechanics",
        manometer: "fluid_mechanics",
        input_output: "seating_arrangement",
        blood_relation: "blood_relations",
        number_sequence: "number_series",
        letter_series: "number_series",
        profit: "profit_loss",
        loss: "profit_loss",
        simple_interest: "si_ci",
        compound_interest: "si_ci",
        binary_search_tree: "data_structures",
        bst: "data_structures",
        linked_list: "data_structures",
        time_complexity: "algorithms_complexity",
        master_theorem: "algorithms_complexity",
        scheduling: "operating_systems",
        subnetting: "computer_networks",
        sql_query: "dbms",
        normalization: "dbms",
        polymorphism: "oops",
      };

      const slug = moduleId.toLowerCase();
      const mappedId =
        technicalSubcategoryMap[slug] ??
        technicalSubcategoryMap[
          Object.keys(technicalSubcategoryMap).find((k) => slug.includes(k)) ?? ""
        ];

      if (mappedId) {
        module = PRACTICE_MODULES.find((m) => m.id === mappedId);
      }
    }

    // Last resort — default to first logical module
    if (!module) {
      module =
        PRACTICE_MODULES.find((m) => m.category === "logical") ?? PRACTICE_MODULES[0];
      console.warn(
        `[practice/submit] Could not match "${moduleId}" → using fallback`
      );
    }

    // 4) Score
    const { score, correctAnswers, categoryScores } = scorePlacementAttempt(
      questions,
      answers
    );

    // 5) Save to practice_attempts
    await adminClient.from("practice_attempts").insert({
      student_id: user.id,
      module_category: module.category,
      subcategory: moduleId,
      branch: profile.branch ?? null,
      score,
      total_questions: questions.length,
      correct_answers: correctAnswers,
      time_taken: timeTaken,
      // Keeping categoryScores for future upgrades (optional column in DB)
      // If the table doesn't have it, Supabase will ignore/complain based on schema.
      // We only store core fields per the requested contract.
      // category_scores: categoryScores,
    });

    // 6) Per-question analysis
    const questionAnalysis = questions.map((q: any) => {
      const studentAns = String(answers[q.id] ?? "")
        .trim()
        .toUpperCase();
      const correctAns = String(q.answer ?? "").trim().toUpperCase();
      return {
        id: q.id,
        question: q.question,
        difficulty_level: q.difficulty_level ?? "intermediate",
        isCorrect: studentAns === correctAns,
        studentAnswer: studentAns,
        correctAnswer: correctAns,
        explanation: q.explanation,
        options: q.options,
      };
    });

    // 7) Compute mastery level
    const mastery =
      score >= 80
        ? "mastered"
        : score >= 60
          ? "progressing"
          : score >= 40
            ? "developing"
            : "needs_work";

    const masteryMessage: string =
      mastery === "mastered"
        ? "Excellent! You have strong command of this topic."
        : mastery === "progressing"
          ? "Good progress. Review the explanations to solidify your understanding."
          : mastery === "developing"
            ? "Keep practicing. Focus on the foundational questions first."
            : "This topic needs attention. Study the concept before retrying.";

    // 8) Return
    return Response.json({
      score,
      correctAnswers,
      totalQuestions: questions.length,
      mastery,
      masteryMessage,
      questionAnalysis,
      moduleLabel: module.label,
      timeTaken,
    });
  } catch (err) {
    console.error("[placement/practice/submit] error:", err);
    return Response.json({ error: "Submit failed" }, { status: 500 });
  }
}

