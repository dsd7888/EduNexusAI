import { apiError, requireAuth } from "@/lib/api/helpers";
import { createAdminClient } from "@/lib/db/supabase-server";

/**
 * POST /api/auth/change-password
 *
 * Clears the caller's own must_change_password flag after they've successfully set a
 * new password via supabase.auth.updateUser on the client. Updates ONLY the caller's
 * row. The actual password change happens client-side against Supabase Auth; this
 * route just retires the forced-change gate for this user.
 */
export async function POST() {
  try {
    const authResult = await requireAuth();
    if (authResult instanceof Response) return authResult;
    const { user } = authResult;

    const adminClient = createAdminClient();
    const { error } = await adminClient
      .from("profiles")
      .update({ must_change_password: false })
      .eq("id", user.id);

    if (error) return apiError(error.message, 500);

    return Response.json({ ok: true });
  } catch (err) {
    console.error("[auth/change-password] Error:", err);
    const message = err instanceof Error ? err.message : "Failed to update profile";
    return apiError(message, 500);
  }
}
