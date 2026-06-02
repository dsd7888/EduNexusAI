import {
  createAdminClient,
  createServerClientForRequestResponse,
} from "@/lib/db/supabase-server";
import { requireAuth, requireRole, apiError, apiSuccess } from "@/lib/api/helpers";
import { type NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  try {
    const response = NextResponse.next();
    void response;
    const authResult = await requireRole(["superadmin"]);
    if (authResult instanceof Response) return authResult;
    const { adminClient } = authResult;
    const { searchParams } = new URL(request.url);
    const path = searchParams.get("path");
    if (!path) {
      return apiError("path is required", 400);
    }
    const { data, error } = await adminClient.storage
      .from("documents")
      .createSignedUrl(path, 60);
    if (error || !data?.signedUrl) {
      return apiError(
        error?.message ?? "Failed to create download link",
        500
      );
    }
    return NextResponse.redirect(data.signedUrl);
  } catch (err) {
    return apiError("Failed to create download link", 500);
  }
}
