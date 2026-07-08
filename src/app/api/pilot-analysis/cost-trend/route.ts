import type { NextRequest } from "next/server";
import { requireRole, apiError, apiSuccess } from "@/lib/api/helpers";
import { getCostTrend } from "@/lib/pilot-analysis/queries";

// GET /api/pilot-analysis/cost-trend?days=30 — daily IST-bucketed spend/tokens by
// model (flash/pro/imagen). Superadmin only.
export async function GET(request: NextRequest) {
  const auth = await requireRole(["superadmin"]);
  if (auth instanceof Response) return auth;
  try {
    const daysParam = parseInt(request.nextUrl.searchParams.get("days") ?? "30", 10);
    const days = Number.isFinite(daysParam) ? Math.min(Math.max(daysParam, 1), 180) : 30;
    return apiSuccess({ days, points: await getCostTrend(auth.adminClient, days) });
  } catch (err) {
    console.error("[pilot-analysis/cost-trend]", err);
    return apiError("Failed to load cost trend", 500);
  }
}
