/**
 * GET /api/notes/module/:moduleId — Notes v2, module scope.
 *
 * Serves the current fresh notes for a module, generating them on first request.
 * "Fresh" is a hash match, not merely an unset is_stale flag — generateModuleNotes
 * owns that rule; this route does not second-guess it.
 *
 * No UI consumes this yet (CP-N4 does). It is exercised by _cp_n1_verify.
 */
import type { NextRequest } from "next/server";

import { requireAuth, apiError } from "@/lib/api/helpers";
import { createAdminClient } from "@/lib/db/supabase-server";
import { checkRateLimit, RATE_LIMITS } from "@/lib/utils/rate-limit";
import { assertNotesSubjectAccess } from "@/lib/notes/access";
import { generateModuleNotes } from "@/lib/notes/generator";
import { enrichBlocksWithPyqFrequency } from "@/lib/notes/pyq-frequency";

export async function GET(
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

    // Resolve the module's OWN subject rather than trusting a query param —
    // the access check must run against the subject that actually owns the
    // module, or it can be bypassed by pairing an accessible subjectId with a
    // foreign moduleId.
    const { data: moduleRow } = await adminClient
      .from("modules")
      .select("id, subject_id")
      .eq("id", moduleId)
      .maybeSingle();
    if (!moduleRow) return apiError("Module not found", 404);

    const denied = await assertNotesSubjectAccess(
      adminClient,
      profile.role,
      user.id,
      moduleRow.subject_id
    );
    if (denied) return denied;

    // Rate limit: study material is a comprehension aid, so it shares the hint
    // allowance (30/day). Cached reads are counted too — the limit exists to
    // bound how much generation a single student can trigger, and a cache hit
    // is indistinguishable from a miss until the hash is compared.
    // CP-N2 NOTE: if student-triggered regeneration lands, it needs its own
    // budget rather than borrowing this one.
    if (profile.role === "student") {
      const rate = await checkRateLimit({
        userId: user.id,
        eventType: "hint",
        limit: RATE_LIMITS.hint,
      });
      if (!rate.allowed) {
        return Response.json(
          {
            error: "Daily limit reached",
            message: `You've used all ${RATE_LIMITS.hint} study aids for today. ${rate.resetAt}.`,
            limitReached: true,
          },
          { status: 429 }
        );
      }
    }

    const result = await generateModuleNotes({
      subjectId: moduleRow.subject_id,
      moduleId,
      adminClient,
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
        result.error === "module_not_found"
          ? 404
          : result.error === "no_syllabus"
            ? 404
            : 500;
      return Response.json(
        {
          error: result.error,
          message: result.message,
          // Validation failures carry their whole surface — the generator does
          // not retry, so this is the only place the problem is visible.
          ...(result.issues ? { issues: result.issues } : {}),
        },
        { status }
      );
    }

    // Only a generation counts against the student's allowance; a cache hit
    // costs nothing to serve.
    if (profile.role === "student" && result.source === "fresh") {
      await recordUsage(adminClient, user.id, moduleRow.subject_id);
    }

    // CP-N3: PYQ exam-frequency enrichment, computed fresh against current
    // pyq_questions/module_co_mapping on every request — never cached, so it
    // runs on both the cache-hit and fresh-generation paths. On enrichment
    // error the function returns blocks unchanged; no try/catch needed here.
    const enriched = await enrichBlocksWithPyqFrequency(
      result.blocks,
      moduleRow.subject_id,
      moduleId,
      adminClient,
    );

    return Response.json({
      blocks: enriched,
      version: result.version,
      generatedAt: result.generatedAt,
      source: result.source,
      pyqEnriched: true,
    });
  } catch (err) {
    console.error("[notes/module] GET error:", err);
    return apiError(
      err instanceof Error ? err.message : "Failed to load notes",
      500
    );
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function recordUsage(adminClient: any, userId: string, subjectId: string) {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const { data: existing } = await adminClient
      .from("usage_analytics")
      .select("id, event_count")
      .eq("date", today)
      .eq("user_id", userId)
      .eq("event_type", "hint")
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
        event_type: "hint",
        event_count: 1,
      });
    }
  } catch (err) {
    console.error("[notes/module] usage_analytics error:", err);
  }
}
