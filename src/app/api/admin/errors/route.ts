import { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/db/supabase-server";
import { requireRole, apiError, apiSuccess } from "@/lib/api/helpers";

/**
 * Reads `app_error_logs` for the superadmin error view.
 *
 * Service-role read behind a superadmin role gate — the table has RLS on with no
 * permissive policy, so there is no client-side path to this data at all.
 */

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 100;

export async function GET(request: NextRequest) {
  const authResult = await requireRole(["superadmin", "dept_admin"]);
  if (authResult instanceof Response) return authResult;

  const params = request.nextUrl.searchParams;

  const limitRaw = Number(params.get("limit") ?? DEFAULT_LIMIT);
  const limit =
    Number.isFinite(limitRaw) && limitRaw > 0
      ? Math.min(Math.floor(limitRaw), MAX_LIMIT)
      : DEFAULT_LIMIT;

  const sinceHoursRaw = Number(params.get("sinceHours") ?? 24);
  const sinceHours =
    Number.isFinite(sinceHoursRaw) && sinceHoursRaw > 0
      ? Math.min(Math.floor(sinceHoursRaw), 24 * 30)
      : 24;

  const origin = params.get("origin");
  if (origin !== null && origin !== "handled" && origin !== "unhandled") {
    return apiError("origin must be 'handled' or 'unhandled'", 400);
  }

  try {
    const adminClient = createAdminClient();
    const since = new Date(Date.now() - sinceHours * 3600_000).toISOString();

    let query = adminClient
      .from("app_error_logs")
      .select(
        "id, created_at, scope, route, http_method, user_email_snapshot, user_role_snapshot, message, stack, origin"
      )
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (origin) query = query.eq("origin", origin);

    const { data, error } = await query;

    if (error) {
      // The overwhelmingly likely cause is the migration not being applied yet.
      // Say which one, rather than making the reader go find out.
      console.error("[admin/errors] query failed:", error);
      return apiError(
        "Could not read error logs. If this is a fresh deploy, check that " +
          "supabase/migrations/20260820000000_app_error_logs.sql has been applied.",
        500
      );
    }

    const rows = data ?? [];

    // Group by scope so the view leads with "what is breaking most", which is
    // the question being asked, rather than a raw reverse-chronological wall.
    const byScope = new Map<string, number>();
    for (const row of rows) {
      byScope.set(row.scope, (byScope.get(row.scope) ?? 0) + 1);
    }
    const topScopes = [...byScope.entries()]
      .map(([scope, count]) => ({ scope, count }))
      .sort((a, b) => b.count - a.count);

    return apiSuccess({
      errors: rows,
      total: rows.length,
      truncated: rows.length === limit,
      sinceHours,
      topScopes,
    });
  } catch (err) {
    console.error("[admin/errors] unexpected failure:", err);
    return apiError("Internal server error", 500);
  }
}
