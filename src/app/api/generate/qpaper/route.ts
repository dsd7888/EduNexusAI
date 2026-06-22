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
  buildSectionSlotsAssignment,
  type CustomBtlWeights,
  type DifficultyPreset,
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
  computeSlots,
  slotKeyStr,
  slotAssignmentKey,
  type SlotTarget,
} from "@/lib/qpaper/bankFill";
import {
  allocateSlotSources,
  type SourcingMix,
  type SourceCategory,
} from "@/lib/qpaper/sourcing";
import { attachTagValidations } from "@/lib/qpaper/validateTags";
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

const SOURCE_CATEGORIES: SourceCategory[] = ["fresh", "pyq_style", "bank"];

/**
 * Resolve the effective sourcing mix from the request body, with backward
 * compatibility for the old single-toggle fields:
 *   - explicit `sourcingMix: [{ category, percent }]` summing to 100 wins,
 *   - else legacy `fromBank` → 100% bank,
 *   - else 100% fresh.
 */
function resolveSourcingMix(
  body: Record<string, unknown>,
  fromBank: boolean
): SourcingMix[] {
  const raw = body.sourcingMix;
  if (Array.isArray(raw) && raw.length > 0) {
    const mix = raw
      .map((r) => r as Record<string, unknown>)
      .map((r) => ({
        category: String(r.category) as SourceCategory,
        percent: Number(r.percent),
      }))
      .filter(
        (m) =>
          SOURCE_CATEGORIES.includes(m.category) &&
          Number.isFinite(m.percent) &&
          m.percent > 0
      );
    const sum = mix.reduce((s, m) => s + m.percent, 0);
    if (mix.length > 0 && Math.abs(sum - 100) < 1e-6) return mix;
  }
  if (fromBank) return [{ category: "bank", percent: 100 }];
  return [{ category: "fresh", percent: 100 }];
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
    const sourcingMix = resolveSourcingMix(body, fromBank);
    const preferredQuestionIds = Array.isArray(body.preferredQuestionIds)
      ? (body.preferredQuestionIds as unknown[]).map(String)
      : [];
    const VALID_PRESETS: DifficultyPreset[] = [
      "foundational",
      "balanced",
      "application_heavy",
      "custom",
    ];
    const rawPreset = String(body.difficultyPreset ?? "balanced");
    const difficultyPreset: DifficultyPreset = VALID_PRESETS.includes(
      rawPreset as DifficultyPreset
    )
      ? (rawPreset as DifficultyPreset)
      : "balanced";
    // Custom tier weights only matter when the preset is "custom". Each must be
    // a finite, non-negative number; otherwise the resolver falls back to
    // balanced, so a missing/garbage value degrades gracefully.
    let customBtlWeights: CustomBtlWeights | null = null;
    if (difficultyPreset === "custom") {
      const raw = (body.customBtlWeights ?? {}) as Record<string, unknown>;
      const num = (v: unknown) =>
        Number.isFinite(Number(v)) ? Math.max(0, Number(v)) : 0;
      const tier1 = num(raw.tier1);
      const tier2 = num(raw.tier2);
      const tier3 = num(raw.tier3);
      if (tier1 + tier2 + tier3 > 0) {
        customBtlWeights = { tier1, tier2, tier3 };
      }
    }
    // Load the bank when the mix sources from it OR there are guaranteed-include
    // preferred questions (those are included regardless of the bank percentage).
    const wantBank =
      sourcingMix.some((m) => m.category === "bank") ||
      preferredQuestionIds.length > 0;

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

    // ── Step 1h: faculty question bank (whenever the mix sources from it) ─
    let bank: BankQuestion[] = [];
    if (wantBank) {
      const { data: bankRows } = await adminClient
        .from("faculty_question_bank")
        .select("*")
        .eq("subject_id", subjectId)
        .eq("faculty_id", user.id);
      bank = ((bankRows ?? []) as FqbRow[]).map(rowToBankQuestion);
      console.log(`[qpaper] Q Bank: ${bank.length} bank question(s) available`);
    }

    // ── Step 2: source allocation + per-section generation ──────────────
    // One sourcing decision per request: allocateSlotSources spreads every
    // atomic slot across fresh / pyq_style / bank per the configured mix
    // (deterministic largest-remainder). Bank-assigned slots are filled from
    // the Q Bank respecting each slot's pre-computed module/CO/BTL target;
    // everything else is generated by the section AI. Bank slots that find no
    // match fall back to AI (counted in bankFallbackCount).
    //
    // NOTE: the active generation path is section-level (one Pro call per
    // section, see generateSection) and its prompt always blends PYQ style, so
    // "fresh" and "pyq_style" slots currently route to the *same* AI output —
    // only "bank" diverges. The allocation is computed at slot granularity so a
    // future per-slot / per-section style toggle can split fresh vs pyq_style
    // without re-plumbing this route.
    const moduleIdByNumber = new Map(
      modules.map((m) => [m.module_number, m.id])
    );

    // Per-section atomic slots (canonical fill units) + module/CO/BTL targets.
    const sectionSlotInfo = structure.sections.map((section) => {
      const atomic = computeSlots(section);
      const qslots = buildSectionSlotsAssignment(
        modulesForSection(modules, section),
        section,
        courseOutcomes,
        coPoMapping,
        difficultyPreset,
        customBtlWeights
      );
      const targets = new Map<string, SlotTarget>();
      for (const qs of qslots) {
        const t: SlotTarget = {};
        const mid = moduleIdByNumber.get(qs.moduleNumber);
        if (mid) t.moduleId = mid;
        // Only constrain CO/BTL when the assignment is unambiguous, otherwise
        // module + type + marks drive the match (and CO/BTL stay free).
        const [lo, hi] = qs.targetBtlRange;
        if (lo === hi) t.btlLevel = lo;
        if (qs.cos.length === 1) t.coCode = qs.cos[0];
        targets.set(qs.slotKey, t);
      }
      return { atomic, targets };
    });

    const allAtomic = sectionSlotInfo.flatMap((info, sIdx) =>
      info.atomic.map((slot) => ({ sIdx, slot }))
    );

    const bankKeysBySection: Set<string>[] = structure.sections.map(
      () => new Set<string>()
    );
    // Per-slot AI style (fresh vs pyq_style) for the non-bank slots, keyed by
    // the moduleAssignment slot key so generateSection can apply it. Bank slots
    // that later fall back to AI carry no style (legacy behaviour).
    const styleBySection: Map<string, "fresh" | "pyq_style">[] =
      structure.sections.map(() => new Map());

    // ── Reserve slots for guaranteed-included preferred questions first ──
    // Each preferred question (that actually exists in the bank) claims a
    // compatible slot (same type, exact marks then ±0.5) regardless of the
    // mix. Those slots are bank-sourced and target-suppressed so the preferred
    // question lands there. The percentage mix then governs only what's left.
    const MARKS_TOL = 0.5;
    const preferredSet = new Set(preferredQuestionIds);
    const preferredRows = bank.filter((b) => preferredSet.has(b.id));
    const reserved = new Set<number>(); // indices into allAtomic
    const forcedKeysBySection: Set<string>[] = structure.sections.map(
      () => new Set<string>()
    );
    const unplaceablePreferredRows: Array<{ id: string; question_text: string }> = [];
    for (const row of preferredRows) {
      const matchAt = (tol: number) =>
        allAtomic.findIndex(
          (e, i) =>
            !reserved.has(i) &&
            e.slot.bankType === row.question_type &&
            Math.abs(e.slot.marks - row.marks) <= tol
        );
      const idx = matchAt(0) !== -1 ? matchAt(0) : matchAt(MARKS_TOL);
      if (idx === -1) {
        // No compatible slot — can't place this question.
        unplaceablePreferredRows.push({ id: row.id, question_text: row.question_text });
        continue;
      }
      reserved.add(idx);
      const entry = allAtomic[idx];
      const keyStr = slotKeyStr(entry.slot);
      bankKeysBySection[entry.sIdx].add(keyStr);
      forcedKeysBySection[entry.sIdx].add(keyStr);
    }
    if (unplaceablePreferredRows.length > 0) {
      console.warn(
        `[qpaper] ${unplaceablePreferredRows.length} preferred question(s) had no compatible slot and were not included`,
        unplaceablePreferredRows.map((r) => r.id)
      );
    }

    // ── The mix governs only the remaining (unreserved) slots ───────────
    const remaining = allAtomic
      .map((entry, i) => ({ entry, i }))
      .filter(({ i }) => !reserved.has(i));
    const sourceAssignments = allocateSlotSources(remaining.length, sourcingMix);
    for (const a of sourceAssignments) {
      const { entry } = remaining[a.slotIndex];
      if (a.source === "bank") {
        bankKeysBySection[entry.sIdx].add(slotKeyStr(entry.slot));
      } else {
        // attempt_any_one's two options share one assignment key — last write
        // wins, so both options get the same style.
        styleBySection[entry.sIdx].set(slotAssignmentKey(entry.slot), a.source);
      }
    }

    console.log(
      `[qpaper] Generating ${structure.sections.length} section(s) — mix ` +
        sourcingMix.map((m) => `${m.category}:${m.percent}%`).join(" ") +
        ` over ${allAtomic.length} slot(s)`
    );

    // Sequential allocation sharing one `used` set so no bank question (or
    // preferred id) repeats across the paper. Sections with no bank-assigned
    // slot get a null allocation and go entirely to AI.
    const used = new Set<string>();
    const allocations = structure.sections.map((section, sIdx) => {
      const bankSlotKeys = bankKeysBySection[sIdx];
      if (bankSlotKeys.size === 0) return null;
      return allocateBankForSection(section, bank, used, {
        targets: sectionSlotInfo[sIdx].targets,
        preferredQuestionIds,
        bankSlotKeys,
        forcedPreferredKeys: forcedKeysBySection[sIdx],
      });
    });

    const runAi = async (section: TemplateSection, sIdx: number) => {
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
          slotStyles: styleBySection[sIdx],
          difficultyPreset,
          customBtlWeights,
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
        if (alloc && alloc.fullyCovered) return null;
        return runAi(section, i);
      })
    );

    const generatedSections: GeneratedSection[] = [];
    const allWarnings: string[] = [];
    const usedIds: string[] = [];
    // Bank-assigned slots that found no match and fell back to AI generation.
    let bankFallbackCount = 0;

    structure.sections.forEach((section, i) => {
      const alloc = allocations[i];

      if (alloc && alloc.fullyCovered) {
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

      if (alloc) {
        const overlay = overlayBankOntoSection(built, section, alloc);
        built = overlay.section;
        // Only count bank questions that were actually placed (an AI-failed
        // empty section overlays nothing, so don't bump usage for it).
        if (overlay.replaced > 0) usedIds.push(...usedBankIds(alloc));
        if (alloc.unmatched.length > 0) {
          bankFallbackCount += alloc.unmatched.length;
          console.log(
            `[qpaper] ${section.section_name}: ${overlay.replaced} from bank, ` +
              `${alloc.unmatched.length} bank slot(s) fell back to AI:\n  ` +
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
    if (usedIds.length > 0) {
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

    // ── Step 2c: CO/BTL tag validation (one parallel Flash batch) ────────
    // Judge whether each AI-generated question's content & cognitive demand
    // genuinely match its claimed CO/BTL. Mutates generatedSections in place,
    // attaching `validation` only to genuine mismatches. Non-fatal: a failure
    // here just means the paper ships without flags.
    try {
      const moduleContentBySection = structure.sections.map((section) =>
        modulesForSection(modules, section)
          .map(
            (m) => `Module ${m.module_number} — ${m.name}: ${m.description ?? ""}`
          )
          .join("\n")
      );
      await attachTagValidations(
        generatedSections,
        courseOutcomes.map((c) => ({
          co_code: c.co_code,
          description: c.description,
        })),
        moduleContentBySection
      );
    } catch (err) {
      console.error("[qpaper] tag validation batch failed:", err);
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
      ...(structure.flatLayout ? { flatLayout: true } : {}),
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
            (qq.items?.length ?? 0) +
            (qq.parts?.length ?? (qq.sub_parts?.length || qq.items?.length ? 0 : 1)),
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
      filePath,
      totalQuestions,
      warnings: allWarnings,
      bankFallbackCount,
      unplaceablePreferred: unplaceablePreferredRows,
    });
  } catch (err) {
    console.error("[qpaper] Error:", err);
    const message =
      err instanceof Error ? err.message : "Failed to generate question paper";
    return apiError(message, 500);
  }
}
