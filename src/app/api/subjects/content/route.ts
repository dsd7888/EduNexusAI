import {
  createAdminClient,
  createServerClientForRequestResponse,
} from "@/lib/db/supabase-server";
import { requireAuth, apiError, apiSuccess } from "@/lib/api/helpers";
import { type NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  try {
    const response = NextResponse.next();
    void response;
    const authResult = await requireAuth();
    if (authResult instanceof Response) return authResult;
    const { user } = authResult;
    void user;
    const adminClient = createAdminClient();

    const subjectId = request.nextUrl.searchParams.get("subjectId");
    if (!subjectId) {
      return apiError("subjectId is required", 400);
    }

    const { data: row, error: fetchError } = await adminClient
      .from("subject_content")
      .select("content, reference_books")
      .eq("subject_id", subjectId)
      .maybeSingle();

    if (fetchError) {
      console.error("[subjects/content] GET error:", fetchError);
      return apiError(fetchError.message, 500);
    }

    if (!row) {
      return NextResponse.json(null);
    }

    return NextResponse.json({
      content: row.content ?? "",
      referenceBooks: row.reference_books ?? "",
    });
  } catch (err) {
    console.error("[subjects/content] GET error:", err);
    const message = err instanceof Error ? err.message : "Failed to fetch content";
    return apiError(message, 500);
  }
}
