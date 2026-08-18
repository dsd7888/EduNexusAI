/**
 * POST /api/notes/subject/:subjectId/generate — student-triggered cold start.
 *
 * CP-11. Notes v2 has no faculty-provisioned generation flow, and none is
 * planned (confirmed by the founder) — Short Notes is student-purpose, built
 * on first request rather than pre-seeded. GET only ASSEMBLES already-fresh
 * module rows (subject-assembler.ts); when a subject has zero fresh module
 * coverage it fails closed with `no_module_notes` rather than generating
 * anything, because assembly must never itself trigger an AI call (§ file
 * header there). This route is the missing "actually go generate it" step,
 * reachable from the reading page's "Generate notes" button.
 *
 * GENERATE-MISSING, NOT FORCE-REGENERATE. Unlike
 * subject/:id/regenerate (faculty-only, marks every module stale and pays to
 * rebuild all of them), this calls generateModuleNotes WITHOUT
 * forceRegenerate — a module that already has fresh notes is a cache hit
 * inside the generator and costs nothing; only modules with no fresh row
 * actually invoke the model. Same access rule as GET (assertNotesSubjectAccess,
 * not the faculty-only assertNotesRegenerateAccess) since a student is
 * generating their own subject's notes, not rebuilding someone else's.
 *
 * ONE notes_view RESERVATION FOR THE WHOLE CLICK, not one per module. That
 * matches how GET already charges a subject assembly (one notes_view unit
 * regardless of how many module rows it joins) — module-scope generation has
 * its own "hint" budget (module/route.ts) that this path deliberately does
 * not touch, since a single "Generate notes" click can legitimately fan out
 * to several modules and charging per-module would make the two entry
 * points inconsistent about what a build costs.
 *
 * Sequential, not parallel, for the same reason subject/regenerate is
 * sequential — see that file's header. A module that fails to generate is
 * logged and skipped; partial coverage is a valid assembly (subject-assembler
 * enforces the zero floor), so one bad module must not block the rest.
 */
import type { NextRequest } from "next/server";

import { requireAuth, apiError } from "@/lib/api/helpers";
import { createAdminClient } from "@/lib/db/supabase-server";
import { checkRateLimit, releaseRateLimit, RATE_LIMITS } from "@/lib/utils/rate-limit";
import { assertNotesSubjectAccess } from "@/lib/notes/access";
import { generateModuleNotes, NOTES_FEATURE } from "@/lib/notes/generator";
import { assembleSubjectNotes } from "@/lib/notes/subject-assembler";
import { enrichBlocksWithPyqFrequency } from "@/lib/notes/pyq-frequency";

const SUBJECT_ASSEMBLE_TASK = "notes_assemble_subject";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ subjectId: string }> }
) {
  // Hoisted above the try so the outer catch can release a reservation made
  // partway through — same pattern as the GET route.
  let releaseReservation: (() => Promise<void>) | null = null;
  try {
    const { subjectId } = await context.params;
    if (!subjectId) return apiError("subjectId is required", 400);

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

    const { data: subject } = await adminClient
      .from("subjects")
      .select("id, name, branch, semester")
      .eq("id", subjectId)
      .maybeSingle();
    if (!subject) return apiError("Subject not found", 404);

    const denied = await assertNotesSubjectAccess(
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
      return apiError("This subject has no modules to generate notes for", 404);
    }

    const rate = await checkRateLimit({
      userId: user.id,
      eventType: "notes_view",
      limit: RATE_LIMITS.notes_view,
      subjectId,
    });
    if (!rate.allowed) {
      return Response.json(
        {
          error: "Daily limit reached",
          message: `You've used all ${RATE_LIMITS.notes_view} notes builds for today. ${rate.resetAt}.`,
          limitReached: true,
        },
        { status: 429 }
      );
    }
    releaseReservation = () =>
      releaseRateLimit({ userId: user.id, eventType: "notes_view", subjectId });

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
    let modulesGenerated = 0;

    for (const moduleRow of modules) {
      try {
        const gen = await generateModuleNotes({
          subjectId,
          moduleId: moduleRow.id,
          adminClient,
          logContext: {
            ...baseLogContext,
            jobId: crypto.randomUUID(),
          },
        });
        if (gen.ok) {
          modulesGenerated += 1;
        } else {
          failedModuleIds.push(moduleRow.id);
          console.error(
            `[notes/subject/generate] module ${moduleRow.id} failed (${gen.error}): ${gen.message}`
          );
        }
      } catch (err) {
        failedModuleIds.push(moduleRow.id);
        console.error(
          `[notes/subject/generate] module ${moduleRow.id} threw:`,
          err
        );
      }
    }

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
      // Nothing was produced — refund the reservation, same as GET's miss path.
      if (releaseReservation) await releaseReservation();
      return Response.json(
        {
          error: result.error,
          detail: result.message,
          modulesGenerated,
          modulesFailed: failedModuleIds,
          ...(result.modulesTotal !== undefined
            ? { modulesTotal: result.modulesTotal }
            : {}),
        },
        { status: 500 }
      );
    }

    const enriched = await enrichBlocksWithPyqFrequency(
      result.blocks,
      subjectId,
      null,
      adminClient,
    );

    return Response.json({
      blocks: enriched,
      version: result.version,
      generatedAt: new Date().toISOString(),
      source: "fresh",
      sourceMetadata: result.sourceMetadata,
      pyqEnriched: true,
      modulesGenerated,
      modulesFailed: failedModuleIds,
    });
  } catch (err) {
    console.error("[notes/subject/generate] POST error:", err);
    if (releaseReservation) {
      await releaseReservation().catch(() => {});
    }
    return apiError(
      err instanceof Error ? err.message : "Failed to generate subject notes",
      500
    );
  }
}
