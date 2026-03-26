import { createPDFBuilder } from "@/lib/pdf/builder";
import { createServerClient } from "@/lib/db/supabase-server";
import { rgb } from "pdf-lib";
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

    const { data: profile } = await supabase
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

    const {
      companyName,
      score,
      correctAnswers,
      totalQuestions,
      timeTaken,
      categoryScores,
      gaps,
      questions,
      answers,
    } = await request.json();

    const safeQuestions = Array.isArray(questions) ? questions : [];
    const safeAnswers =
      answers && typeof answers === "object" ? answers : ({} as Record<string, string>);
    const safeCategoryScores =
      categoryScores && typeof categoryScores === "object"
        ? (categoryScores as Record<string, number>)
        : {};

    const { builder } = await createPDFBuilder();

    // 1) HEADER
    builder.addPageHeader(
      `Placement Test — ${companyName}`,
      `${companyName} Aptitude Test Results`,
      `${new Date().toLocaleDateString("en-IN", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })} · ${correctAnswers}/${totalQuestions} correct`
    );

    // 2) SCORE SECTION
    builder.space(8);

    const scoreColor =
      score >= 65
        ? rgb(0.086, 0.639, 0.29)
        : score >= 50
          ? rgb(0.855, 0.475, 0.027)
          : rgb(0.863, 0.196, 0.184);

    builder.text(`Overall Score: ${score}%`, {
      font: builder.getFont("bold"),
      size: 20,
      color: scoreColor,
    });
    builder.space(4);

    const mm = Math.floor((timeTaken ?? 0) / 60);
    const ss = (timeTaken ?? 0) % 60;
    builder.text(
      `${correctAnswers} correct · ${totalQuestions - correctAnswers} wrong · Time: ${mm}m ${ss}s`,
      { size: 11, color: rgb(0.278, 0.337, 0.424) }
    );
    builder.space(8);
    builder.drawLine();

    // 3) CATEGORY SCORES
    builder.sectionHeading("Category Performance");
    builder.space(4);

    const categories = ["quantitative", "logical", "verbal", "technical"];
    for (const cat of categories) {
      const catScore = safeCategoryScores[cat] ?? 0;
      const delta = catScore - 65;
      const catColor =
        catScore >= 65
          ? rgb(0.086, 0.639, 0.29)
          : catScore >= 50
            ? rgb(0.855, 0.475, 0.027)
            : rgb(0.863, 0.196, 0.184);

      const deltaText =
        delta > 0
          ? `▲ ${delta}% above target`
          : delta < 0
            ? `▼ ${Math.abs(delta)}% below target`
            : "At target";

      builder.text(
        `${cat.charAt(0).toUpperCase() + cat.slice(1)}: ${catScore}%  —  ${deltaText}`,
        { size: 11, color: catColor }
      );
    }
    builder.space(8);
    builder.drawLine();

    builder.space(4);
    builder.text(
      "Note: Questions are modelled on verified campus placement patterns " +
        `(${companyName} aptitude rounds) with topic distribution matching ` +
        "real recruitment drives. Technical questions are grounded in the " +
        "student's academic syllabus.",
      { size: 9, color: rgb(0.58, 0.635, 0.71) }
    );
    builder.space(8);

    // 4) QUESTION BREAKDOWN
    builder.sectionHeading(`Question Breakdown (${safeQuestions.length} questions)`);
    builder.space(4);

    const categoryColors: Record<string, any> = {
      quantitative: rgb(0.145, 0.388, 0.922),
      logical: rgb(0.533, 0.29, 0.922),
      verbal: rgb(0.855, 0.475, 0.027),
      technical: rgb(0.086, 0.639, 0.29),
    };

    for (let i = 0; i < safeQuestions.length; i++) {
      const q = safeQuestions[i];
      const studentAns = String(safeAnswers[q.id] ?? "").trim().toUpperCase();
      const correctAns = String(q.answer ?? "").trim().toUpperCase();
      const isCorrect = studentAns === correctAns;

      builder.ensureSpace(100);
      builder.space(10);

      // Q number + status
      const qColor = isCorrect ? rgb(0.086, 0.639, 0.29) : rgb(0.863, 0.196, 0.184);
      const catLabel = `${(q.category ?? "general").charAt(0).toUpperCase()}${String(
        q.category ?? ""
      ).slice(1)}`;
      const catColor = categoryColors[String(q.category ?? "").toLowerCase()] ?? qColor;

      builder.text(`Q${i + 1}  [${catLabel}]  ${isCorrect ? "✓ Correct" : "✗ Wrong"}`, {
        font: builder.getFont("bold"),
        size: 10,
        color: qColor,
      });
      builder.space(2);

      // Question text
      builder.text(q.question ?? "", {
        font: builder.getFont("bold"),
        size: 11,
        color: rgb(0.118, 0.161, 0.235),
      });
      builder.space(3);

      // Options
      const optionLabels = ["A", "B", "C", "D"];
      if (Array.isArray(q.options)) {
        for (let j = 0; j < q.options.length; j++) {
          const label = optionLabels[j] ?? String(j + 1);
          const optText = String(q.options[j] ?? "").replace(/^[A-D]\.\s*/i, "");
          const isStudentChoice = studentAns === label;
          const isCorrectOpt = correctAns === label;

          const optColor = isCorrectOpt
            ? rgb(0.086, 0.639, 0.29)
            : isStudentChoice && !isCorrect
              ? rgb(0.863, 0.196, 0.184)
              : rgb(0.278, 0.337, 0.424);

          const prefix = isCorrectOpt ? "✓" : isStudentChoice && !isCorrect ? "✗" : "○";

          builder.text(`${prefix}  ${label}. ${optText}`, {
            size: 10.5,
            color: optColor,
            x: 60,
          });
        }
      }
      builder.space(3);

      // Explanation
      if (q.explanation) {
        builder.text(`Explanation: ${q.explanation}`, {
          size: 10,
          color: rgb(0.278, 0.337, 0.424),
          x: 60,
        });
      }

      // Your answer vs correct (when wrong)
      if (!isCorrect) {
        builder.space(2);
        builder.text(
          `Your answer: ${studentAns || "(not answered)"}  ·  Correct: ${correctAns}`,
          { size: 10, color: rgb(0.863, 0.196, 0.184), x: 60 }
        );
      }

      // Divider between questions
      if (i < safeQuestions.length - 1) {
        builder.space(6);
        builder.drawLine(rgb(0.886, 0.914, 0.941), 0.5);
      }
    }

    // 5) FOOTER
    builder.space(16);
    builder.drawLine();
    builder.space(4);
    builder.text("Generated by EduNexus AI · Placement Readiness Module", {
      size: 9,
      color: rgb(0.58, 0.635, 0.71),
      align: "center",
    });

    const pdfBytes = await builder.build();
    const safeCompanyName = String(companyName ?? "company")
      .trim()
      .replace(/\s+/g, "-")
      .replace(/[^a-zA-Z0-9-_]/g, "");

    return new Response(Buffer.from(pdfBytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="placement-${safeCompanyName}-results.pdf"`,
      },
    });
  } catch (err) {
    console.error("[placement/export] error:", err);
    return Response.json({ error: "Export failed" }, { status: 500 });
  }
}

