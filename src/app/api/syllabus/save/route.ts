import type { NextRequest } from "next/server";
import { apiError, requireRole } from "@/lib/api/helpers";
import { reconstructSyllabusText } from "@/lib/syllabus/reconstruct";
import { classifyModulesForSubject } from "@/lib/qpaper/moduleCoClassifier";
import type { ExtractedSyllabus } from "@/lib/syllabus/types";

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireRole(["superadmin"]);
    if (authResult instanceof Response) return authResult;
    const { user, adminClient } = authResult;

    const body = (await request.json().catch(() => ({}))) as {
      subject_id?: string;
      extracted?: ExtractedSyllabus;
    };

    const subjectId = String(body.subject_id ?? "").trim();
    const extracted = body.extracted;

    if (!subjectId) return apiError("subject_id is required", 400);
    if (!extracted || typeof extracted !== "object") {
      return apiError("extracted payload is required", 400);
    }

    const { data: subject, error: subjectErr } = await adminClient
      .from("subjects")
      .select("id")
      .eq("id", subjectId)
      .single();
    if (subjectErr || !subject) {
      return apiError("Subject not found", 404);
    }

    const warnings: string[] = [];

    // 1. Exam scheme — upsert by subject_id (UNIQUE)
    {
      const ex = extracted.exam_scheme ?? {};
      const { error } = await adminClient
        .from("exam_scheme")
        .upsert(
          {
            subject_id: subjectId,
            theory_ce: ex.theory_ce ?? null,
            theory_ese: ex.theory_ese ?? null,
            practical_ce: ex.practical_ce ?? null,
            practical_ese: ex.practical_ese ?? null,
            tutorial_marks: ex.tutorial_marks ?? null,
            total_marks: ex.total_marks ?? null,
            credits: extracted.course?.credits ?? null,
          },
          { onConflict: "subject_id" }
        );
      if (error) warnings.push(`exam_scheme: ${error.message}`);
    }

    // 2. Modules — update existing by (subject_id, module_number), insert if missing
    for (const m of extracted.modules ?? []) {
      const payload = {
        name: m.name || `Module ${m.module_number}`,
        description: m.content || null,
        hours: m.hours || null,
        weightage_percent: m.weightage_percent || null,
        section_number: m.section_number || 1,
        btl_levels: m.btl_levels && m.btl_levels.length > 0 ? m.btl_levels : null,
      };

      const { data: existing } = await adminClient
        .from("modules")
        .select("id")
        .eq("subject_id", subjectId)
        .eq("module_number", m.module_number)
        .maybeSingle();

      if (existing) {
        const { error } = await adminClient
          .from("modules")
          .update(payload)
          .eq("id", (existing as { id: string }).id);
        if (error) warnings.push(`module ${m.module_number}: ${error.message}`);
      } else {
        const { error } = await adminClient
          .from("modules")
          .insert({
            subject_id: subjectId,
            module_number: m.module_number,
            ...payload,
          });
        if (error)
          warnings.push(`module ${m.module_number} insert: ${error.message}`);
      }
    }

    // 3. course_outcomes — replace
    {
      const { error: delErr } = await adminClient
        .from("course_outcomes")
        .delete()
        .eq("subject_id", subjectId);
      if (delErr) warnings.push(`course_outcomes delete: ${delErr.message}`);

      const cos = (extracted.course_outcomes ?? []).filter(
        (c) => c.co_code && c.description
      );
      if (cos.length > 0) {
        const { error } = await adminClient.from("course_outcomes").insert(
          cos.map((c) => ({
            subject_id: subjectId,
            co_code: c.co_code,
            description: c.description,
          }))
        );
        if (error) warnings.push(`course_outcomes insert: ${error.message}`);
      }
    }

    // 4. co_po_mapping — replace
    {
      const { error: delErr } = await adminClient
        .from("co_po_mapping")
        .delete()
        .eq("subject_id", subjectId);
      if (delErr) warnings.push(`co_po_mapping delete: ${delErr.message}`);

      const rows = (extracted.co_po_mapping ?? []).filter(
        (m) => m.co_code && m.po_code && m.strength >= 1 && m.strength <= 3
      );
      if (rows.length > 0) {
        const { error } = await adminClient.from("co_po_mapping").insert(
          rows.map((m) => ({
            subject_id: subjectId,
            co_code: m.co_code,
            po_code: m.po_code,
            strength: m.strength,
          }))
        );
        if (error) warnings.push(`co_po_mapping insert: ${error.message}`);
      }
    }

    // 5. co_pso_mapping — replace
    {
      const { error: delErr } = await adminClient
        .from("co_pso_mapping")
        .delete()
        .eq("subject_id", subjectId);
      if (delErr) warnings.push(`co_pso_mapping delete: ${delErr.message}`);

      const rows = (extracted.co_pso_mapping ?? []).filter(
        (m) => m.co_code && m.pso_code && m.strength >= 1 && m.strength <= 3
      );
      if (rows.length > 0) {
        const { error } = await adminClient.from("co_pso_mapping").insert(
          rows.map((m) => ({
            subject_id: subjectId,
            co_code: m.co_code,
            pso_code: m.pso_code,
            strength: m.strength,
          }))
        );
        if (error) warnings.push(`co_pso_mapping insert: ${error.message}`);
      }
    }

    // 6. subject_content — upsert content (reconstructed) + reference_books + practicals
    {
      const reconstructed = reconstructSyllabusText(extracted);
      const referenceBooks = (extracted.reference_books ?? []).join("\n");
      const practicals = extracted.practicals ?? [];

      const { data: existing } = await adminClient
        .from("subject_content")
        .select("subject_id")
        .eq("subject_id", subjectId)
        .maybeSingle();

      if (existing) {
        const { error } = await adminClient
          .from("subject_content")
          .update({
            content: reconstructed,
            reference_books: referenceBooks,
            practicals,
          })
          .eq("subject_id", subjectId);
        if (error) warnings.push(`subject_content update: ${error.message}`);
      } else {
        const { error } = await adminClient.from("subject_content").insert({
          subject_id: subjectId,
          content: reconstructed,
          reference_books: referenceBooks,
          practicals,
          created_by: user.id,
        });
        if (error) warnings.push(`subject_content insert: ${error.message}`);
      }
    }

    // 7. Module ↔ CO mapping — now that modules and course_outcomes are saved,
    // infer which COs each module teaches toward. This NEVER throws (logs and
    // returns on any failure), so it can't compromise the save we just did.
    await classifyModulesForSubject(subjectId);

    return Response.json({ saved: true, warnings });
  } catch (err) {
    console.error("[syllabus/save] Error:", err);
    const message = err instanceof Error ? err.message : "Save failed";
    return apiError(message, 500);
  }
}
