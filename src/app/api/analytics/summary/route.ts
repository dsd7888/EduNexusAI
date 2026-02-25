import {
  createAdminClient,
  createServerClient,
} from "@/lib/db/supabase-server";
import type { NextRequest } from "next/server";

export async function GET(_request: NextRequest) {
  try {
    const supabase = await createServerClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const adminClient = createAdminClient();
    const { data: profile, error: profileError } = await adminClient
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (profileError || !profile || profile.role !== "superadmin") {
      return Response.json(
        { error: "Forbidden: Superadmin only" },
        { status: 403 }
      );
    }

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

    const { data: usageRows, error: usageError } = await adminClient
      .from("usage_analytics")
      .select("event_count, cost_inr, date")
      .gte("date", monthStartStr);

    if (usageError) {
      console.error("[analytics/summary] usage_analytics error:", usageError);
    }

    let costThisMonth = 0;
    let apiCallsThisMonth = 0;
    for (const row of usageRows ?? []) {
      const ec = (row as any).event_count ?? 0;
      const cost = Number((row as any).cost_inr ?? 0);
      apiCallsThisMonth += ec;
      costThisMonth += cost;
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
      costThisMonth,
      apiCallsThisMonth,
      pendingApprovals: pendingApprovals ?? 0,
    });
  } catch (err) {
    console.error("[analytics/summary] Error:", err);
    const message =
      err instanceof Error ? err.message : "Failed to load summary analytics";
    return Response.json({ error: message }, { status: 500 });
  }
}

