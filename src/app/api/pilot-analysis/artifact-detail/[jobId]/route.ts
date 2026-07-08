import { requireRole, apiError, apiSuccess } from "@/lib/api/helpers";
import { getArtifactDetail } from "@/lib/pilot-analysis/queries";

// GET /api/pilot-analysis/artifact-detail/[jobId] — every ai_call_logs row for one
// job_id (or related_content_id): model, tokens, cost, status, latency, metadata,
// ordered by created_at. The per-artifact model-split drill-down. Superadmin only.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const auth = await requireRole(["superadmin"]);
  if (auth instanceof Response) return auth;
  try {
    const { jobId } = await params;
    const id = String(jobId ?? "").trim();
    // Guard against injection into the .or() filter — only accept a UUID.
    if (!/^[0-9a-f-]{36}$/i.test(id)) return apiError("Invalid id", 400);
    const calls = await getArtifactDetail(auth.adminClient, id);
    return apiSuccess({ jobId: id, calls });
  } catch (err) {
    console.error("[pilot-analysis/artifact-detail]", err);
    return apiError("Failed to load artifact detail", 500);
  }
}
