/**
 * Answer key generation for a previously generated question paper.
 *
 * Faculty generates the paper first (POST /api/generate/qpaper), reviews
 * the result, and then triggers this route to produce a confidential model
 * answer key + marking scheme PDF. The route runs ONE Pro call per section
 * (same shape as Q-paper generation) so a typical 2-section PPSU paper takes
 * ~60s — vercel.json gives this route 120s.
 *
 * Why the request body carries the full `paper` instead of looking it up
 * from `generated_content.metadata`: the qpaper route currently stores only
 * aggregate counts in metadata, not the assembled question JSON. The
 * frontend already holds the AssembledPaper from the qpaper response, so it
 * passes it through here directly. A new generated_content row of type
 * "answer_key" is created with `answer_key_path` + `answer_key_generated_at`
 * set, providing the persistence the migration enables.
 */

import { requireRole, apiError } from "@/lib/api/helpers";
import {
  generateAnswerKeySection,
  buildAnswerKeyPDF,
  type AnswerKeyGenSectionResult,
  type AnswerKeyModuleInfo,
} from "@/lib/qpaper/answerKeyGen";
import type {
  AssembledPaper,
  GeneratedSection,
} from "@/lib/qpaper/builder";
import type { NextRequest } from "next/server";

interface ModuleRow {
  module_number: number;
  name: string;
  description: string | null;
}

function modulesForSection(
  allModules: ModuleRow[],
  section: GeneratedSection
): AnswerKeyModuleInfo[] {
  if (!section.module_range) {
    return allModules.map((m) => ({
      module_number: m.module_number,
      name: m.name,
      description: m.description,
    }));
  }
  const [lo, hi] = section.module_range;
  return allModules
    .filter((m) => m.module_number >= lo && m.module_number <= hi)
    .map((m) => ({
      module_number: m.module_number,
      name: m.name,
      description: m.description,
    }));
}

export async function POST(request: NextRequest) {
  try {
    console.log("[answer-key] POST request received");

    const authResult = await requireRole(["faculty", "superadmin"]);
    if (authResult instanceof Response) return authResult;
    const { user, profile, adminClient } = authResult;

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return apiError("Invalid JSON body", 400);
    }

    const subjectId = String(body.subject_id ?? "").trim();
    if (!subjectId) return apiError("subject_id is required", 400);

    const paper = body.paper as AssembledPaper | undefined;
    if (!paper || !Array.isArray(paper.sections) || paper.sections.length === 0) {
      return apiError(
        "paper (with non-empty sections) is required in the request body",
        400
      );
    }

    const generatedContentId =
      typeof body.generated_content_id === "string"
        ? body.generated_content_id.trim()
        : "";

    // ── Ownership check ────────────────────────────────────────────────────
    // Faculty can only generate answer keys for subjects they are assigned to.
    // Superadmin bypasses this check.
    if (profile.role === "faculty") {
      const { data: assignment } = await adminClient
        .from("faculty_assignments")
        .select("subject_id")
        .eq("faculty_id", user.id)
        .eq("subject_id", subjectId)
        .maybeSingle();
      if (!assignment) {
        return apiError(
          "Forbidden: subject is not assigned to this faculty",
          403
        );
      }
    }

    // ── Subject content (syllabus + reference books) ───────────────────────
    const { data: contentRow } = await adminClient
      .from("subject_content")
      .select("reference_books")
      .eq("subject_id", subjectId)
      .maybeSingle();
    const referenceBooks =
      ((contentRow as { reference_books?: string | null } | null)
        ?.reference_books ?? "").trim();

    // ── Modules ────────────────────────────────────────────────────────────
    const { data: moduleRows } = await adminClient
      .from("modules")
      .select("module_number, name, description")
      .eq("subject_id", subjectId)
      .order("module_number");
    const modules: ModuleRow[] = (moduleRows ?? []) as ModuleRow[];

    // ── Course outcomes (loaded for completeness; surfaced in the paper
    //    JSON sent by the frontend if any). Not strictly required by the
    //    answer-key prompt but kept here so the route owns its full context
    //    independent of what the frontend chose to forward.
    await adminClient
      .from("course_outcomes")
      .select("co_code, description")
      .eq("subject_id", subjectId);

    // ── Per-section generation — parallel block calls ─────────────────────
    // Each generateAnswerKeySection() fans out into up to three parallel
    // AI calls (mcq Flash, main Pro, alt Pro). Running both sections in
    // parallel here means 6 concurrent calls overall, with total wall-clock
    // time bounded by the slowest single call. Promise.all preserves order
    // so sectionResults[0] is Section I, sectionResults[1] is Section II.
    console.log(
      `[answer-key] Generating ${paper.sections.length} section(s) — parallel block calls`
    );
    const sectionResults: AnswerKeyGenSectionResult[] = await Promise.all(
      paper.sections.map((section) =>
        generateAnswerKeySection({
          sectionName: section.section_name,
          subjectName: paper.courseName,
          referenceBooks,
          sectionQuestions: section.questions,
          modules: modulesForSection(modules, section),
        })
      )
    );
    const warnings: string[] = [];
    for (const r of sectionResults) {
      if (r.warning) warnings.push(r.warning);
    }

    // ── PDF + upload ──────────────────────────────────────────────────────
    const pdfBuffer = await buildAnswerKeyPDF({
      paper,
      sections: sectionResults,
    });
    const timestamp = Date.now();
    const fileName = `ak_${timestamp}_${user.id.slice(0, 8)}.pdf`;
    const filePath = `generated/answer-keys/${subjectId}/${fileName}`;

    const { error: uploadError } = await adminClient.storage
      .from("generated-content")
      .upload(filePath, pdfBuffer, { contentType: "application/pdf" });
    if (uploadError) {
      console.error("[answer-key] Upload failed:", uploadError.message);
      return apiError("Failed to upload answer key", 500);
    }

    // 1-hour signed URL — confidential content, do not use public URL.
    const { data: signed, error: signError } = await adminClient.storage
      .from("generated-content")
      .createSignedUrl(filePath, 3600);
    if (signError || !signed) {
      console.error("[answer-key] Sign URL failed:", signError?.message);
      return apiError("Failed to create download URL", 500);
    }

    // ── Persist row ───────────────────────────────────────────────────────
    const generatedAt = new Date().toISOString();
    if (generatedContentId) {
      // If the caller knows the parent qpaper row, patch the answer-key
      // columns onto it directly.
      // status is forced to 'ready' on every write from this route — the
      // generated_content.status check constraint only accepts
      // 'processing' | 'ready' | 'failed' | 'archived', and any stale value
      // already on the row would fail the constraint when we update other
      // columns alongside it.
      const { error: updateError } = await adminClient
        .from("generated_content")
        .update({
          answer_key_path: filePath,
          answer_key_generated_at: generatedAt,
          status: "ready",
        })
        .eq("id", generatedContentId);
      if (updateError) {
        console.error(
          "[answer-key] generated_content update failed:",
          updateError.message
        );
        // Non-fatal — the PDF is uploaded and downloadable.
      }
    } else {
      // Otherwise insert a fresh row tagged "answer_key" so the upload is
      // still attributable in analytics.
      const { error: insertError } = await adminClient
        .from("generated_content")
        .insert({
          subject_id: subjectId,
          module_id: null,
          type: "answer_key",
          title: `${paper.courseCode} - ${paper.courseName} (Answer Key)`,
          file_path: filePath,
          metadata: {
            sectionsCovered: sectionResults.length,
            warnings,
          },
          generated_by: user.id,
          status: "ready",
          answer_key_path: filePath,
          answer_key_generated_at: generatedAt,
        });
      if (insertError) {
        console.error(
          "[answer-key] generated_content insert failed:",
          insertError.message
        );
      }
    }

    return Response.json({
      success: true,
      downloadUrl: signed.signedUrl,
      filePath,
      generatedAt,
      sections: sectionResults.map((s) => ({
        sectionName: s.sectionName,
        questionsAnswered: s.entries.length,
        warning: s.warning,
      })),
      warnings,
    });
  } catch (err) {
    console.error("[answer-key] Error:", err);
    const message =
      err instanceof Error ? err.message : "Failed to generate answer key";
    return apiError(message, 500);
  }
}
