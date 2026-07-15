import { requireRole, apiError, apiSuccess } from "@/lib/api/helpers";
import { assertSubjectAccess } from "@/lib/api/subjectAccess";
import { loadSubjectContext } from "@/lib/subjectContext";
import { generateLearningPath } from "@/lib/labmanual/pathGenerator";
import type { AILogContext } from "@/lib/ai/providers/types";
import type { NextRequest } from "next/server";

/**
 * POST /api/labmanual/path — propose a learning path for a subject's practicals.
 *
 * Deliberately NOT cached (§5): the proposal is one cheap Flash call, and the
 * path is per-faculty by design — caching it would let one faculty's grouping
 * become another's default. `force` is accepted for symmetry with the other
 * routes and to make "re-propose" explicit at the call site.
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireRole([
      "faculty",
      "superadmin",
      "dean",
      "hod",
    ]);
    if (authResult instanceof Response) return authResult;
    const { user, profile, adminClient } = authResult;

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return apiError("Invalid JSON body", 400);
    }

    const subjectId = String(body.subjectId ?? "").trim();
    if (!subjectId) return apiError("subjectId is required", 400);

    // ── Assignment check (faculty only; oversight roles bypass) ─────────────
    const denied = await assertSubjectAccess(
      adminClient,
      profile.role,
      user.id,
      subjectId,
    );
    if (denied) return denied;

    const ctx = await loadSubjectContext(subjectId);
    if (ctx.practicals.length === 0) {
      return apiError("This subject has no practicals to plan", 400);
    }

    const logContext: AILogContext = {
      userId: user.id,
      userEmail: user.email ?? null,
      userRole: profile.role,
      subjectId,
      subjectCode: ctx.subjectCode,
      jobId: crypto.randomUUID(),
      relatedContentId: null,
      feature: "lab_manual",
    };

    const { path, warnings } = await generateLearningPath(ctx, logContext);

    return apiSuccess({ path, warnings });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    console.error("[labmanual path] error:", message);
    return apiError("Failed to propose a learning path", 500);
  }
}
