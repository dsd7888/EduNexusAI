/**
 * POST /api/admin/classify-module-quant
 *
 * Triggers the module quantitative/conceptual classification (gate 1 of NAT
 * integrity — see CP_Q2_NAT_INTEGRITY.md). Mirrors
 * /api/admin/classify-module-co: respond immediately, run the classification in
 * after() so a whole-branch backfill isn't bounded by the request timeout.
 *
 * Body: { subjectId?: string }  (subject_id also accepted, matching the sibling
 * route's field name). With a subject id → that subject only. Without one →
 * every subject that still has at least one unclassified module, so re-running
 * the no-arg form is a cheap "finish the backfill" rather than a full re-scan.
 */

import { after } from "next/server";
import type { NextRequest } from "next/server";
import { apiError, requireRole } from "@/lib/api/helpers";
import { classifyModulesForSubjectQuant } from "@/lib/assessment/quantClassifier";

export async function POST(request: NextRequest) {
  try {
    // superadmin only. The sibling CO route also lists "dept_admin", but that
    // role does not exist in the current role set (§4: superadmin / dean / hod /
    // faculty / student) — it is dead weight there, not a pattern to copy.
    const authResult = await requireRole(["superadmin"]);
    if (authResult instanceof Response) return authResult;
    const { user, profile, adminClient } = authResult;

    const body = (await request.json().catch(() => ({}))) as {
      subjectId?: string;
      subject_id?: string;
    };
    const requested = String(body.subjectId ?? body.subject_id ?? "").trim();

    let subjectIds: string[];

    if (requested) {
      const { data, error } = await adminClient
        .from("subjects")
        .select("id")
        .eq("id", requested)
        .maybeSingle();
      if (error) return apiError(error.message, 500);
      if (!data) return apiError("Subject not found", 404);
      subjectIds = [requested];
    } else {
      // Every subject with at least one module still lacking a profile.
      const { data, error } = await adminClient
        .from("modules")
        .select("subject_id")
        .is("quant_profile", null);
      if (error) return apiError(error.message, 500);
      subjectIds = [
        ...new Set(
          ((data ?? []) as Array<{ subject_id: string }>).map((r) => r.subject_id)
        ),
      ];
      if (subjectIds.length === 0) {
        return Response.json({
          started: false,
          subject_count: 0,
          message: "Every module already has a quant profile.",
        });
      }
    }

    // Respond immediately; classify after the response is sent. Sequential, not
    // parallel: each subject costs two Flash calls and a backfill can span 50+
    // subjects — firing them all at once is how a Flash 429 storm starts.
    after(async () => {
      for (const id of subjectIds) {
        const result = await classifyModulesForSubjectQuant(id, adminClient, {
          userId: user.id,
          userEmail: user.email ?? null,
          userRole: profile.role,
          feature: "admin_classification",
        });
        for (const w of result.warnings) {
          console.warn(`[admin/classify-module-quant] ${id}: ${w}`);
        }
      }
    });

    return Response.json({ started: true, subject_count: subjectIds.length });
  } catch (err) {
    console.error("[admin/classify-module-quant]", err);
    return apiError("Internal server error", 500);
  }
}
