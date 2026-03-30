import {
  generateStructuredQPaperPDF,
  type StructuredPaperData,
} from "@/lib/qpaper/generator";
import { routeAI } from "@/lib/ai/router";
import {
  createAdminClient,
  createServerClient,
} from "@/lib/db/supabase-server";
import type { NextRequest } from "next/server";

function buildPYQInstruction(
  questionSource: string,
  pyqPercent: number | null,
  pyqContent: string,
  pyqMetadata: Array<{ title: string; year?: string }>
): string {
  const hasPYQ = pyqContent.length > 50 || pyqMetadata.length > 0;

  if (!hasPYQ || questionSource === "fresh") {
    return `QUESTION GENERATION: All questions are fresh and original.
Difficulty: 25% easy recall, 50% application/analysis, 25% challenging.
Draw topics proportionally from the selected modules.`;
  }

  const pyqContext =
    pyqMetadata.length > 0
      ? `AVAILABLE PYQ DOCUMENTS:
${pyqMetadata.map((p) => `- ${p.title}${p.year ? ` (${p.year})` : ""}`).join("\n")}

KEY INSTRUCTION: These PYQs follow the university's examination pattern.
Understand from them:
  1. The TYPE of questions asked (conceptual vs numerical vs derivation)
  2. The DEPTH expected (how many steps in solutions, level of detail)
  3. The TOPICS prioritised in each module
  4. The LANGUAGE and framing style used
  5. The DIFFICULTY curve across the paper

EXAM TYPE AWARENESS:
Internal exams typically cover 2-3 specific modules.
Final exams cover all modules with broader scope.

When analyzing PYQs, identify:
- Which modules/topics appear most frequently
- Typical marks distribution per topic
- Question depth (recall vs application vs analysis)
- Whether numericals require steam tables, charts, etc.

Generate new questions maintaining the same module
weightage as seen in the PYQ for this exam type.

${pyqContent.slice(0, 2000)}`
      : "";

  if (questionSource === "pyq_pattern") {
    return `${pyqContext}

GENERATION INSTRUCTION: Generate completely NEW questions that:
- Follow the same cognitive level as the PYQs (same type: derivation/numerical/conceptual)
- Match the depth and length of answers expected
- Cover similar topic distribution
- Use similar question framing and terminology
All questions must be original — no verbatim copying.`;
  }

  const pyqPct = pyqPercent ?? 50;
  const freshPct = 100 - pyqPct;

  return `${pyqContext}

GENERATION INSTRUCTION — MIXED MODE:
${pyqPct}% of questions (by marks) should be PYQ-inspired variations.
${freshPct}% of questions (by marks) should be completely fresh.

PYQ-inspired: same topic/concept, different values or scenario.
Fresh: original questions covering underrepresented topics.
Both must match the university's examination style and depth.`;
}

type ModuleDetailRow = {
  id: string;
  name: string;
  module_number: number;
  description?: string | null;
};

function buildQPaperPrompt(options: {
  subjectName: string;
  subjectCode: string;
  syllabusContent: string;
  referenceBooks: string;
  pyqInstruction: string;
  sections: unknown[];
  totalMarks: number;
  duration: number;
  moduleDetails: ModuleDetailRow[];
}): string {
  const {
    subjectName,
    subjectCode,
    syllabusContent,
    referenceBooks,
    pyqInstruction,
    sections,
    totalMarks,
    duration,
    moduleDetails,
  } = options;

  const effectiveMarksQuestion = (q: any): number => {
    const parts = q.parts ?? [];
    if (q.attemptAny != null && parts.length > 0) {
      const n = Math.min(Number(q.attemptAny) || 0, parts.length);
      return parts
        .slice(0, n)
        .reduce((sum: number, p: any) => sum + (Number(p?.marks) || 0), 0);
    }
    return parts.reduce(
      (sum: number, p: any) => sum + (Number(p?.marks) || 0),
      0
    );
  };

  const sectionDesc = (sections as any[]).map((sec: any, sIdx: number) => {
    const qDescs = sec.questions
      .map((q: any, qIdx: number) => {
        const globalQNum =
          sections
            .slice(0, sIdx)
            .reduce((acc: number, s: any) => acc + s.questions.length, 0) +
          qIdx +
          1;

        const em = effectiveMarksQuestion(q);

        const partDesc = (q.parts ?? [])
          .map((p: any, pIdx: number) => {
            const label = "abcdefghijklmnopqrstuvwxyz"[pIdx] ?? "?";
            return `    (${label}) [${String(p?.type ?? "long").toUpperCase()}] ${p.marks} marks`;
          })
          .join("\n");

        const attemptNote =
          q.attemptAny !== undefined
            ? `    → Attempt any ${q.attemptAny} out of ${(q.parts ?? []).length} parts`
            : "";

        const paperMarksLine = `    Paper marks (toward total): ${em}M`;

        const moduleNote = q.moduleId
          ? (() => {
              const mod = moduleDetails.find((m) => m.id === q.moduleId);
              return mod
                ? `    → This question MUST be from Module ${mod.module_number}: ${mod.name}`
                : "";
            })()
          : "    → Draw from any selected module";

        return `  Q.${globalQNum}\n${paperMarksLine}\n${partDesc}${attemptNote ? "\n" + attemptNote : ""}\n${moduleNote}`;
      })
      .join("\n");

    const secTotal = sec.questions.reduce(
      (s: number, q: any) => s + effectiveMarksQuestion(q),
      0
    );

    return `${sec.name} (${secTotal} marks):\n${qDescs}`;
  }).join("\n\n");

  return `You are an expert ${subjectName} professor creating a university examination.

SUBJECT: ${subjectName} (${subjectCode})
TOTAL MARKS: ${totalMarks} | DURATION: ${duration} minutes

SYLLABUS:
${syllabusContent.slice(0, 4000)}

${referenceBooks ? `REFERENCE BOOKS: ${referenceBooks}` : ""}

${pyqInstruction}

PAPER STRUCTURE TO GENERATE:
${sectionDesc}

QUESTION TYPE RULES:
- MCQ: 4 options labeled A/B/C/D, exactly 1 correct. Include correct_answer field.
- True/False: 2 options: "True" and "False". Include correct_answer field.
- Short Answer: Clear, focused question. Expected answer: 2-5 sentences.
- Long Answer: Multi-part or detailed question. Expected answer: structured paragraphs.
- Numerical: Real engineering problem with given values. Must have a clean numerical answer.
  Show solution method in the solution field.

RULES:
- Questions must be original and not repeat each other
- Each question must match its allocated marks (harder = more marks)
- Use subject-specific terminology and realistic scenarios
- For numerical: use values that give clean answers

OUTPUT FORMAT — Return ONLY this JSON, no other text:
{
  "paperTitle": "${subjectName} Examination",
  "sections": [
    {
      "name": "Section A",
      "questions": [
        {
          "qNumber": 1,
          "parts": [
            {
              "partLabel": "a",
              "type": "mcq",
              "marks": 1,
              "question": "Question text here",
              "options": ["A. option1", "B. option2", "C. option3", "D. option4"],
              "correct_answer": "B",
              "solution": "Brief explanation of correct answer"
            }
          ]
        }
      ]
    }
  ]
}`;
}

export async function POST(request: NextRequest) {
  try {
    console.log("[qpaper] POST request received");

    const supabase = await createServerClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      console.log("[qpaper] Unauthorized: no user");
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const adminClient = createAdminClient();
    const { data: profile, error: profileError } = await adminClient
      .from("profiles")
      .select("id, role")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      console.error("[qpaper] Profile fetch error:", profileError?.message);
      return Response.json(
        { error: "Failed to load profile" },
        { status: 500 }
      );
    }

    const role = (profile as { role?: string }).role;
    if (role !== "faculty" && role !== "superadmin") {
      console.log("[qpaper] Forbidden: role", role);
      return Response.json(
        { error: "Forbidden: Faculty or Superadmin only" },
        { status: 403 }
      );
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = (await request.json()) as Record<string, unknown>;
    } catch {
      return Response.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const {
      subjectId: rawSubjectId,
      sections,
      totalMarks: rawTotalMarks,
      duration: rawDuration,
      questionSource: rawQuestionSource,
      pyqPercent: rawPyqPercent,
      selectedModuleIds: rawSelectedModuleIds,
    } = parsed as {
      subjectId?: unknown;
      sections?: unknown;
      totalMarks?: unknown;
      duration?: unknown;
      questionSource?: unknown;
      pyqPercent?: unknown;
      selectedModuleIds?: unknown;
    };

    const subjectId = String(rawSubjectId ?? "").trim();

    if (!subjectId) {
      return Response.json(
        { error: "subjectId is required" },
        { status: 400 }
      );
    }

    if (!Array.isArray(sections) || sections.length === 0) {
      return Response.json(
        { error: "sections is required and must be a non-empty array" },
        { status: 400 }
      );
    }

    if (rawTotalMarks == null || rawDuration == null) {
      return Response.json(
        { error: "totalMarks and duration are required" },
        { status: 400 }
      );
    }

    const totalMarks = Number(rawTotalMarks);
    const duration = Number(rawDuration);
    const questionSource =
      rawQuestionSource === "pyq_mix" || rawQuestionSource === "pyq_pattern"
        ? rawQuestionSource
        : "fresh";

    const selectedModuleIds = Array.isArray(rawSelectedModuleIds)
      ? rawSelectedModuleIds.filter((id): id is string => typeof id === "string")
      : [];

    console.log("[qpaper] Fetching subject_content for subjectId:", subjectId);
    const { data: contentRow, error: contentError } = await adminClient
      .from("subject_content")
      .select("content, reference_books")
      .eq("subject_id", subjectId)
      .maybeSingle();

    if (contentError) {
      console.error("[qpaper] subject_content error:", contentError.message);
      return Response.json(
        { error: "Failed to load syllabus content" },
        { status: 500 }
      );
    }
    if (!contentRow) {
      console.log("[qpaper] No subject_content found");
      return Response.json(
        { error: "Syllabus content not found for this subject" },
        { status: 404 }
      );
    }

    const fullSyllabus = String(
      (contentRow as { content?: string }).content ?? ""
    );
    const referenceBooks = String(
      (contentRow as { reference_books?: string }).reference_books ?? ""
    );

    let syllabusForPrompt = fullSyllabus;
    let moduleDetails: ModuleDetailRow[] = [];

    if (selectedModuleIds.length > 0) {
      const { data: fetchedModules } = await adminClient
        .from("modules")
        .select("id, name, module_number, description")
        .eq("subject_id", subjectId)
        .in("id", selectedModuleIds)
        .order("module_number");

      moduleDetails = (fetchedModules ?? []) as ModuleDetailRow[];

      const moduleContext = moduleDetails
        .map(
          (m) =>
            `Module ${m.module_number}: ${m.name}${
              m.description ? `\nTopics: ${m.description}` : ""
            }`
        )
        .join("\n\n");

      syllabusForPrompt = `SELECTED MODULES FOR THIS PAPER:
${moduleContext}

FULL SUBJECT SYLLABUS FOR REFERENCE:
${fullSyllabus.slice(0, 2000)}

IMPORTANT: Distribute questions proportionally across 
ALL selected modules. Each module should appear in 
roughly equal proportion unless faculty specified 
otherwise via question-level module assignment.`;
    }

    const { data: subject, error: subjectError } = await adminClient
      .from("subjects")
      .select("name, code")
      .eq("id", subjectId)
      .single();

    if (subjectError || !subject) {
      console.log("[qpaper] Subject not found");
      return Response.json({ error: "Subject not found" }, { status: 404 });
    }

    const subjectName = (subject as { name?: string }).name ?? "";
    const subjectCode = (subject as { code?: string }).code ?? "";

    const { data: pyqDocs } = await adminClient
      .from("documents")
      .select("title, file_path, year")
      .eq("subject_id", subjectId)
      .eq("type", "pyq")
      .eq("status", "ready")
      .order("year", { ascending: false })
      .limit(3);

    const pyqContent = pyqDocs?.length
      ? `PYQ documents available: ${pyqDocs.map((d) => d.title).join(", ")}`
      : "";

    const pyqMetadata =
      pyqDocs?.map((d) => ({
        title: String(d.title ?? ""),
        year: d.year != null ? String(d.year) : undefined,
      })) ?? [];

    let pyqPercent: number | null = null;
    if (questionSource === "pyq_mix" && rawPyqPercent != null) {
      const n = Number(rawPyqPercent);
      if (!Number.isNaN(n)) {
        pyqPercent = Math.min(100, Math.max(0, n));
      }
    }

    const pyqInstruction = buildPYQInstruction(
      questionSource ?? "fresh",
      pyqPercent,
      pyqContent,
      pyqMetadata
    );

    const prompt = buildQPaperPrompt({
      subjectName,
      subjectCode,
      syllabusContent: syllabusForPrompt,
      referenceBooks,
      pyqInstruction,
      sections: sections as unknown[],
      totalMarks,
      duration,
      moduleDetails,
    });

    const attemptAnyMatrix = (sections as any[]).map((sec: any) =>
      (sec.questions ?? []).map(
        (q: any) => q.attemptAny as number | undefined
      )
    );

    console.log("[qpaper] Generating question paper...");
    const result = await routeAI("qpaper_gen", {
      messages: [{ role: "user", content: prompt }],
      temperature: 0.4,
    });

    const raw = String(result.content ?? "");

    let paperData: StructuredPaperData | null = null;
    try {
      const cleaned = raw
        .replace(/```json\s*/gi, "")
        .replace(/```\s*/gi, "")
        .trim();
      paperData = JSON.parse(cleaned) as StructuredPaperData;
    } catch {
      const start = raw.indexOf("{");
      const end = raw.lastIndexOf("}");
      if (start !== -1 && end > start) {
        try {
          paperData = JSON.parse(
            raw
              .slice(start, end + 1)
              .replace(/,\s*}/g, "}")
              .replace(/,\s*]/g, "]")
          ) as StructuredPaperData;
        } catch {
          return Response.json(
            { error: "Failed to generate paper. Please try again." },
            { status: 500 }
          );
        }
      }
    }

    if (!paperData?.sections) {
      return Response.json(
        { error: "Failed to generate paper. Please try again." },
        { status: 500 }
      );
    }

    const totalQuestions = paperData.sections.reduce(
      (acc, s) => acc + (s.questions?.length ?? 0),
      0
    );
    console.log("[qpaper] Generated", totalQuestions, "questions");

    const pdfBuffer = await generateStructuredQPaperPDF(
      paperData,
      {
        subjectName,
        subjectCode,
        totalMarks,
        duration,
      },
      { attemptAnyMatrix }
    );

    const fileName = `qpaper_${Date.now()}_${user.id.slice(0, 8)}.pdf`;
    const filePath = `qpapers/${fileName}`;

    const { error: uploadError } = await adminClient.storage
      .from("generated-content")
      .upload(filePath, pdfBuffer, {
        contentType: "application/pdf",
      });

    if (uploadError) {
      console.error("[qpaper] Upload failed:", uploadError.message);
      return Response.json(
        { error: "Failed to upload question paper" },
        { status: 500 }
      );
    }

    const { data: urlData } = adminClient.storage
      .from("generated-content")
      .getPublicUrl(filePath);

    const paperTitle =
      paperData.paperTitle ?? `${subjectName} Examination`;

    await adminClient.from("generated_content").insert({
      subject_id: subjectId,
      module_id: null,
      type: "qpaper",
      title: paperTitle,
      file_path: filePath,
      metadata: {
        totalMarks,
        totalQuestions,
        sections: paperData.sections.length,
        questionSource,
        downloadUrl: urlData.publicUrl,
      },
      generated_by: user.id,
      status: "completed",
    });

    return Response.json({
      success: true,
      paper: paperData,
      downloadUrl: urlData.publicUrl,
      totalQuestions,
    });
  } catch (err) {
    console.error("[qpaper] Error:", err);
    const message =
      err instanceof Error ? err.message : "Failed to generate question paper";
    return Response.json({ error: message }, { status: 500 });
  }
}
