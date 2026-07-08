import { requireRole, apiError, apiSuccess } from "@/lib/api/helpers";
import { getFeatureAdoption } from "@/lib/pilot-analysis/queries";

// GET /api/pilot-analysis/feature-adoption — per-feature adoption %, calls, cost,
// failure rate, p50/p95 latency (percentile_cont via RPC). Superadmin only.
export async function GET() {
  const auth = await requireRole(["superadmin"]);
  if (auth instanceof Response) return auth;
  try {
    return apiSuccess({ features: await getFeatureAdoption(auth.adminClient) });
  } catch (err) {
    console.error("[pilot-analysis/feature-adoption]", err);
    return apiError("Failed to load feature adoption", 500);
  }
}
