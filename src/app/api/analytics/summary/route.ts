import {
  createAdminClient,
  createServerClient,
} from "@/lib/db/supabase-server";
import { requireAuth, requireRole, apiError, apiSuccess } from "@/lib/api/helpers";
import type { NextRequest } from "next/server";

export async function GET(_request: NextRequest) {
  try {
    const authResult = await requireRole([
      "faculty",
      "superadmin",
      "dept_admin",
      "dean",
      "hod",
    ]);
    if (authResult instanceof Response) return authResult;
    const { adminClient, profile } = authResult;
    const canViewCostSummary =
      profile.role === "superadmin" || profile.role === "dept_admin";

    const [
      { count: studentCount },
      { count: facultyCount },
      { count: subjectCount },
      { count: contentCount },
    ] = await Promise.all([
      adminClient
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("role", "student"),
      adminClient
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("role", "faculty"),
      adminClient
        .from("subjects")
        .select("id", { count: "exact", head: true }),
      adminClient
        .from("generated_content")
        .select("id", { count: "exact", head: true })
        .eq("status", "ready"),
    ]);

    // Current month range
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthStartStr = monthStart.toISOString().slice(0, 10);

    let costThisMonth: number | undefined;
    let apiCallsThisMonth: number | undefined;
    if (canViewCostSummary) {
      const { data: usageRows, error: usageError } = await adminClient
        .from("usage_analytics")
        .select("event_count, cost_inr, date")
        .gte("date", monthStartStr);

      if (usageError) {
        console.error("[analytics/summary] usage_analytics error:", usageError);
      }

      costThisMonth = 0;
      apiCallsThisMonth = 0;
      for (const row of usageRows ?? []) {
        const ec = (row as any).event_count ?? 0;
        const cost = Number((row as any).cost_inr ?? 0);
        apiCallsThisMonth += ec;
        costThisMonth += cost;
      }
    }

    const { count: pendingApprovals } = await adminClient
      .from("note_change_requests")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending");

    return Response.json({
      studentCount: studentCount ?? 0,
      facultyCount: facultyCount ?? 0,
      subjectCount: subjectCount ?? 0,
      contentCount: contentCount ?? 0,
      ...(canViewCostSummary
        ? {
            costThisMonth,
            apiCallsThisMonth,
          }
        : {}),
      pendingApprovals: pendingApprovals ?? 0,
    });
  } catch (err) {
    console.error("[analytics/summary] Error:", err);
    const message =
      err instanceof Error ? err.message : "Failed to load summary analytics";
    return apiError(message, 500);
  }
}

