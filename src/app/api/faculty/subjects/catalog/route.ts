import { apiError, requireRole } from "@/lib/api/helpers";

/**
 * GET /api/faculty/subjects/catalog
 * Returns every existing subject as { id, code, name } to power the "search your
 * subject, or type a new one" combobox on the Add Subject page. Faculty can still
 * free-type a code/name not in this list (the new-subject upload path).
 */
export async function GET() {
  try {
    const authResult = await requireRole(["faculty"]);
    if (authResult instanceof Response) return authResult;
    const { adminClient } = authResult;

    const { data, error } = await adminClient
      .from("subjects")
      .select("id, code, name")
      .order("code", { ascending: true });

    if (error) return apiError(error.message, 500);

    return Response.json({ subjects: data ?? [] });
  } catch (err) {
    console.error("[faculty/subjects/catalog] Error:", err);
    const message = err instanceof Error ? err.message : "Failed to load catalog";
    return apiError(message, 500);
  }
}
