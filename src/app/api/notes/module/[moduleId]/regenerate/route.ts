/**
 * POST /api/notes/module/:moduleId/regenerate — force a new notes version.
 *
 * FACULTY TIER ONLY (§4). Students consume notes; they do not decide when the
 * institution pays to rebuild them. Faculty regenerate when the syllabus has
 * changed or the output quality is poor — the second case is exactly why
 * is_stale exists separately from content_hash, since the hash will not have
 * moved.
 *
 * Every existing module-scope row is marked stale and a new version inserted,
 * rather than updating in place: the previous version stays readable while the
 * new one generates, and a bad regeneration can be rolled back.
 */
import type { NextRequest } from "next/server";

import { requireAuth, apiError } from "@/lib/api/helpers";
import { createAdminClient } from "@/lib/db/supabase-server";
import { assertNotesRegenerateAccess } from "@/lib/notes/access";
import { generateModuleNotes } from "@/lib/notes/generator";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ moduleId: string }> }
) {
  try {
    const { moduleId } = await context.params;
    if (!moduleId) return apiError("moduleId is required", 400);

    const authResult = await requireAuth();
    if (authResult instanceof Response) return authResult;
    const { user } = authResult;

    const adminClient = createAdminClient();

    const { data: profile, error: profileError } = await adminClient
      .from("profiles")
      .select("id, role")
      .eq("id", user.id)
      .single();
    if (profileError || !profile) return apiError("Failed to load profile", 500);

    const { data: moduleRow } = await adminClient
      .from("modules")
      .select("id, subject_id")
      .eq("id", moduleId)
      .maybeSingle();
    if (!moduleRow) return apiError("Module not found", 404);

    // Role gate AND scope gate. An unassigned faculty is refused here, not
    // merely a student — assignment is what grants the spend.
    const denied = await assertNotesRegenerateAccess(
      adminClient,
      profile.role,
      user.id,
      moduleRow.subject_id
    );
    if (denied) return denied;

    const result = await generateModuleNotes({
      subjectId: moduleRow.subject_id,
      moduleId,
      adminClient,
      forceRegenerate: true,
      logContext: {
        userId: user.id,
        userEmail: user.email ?? null,
        userRole: profile.role,
        subjectId: moduleRow.subject_id,
        subjectCode: null,
        jobId: crypto.randomUUID(),
        relatedContentId: null,
      },
    });

    if (!result.ok) {
      const status =
        result.error === "module_not_found" || result.error === "no_syllabus"
          ? 404
          : 500;
      return Response.json(
        {
          error: result.error,
          message: result.message,
          ...(result.issues ? { issues: result.issues } : {}),
        },
        { status }
      );
    }

    return Response.json({
      blocks: result.blocks,
      version: result.version,
      generatedAt: result.generatedAt,
      source: result.source,
    });
  } catch (err) {
    console.error("[notes/module/regenerate] POST error:", err);
    return apiError(
      err instanceof Error ? err.message : "Failed to regenerate notes",
      500
    );
  }
}
