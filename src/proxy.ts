import {
  createAdminClient,
  createServerClientForRequestResponse,
} from "@/lib/db/supabase-server";
import { type NextRequest, NextResponse } from "next/server";

type UserRole = "superadmin" | "dept_admin" | "faculty" | "student";

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
  if (role === "faculty") return "/faculty/dashboard";
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

async function getProfileRole(userId: string): Promise<UserRole | null> {
  try {
    const supabase = createAdminClient();

    const { data, error } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", userId)
      .single();

    if (error) {
      console.error("[proxy] Profile fetch error:", error.message);
      return null;
    }

    const role = data?.role as UserRole | undefined;
    if (!role || !["superadmin", "dept_admin", "faculty", "student"].includes(role)) {
      return null;
    }

    return role;
  } catch (err) {
    console.error("[proxy] Profile fetch exception:", err);
    return null;
  }
}

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    return response;
  }

  const supabase = createServerClientForRequestResponse(request, response);

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;

  // API routes (except auth callback) - allow through without checks
  if (pathname.startsWith("/api/") && pathname !== "/api/auth/callback") {
    return response;
  }

  // 1. Public routes
  if (isPublicPath(pathname)) {
    if (!user) {
      return response;
    }
    // User is logged in on /login or /register - fetch profile and redirect to dashboard
    if (pathname === "/login" || pathname === "/register") {
      const role = await getProfileRole(user.id);
      const dashboard = role ? getDashboardForRole(role) : "/";
      return redirectWithCookies(response, new URL(dashboard, request.url).toString());
    }
    return response;
  }

  // 2. Protected routes - only check session, let layout handle role
  if (isProtectedPath(pathname)) {
    if (!user) {
      return redirectWithCookies(response, new URL("/login", request.url).toString());
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
