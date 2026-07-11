import type { NextRequest } from "next/server";
import { apiError, requireRole } from "@/lib/api/helpers";
import { assertSubjectAccess } from "@/lib/api/subjectAccess";
import type {
  ExtractedSyllabus,
  ExtractedPractical,
} from "@/lib/syllabus/types";

export async function GET(request: NextRequest) {
  try {
    const authResult = await requireRole(["faculty", "superadmin", "dept_admin"]);
    if (authResult instanceof Response) return authResult;
    const { user, profile, adminClient } = authResult;

    const subjectId = request.nextUrl.searchParams.get("subject_id");
    if (!subjectId) return apiError("subject_id is required", 400);

    const accessError = await assertSubjectAccess(
      adminClient,
      profile.role,
      user.id,
      subjectId
    );
    if (accessError) return accessError;

    const { data: subject, error: subjectErr } = await adminClient
      .from("subjects")
      .select("id, code, name")
      .eq("id", subjectId)
      .single();
    if (subjectErr || !subject) return apiError("Subject not found", 404);

    const [
      { data: modules },
      { data: outcomes },
      { data: coPo },
      { data: coPso },
      { data: exam },
      { data: content },
    ] = await Promise.all([
      adminClient
        .from("modules")
        .select(
          "module_number, name, description, hours, weightage_percent, section_number, btl_levels"
        )
        .eq("subject_id", subjectId)
        .order("module_number"),
      adminClient
        .from("course_outcomes")
        .select("co_code, description")
        .eq("subject_id", subjectId)
        .order("co_code"),
      adminClient
        .from("co_po_mapping")
        .select("co_code, po_code, strength")
        .eq("subject_id", subjectId),
      adminClient
        .from("co_pso_mapping")
        .select("co_code, pso_code, strength")
        .eq("subject_id", subjectId),
      adminClient
        .from("exam_scheme")
        .select(
          "theory_ce, theory_ese, practical_ce, practical_ese, tutorial_marks, total_marks, credits"
        )
        .eq("subject_id", subjectId)
        .maybeSingle(),
      adminClient
        .from("subject_content")
        .select("reference_books, practicals, updated_at")
        .eq("subject_id", subjectId)
        .maybeSingle(),
    ]);

    const hasData =
      (modules ?? []).length > 0 ||
      (outcomes ?? []).length > 0 ||
      exam != null ||
      content != null;

    if (!hasData) {
      return Response.json({
        subject: subject as { id: string; code: string; name: string },
        extracted: null,
        updated_at: null,
      });
    }

    const refBooks = String(
      (content as { reference_books?: string | null } | null)?.reference_books ?? ""
    );
    const practicalsRaw = (content as { practicals?: unknown } | null)?.practicals;
    const practicals: ExtractedPractical[] = Array.isArray(practicalsRaw)
      ? (practicalsRaw as ExtractedPractical[])
      : [];

    const extracted: ExtractedSyllabus = {
      course: {
        code: (subject as { code: string }).code ?? "",
        name: (subject as { name: string }).name ?? "",
        prerequisites: [],
        credits: (exam as { credits?: number } | null)?.credits ?? 0,
        theory_hours_per_week: 0,
        practical_hours_per_week: 0,
      },
      exam_scheme: {
        theory_ce: (exam as { theory_ce?: number | null } | null)?.theory_ce ?? null,
        theory_ese: (exam as { theory_ese?: number | null } | null)?.theory_ese ?? null,
        practical_ce: (exam as { practical_ce?: number | null } | null)?.practical_ce ?? null,
        practical_ese: (exam as { practical_ese?: number | null } | null)?.practical_ese ?? null,
        tutorial_marks: (exam as { tutorial_marks?: number | null } | null)?.tutorial_marks ?? null,
        total_marks: (exam as { total_marks?: number | null } | null)?.total_marks ?? null,
      },
      modules: (modules ?? []).map((m) => {
        const mm = m as {
          module_number: number;
          name: string;
          description: string | null;
          hours: number | null;
          weightage_percent: number | null;
          section_number: number | null;
          btl_levels: string[] | null;
        };
        return {
          module_number: mm.module_number,
          name: mm.name ?? "",
          content: mm.description ?? "",
          hours: mm.hours ?? 0,
          weightage_percent: mm.weightage_percent ?? 0,
          section_number: mm.section_number ?? 1,
          btl_levels: mm.btl_levels ?? [],
        };
      }),
      course_outcomes: (outcomes ?? []).map((c) => {
        const cc = c as { co_code: string; description: string };
        return { co_code: cc.co_code, description: cc.description };
      }),
      co_po_mapping: (coPo ?? []).map((r) => {
        const rr = r as { co_code: string; po_code: string; strength: number };
        return { co_code: rr.co_code, po_code: rr.po_code, strength: rr.strength };
      }),
      co_pso_mapping: (coPso ?? []).map((r) => {
        const rr = r as { co_code: string; pso_code: string; strength: number };
        return { co_code: rr.co_code, pso_code: rr.pso_code, strength: rr.strength };
      }),
      practicals,
      textbooks: [],
      reference_books: refBooks
        .split(/\n|,/)
        .map((s) => s.trim())
        .filter(Boolean),
    };

    return Response.json({
      subject: subject as { id: string; code: string; name: string },
      extracted,
      updated_at:
        (content as { updated_at?: string | null } | null)?.updated_at ?? null,
    });
  } catch (err) {
    console.error("[syllabus/load] Error:", err);
    const message = err instanceof Error ? err.message : "Load failed";
    return apiError(message, 500);
  }
}
