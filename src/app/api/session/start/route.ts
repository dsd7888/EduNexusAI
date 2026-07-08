import { requireAuth, apiError, apiSuccess } from "@/lib/api/helpers";
import { createAdminClient } from "@/lib/db/supabase-server";
import type { NextRequest } from "next/server";

// POST /api/session/start
// Called fire-and-forget from the authenticated layout on fresh login. Inserts a
// user_sessions row and returns { sessionId }. Must never block render/redirect.
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAuth();
    if (authResult instanceof Response) return authResult;
    const { user } = authResult;

    const adminClient = createAdminClient();

    // Role snapshot — best-effort; a missing profile row must not block session start.
    const { data: profile } = await adminClient
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    // best-effort device label from User-Agent; NULL is fine, never block on this
    const deviceLabel = request.headers.get("user-agent")?.slice(0, 255) ?? null;

    const { data: row, error } = await adminClient
      .from("user_sessions")
      .insert({
        user_id: user.id,
        user_email_snapshot: user.email ?? null,
        user_role_snapshot: (profile as { role?: string } | null)?.role ?? null,
        device_label: deviceLabel,
      })
      .select("id")
      .single();

    if (error || !row) {
      console.error("[session/start] insert failed:", error);
      return apiError("Failed to start session", 500);
    }

    return apiSuccess({ sessionId: (row as { id: string }).id });
  } catch (err) {
    console.error("[session/start] unexpected failure:", err);
    return apiError("Failed to start session", 500);
  }
}
