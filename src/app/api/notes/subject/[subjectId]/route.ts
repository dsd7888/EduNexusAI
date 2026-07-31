/**
 * GET /api/notes/subject/:subjectId — Notes v2, subject scope.
 *
 * Serves the whole subject's notes as one ordered block array, assembled
 * DETERMINISTICALLY from the module-scope rows beneath it. There is no AI call
 * on this path at any point: assembly is a join, not a generation. What it costs
 * is a couple of selects and (on a miss) one insert.
 *
 * CACHE PROBE RUNS BEFORE THE RATE-LIMIT CHECK — the same ordering as chat
 * (§9). Checking the limit first would charge students quota for notes the
 * platform already built and can serve for free.
 *
 * No UI consumes this yet (CP-N4 does). It is exercised by _cp_n2_verify.
 */
import type { NextRequest } from "next/server";

import { requireAuth, apiError } from "@/lib/api/helpers";
import { createAdminClient } from "@/lib/db/supabase-server";
import { checkRateLimit, RATE_LIMITS } from "@/lib/utils/rate-limit";
import { assertNotesSubjectAccess } from "@/lib/notes/access";
import { NOTES_FEATURE } from "@/lib/notes/generator";
import {
  assembleSubjectNotes,
  probeSubjectNotesCache,
} from "@/lib/notes/subject-assembler";

/** logContext task tag for the subject-scope path. Deterministic, not a routeAI task. */
const SUBJECT_ASSEMBLE_TASK = "notes_assemble_subject";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ subjectId: string }> }
) {
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

    // ── Cache first, quota second ─────────────────────────────────────────
    // The probe verifies the stored hash against the CURRENT constituent module
    // hashes, not merely is_stale — freshness in Notes v2 is a hash match, never
    // the flag alone (§19). See probeSubjectNotesCache for why both exist.
    const cached = await probeSubjectNotesCache({ subjectId, adminClient });
    if (cached) {
      return Response.json({
        blocks: cached.blocks,
        version: cached.version,
        generatedAt: cached.generatedAt,
        source: "cache",
        sourceMetadata: cached.sourceMetadata,
      });
    }

    const rate = await checkRateLimit({
      userId: user.id,
      eventType: "notes_view",
      limit: RATE_LIMITS.notes_view,
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

    const result = await assembleSubjectNotes({
      subjectId,
      adminClient,
      logContext: {
        userId: user.id,
        userEmail: user.email ?? null,
        userRole: profile.role,
        subjectId,
        subjectCode: null,
        jobId: crypto.randomUUID(),
        relatedContentId: null,
        feature: NOTES_FEATURE,
        metadata: { task: SUBJECT_ASSEMBLE_TASK },
      },
    });

    if (!result.ok) {
      return Response.json(
        {
          error: result.error,
          detail: result.message,
          ...(result.modulesTotal !== undefined
            ? { modulesTotal: result.modulesTotal }
            : {}),
        },
        { status: 500 }
      );
    }

    // NO logAICall here, deliberately: assembly makes no AI call, and its
    // tokens/cost are the AGGREGATE of module rows whose own generations were
    // already logged by routeAI. Emitting a row for them would double-count
    // notes spend — the exact class of bug v1's feature='chat' mislabelling was.
    await recordUsage(adminClient, user.id, subjectId);

    return Response.json({
      blocks: result.blocks,
      version: result.version,
      generatedAt: new Date().toISOString(),
      source: "fresh",
      sourceMetadata: result.sourceMetadata,
    });
  } catch (err) {
    console.error("[notes/subject] GET error:", err);
    return apiError(
      err instanceof Error ? err.message : "Failed to load subject notes",
      500
    );
  }
}

/**
 * Consumes one notes_view unit. Only reached on a cache MISS — a hit returns
 * above without touching this, so quota tracks assemblies, not reads.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function recordUsage(adminClient: any, userId: string, subjectId: string) {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const { data: existing } = await adminClient
      .from("usage_analytics")
      .select("id, event_count")
      .eq("date", today)
      .eq("user_id", userId)
      .eq("event_type", "notes_view")
      .eq("subject_id", subjectId)
      .maybeSingle();

    if (existing) {
      await adminClient
        .from("usage_analytics")
        .update({ event_count: (existing.event_count ?? 0) + 1 })
        .eq("id", existing.id);
    } else {
      await adminClient.from("usage_analytics").insert({
        date: today,
        user_id: userId,
        subject_id: subjectId,
        event_type: "notes_view",
        event_count: 1,
      });
    }
  } catch (err) {
    console.error("[notes/subject] usage_analytics error:", err);
  }
}
