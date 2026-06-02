import {
  createAdminClient,
  createServerClient,
} from "@/lib/db/supabase-server";
import { requireAuth, requireRole, apiError, apiSuccess } from "@/lib/api/helpers";
import type { NextRequest } from "next/server";

// Resume the student's last open session for a subject if it is recent
// enough; otherwise start a fresh one.
const RESUME_WINDOW_MS = 72 * 60 * 60 * 1000; // 72 hours
const SESSION_CAP = 5; // sessions kept per student per subject

export async function POST(request: NextRequest) {
  const authResult = await requireAuth();
  if (authResult instanceof Response) return authResult;
  const { user, supabase } = authResult;

  const adminClient = createAdminClient();
  const { data: profile } = await adminClient
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if ((profile as { role?: string } | null)?.role !== "student") {
    return apiError("Forbidden: Students only", 403);
  }

  const body = await request
    .json()
    .catch(() => ({} as { subjectId?: string; force_new?: boolean }));
  const subjectId = String(body?.subjectId ?? "").trim();
  const forceNew = body?.force_new === true;

  if (!subjectId) {
    return apiError("subjectId is required", 400);
  }

  // ── Resume: latest session for this student + subject ────────────────
  if (!forceNew) {
    const { data: lastSession } = await adminClient
      .from("chat_sessions")
      .select("id, created_at")
      .eq("student_id", user.id)
      .eq("subject_id", subjectId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lastSession) {
      const createdAtMs = new Date(
        lastSession.created_at as string
      ).getTime();
      const isWithinWindow =
        Number.isFinite(createdAtMs) &&
        Date.now() - createdAtMs < RESUME_WINDOW_MS;

      if (isWithinWindow) {
        const { count } = await adminClient
          .from("chat_messages")
          .select("id", { count: "exact", head: true })
          .eq("session_id", lastSession.id);

        const messageCount = count ?? 0;

        return Response.json({
          sessionId: lastSession.id,
          isResumed: true,
          messageCount,
        });
      }
    }
  }

  // ── Fresh start: create a new session row ────────────────────────────
  const { data, error } = await adminClient
    .from("chat_sessions")
    .insert({
      student_id: user.id,
      subject_id: subjectId,
    })
    .select("id")
    .single();

  if (error || !data) {
    return apiError("Failed to create session", 500);
  }

  // ── 5-session cap cleanup (per student per subject) ──────────────────
  // Trigger only on NEW session creation, never on resume. Async — the
  // response does not wait on cleanup.
  adminClient
    .from("chat_sessions")
    .select("id, created_at")
    .eq("student_id", user.id)
    .eq("subject_id", subjectId)
    .order("created_at", { ascending: false })
    .then(({ data: allSessions }) => {
      if (allSessions && allSessions.length > SESSION_CAP) {
        const toDelete = allSessions
          .slice(SESSION_CAP)
          .map((s: { id: string }) => s.id);
        adminClient
          .from("chat_messages")
          .delete()
          .in("session_id", toDelete)
          .then(() => {
            adminClient.from("chat_sessions").delete().in("id", toDelete);
          });
      }
    });

  return Response.json({
    sessionId: data.id,
    isResumed: false,
    messageCount: 0,
  });
}
