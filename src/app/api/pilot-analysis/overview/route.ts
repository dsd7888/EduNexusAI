import { requireRole, apiError, apiSuccess } from "@/lib/api/helpers";
import { getOverview } from "@/lib/pilot-analysis/queries";

// GET /api/pilot-analysis/overview — superadmin only (tighter than the table RLS).
export async function GET() {
  const auth = await requireRole(["superadmin"]);
  if (auth instanceof Response) return auth;
  try {
    return apiSuccess(await getOverview(auth.adminClient));
  } catch (err) {
    console.error("[pilot-analysis/overview]", err);
    return apiError("Failed to load overview", 500);
  }
}
