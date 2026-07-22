// ============================================================================
// POST /api/syllabus/audit/export   body { subjectId }
//
// Renders the current deterministic audit as a one-page compliance report and
// returns a short-lived signed URL from the private `syllabus-audits` bucket.
//
// No review gate, unlike the lab manual's instructor/solution variants: this is
// a snapshot of facts already visible to anyone who can open the syllabus, not
// a controlled document. It is private only because internal curriculum-quality
// data has no business being world-readable.
//
// The report is built from a FRESH audit, never from a cache. A compliance
// document that reports last week's state while claiming today's date is worse
// than no document, and re-running costs ~20ms.
// ============================================================================

import { requireRole, apiError, apiSuccess } from "@/lib/api/helpers";
import { assertSubjectAccess } from "@/lib/api/subjectAccess";
import { loadAuditInput } from "@/lib/syllabus-audit/load";
import { runDeterministicAudit } from "@/lib/syllabus-audit/checks";
import { buildComplianceReportPdf } from "@/lib/syllabus-audit/pdfBuilder";
import { loadExportHeader } from "@/lib/lessonplan/exportShared";
import type { NextRequest } from "next/server";

const BUCKET = "syllabus-audits";
const SIGNED_URL_TTL = 60 * 10; // 10 minutes — long enough to click, short enough to expire

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

    const denied = await assertSubjectAccess(
      adminClient,
      profile.role,
      user.id,
      subjectId,
    );
    if (denied) return denied;

    const [input, headerResult] = await Promise.all([
      loadAuditInput(subjectId),
      loadExportHeader(subjectId, user.id),
    ]);
    const audit = runDeterministicAudit(input);

    const bytes = await buildComplianceReportPdf({
      ctx: input.ctx,
      audit,
      header: headerResult.header,
    });

    // Keyed {faculty_id}/… so the bucket's storage policy (first path segment
    // must match auth.uid()) holds for any future direct-from-browser read.
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const code = (input.ctx.subjectCode ?? "subject").replace(/[^A-Za-z0-9_-]/g, "");
    const filePath = `${user.id}/${subjectId}/compliance-${code}-${stamp}.pdf`;

    const { error: uploadError } = await adminClient.storage
      .from(BUCKET)
      .upload(filePath, Buffer.from(bytes), {
        contentType: "application/pdf",
        upsert: true,
      });
    if (uploadError) {
      console.error("[syllabus audit export] upload failed:", uploadError.message);
      return apiError("Failed to upload the compliance report", 500);
    }

    const { data: signed, error: signError } = await adminClient.storage
      .from(BUCKET)
      .createSignedUrl(filePath, SIGNED_URL_TTL);
    if (signError || !signed) {
      console.error("[syllabus audit export] sign failed:", signError?.message);
      return apiError("Failed to create a download link", 500);
    }

    return apiSuccess({
      url: signed.signedUrl,
      path: filePath,
      overallHealth: audit.overallHealth,
      findingCount: audit.findings.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    console.error("[syllabus audit export] error:", message);
    return apiError("Failed to export the compliance report", 500);
  }
}
