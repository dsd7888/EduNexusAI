// ============================================================================
// POST /api/syllabus/audit/suggest   body { subjectId, findingIds?: string[] }
//
// Layer 2: the ONE Flash call, plus the cache in front of it.
//
// Two modes, and the difference matters for the cache:
//
//   FULL RUN (no findingIds) — the canonical set of proposals for this subject.
//     Reads and writes syllabus_audit_cache, so the first faculty to press
//     "Get AI Suggestions" pays and colleagues on the same subject don't.
//
//   TARGETED RE-SUGGEST (findingIds given) — the faculty dismissed a proposal
//     and wants another go at those findings only. Bypasses the cache in BOTH
//     directions: reading it would return the very proposal they just
//     dismissed, and WRITING it would replace the shared canonical set with one
//     person's partial re-roll. That is the lab-manual cache-contamination rule
//     from §19 applied to a different axis — a personalised generation never
//     becomes a colleague's default.
//
// Cache validity is fingerprint-based (computeAuditFingerprint): edit the
// syllabus and the next call regenerates rather than proposing fixes to modules
// that no longer look like that.
// ============================================================================

import { requireRole, apiError, apiSuccess } from "@/lib/api/helpers";
import { assertSubjectAccess } from "@/lib/api/subjectAccess";
import { loadAuditInput } from "@/lib/syllabus-audit/load";
import {
  assessDeterministicDimensions,
  computeScores,
  runDeterministicAudit,
} from "@/lib/syllabus-audit/checks";
import { computeAuditFingerprint } from "@/lib/syllabus-audit/fingerprint";
import { generateSuggestions } from "@/lib/syllabus-audit/suggestions";
import type { Finding, Proposal, SuggestionResult } from "@/lib/syllabus-audit/types";
import type { AILogContext } from "@/lib/ai/providers/types";
import type { NextRequest } from "next/server";

const MODEL_USED = "gemini-2.5-flash";

interface CachePayload {
  proposals: Proposal[];
  aiFindings: Finding[];
}

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

    const findingIds = Array.isArray(body.findingIds)
      ? Array.from(
          new Set(
            (body.findingIds as unknown[])
              .map((v) => String(v ?? "").trim())
              .filter(Boolean),
          ),
        )
      : [];
    const isTargeted = findingIds.length > 0;

    const denied = await assertSubjectAccess(
      adminClient,
      profile.role,
      user.id,
      subjectId,
    );
    if (denied) return denied;

    const input = await loadAuditInput(subjectId);
    const audit = runDeterministicAudit(input);
    const fingerprint = computeAuditFingerprint(input);

    // The findings the AI is allowed to see. A targeted re-suggest narrows to
    // the requested ids; anything else is still needed as CONTEXT for the gate
    // (a proposal must resolve against the full finding list), so only the
    // prompt-side selection narrows, not the validation-side list.
    const promptFindings = isTargeted
      ? audit.findings.filter((f) => findingIds.includes(f.id))
      : audit.findings;

    if (isTargeted && promptFindings.length === 0) {
      return apiError("None of the requested findingIds are in this audit", 400);
    }

    // ── Cache lookup (full runs only) ────────────────────────────────────────
    let result: SuggestionResult | null = null;
    let fromCache = false;

    if (!isTargeted && !body.force) {
      const { data: cachedRow } = await adminClient
        .from("syllabus_audit_cache")
        .select("payload, syllabus_fingerprint")
        .eq("subject_id", subjectId)
        .maybeSingle();

      const row = cachedRow as {
        payload: CachePayload;
        syllabus_fingerprint: string | null;
      } | null;

      if (row && row.syllabus_fingerprint === fingerprint) {
        // A cached proposal whose finding no longer exists has been fixed (or
        // the check stopped firing). Drop it rather than offering a fix for a
        // problem that is already gone.
        const liveIds = new Set([
          ...audit.findings.map((f) => f.id),
          ...(row.payload.aiFindings ?? []).map((f) => f.id),
        ]);
        result = {
          proposals: (row.payload.proposals ?? []).filter((p) =>
            liveIds.has(p.findingId),
          ),
          aiFindings: row.payload.aiFindings ?? [],
          warnings: [],
        };
        fromCache = true;
      }
    }

    // ── Generate on miss ─────────────────────────────────────────────────────
    if (!result) {
      const logContext: AILogContext = {
        userId: user.id,
        userEmail: user.email ?? null,
        userRole: profile.role,
        subjectId,
        subjectCode: input.ctx.subjectCode,
        jobId: crypto.randomUUID(),
        relatedContentId: null,
        feature: "syllabus_audit",
      };

      result = await generateSuggestions(
        input,
        // Gate against ALL findings so ids resolve; the prompt only shows the
        // selected ones.
        isTargeted ? promptFindings : audit.findings,
        logContext,
      );

      if (!isTargeted) {
        const payload: CachePayload = {
          proposals: result.proposals,
          aiFindings: result.aiFindings,
        };
        const { error: upsertError } = await adminClient
          .from("syllabus_audit_cache")
          .upsert(
            {
              subject_id: subjectId,
              payload,
              syllabus_fingerprint: fingerprint,
              generated_by: user.id,
              model_used: MODEL_USED,
            },
            { onConflict: "subject_id" },
          );
        if (upsertError) {
          console.warn(
            "[syllabus audit suggest] cache upsert failed:",
            upsertError.message,
          );
        }
      }
    }

    // Rescore with the AI findings folded in, so the dashboard's three AI
    // dimension cards stop reading "Run AI suggestions to assess this".
    const allFindings = [...audit.findings, ...result.aiFindings];
    const assessment = assessDeterministicDimensions(input);
    for (const d of ["co_verb_quality", "modern_relevance", "missing_topics"] as const) {
      assessment[d] = { assessed: true };
    }
    const { scores, overallHealth } = computeScores(allFindings, assessment);

    return apiSuccess({
      proposals: result.proposals,
      aiFindings: result.aiFindings,
      findings: allFindings,
      warnings: result.warnings,
      scores,
      overallHealth,
      fromCache,
      modelUsed: MODEL_USED,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    console.error("[syllabus audit suggest] error:", message);
    return apiError("Failed to generate syllabus suggestions", 500);
  }
}
