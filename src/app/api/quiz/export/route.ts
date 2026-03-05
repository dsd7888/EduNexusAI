import { rgb } from "pdf-lib";

import { createPDFBuilder } from "@/lib/pdf/builder";
import {
  createAdminClient,
  createServerClient,
} from "@/lib/db/supabase-server";

export async function POST(request: Request) {
  try {
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { attemptId } = await request.json();
    const adminClient = createAdminClient();

    const { data: attempt } = await adminClient
      .from("quiz_attempts")
      .select(
        `
        id, score, time_taken, created_at, answers,
        quizzes ( title, questions, subjects ( name, code ) )
      `
      )
      .eq("id", attemptId)
      .eq("student_id", user.id)
      .single();

    if (!attempt) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }

    const quiz = attempt.quizzes as any;
    const subject = quiz?.subjects as any;
    const questions = Array.isArray(quiz?.questions) ? quiz.questions : [];
    const answers = (attempt.answers as any) ?? {};

    const dateStr = new Date(attempt.created_at).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });

    const correct = questions.filter((q: any) => {
      const student = String(answers[q.id] ?? "").trim().toLowerCase();
      const correctAns = String(q.correctAnswer ?? "")
        .trim()
        .toLowerCase();
      return student === correctAns;
    }).length;

    const { builder } = await createPDFBuilder();

    // Header
    builder.addPageHeader(
      `Quiz Results — ${subject?.code ?? ""}`,
      quiz?.title ?? "Quiz Results",
      `${subject?.name ?? ""} · ${dateStr}`
    );

    // Score summary card
    builder.space(8);
    const scoreColor =
      attempt.score >= 70
        ? rgb(0.086, 0.639, 0.29)
        : attempt.score >= 50
          ? rgb(0.855, 0.475, 0.027)
          : rgb(0.863, 0.196, 0.184);

    builder.sectionHeading("Score Summary", scoreColor);
    builder.text(
      `${attempt.score}%  ·  ${correct} / ${questions.length} correct  ·  Time: ${Math.round(
        (attempt.time_taken ?? 0) / 60
      )} min`,
      {
        font: builder.getFont("bold"),
        size: 13,
        color: scoreColor,
      }
    );
    builder.space(12);
    builder.drawLine();

    // Questions
    builder.sectionHeading(`Questions & Answers (${questions.length} total)`);
    builder.space(4);

    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      const studentAns = String(answers[q.id] ?? "").trim();
      const correctAns = String(q.correctAnswer ?? "").trim();
      const isCorrect =
        studentAns.toLowerCase() === correctAns.toLowerCase();

      builder.ensureSpace(80);
      builder.space(10);

      // Question number + correct/wrong indicator
      const qColor = isCorrect
        ? rgb(0.086, 0.639, 0.29)
        : rgb(0.863, 0.196, 0.184);

      builder.text(`Q${i + 1}  ${isCorrect ? "✓ Correct" : "✗ Incorrect"}`, {
        font: builder.getFont("bold"),
        size: 10,
        color: qColor,
      });
      builder.space(2);

      // Question text
      builder.text(q.question ?? q.text ?? "", {
        font: builder.getFont("bold"),
        size: 11,
        color: rgb(0.118, 0.161, 0.235),
      });
      builder.space(4);

      // Options (if MCQ)
      if (Array.isArray(q.options) && q.options.length) {
        const labels = ["A", "B", "C", "D", "E"];
        for (let j = 0; j < q.options.length; j++) {
          const opt = q.options[j];
          const label = labels[j] ?? String(j + 1);
          const isStudentChoice = studentAns === label || studentAns === opt;
          const isCorrectOpt = correctAns === label || correctAns === opt;

          const optColor = isCorrectOpt
            ? rgb(0.086, 0.639, 0.29)
            : isStudentChoice && !isCorrect
              ? rgb(0.863, 0.196, 0.184)
              : rgb(0.278, 0.337, 0.424);

          builder.text(
            `${isCorrectOpt ? "✓" : isStudentChoice && !isCorrect ? "✗" : "○"}  ${label}. ${opt}`,
            { size: 10.5, color: optColor, x: 48 + 12 }
          );
        }
        builder.space(4);
      } else {
        // Short answer / numerical
        builder.text(
          `Your answer: ${studentAns || "(no answer)"}`,
          {
            size: 10.5,
            color: isCorrect
              ? rgb(0.086, 0.639, 0.29)
              : rgb(0.863, 0.196, 0.184),
            x: 48 + 12,
          }
        );
        if (!isCorrect) {
          builder.text(`Correct answer: ${correctAns}`, {
            size: 10.5,
            color: rgb(0.086, 0.639, 0.29),
            x: 48 + 12,
          });
        }
        builder.space(4);
      }

      // Explanation
      if (q.explanation) {
        builder.text(`Explanation: ${q.explanation}`, {
          size: 10,
          color: rgb(0.278, 0.337, 0.424),
          x: 48 + 12,
        });
      }

      // Divider between questions
      if (i < questions.length - 1) {
        builder.space(6);
        builder.drawLine(rgb(0.886, 0.914, 0.941), 0.5);
      }
    }

    const pdfBytes = await builder.build();
    return new Response(Buffer.from(pdfBytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="quiz-results.pdf"`,
      },
    });
  } catch (err) {
    console.error("[quiz/export]", err);
    return Response.json({ error: "Export failed" }, { status: 500 });
  }
}

