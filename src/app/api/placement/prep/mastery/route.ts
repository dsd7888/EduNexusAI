import type { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/db/supabase-server";
import { requireRole, apiError, apiSuccess } from "@/lib/api/helpers";

export async function GET(request: NextRequest) {
  try {
    const authResult = await requireRole(["student"]);
    if (authResult instanceof Response) return authResult;

    const { user } = authResult;
    const track = request.nextUrl.searchParams.get("track");

    const adminClient = createAdminClient();

    const baseQuery = adminClient
      .from("placement_topic_mastery")
      .select("*")
      .eq("student_id", user.id)
      .order("last_practiced_at", { ascending: false, nullsFirst: false });

    const { data, error } = track
      ? await baseQuery.eq("track", track)
      : await baseQuery;

    if (error) {
      console.error("[placement-mastery] Fetch error:", error);
      return apiError("Failed to fetch mastery data", 500);
    }

    return apiSuccess({ mastery: data ?? [] });
  } catch (error) {
    console.error("[placement-mastery] Error:", error instanceof Error ? error.message : error);
    return apiError("Internal server error", 500);
  }
}
