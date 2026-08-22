/**
 * GET /api/faculty/pyq/coverage?subject_id=…[&papers=true]
 *
 * The read every PYQ-aware surface calls: the qpaper Sourcing stage (to decide
 * whether "PYQ-style" is offerable at all), the qbank Generate tab, and the
 * Past Papers tab (with `papers=true` for the management list).
 *
 * Read-only and cheap, so it is NOT gated behind the faculty assignment check —
 * any faculty-tier user may ask about any subject's coverage. Nothing here is
 * question content; it is counts, years and CO codes. The write path
 * (/api/faculty/pyq/upload) is where the assignment boundary sits.
 */
import type { NextRequest } from "next/server";
import { apiError, apiSuccess, isUuid, requireRole } from "@/lib/api/helpers";
import { computePyqCoverage, listPyqPapers } from "@/lib/pyq/coverage";

export async function GET(request: NextRequest) {
  try {
    const authResult = await requireRole(["faculty", "superadmin", "dean", "hod"]);
    if (authResult instanceof Response) return authResult;
    const { adminClient } = authResult;

    const subjectId = (request.nextUrl.searchParams.get("subject_id") ?? "").trim();
    if (!subjectId || !isUuid(subjectId)) {
      return apiError("A valid subject_id is required", 400);
    }

    const wantPapers = request.nextUrl.searchParams.get("papers") === "true";

    const [coverage, papers] = await Promise.all([
      computePyqCoverage(adminClient, subjectId),
      wantPapers ? listPyqPapers(adminClient, subjectId) : Promise.resolve(null),
    ]);

    return apiSuccess(papers === null ? { coverage } : { coverage, papers });
  } catch (err) {
    console.error("[faculty/pyq/coverage]", err);
    return apiError("Failed to load past-paper coverage", 500);
  }
}
