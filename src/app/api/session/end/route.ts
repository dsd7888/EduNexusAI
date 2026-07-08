import { requireAuth, apiError, apiSuccess } from "@/lib/api/helpers";
import { createAdminClient } from "@/lib/db/supabase-server";
import type { NextRequest } from "next/server";

// POST /api/session/end  { sessionId, reason: 'idle_timeout' | 'manual_logout' }
//
// Unlike heartbeat, this does NOT hard-require a matching authenticated user: by the
// time idle-timeout fires the auth session may already be dying. We attempt auth and,
// if present, use it as an extra ownership guard; if it's gone, we still close the row
// by sessionId alone. The whole point is to record the end of a session that may
// already be gone.
//
// Idempotent: only sets ended_at/end_reason when ended_at IS currently NULL, so a
// double-fire can't overwrite an already-recorded reason.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}) as Record<string, unknown>);
    const sessionId = String((body as { sessionId?: unknown })?.sessionId ?? "").trim();
    const reason = String((body as { reason?: unknown })?.reason ?? "").trim();

    if (!sessionId) return apiError("Missing sessionId", 400);
    if (reason !== "idle_timeout" && reason !== "manual_logout") {
      return apiError("Invalid reason", 400);
    }

    // Best-effort auth: if present, treat as an ownership guard; if absent, proceed.
    let authedUserId: string | null = null;
    try {
      const authResult = await requireAuth();
      if (!(authResult instanceof Response)) {
        authedUserId = authResult.user.id;
      }
    } catch {
      // ignore — auth may already be gone during idle timeout
    }

    const adminClient = createAdminClient();

    const { data: session, error: selectError } = await adminClient
      .from("user_sessions")
      .select("id, user_id, ended_at")
      .eq("id", sessionId)
      .single();

    if (selectError || !session) {
      return apiError("Session not found", 404);
    }

    const s = session as { id: string; user_id: string | null; ended_at: string | null };

    // If we DO have an authenticated user, require it to match (extra guard). If the
    // row's user_id is null (deleted account) we don't block — closing is harmless.
    if (authedUserId && s.user_id && s.user_id !== authedUserId) {
      return apiError("Session not found", 404);
    }

    // Idempotency — already ended, leave the recorded reason intact.
    if (s.ended_at) {
      return apiSuccess({ ok: true, alreadyEnded: true });
    }

    const { error: updateError } = await adminClient
      .from("user_sessions")
      .update({ ended_at: new Date().toISOString(), end_reason: reason })
      .eq("id", sessionId)
      .is("ended_at", null);

    if (updateError) {
      console.error("[session/end] update failed:", updateError);
      return apiError("Failed to end session", 500);
    }

    return apiSuccess({ ok: true });
  } catch (err) {
    console.error("[session/end] unexpected failure:", err);
    return apiError("Failed to end session", 500);
  }
}
