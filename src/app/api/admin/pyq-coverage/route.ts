/**
 * GET /api/admin/pyq-coverage
 *
 * Pilot-ops instrument, not a faculty surface: one row per live subject saying
 * whether it has past papers. During a pilot the in-person chase converts far
 * better than any in-app nudge — the UI's job is to make the ask legible, this
 * route's job is to tell Dhruv WHICH faculty to ask.
 *
 * Deliberately a single flat read of three small tables rather than a per-
 * subject computePyqCoverage() loop: with 17 live subjects that would be 51
 * round-trips to render one card.
 */
import { apiError, apiSuccess, requireRole } from "@/lib/api/helpers";

interface SubjectRow {
  id: string;
  code: string;
  name: string;
  branch: string | null;
  semester: number | null;
}

export async function GET() {
  try {
    const authResult = await requireRole(["superadmin", "dean", "hod"]);
    if (authResult instanceof Response) return authResult;
    const { adminClient } = authResult;

    const [subjectsRes, docsRes, questionsRes] = await Promise.all([
      adminClient
        .from("subjects")
        .select("id, code, name, branch, semester")
        .order("semester", { ascending: true })
        .order("code", { ascending: true }),
      adminClient
        .from("documents")
        .select("id, subject_id")
        .eq("type", "pyq"),
      adminClient.from("pyq_questions").select("subject_id"),
    ]);

    if (subjectsRes.error) return apiError(subjectsRes.error.message, 500);

    const papersBySubject = new Map<string, number>();
    for (const d of (docsRes.data ?? []) as Array<{ subject_id: string }>) {
      papersBySubject.set(d.subject_id, (papersBySubject.get(d.subject_id) ?? 0) + 1);
    }

    const questionsBySubject = new Map<string, number>();
    for (const q of (questionsRes.data ?? []) as Array<{ subject_id: string }>) {
      questionsBySubject.set(
        q.subject_id,
        (questionsBySubject.get(q.subject_id) ?? 0) + 1
      );
    }

    const subjects = ((subjectsRes.data ?? []) as SubjectRow[]).map((s) => ({
      ...s,
      papers: papersBySubject.get(s.id) ?? 0,
      questions: questionsBySubject.get(s.id) ?? 0,
    }));

    const withPapers = subjects.filter((s) => s.papers > 0).length;

    return apiSuccess({
      total_subjects: subjects.length,
      subjects_with_papers: withPapers,
      subjects_without_papers: subjects.length - withPapers,
      subjects,
    });
  } catch (err) {
    console.error("[admin/pyq-coverage]", err);
    return apiError("Failed to load past-paper coverage", 500);
  }
}
