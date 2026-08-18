/**
 * POST /api/notes/subject/:subjectId/regenerate — rebuild a whole subject.
 *
 * FACULTY TIER ONLY (§4). Students consume notes; they do not decide when the
 * institution pays to rebuild them. A student who needs current content gets it
 * transparently through GET, which reassembles from whatever fresh module rows
 * exist — regeneration is the paid path, and paying is a faculty decision.
 *
 * ── WHY THIS REGENERATES MODULES BEFORE ASSEMBLING ────────────────────────────
 * Marking everything stale and then calling the assembler cannot work: the
 * assembler reads only NON-STALE module rows, so it would find zero coverage and
 * refuse (correctly — you cannot assemble a subject out of notes you have just
 * declared out of date). The sequence therefore has to be
 *
 *   stale-everything → regenerate each module → assemble
 *
 * Module regeneration runs SEQUENTIALLY, not in parallel: each module is a Flash
 * call with a 16k output budget, and firing a subject's worth of them at once is
 * the concurrent-load shape that produces 429s and the decoder degeneration
 * documented in generator.ts. A slow rebuild beats a fast one that half-fails.
 *
 * A module that fails to regenerate is LOGGED AND SKIPPED, not fatal — partial
 * coverage is a valid subject assembly, and one bad module must not deny the
 * faculty member the other six. Zero successes is the floor, and the assembler
 * enforces it.
 */
import type { NextRequest } from "next/server";

import { requireRole, apiError, type AllowedRole } from "@/lib/api/helpers";
import { createAdminClient } from "@/lib/db/supabase-server";
import { assertNotesRegenerateAccess } from "@/lib/notes/access";
import { generateModuleNotes, NOTES_FEATURE } from "@/lib/notes/generator";
import { assembleSubjectNotes } from "@/lib/notes/subject-assembler";

const SUBJECT_ASSEMBLE_TASK = "notes_assemble_subject";

/** §4 — dean/hod route to the faculty tier; superadmin bypasses the scope gate. */
const FACULTY_TIER_ROLES: AllowedRole[] = [
  "faculty",
  "superadmin",
  "dean",
  "hod",
];

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ subjectId: string }> }
) {
  try {
    const { subjectId } = await context.params;
    if (!subjectId) return apiError("subjectId is required", 400);

    const roleResult = await requireRole(FACULTY_TIER_ROLES);
    if (roleResult instanceof Response) return roleResult;
    const { user, profile } = roleResult;

    const adminClient = createAdminClient();

    const { data: subject } = await adminClient
      .from("subjects")
      .select("id, name, branch, semester")
      .eq("id", subjectId)
      .maybeSingle();
    if (!subject) return apiError("Subject not found", 404);

    // Scope gate on top of the role gate: an unassigned faculty is refused even
    // though their role is permitted. Superadmin bypasses; dean/hod resolve
    // through role_scope. Same helper the module regenerate route uses.
    const denied = await assertNotesRegenerateAccess(
      adminClient,
      profile.role,
      user.id,
      subjectId
    );
    if (denied) return denied;

    const { data: moduleRowsRaw } = await adminClient
      .from("modules")
      .select("id, module_number")
      .eq("subject_id", subjectId)
      .order("module_number", { ascending: true });

    const modules: Array<{ id: string; module_number: number }> =
      moduleRowsRaw ?? [];
    if (modules.length === 0) {
      return apiError("This subject has no modules to regenerate", 404);
    }

    // ── a. Retire everything: module AND subject scope ────────────────────
    await adminClient
      .from("study_notes")
      .update({ is_stale: true })
      .eq("subject_id", subjectId);

    // ── b. Regenerate each module, sequentially ───────────────────────────
    const baseLogContext = {
      userId: user.id,
      userEmail: user.email ?? null,
      userRole: profile.role,
      subjectId,
      subjectCode: null,
      relatedContentId: null,
      feature: NOTES_FEATURE,
    };

    const failedModuleIds: string[] = [];
    let modulesRegenerated = 0;

    for (const moduleRow of modules) {
      try {
        const gen = await generateModuleNotes({
          subjectId,
          moduleId: moduleRow.id,
          adminClient,
          forceRegenerate: true,
          logContext: {
            ...baseLogContext,
            jobId: crypto.randomUUID(),
          },
        });
        if (gen.ok) {
          modulesRegenerated += 1;
        } else {
          failedModuleIds.push(moduleRow.id);
          console.error(
            `[notes/subject/regenerate] module ${moduleRow.id} failed (${gen.error}): ${gen.message}`
          );
        }
      } catch (err) {
        failedModuleIds.push(moduleRow.id);
        console.error(
          `[notes/subject/regenerate] module ${moduleRow.id} threw:`,
          err
        );
      }
    }

    // ── c. Assemble from whatever succeeded ───────────────────────────────
    const result = await assembleSubjectNotes({
      subjectId,
      adminClient,
      logContext: {
        ...baseLogContext,
        jobId: crypto.randomUUID(),
        metadata: { task: SUBJECT_ASSEMBLE_TASK },
      },
    });

    if (!result.ok) {
      return Response.json(
        {
          error: result.error,
          detail: result.message,
          modulesRegenerated,
          modulesFailed: failedModuleIds,
        },
        { status: 500 }
      );
    }

    return Response.json({
      blocks: result.blocks,
      version: result.version,
      generatedAt: new Date().toISOString(),
      sourceMetadata: result.sourceMetadata,
      modulesRegenerated,
      modulesFailed: failedModuleIds,
    });
  } catch (err) {
    console.error("[notes/subject/regenerate] POST error:", err);
    return apiError(
      err instanceof Error ? err.message : "Failed to regenerate subject notes",
      500
    );
  }
}
