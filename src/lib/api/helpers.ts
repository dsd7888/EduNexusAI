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

// ─── Input validation ────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Cheap shape check — rejects SQL-injection-shaped strings before they ever reach a query. */
export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

// ─── Error logging ────────────────────────────────────────────────────────────

const LOGGED_ERROR_MESSAGE_CAP = 500;

/**
 * console.error, but caps the message length. An upstream failure on a
 * malformed query can surface a raw, unbounded HTML error page as `err.message`
 * — logging that verbatim turns one bad request into log-noise (or worse, a
 * log-injection vector). Truncate before it hits stdout.
 */
export function logCappedError(scope: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  const capped =
    message.length > LOGGED_ERROR_MESSAGE_CAP
      ? `${message.slice(0, LOGGED_ERROR_MESSAGE_CAP)}… [truncated, ${message.length} chars total]`
      : message;
  console.error(scope, capped);
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
