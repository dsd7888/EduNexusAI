import {
  createServerClient,
  createAdminClient,
} from "@/lib/db/supabase-server";
import type { NextRequest } from "next/server";

// ─── Response helpers ────────────────────────────────────────────────────────

export function apiError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

export function apiSuccess<T>(data: T, status = 200): Response {
  return Response.json(data, { status });
}

// ─── Auth helpers ─────────────────────────────────────────────────────────────

export type AllowedRole =
  | "student"
  | "faculty"
  | "superadmin"
  | "dept_admin"
  | "dean"
  | "hod";

interface AuthResult {
  user: { id: string; email?: string };
  supabase: Awaited<ReturnType<typeof createServerClient>>;
}

interface AuthWithProfileResult extends AuthResult {
  profile: { id: string; role: string };
  adminClient: ReturnType<typeof createAdminClient>;
}

/**
 * Verifies the request has a valid Supabase session.
 * Returns { user, supabase } or returns a 401 Response.
 * Usage: const result = await requireAuth(); if (result instanceof Response) return result;
 */
export async function requireAuth(): Promise<AuthResult | Response> {
  const supabase = await createServerClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return apiError("Unauthorized", 401);
  }

  return { user, supabase };
}

/**
 * Verifies session AND checks the user's role against allowedRoles.
 * Returns { user, supabase, profile, adminClient } or returns a 401/403/500 Response.
 * Usage: const result = await requireRole(["faculty", "superadmin"]); if (result instanceof Response) return result;
 */
export async function requireRole(
  allowedRoles: AllowedRole[]
): Promise<AuthWithProfileResult | Response> {
  const authResult = await requireAuth();
  if (authResult instanceof Response) return authResult;

  const { user, supabase } = authResult;
  const adminClient = createAdminClient();

  const { data: profile, error: profileError } = await adminClient
    .from("profiles")
    .select("id, role")
    .eq("id", user.id)
    .single();

  if (profileError || !profile) {
    return apiError("Failed to load profile", 500);
  }

  const role = (profile as { id: string; role: string }).role as AllowedRole;

  if (!allowedRoles.includes(role)) {
    return apiError(
      `Forbidden: ${allowedRoles.map((r) => r.charAt(0).toUpperCase() + r.slice(1)).join(" or ")} only`,
      403
    );
  }

  return { user, supabase, profile: { id: profile.id, role }, adminClient };
}
