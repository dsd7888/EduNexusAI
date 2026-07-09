import type { createAdminClient } from "@/lib/db/supabase-server";
import { reconstructSyllabusText } from "@/lib/syllabus/reconstruct";
import { classifyModulesForSubject } from "@/lib/qpaper/moduleCoClassifier";
import type { ExtractedSyllabus } from "@/lib/syllabus/types";

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * The actor persisting the syllabus. Stamped onto subject_content.created_by and
 * used as the module→CO classification log context. For the superadmin flow this is
 * the superadmin; for the faculty self-serve flow it is the faculty member.
 */
interface PersistActor {
  userId: string;
  userEmail: string | null;
  userRole: string;
}

/**
 * Persists a fully-extracted syllabus (exam scheme, modules, COs, CO↔PO/PSO mappings,
 * subject_content) for a subject, then auto-runs module→CO classification — exactly
 * the pipeline the superadmin save route has always run. Extracted here so the faculty
 * self-serve upload route can share it verbatim rather than duplicating it.
 *
 * Never throws for row-level failures: individual write errors are collected into
 * `warnings` (same shape/behavior the superadmin route returned before this refactor).
 * The final classification step also never throws (it logs and returns internally).
 */
export async function persistSyllabusAndClassify(
  adminClient: AdminClient,
  subjectId: string,
  extracted: ExtractedSyllabus,
  actor: PersistActor
): Promise<{ warnings: string[] }> {
  const warnings: string[] = [];

  // 1. Exam scheme — upsert by subject_id (UNIQUE)
  {
    const ex = extracted.exam_scheme ?? {};
    const { error } = await adminClient.from("exam_scheme").upsert(
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
        created_by: actor.userId,
      });
      if (error) warnings.push(`subject_content insert: ${error.message}`);
    }
  }

  // 7. Module ↔ CO mapping — now that modules and course_outcomes are saved, infer
  // which COs each module teaches toward. This NEVER throws (logs and returns on any
  // failure), so it can't compromise the save we just did.
  await classifyModulesForSubject(subjectId, {
    userId: actor.userId,
    userEmail: actor.userEmail,
    userRole: actor.userRole,
  });

  return { warnings };
}
