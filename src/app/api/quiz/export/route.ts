import type { NextRequest } from "next/server";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

import type { QuizQuestion } from "@/lib/quiz/generator";
import {
  createAdminClient,
  createServerClient,
} from "@/lib/db/supabase-server";

function sanitizeForPDF(text: string): string {
  if (!text) return "";
  return text
    .replace(/ρ/g, "rho")
    .replace(/μ/g, "mu")
    .replace(/σ/g, "sigma")
    .replace(/τ/g, "tau")
    .replace(/η/g, "eta")
    .replace(/θ/g, "theta")
    .replace(/α/g, "alpha")
    .replace(/β/g, "beta")
    .replace(/γ/g, "gamma")
    .replace(/δ/g, "delta")
    .replace(/λ/g, "lambda")
    .replace(/π/g, "pi")
    .replace(/ω/g, "omega")
    .replace(/Δ/g, "Delta")
    .replace(/Σ/g, "Sigma")
    .replace(/Ω/g, "Omega")
    .replace(/×/g, "x")
    .replace(/÷/g, "/")
    .replace(/≈/g, "~=")
    .replace(/≠/g, "!=")
    .replace(/≤/g, "<=")
    .replace(/≥/g, ">=")
    .replace(/²/g, "^2")
    .replace(/³/g, "^3")
    .replace(/√/g, "sqrt")
    .replace(/∞/g, "infinity")
    .replace(/∑/g, "sum")
    .replace(/∫/g, "integral")
    .replace(/∂/g, "d")
    .replace(/°/g, " deg")
    .replace(/→/g, "->")
    .replace(/←/g, "<-")
    .replace(/↑/g, "^")
    .replace(/↓/g, "v")
    .replace(/•/g, "-")
    .replace(/…/g, "...")
    .replace(/[*_`]/g, "")
    .replace(/[^\x00-\xFF]/g, "?")
    .trim();
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
      });
    }

    const adminClient = createAdminClient();
    const { data: profile, error: profileError } = await adminClient
      .from("profiles")
      .select("id, role")
      .eq("id", user.id)
      .single();

    if (profileError || !profile || profile.role !== "student") {
      return new Response(
        JSON.stringify({ error: "Forbidden: Students only" }),
        { status: 403 }
      );
    }

    const body = await request.json().catch(() => ({} as any));
    const attemptId = String(body?.attemptId ?? "").trim();

    if (!attemptId) {
      return new Response(
        JSON.stringify({ error: "attemptId is required" }),
        { status: 400 }
      );
    }

    const { data: attempt, error: attemptError } = await adminClient
      .from("quiz_attempts")
      .select(
        "id, score, time_taken, created_at, answers, quiz_id, quizzes(title, questions, subject_id, subjects(name))"
      )
      .eq("id", attemptId)
      .eq("student_id", user.id)
      .single();

    if (attemptError || !attempt) {
      return new Response(JSON.stringify({ error: "Attempt not found" }), {
        status: 404,
      });
    }

    const quizRel = attempt.quizzes as any;
    const questions = ((quizRel?.questions ?? []) as QuizQuestion[]) || [];
    const subjectName: string =
      (Array.isArray(quizRel?.subjects)
        ? quizRel.subjects[0]?.name
        : quizRel?.subjects?.name) ?? "Subject";

    const answers =
      (attempt.answers as Record<string, string> | null) ?? {};

    let correctCount = 0;
    const breakdown = questions.map((q, idx) => {
      const rawStudent = String(answers[q.id] ?? "").trim();
      const rawCorrect = String(q.correctAnswer ?? "").trim();

      let isCorrect = false;

      if (q.type === "multiple_correct") {
        const splitAndSort = (val: string) =>
          val
            .split("|")
            .map((s) => s.trim().toLowerCase())
            .filter(Boolean)
            .sort();
        const sArr = splitAndSort(rawStudent);
        const cArr = splitAndSort(rawCorrect);
        isCorrect =
          sArr.length > 0 &&
          sArr.length === cArr.length &&
          sArr.every((v, i) => v === cArr[i]);
      } else if (q.type === "match") {
        const toPairs = (val: string) =>
          val
            .split("|")
            .map((p) => p.trim())
            .filter(Boolean)
            .map((p) => p.toLowerCase());
        const sPairs = toPairs(rawStudent);
        const cPairs = toPairs(rawCorrect);
        const sSet = new Set(sPairs);
        const cSet = new Set(cPairs);
        isCorrect =
          sPairs.length > 0 &&
          sPairs.length === cPairs.length &&
          sPairs.every((p) => cSet.has(p)) &&
          cPairs.every((p) => sSet.has(p));
      } else {
        const studentAns = rawStudent.toLowerCase();
        const correctAns = rawCorrect.toLowerCase();
        isCorrect = studentAns === correctAns;
      }

      if (isCorrect) correctCount++;

      return {
        index: idx + 1,
        question: q,
        studentAnswer: rawStudent,
        correctAnswer: rawCorrect,
        correct: isCorrect,
      };
    });

    const totalCount = questions.length;

    const pdfDoc = await PDFDocument.create();
    const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    let page = pdfDoc.addPage();
    let { width, height } = page.getSize();
    const margin = 50;
    let y = height - margin;

    const newPage = () => {
      page = pdfDoc.addPage();
      ({ width, height } = page.getSize());
      y = height - margin;
    };

    const drawWrappedText = (
      textRaw: string,
      opts: {
        bold?: boolean;
        size?: number;
        color?: [number, number, number];
        gap?: number;
        indent?: number;
      } = {}
    ) => {
      const text = sanitizeForPDF(textRaw);
      const {
        bold,
        size = 12,
        color = [0, 0, 0],
        gap = 16,
        indent = 0,
      } = opts;
      const font = bold ? fontBold : fontRegular;
      const maxWidth = width - margin * 2 - indent;
      const words = text.split(/\s+/);
      let line = "";
      const lines: string[] = [];
      for (const word of words) {
        const test = line ? `${line} ${word}` : word;
        const w = font.widthOfTextAtSize(test, size);
        if (w > maxWidth && line) {
          lines.push(line);
          line = word;
        } else {
          line = test;
        }
      }
      if (line) lines.push(line);

      for (const l of lines) {
        if (y - gap < margin) {
          newPage();
        }
        page.drawText(l, {
          x: margin + indent,
          y: y - gap,
          size,
          font,
          color: rgb(color[0], color[1], color[2]),
        });
        y -= gap;
      }
    };

    // Header
    drawWrappedText("EduNexus AI — Quiz Results", {
      bold: true,
      size: 18,
    });
    drawWrappedText(`Subject: ${subjectName}`, { size: 12 });
    drawWrappedText(`Quiz: ${quizRel?.title ?? "Quiz"}`, { size: 12 });
    drawWrappedText(
      `Date: ${new Date(attempt.created_at).toLocaleString("en-IN")}`,
      { size: 12 }
    );
    drawWrappedText(
      `Score: ${attempt.score}% (${correctCount}/${totalCount} correct)`,
      { size: 12 }
    );
    if (attempt.time_taken != null) {
      drawWrappedText(`Time: ${attempt.time_taken}s`, { size: 12 });
    }

    // Divider
    y -= 8;
    page.drawLine({
      start: { x: margin, y },
      end: { x: width - margin, y },
      color: rgb(0.7, 0.7, 0.7),
      thickness: 1,
    });
    y -= 12;

    // Questions
    breakdown.forEach((item) => {
      const q = item.question;
      drawWrappedText(`Q${item.index}. ${q.question}`, {
        bold: true,
        size: 12,
      });

      if (q.type === "mcq" && q.options) {
        q.options.forEach((opt, idx) => {
          const letter = String.fromCharCode(65 + idx);
          const isCorrectOpt = q.correctAnswer
            .toLowerCase()
            .includes(letter.toLowerCase());
          const mark = isCorrectOpt ? "✓" : " ";
          drawWrappedText(`${mark} ${letter}. ${opt}`, {
            size: 10,
            indent: 12,
          });
        });
      }

      const ansColor: [number, number, number] = item.correct
        ? [0, 0.5, 0]
        : [0.7, 0, 0];
      drawWrappedText(`Your Answer: ${item.studentAnswer || "(empty)"}`, {
        size: 11,
        color: ansColor,
      });

      if (!item.correct) {
        drawWrappedText(`Correct Answer: ${item.correctAnswer}`, {
          size: 11,
          color: [0, 0, 0],
        });
      }

      if (q.explanation) {
        drawWrappedText(`Explanation: ${q.explanation}`, {
          size: 10,
        });
      }

      drawWrappedText(`Difficulty: ${q.difficulty}`, {
        size: 10,
        color: [0.3, 0.3, 0.3],
      });

      y -= 8;
      page.drawLine({
        start: { x: margin, y },
        end: { x: width - margin, y },
        color: rgb(0.9, 0.9, 0.9),
        thickness: 0.5,
      });
      y -= 8;
    });

    const pdfBytes = await pdfDoc.save();
    const buffer = Buffer.from(pdfBytes);
    const filename = `quiz-results-${new Date()
      .toISOString()
      .slice(0, 10)}.pdf`;

    return new Response(buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    console.error("[quiz/export] POST error:", err);
    const msg =
      err instanceof Error ? err.message : "Failed to export quiz results";
    return new Response(JSON.stringify({ error: msg }), { status: 500 });
  }
}

