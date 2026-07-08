import { requireAuth, apiError, apiSuccess } from "@/lib/api/helpers";
import { createAdminClient } from "@/lib/db/supabase-server";
import type { NextRequest } from "next/server";

// POST /api/session/heartbeat  { sessionId }
// Advances last_activity_at. adminClient bypasses RLS, so we independently verify the
// session belongs to the authenticated user (RLS can't do this for us here). A missing
// row or mismatched owner returns 404 so the client can start a fresh session.
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAuth();
    if (authResult instanceof Response) return authResult;
    const { user } = authResult;

    const body = await request.json().catch(() => ({}) as Record<string, unknown>);
    const sessionId = String((body as { sessionId?: unknown })?.sessionId ?? "").trim();
    if (!sessionId) return apiError("Missing sessionId", 400);

    const adminClient = createAdminClient();

    const { data: session, error: selectError } = await adminClient
      .from("user_sessions")
      .select("id, user_id")
      .eq("id", sessionId)
      .single();

    if (selectError || !session) {
      return apiError("Session not found", 404);
    }
    if ((session as { user_id: string | null }).user_id !== user.id) {
      // Ownership check — this is the guard RLS can't provide via adminClient.
      return apiError("Session not found", 404);
    }

    const { error: updateError } = await adminClient
      .from("user_sessions")
      .update({ last_activity_at: new Date().toISOString() })
      .eq("id", sessionId);

    if (updateError) {
      console.error("[session/heartbeat] update failed:", updateError);
      return apiError("Failed to update session", 500);
    }

    return apiSuccess({ ok: true });
  } catch (err) {
    console.error("[session/heartbeat] unexpected failure:", err);
    return apiError("Failed to update session", 500);
  }
}
