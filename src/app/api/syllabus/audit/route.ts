// ============================================================================
// GET /api/syllabus/audit?subjectId=
//
// Layer 1 only: the deterministic audit. No AI, no cache, no Storage — one
// pre-fetch and a synchronous pass. Runs in well under 500ms, which is what
// lets the Health tab render findings on open and re-run after every edit
// rather than showing a spinner or a stale number.
//
// Deliberately NOT cached. Recomputing is free; serving a cached finding about
// a mapping the faculty fixed thirty seconds ago is the failure this feature
// exists to prevent.
// ============================================================================

import { requireRole, apiError, apiSuccess } from "@/lib/api/helpers";
import { assertSubjectAccess } from "@/lib/api/subjectAccess";
import { loadAuditInput } from "@/lib/syllabus-audit/load";
import { runDeterministicAudit } from "@/lib/syllabus-audit/checks";
import type { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  try {
    const authResult = await requireRole(["faculty", "superadmin", "dean", "hod"]);
    if (authResult instanceof Response) return authResult;
    const { user, profile, adminClient } = authResult;

    const subjectId = (
      request.nextUrl.searchParams.get("subjectId") ??
      request.nextUrl.searchParams.get("subject_id") ??
      ""
    ).trim();
    if (!subjectId) return apiError("subjectId is required", 400);

    const denied = await assertSubjectAccess(
      adminClient,
      profile.role,
      user.id,
      subjectId,
    );
    if (denied) return denied;

    const input = await loadAuditInput(subjectId);
    const { findings, scores, overallHealth } = runDeterministicAudit(input);

    return apiSuccess({ findings, scores, overallHealth });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    console.error("[syllabus audit] error:", message);
    return apiError("Failed to audit this syllabus", 500);
  }
}
