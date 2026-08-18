/**
 * POST /api/quiz/export — PDF export for a completed assessment-engine session.
 *
 * Rebuilt against the current schema (quiz_sessions + quiz_session_keys +
 * student_question_attempts) — the v1 shape this used to read (quiz_attempts
 * joined to quizzes) is dead; nothing has written those tables since the
 * assessment engine (CP-Q3) replaced them. Mirrors
 * GET /api/assessment/results/[sessionId]'s reconstruction so the exported
 * PDF always matches what the results page shows.
 */

import { rgb } from "pdf-lib";

import { createPDFBuilder } from "@/lib/pdf/builder";
import { requireRole, apiError } from "@/lib/api/helpers";
import { loadSessionKey } from "@/lib/assessment/runner";
import type { AssessmentMode } from "@/lib/assessment/types";

interface SessionRow {
  id: string;
  student_id: string;
  mode: AssessmentMode;
  subject_ids: string[];
  status: string;
  completed_at: string | null;
  score: number | null;
  total_marks: number | null;
  config: { questions?: Array<{ slotId: string; options?: string[] | null }> } | null;
}

interface AttemptRow {
  subject_id: string;
  module_id: string | null;
  question_text: string;
  student_answer: string | null;
  is_correct: boolean | null;
  created_at: string;
}

export async function POST(request: Request) {
  try {
    const authResult = await requireRole(["student"]);
    if (authResult instanceof Response) return authResult;
    const { user, adminClient } = authResult;

    const { sessionId } = await request.json();
    if (!sessionId || typeof sessionId !== "string") {
      return apiError("sessionId is required", 400);
    }

    const { data, error } = await adminClient
      .from("quiz_sessions")
      .select("id, student_id, mode, subject_ids, status, completed_at, score, total_marks, config")
      .eq("id", sessionId)
      .maybeSingle();
    if (error) return apiError(error.message, 500);
    const session = data as SessionRow | null;
    if (!session) return apiError("Not found", 404);
    if (session.student_id !== user.id) return apiError("Forbidden", 403);
    if (session.status !== "completed") {
      return apiError("This session has not been submitted yet", 404);
    }

    const [key, attemptsRes, subjectsRes] = await Promise.all([
      loadSessionKey(adminClient, session.id),
      adminClient
        .from("student_question_attempts")
        .select("subject_id, module_id, question_text, student_answer, is_correct, created_at")
        .eq("session_id", session.id)
        .order("created_at", { ascending: true }),
      adminClient.from("subjects").select("id, name, code").in("id", session.subject_ids ?? []),
    ]);
    if (key.length === 0) {
      return apiError("This session has no recoverable answer key", 500);
    }

    const subjectsById = new Map(
      ((subjectsRes.data ?? []) as Array<{ id: string; name: string; code: string }>).map((s) => [
        s.id,
        s,
      ])
    );

    // Same "last attempt wins" collapse as the results route — /submit
    // re-writes a final row per question over the /answer-time row.
    const attemptByText = new Map<string, AttemptRow>();
    for (const row of (attemptsRes.data ?? []) as AttemptRow[]) {
      attemptByText.set(`${row.subject_id}:${row.module_id ?? ""}:${row.question_text}`, row);
    }

    const optionsBySlot = new Map(
      (session.config?.questions ?? []).map((q) => [q.slotId, q.options ?? null])
    );

    const primarySubject = subjectsById.get(session.subject_ids?.[0] ?? "");
    const score = session.score ?? 0;
    const totalMarks = session.total_marks ?? key.reduce((s, k) => s + k.marks, 0);
    const correctCount = key.filter((k) => {
      const a = attemptByText.get(`${k.subjectId}:${k.moduleId ?? ""}:${k.questionText}`);
      return a?.is_correct === true;
    }).length;

    const dateStr = new Date(session.completed_at ?? Date.now()).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });

    const { builder } = await createPDFBuilder();

    builder.addPageHeader(
      `Quiz Results — ${primarySubject?.code ?? ""}`,
      `${session.mode.replace("_", " ")} quiz`,
      `${primarySubject?.name ?? ""} · ${dateStr}`
    );

    builder.space(8);
    const scoreColor =
      score >= 70 ? rgb(0.086, 0.639, 0.29) : score >= 50 ? rgb(0.855, 0.475, 0.027) : rgb(0.863, 0.196, 0.184);

    builder.sectionHeading("Score Summary", scoreColor);
    builder.text(`${score}%  ·  ${correctCount} / ${key.length} correct  ·  ${totalMarks} marks`, {
      font: builder.getFont("bold"),
      size: 13,
      color: scoreColor,
    });
    builder.space(12);
    builder.drawLine();

    builder.sectionHeading(`Questions & Answers (${key.length} total)`);
    builder.space(4);

    for (let i = 0; i < key.length; i++) {
      const k = key[i];
      const attempt = attemptByText.get(`${k.subjectId}:${k.moduleId ?? ""}:${k.questionText}`);
      const studentAns = attempt?.student_answer ?? "";
      const isCorrect = attempt?.is_correct === true;

      builder.ensureSpace(80);
      builder.space(10);

      const qColor = isCorrect ? rgb(0.086, 0.639, 0.29) : rgb(0.863, 0.196, 0.184);
      builder.text(`Q${i + 1}  ${isCorrect ? "✓ Correct" : "✗ Incorrect"}`, {
        font: builder.getFont("bold"),
        size: 10,
        color: qColor,
      });
      builder.space(2);

      builder.text(k.questionText, {
        font: builder.getFont("bold"),
        size: 11,
        color: rgb(0.118, 0.161, 0.235),
      });
      builder.space(4);

      const options = optionsBySlot.get(k.slotId);
      if (Array.isArray(options) && options.length) {
        const labels = ["A", "B", "C", "D", "E"];
        for (let j = 0; j < options.length; j++) {
          const opt = options[j];
          const label = labels[j] ?? String(j + 1);
          const isStudentChoice = studentAns === label || studentAns === opt;
          const isCorrectOpt = k.correctAnswer === label || k.correctAnswer === opt;

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
        builder.text(`Your answer: ${studentAns || "(no answer)"}`, {
          size: 10.5,
          color: isCorrect ? rgb(0.086, 0.639, 0.29) : rgb(0.863, 0.196, 0.184),
          x: 48 + 12,
        });
        if (!isCorrect) {
          builder.text(`Correct answer: ${k.correctAnswer}`, {
            size: 10.5,
            color: rgb(0.086, 0.639, 0.29),
            x: 48 + 12,
          });
        }
        builder.space(4);
      }

      if (k.explanation) {
        builder.text(`Explanation: ${k.explanation}`, {
          size: 10,
          color: rgb(0.278, 0.337, 0.424),
          x: 48 + 12,
        });
      }

      if (i < key.length - 1) {
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
    return apiError("Export failed", 500);
  }
}
