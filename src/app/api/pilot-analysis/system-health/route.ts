import { requireRole, apiError, apiSuccess } from "@/lib/api/helpers";
import { getSystemHealth } from "@/lib/pilot-analysis/queries";

// GET /api/pilot-analysis/system-health — latest storage/DB snapshot + tier % +
// days-to-limit projection (null with a reason if <3 snapshots). Superadmin only.
export async function GET() {
  const auth = await requireRole(["superadmin"]);
  if (auth instanceof Response) return auth;
  try {
    return apiSuccess(await getSystemHealth(auth.adminClient));
  } catch (err) {
    console.error("[pilot-analysis/system-health]", err);
    return apiError("Failed to load system health", 500);
  }
}
