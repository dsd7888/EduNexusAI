import {
  createAdminClient,
  createServerClientForRequestResponse,
} from "@/lib/db/supabase-server";
import { type NextRequest, NextResponse } from "next/server";

type UserRole =
  | "superadmin"
  | "dept_admin"
  | "faculty"
  | "student"
  | "dean"
  | "hod";

// dean/hod are faculty-tier roles: they reach /faculty/* and faculty-tier APIs
// but not the superadmin tier.
const FACULTY_TIER_ROLES: UserRole[] = ["faculty", "dean", "hod"];

const PUBLIC_PATHS = ["/", "/login", "/register", "/auth/callback", "/api/auth/callback"] as const;
const SUPERADMIN_PREFIX = "/superadmin";
const FACULTY_PREFIX = "/faculty";
const STUDENT_PREFIX = "/student";

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.includes(pathname as (typeof PUBLIC_PATHS)[number]);
}

function isProtectedPath(pathname: string): boolean {
  return (
    pathname.startsWith(SUPERADMIN_PREFIX) ||
    pathname.startsWith(FACULTY_PREFIX) ||
    pathname.startsWith(STUDENT_PREFIX) ||
    pathname.startsWith("/auth/loading")
  );
}

function getDashboardForRole(role: UserRole): string {
  if (role === "superadmin" || role === "dept_admin") return "/superadmin/dashboard";
  if (FACULTY_TIER_ROLES.includes(role)) return "/faculty/dashboard";
  if (role === "student") return "/student/dashboard";
  return "/";
}

function redirectWithCookies(response: NextResponse, url: string): NextResponse {
  const redirectResponse = NextResponse.redirect(url);
  response.cookies.getAll().forEach((cookie) =>
    redirectResponse.cookies.set(cookie.name, cookie.value)
  );
  return redirectResponse;
}

interface ProfileGate {
  role: UserRole | null;
  mustChangePassword: boolean;
}

// Single profile read used for both role gating and the forced-password-change gate —
// same shape as before, just one extra column, so no second fetch is introduced.
async function getProfile(userId: string): Promise<ProfileGate | null> {
  try {
    const supabase = createAdminClient();

    const { data, error } = await supabase
      .from("profiles")
      .select("role, must_change_password")
      .eq("id", userId)
      .single();

    if (error) {
      console.error("[proxy] Profile fetch error:", error.message);
      return null;
    }

    const rawRole = data?.role as UserRole | undefined;
    const role =
      rawRole &&
      ["superadmin", "dept_admin", "faculty", "student", "dean", "hod"].includes(
        rawRole
      )
        ? rawRole
        : null;

    return { role, mustChangePassword: Boolean(data?.must_change_password) };
  } catch (err) {
    console.error("[proxy] Profile fetch exception:", err);
    return null;
  }
}

function roleOrDefault(role: UserRole | null): UserRole {
  return role ?? "student";
}

export async function proxy(request: NextRequest) {
  const response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    return response;
  }

  const supabase = createServerClientForRequestResponse(request, response);

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;

  if (path === "/api/auth/callback") {
    return response;
  }

  // ── API route protection (must run before generic API passthrough) ──
  if (path.startsWith("/api/")) {
    const isFacultyTierApi =
      path.startsWith("/api/generate/") ||
      path.startsWith("/api/qpaper") ||
      path.startsWith("/api/refine") ||
      path.startsWith("/api/approvals") ||
      path.startsWith("/api/faculty");
    const isSuperadminTierApi =
      path.startsWith("/api/upload") || path.startsWith("/api/admin");

    if (isFacultyTierApi || isSuperadminTierApi) {
      if (!user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      const role = roleOrDefault((await getProfile(user.id))?.role ?? null);

      if (isFacultyTierApi && role === "student") {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      if (
        isSuperadminTierApi &&
        role !== "superadmin" &&
        role !== "dept_admin"
      ) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    return response;
  }

  // ── Public routes ──
  if (isPublicPath(path)) {
    if (!user) {
      return response;
    }
    if (path === "/login" || path === "/register") {
      const role = (await getProfile(user.id))?.role ?? null;
      const dashboard = role ? getDashboardForRole(role) : "/";
      return redirectWithCookies(response, new URL(dashboard, request.url).toString());
    }
    return response;
  }

  // ── Protected page routes: session + role ──
  if (isProtectedPath(path)) {
    if (!user) {
      return redirectWithCookies(response, new URL("/login", request.url).toString());
    }

    // OAuth / auth loading — session only
    if (path.startsWith("/auth/loading")) {
      return response;
    }

    const profile = await getProfile(user.id);
    const role = roleOrDefault(profile?.role ?? null);

    // Forced password change: bulk-created faculty must set a real password before
    // reaching any app page. The change-password page itself is exempt (it's not a
    // protected path, so it stays reachable). API + sign-out flows are handled in the
    // /api/ block above and never reach here.
    if (profile?.mustChangePassword && path !== "/auth/change-password") {
      return redirectWithCookies(
        response,
        new URL("/auth/change-password", request.url).toString()
      );
    }

    const isSuperadminRoute = path.startsWith("/superadmin");
    const isFacultyRoute = path.startsWith("/faculty");
    const isStudentRoute = path.startsWith("/student");

    if (isSuperadminRoute) {
      if (role !== "superadmin" && role !== "dept_admin") {
        const dest = FACULTY_TIER_ROLES.includes(role)
          ? "/faculty/dashboard"
          : "/student/dashboard";
        return redirectWithCookies(
          response,
          new URL(dest, request.url).toString()
        );
      }
    }

    if (isFacultyRoute) {
      if (
        !FACULTY_TIER_ROLES.includes(role) &&
        role !== "superadmin" &&
        role !== "dept_admin"
      ) {
        return redirectWithCookies(
          response,
          new URL("/student/dashboard", request.url).toString()
        );
      }
    }

    if (isStudentRoute) {
      if (FACULTY_TIER_ROLES.includes(role)) {
        return redirectWithCookies(
          response,
          new URL("/faculty/dashboard", request.url).toString()
        );
      }
    }

    return response;
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
