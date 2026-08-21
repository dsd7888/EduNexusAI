import { apiError, requireAuth } from "@/lib/api/helpers";
import { createAdminClient } from "@/lib/db/supabase-server";

/**
 * POST /api/auth/change-password
 *
 * Clears the caller's own must_change_password flag after they've successfully set a
 * new password via supabase.auth.updateUser on the client. Updates ONLY the caller's
 * row. The actual password change happens client-side against Supabase Auth; this
 * route just retires the forced-change gate for this user.
 *
 * Also returns where this user should go next. The success card used to hardcode
 * /faculty/syllabus — correct when only faculty were bulk-created, wrong the moment
 * students were, since proxy.ts bounces a student off every /faculty/* route. The
 * role lives server-side, so resolving the destination here keeps the client from
 * needing its own profile read.
 */

/** Mirrors proxy.ts's landing map, except faculty keep their onboarding-specific
 *  destination (add a subject) rather than the plain dashboard. */
function landingFor(role: string | null | undefined): { href: string; label: string; blurb: string } {
  if (role === "superadmin" || role === "dept_admin") {
    return {
      href: "/superadmin/dashboard",
      label: "Continue to Dashboard",
      blurb: "You're all set.",
    };
  }
  if (role === "faculty" || role === "dean" || role === "hod") {
    return {
      href: "/faculty/syllabus",
      label: "Continue to Syllabus",
      blurb: "You're all set. Let's add your first subject.",
    };
  }
  return {
    href: "/student/dashboard",
    label: "Continue to Dashboard",
    blurb: "You're all set. Your subjects are ready on your dashboard.",
  };
}

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

    const { data: profile } = await adminClient
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();

    return Response.json({ ok: true, next: landingFor(profile?.role) });
  } catch (err) {
    console.error("[auth/change-password] Error:", err);
    const message = err instanceof Error ? err.message : "Failed to update profile";
    return apiError(message, 500);
  }
}
