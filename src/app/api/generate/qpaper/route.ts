import { requireRole, apiError } from "@/lib/api/helpers";
import {
  PPSU_DEFAULT_STRUCTURE,
  PPSU_DEFAULT_INSTRUCTIONS,
  type PaperTemplateRow,
  type TemplateSection,
  type TemplateStructure,
} from "@/lib/qpaper/templates";
import {
  generatePPSUPaperPDF,
  type AssembledPaper,
  type GeneratedSection,
} from "@/lib/qpaper/builder";
import {
  generateSection,
  type ModuleInfo,
  type CourseOutcomeInfo,
  type CoPoMappingInfo,
  type PyqExample,
} from "@/lib/qpaper/sectionGen";
import {
  allocateBankForSection,
  assembleSectionFromBank,
  overlayBankOntoSection,
  usedBankIds,
} from "@/lib/qpaper/bankFill";
import { rowToBankQuestion, type FqbRow } from "@/lib/qbank/row";
import type { BankQuestion } from "@/lib/qbank/types";
import type { NextRequest } from "next/server";

interface ModuleRow {
  id: string;
  name: string;
  module_number: number;
  description: string | null;
  section_number: number | null;
  weightage_percent: number | null;
  btl_levels: string[] | null;
  hours: number | null;
}

interface PyqQuestionRow {
  document_id: string;
  section_name: string | null;
  q_number: string | null;
  question_text: string;
  question_type: string | null;
  marks: number | null;
  co: string | null;
  btl: number | null;
  po: string | null;
  options: Record<string, string> | null;
  year: number | null;
}

function modulesForSection(
  modules: ModuleRow[],
  section: TemplateSection
): ModuleInfo[] {
  const [lo, hi] = section.module_range;
  return modules
    .filter((m) => m.module_number >= lo && m.module_number <= hi)
    .map((m) => ({
      module_number: m.module_number,
      name: m.name,
      description: m.description,
      btl_levels: m.btl_levels,
      weightage_percent: m.weightage_percent,
      hours: m.hours,
    }));
}

export async function POST(request: NextRequest) {
  try {
    console.log("[qpaper] POST request received");

    const authResult = await requireRole(["faculty", "superadmin", "dean", "hod"]);
    if (authResult instanceof Response) return authResult;
    const { user, adminClient } = authResult;

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return apiError("Invalid JSON body", 400);
    }

    const subjectId = String(body.subjectId ?? "").trim();
    if (!subjectId) return apiError("subjectId is required", 400);
    const templateId =
      typeof body.templateId === "string" ? body.templateId.trim() : "";
    const fromBank =
      body.fromBank === true || body.questionSource === "from_bank";

    // ── Step 1a: subject ──────────────────────────────────────────────────
    const { data: subject, error: subjectError } = await adminClient
      .from("subjects")
      .select("name, code")
      .eq("id", subjectId)
      .single();
    if (subjectError || !subject) return apiError("Subject not found", 404);
    const subjectName = (subject as { name: string }).name;
    const subjectCode = (subject as { code: string }).code;

    // ── Step 1b: subject_content (syllabus, ref books) ────────────────────
    const { data: contentRow } = await adminClient
      .from("subject_content")
      .select("content, reference_books")
      .eq("subject_id", subjectId)
      .maybeSingle();
    void contentRow; // currently unused at section-level; reserved for future depth tuning

    // ── Step 1c: modules ──────────────────────────────────────────────────
    const { data: moduleRows } = await adminClient
      .from("modules")
      .select(
        "id, name, module_number, description, section_number, weightage_percent, btl_levels, hours"
      )
      .eq("subject_id", subjectId)
      .order("module_number");
    const modules: ModuleRow[] = (moduleRows ?? []) as ModuleRow[];

    // ── Step 1d: course outcomes ─────────────────────────────────────────
    const { data: coRows } = await adminClient
      .from("course_outcomes")
      .select("co_code, description")
      .eq("subject_id", subjectId);
    const courseOutcomes: CourseOutcomeInfo[] = (coRows ?? []) as CourseOutcomeInfo[];

    // ── Step 1e: CO-PO mapping ───────────────────────────────────────────
    const { data: coPoRows } = await adminClient
      .from("co_po_mapping")
      .select("co_code, po_code, strength")
      .eq("subject_id", subjectId);
    const coPoMapping: CoPoMappingInfo[] = (coPoRows ?? []) as CoPoMappingInfo[];

    const hasCoPoData =
      courseOutcomes.length > 0 && coPoMapping.length > 0;

    // ── Step 1f: template ────────────────────────────────────────────────
    let template: PaperTemplateRow | null = null;
    if (templateId) {
      const { data: t } = await adminClient
        .from("qpaper_templates")
        .select("*")
        .eq("id", templateId)
        .maybeSingle();
      template = (t as PaperTemplateRow | null) ?? null;
    }
    if (!template) {
      const { data: defaults } = await adminClient
        .from("qpaper_templates")
        .select("*")
        .eq("subject_id", subjectId)
        .order("is_default", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(1);
      template = (defaults?.[0] as PaperTemplateRow | undefined) ?? null;
    }

    const structure: TemplateStructure =
      (template?.structure as TemplateStructure | undefined) ??
      PPSU_DEFAULT_STRUCTURE;
    const universityName = template?.university_name ?? "P P Savani University";
    const examTitle = template?.exam_title ?? null;
    const duration = template?.duration_minutes ?? 150;
    const totalMarks = template?.total_marks ?? 60;
    const instructions = template?.instructions ?? PPSU_DEFAULT_INSTRUCTIONS;

    // ── Step 1g: PYQ examples (structured first, chunk fallback) ────────
    const { data: pyqRows } = await adminClient
      .from("pyq_questions")
      .select(
        "document_id, section_name, q_number, question_text, question_type, marks, co, btl, po, options, year"
      )
      .eq("subject_id", subjectId)
      .order("year", { ascending: false })
      .order("section_name", { ascending: true })
      .order("q_number", { ascending: true })
      .limit(40);
    const pyqExamples: PyqExample[] = ((pyqRows ?? []) as PyqQuestionRow[]).map(
      (r) => ({
        section_name: r.section_name,
        q_number: r.q_number,
        question_text: r.question_text,
        question_type: r.question_type,
        marks: r.marks,
        co: r.co,
        btl: r.btl,
        po: r.po,
        options: r.options,
        year: r.year,
      })
    );

    let pyqContext = "";
    if (pyqExamples.length === 0) {
      const { data: pyqDocs } = await adminClient
        .from("documents")
        .select("id")
        .eq("subject_id", subjectId)
        .eq("type", "pyq")
        .eq("status", "ready");
      const pyqDocIds = (pyqDocs ?? []).map((d) => (d as { id: string }).id);
      if (pyqDocIds.length > 0) {
        const { data: chunkRows } = await adminClient
          .from("document_chunks")
          .select("content")
          .in("document_id", pyqDocIds)
          .order("chunk_index", { ascending: true })
          .limit(30);
        const joined = (chunkRows ?? [])
          .map((c) => String((c as { content: string }).content ?? ""))
          .join("\n\n");
        pyqContext = joined.length > 4000 ? joined.slice(0, 4000) : joined;
      }
    }
    console.log(
      `[qpaper] PYQ source: ${
        pyqExamples.length > 0
          ? `${pyqExamples.length} structured questions`
          : pyqContext
            ? `${pyqContext.length} chars of chunk fallback`
            : "none"
      }`
    );

    // ── Step 1h: faculty question bank (only for "From Q Bank" mode) ─────
    let bank: BankQuestion[] = [];
    if (fromBank) {
      const { data: bankRows } = await adminClient
        .from("faculty_question_bank")
        .select("*")
        .eq("subject_id", subjectId)
        .eq("faculty_id", user.id);
      bank = ((bankRows ?? []) as FqbRow[]).map(rowToBankQuestion);
      console.log(`[qpaper] From Q Bank: ${bank.length} bank question(s) available`);
    }

    // ── Step 2: per-section generation ──────────────────────────────────
    // Sections are independent. In normal mode each is a parallel Pro call.
    // In "From Q Bank" mode we first allocate bank questions to every slot
    // (sequentially, sharing one `used` set so no question repeats across the
    // paper); sections fully covered by the bank skip AI entirely, the rest
    // fall back to an AI section with the matched bank questions overlaid.
    console.log(
      `[qpaper] Generating ${structure.sections.length} section(s)` +
        (fromBank ? " — From Q Bank (AI fallback per uncovered section)" : " via Pro — parallel AI calls")
    );

    const used = new Set<string>();
    const allocations = fromBank
      ? structure.sections.map((section) =>
          allocateBankForSection(section, bank, used)
        )
      : structure.sections.map(() => null);

    const runAi = async (section: TemplateSection) => {
      const sectionModules = modulesForSection(modules, section);
      try {
        const { questions, warnings } = await generateSection({
          sectionName: section.section_name,
          sectionTemplate: section,
          modulesInSection: sectionModules,
          courseOutcomes,
          coPoMapping,
          pyqExamples,
          pyqContext,
          subjectName,
          subjectCode,
        });
        return { questions, warnings, error: null as string | null };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        console.error(
          `[qpaper] ${section.section_name} generation failed:`,
          message
        );
        return { questions: [], warnings: [] as string[], error: message };
      }
    };

    // AI runs for every normal-mode section, and for bank-mode sections that
    // are not fully covered. Parallelised across sections.
    const aiSettled = await Promise.all(
      structure.sections.map(async (section, i) => {
        const alloc = allocations[i];
        if (fromBank && alloc && alloc.fullyCovered) return null;
        return runAi(section);
      })
    );

    const generatedSections: GeneratedSection[] = [];
    const allWarnings: string[] = [];
    const usedIds: string[] = [];

    structure.sections.forEach((section, i) => {
      const alloc = allocations[i];

      if (fromBank && alloc && alloc.fullyCovered) {
        generatedSections.push(assembleSectionFromBank(section, alloc));
        usedIds.push(...usedBankIds(alloc));
        console.log(
          `[qpaper] ${section.section_name}: fully sourced from Q Bank (no AI)`
        );
        return;
      }

      const ai = aiSettled[i] ?? {
        questions: [],
        warnings: [] as string[],
        error: "no AI result",
      };
      if (ai.error) allWarnings.push(`${section.section_name}: ${ai.error}`);
      if (ai.warnings.length > 0) {
        console.warn(
          `[qpaper] ${section.section_name} warnings:\n  ${ai.warnings.join("\n  ")}`
        );
        allWarnings.push(
          ...ai.warnings.map((w) => `${section.section_name}: ${w}`)
        );
      }

      let built: GeneratedSection = {
        section_name: section.section_name,
        module_range: section.module_range,
        total_marks: section.total_marks,
        questions: ai.questions,
      };

      if (fromBank && alloc) {
        const overlay = overlayBankOntoSection(built, section, alloc);
        built = overlay.section;
        // Only count bank questions that were actually placed (an AI-failed
        // empty section overlays nothing, so don't bump usage for it).
        if (overlay.replaced > 0) usedIds.push(...usedBankIds(alloc));
        if (alloc.unmatched.length > 0) {
          console.log(
            `[qpaper] ${section.section_name}: ${overlay.replaced} from bank, ` +
              `${alloc.unmatched.length} slot(s) fell back to AI:\n  ` +
              alloc.unmatched.join("\n  ")
          );
          allWarnings.push(
            `${section.section_name}: ${alloc.unmatched.length} slot(s) not in bank — AI-generated`
          );
        }
      }

      generatedSections.push(built);
    });

    // ── Step 2b: bump usage_count / last_used_at for used bank questions ─
    if (fromBank && usedIds.length > 0) {
      const uniqueUsed = Array.from(new Set(usedIds));
      const nowIso = new Date().toISOString();
      const byId = new Map(bank.map((b) => [b.id, b]));
      await Promise.all(
        uniqueUsed.map((id) => {
          const current = byId.get(id);
          return adminClient
            .from("faculty_question_bank")
            .update({
              usage_count: (current?.usage_count ?? 0) + 1,
              last_used_at: nowIso,
            })
            .eq("id", id);
        })
      );
      console.log(`[qpaper] Bumped usage on ${uniqueUsed.length} bank question(s)`);
    }

    // ── Step 3: assemble paper ───────────────────────────────────────────
    const paperTitle = `${subjectCode} - ${subjectName}`;
    const paper: AssembledPaper = {
      paperTitle,
      universityName,
      examTitle,
      courseCode: subjectCode,
      courseName: subjectName,
      date: null,
      duration,
      totalMarks,
      instructions,
      sections: generatedSections,
      courseOutcomes: hasCoPoData ? courseOutcomes : undefined,
      hasCoPoData,
    };

    // ── Step 4: render PDF + upload ──────────────────────────────────────
    const pdfBuffer = await generatePPSUPaperPDF(paper);
    const fileName = `qpaper_${Date.now()}_${user.id.slice(0, 8)}.pdf`;
    const filePath = `qpapers/${fileName}`;

    const { error: uploadError } = await adminClient.storage
      .from("generated-content")
      .upload(filePath, pdfBuffer, { contentType: "application/pdf" });
    if (uploadError) {
      console.error("[qpaper] Upload failed:", uploadError.message);
      return apiError("Failed to upload question paper", 500);
    }

    const { data: urlData } = adminClient.storage
      .from("generated-content")
      .getPublicUrl(filePath);

    const totalQuestions = generatedSections.reduce(
      (acc, s) =>
        acc +
        s.questions.reduce(
          (q, qq) =>
            q +
            (qq.sub_parts?.length ?? 0) +
            (qq.parts?.length ?? (qq.sub_parts?.length ? 0 : 1)),
          0
        ),
      0
    );

    await adminClient.from("generated_content").insert({
      subject_id: subjectId,
      module_id: null,
      type: "qpaper",
      title: paperTitle,
      file_path: filePath,
      metadata: {
        totalMarks,
        totalQuestions,
        sections: generatedSections.length,
        templateId: template?.id ?? null,
        downloadUrl: urlData.publicUrl,
      },
      generated_by: user.id,
      status: "completed",
    });

    return Response.json({
      success: true,
      paper,
      downloadUrl: urlData.publicUrl,
      totalQuestions,
      warnings: allWarnings,
    });
  } catch (err) {
    console.error("[qpaper] Error:", err);
    const message =
      err instanceof Error ? err.message : "Failed to generate question paper";
    return apiError(message, 500);
  }
}
