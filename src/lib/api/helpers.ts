import {
  createServerClient,
  createAdminClient,
} from "@/lib/db/supabase-server";

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
export function logCappedError(
  scope: string,
  err: unknown,
  context?: AppErrorContext
): void {
  const message = err instanceof Error ? err.message : String(err);
  const capped =
    message.length > LOGGED_ERROR_MESSAGE_CAP
      ? `${message.slice(0, LOGGED_ERROR_MESSAGE_CAP)}… [truncated, ${message.length} chars total]`
      : message;
  console.error(scope, capped);
  persistAppError({
    scope,
    message: capped,
    stack: err instanceof Error ? err.stack : undefined,
    origin: "handled",
    ...context,
  });
}

const LOGGED_ERROR_STACK_CAP = 4000;

export interface AppErrorContext {
  route?: string;
  httpMethod?: string;
  userId?: string | null;
  userEmail?: string | null;
  userRole?: string | null;
  metadata?: Record<string, unknown>;
}

interface PersistAppErrorParams extends AppErrorContext {
  scope: string;
  message: string;
  stack?: string;
  origin: "handled" | "unhandled";
}

/** Aborted/cancelled requests are client navigation, not server faults. */
function isClientAbort(message: string): boolean {
  return /\b(aborted|abortterror|request aborted|the operation was aborted|canceled|cancelled|ECONNRESET)\b/i
    .test(message);
}

/**
 * Writes one row to `app_error_logs` (migration 20260820000000).
 *
 * Fire-and-forget by design, and every failure inside it is swallowed after a
 * console.error: this is the error *reporting* path, and a reporting path that
 * can itself throw turns a handled 500 into an unhandled one. It must never be
 * able to make things worse than the error it is describing.
 *
 * Not awaited by callers for the same reason — a student waiting on a response
 * should not also wait on our telemetry write.
 */
export function persistAppError(params: PersistAppErrorParams): void {
  // A client that navigates away mid-request aborts it, and the handler's catch
  // block sees that as an error. It isn't one — nothing is broken server-side,
  // and during a pilot it is the single most common thing students generate
  // (every back-button press mid-load). Logging it would bury the real faults
  // this table exists to surface. Verified against live rows: the interrupted-
  // flow test produced two "[placement-submit] Error: aborted" entries and
  // nothing else.
  if (isClientAbort(params.message)) return;

  void (async () => {
    try {
      const stack = params.stack
        ? params.stack.length > LOGGED_ERROR_STACK_CAP
          ? `${params.stack.slice(0, LOGGED_ERROR_STACK_CAP)}… [truncated]`
          : params.stack
        : null;

      const adminClient = createAdminClient();
      const { error } = await adminClient.from("app_error_logs").insert({
        scope: params.scope,
        route: params.route ?? null,
        http_method: params.httpMethod ?? null,
        user_id: params.userId ?? null,
        user_email_snapshot: params.userEmail ?? null,
        user_role_snapshot: params.userRole ?? null,
        message: params.message,
        stack,
        origin: params.origin,
        metadata: params.metadata ?? {},
      });
      if (error) {
        // Most likely cause during rollout: the migration has not been applied
        // yet. Say so plainly rather than emitting a bare PostgREST code.
        console.error(
          "[app-error-logs] insert failed (is migration " +
            "20260820000000_app_error_logs.sql applied?):",
          error.message
        );
      }
    } catch (err) {
      console.error("[app-error-logs] unexpected failure:", err);
    }
  })();
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
