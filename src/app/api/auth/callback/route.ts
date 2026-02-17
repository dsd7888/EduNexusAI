import {
  createServerClientForRequestResponse,
} from "@/lib/db/supabase-server";
import { type NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");

  if (!code) {
    return NextResponse.redirect(new URL("/login?error=auth_failed", requestUrl.origin));
  }

  const response = NextResponse.redirect(new URL("/auth/loading", requestUrl.origin));

  try {
    const supabase = createServerClientForRequestResponse(request, response);
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (error) {
      console.error("[auth/callback] exchangeCodeForSession error:", error.message);
      return NextResponse.redirect(new URL("/login?error=auth_failed", requestUrl.origin));
    }

    return response;
  } catch {
    return NextResponse.redirect(new URL("/login?error=auth_failed", requestUrl.origin));
  }
}
