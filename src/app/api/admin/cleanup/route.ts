import {
  createAdminClient,
  createServerClient,
} from "@/lib/db/supabase-server";
import { requireAuth, requireRole, apiError, apiSuccess } from "@/lib/api/helpers";
import type { NextRequest } from "next/server";

export async function POST(_request: NextRequest) {
  try {
    const authResult = await requireRole(["superadmin"]);
    if (authResult instanceof Response) return authResult;
    const { adminClient } = authResult;

    const { error } = await adminClient.rpc("cleanup_old_question_history");

    if (error) {
      return apiError(error.message, 500);
    }

    return Response.json({ success: true });
  } catch (err) {
    console.error("[admin/cleanup]", err);
    return apiError("Internal server error", 500);
  }
}
