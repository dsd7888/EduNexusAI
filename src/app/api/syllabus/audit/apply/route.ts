// ============================================================================
// POST /api/syllabus/audit/apply
//   body { subjectId, proposalId, entityType, patch }
//
// Accepting one proposal. The only write path in the feature.
//
// `entityType` is in the body alongside the spec's {subjectId, proposalId,
// patch} because the patch alone is not self-describing — {moduleId, coCode}
// is a valid shape for more than one kind of change, and picking a write path
// by sniffing which keys are present is exactly the ambiguity the whitelist is
// supposed to remove. The client already holds the full Proposal, so sending it
// costs nothing and lets the server dispatch on a declared, validated type.
//
// `proposalId` is carried for logging and client reconciliation only. It is
// deliberately NOT used to look a proposal up server-side: proposals live in a
// jsonb cache blob that a concurrent edit may already have invalidated, so
// trusting it would trade a validated patch for a possibly-stale one. Every
// identifier in the patch is re-resolved against the live DB instead (apply.ts).
//
// The response carries a freshly recomputed audit so the dashboard's ring,
// dimension cards and finding list update from server truth in the same round
// trip — no second fetch, and no chance of the UI's local edit diverging from
// what was actually written.
// ============================================================================

import { requireRole, apiError, apiSuccess } from "@/lib/api/helpers";
import { assertSubjectAccess } from "@/lib/api/subjectAccess";
import { loadAuditInput } from "@/lib/syllabus-audit/load";
import { runDeterministicAudit } from "@/lib/syllabus-audit/checks";
import {
  applyProposalPatch,
  invalidateDownstreamCaches,
} from "@/lib/syllabus-audit/apply";
import type { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireRole(["faculty", "superadmin", "dean", "hod"]);
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

    const proposalId = String(body.proposalId ?? "").trim();
    if (!proposalId) return apiError("proposalId is required", 400);

    const entityType = String(body.entityType ?? "").trim();
    if (!entityType) return apiError("entityType is required", 400);

    const patch =
      body.patch && typeof body.patch === "object" && !Array.isArray(body.patch)
        ? (body.patch as Record<string, unknown>)
        : null;
    if (!patch) return apiError("patch must be an object", 400);

    const denied = await assertSubjectAccess(
      adminClient,
      profile.role,
      user.id,
      subjectId,
    );
    if (denied) return denied;

    const outcome = await applyProposalPatch(
      adminClient,
      subjectId,
      entityType,
      patch,
    );
    if (!outcome.ok) {
      return apiError(outcome.error ?? "Could not apply this change", outcome.status ?? 400);
    }

    // Only after a successful write — never invalidate on a rejected patch.
    const invalidated = await invalidateDownstreamCaches(adminClient, subjectId);

    const input = await loadAuditInput(subjectId);
    const audit = runDeterministicAudit(input);

    console.log(
      `[syllabus audit apply] ${entityType} on ${subjectId} by ${user.id} ` +
        `(proposal ${proposalId}) — cleared ` +
        `${invalidated.lessonPlanCache} lesson-plan, ` +
        `${invalidated.labManualCache} lab-manual, ` +
        `${invalidated.syllabusAuditCache} audit cache row(s)`,
    );

    return apiSuccess({
      applied: true,
      proposalId,
      summary: outcome.summary,
      invalidated,
      findings: audit.findings,
      scores: audit.scores,
      overallHealth: audit.overallHealth,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    console.error("[syllabus audit apply] error:", message);
    return apiError("Failed to apply this change", 500);
  }
}
