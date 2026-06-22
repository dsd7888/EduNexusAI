import { requireRole, apiError } from "@/lib/api/helpers";
import type { NextRequest } from "next/server";

/**
 * POST /api/qbank/bulk-verify
 * Body: { ids: string[] }
 *
 * For each supplied question ID that belongs to the caller and has both
 * co_code and btl_level populated, sets is_verified = true in one UPDATE.
 * Returns { verified: number, skipped: Array<{ id: string; question_text: string }> }
 * so the UI can report "12 verified, 2 skipped (missing CO or BTL)".
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireRole(["faculty", "superadmin", "dean", "hod"]);
    if (authResult instanceof Response) return authResult;
    const { user, profile, adminClient } = authResult;

    let body: { ids?: unknown };
    try {
      body = (await request.json()) as { ids?: unknown };
    } catch {
      return apiError("Invalid JSON body", 400);
    }

    if (!Array.isArray(body.ids) || body.ids.length === 0) {
      return apiError("ids must be a non-empty array", 400);
    }

    const ids = (body.ids as unknown[])
      .filter((id) => typeof id === "string" && id.trim())
      .map((id) => (id as string).trim());

    if (ids.length === 0) return apiError("No valid IDs provided", 400);
    if (ids.length > 500) return apiError("Maximum 500 IDs per request", 400);

    // Fetch only rows the caller owns.
    let query = adminClient
      .from("faculty_question_bank")
      .select("id, question_text, co_code, btl_level, is_verified")
      .in("id", ids);

    if (profile.role === "faculty") {
      query = query.eq("faculty_id", user.id);
    }

    const { data, error: fetchError } = await query;
    if (fetchError) {
      console.error("[qbank bulk-verify] fetch failed:", fetchError.message);
      return apiError("Failed to load questions", 500);
    }

    type Row = { id: string; question_text: string; co_code: string | null; btl_level: number | null; is_verified: boolean };
    const rows = (data ?? []) as Row[];

    const eligible: string[] = [];
    const skipped: Array<{ id: string; question_text: string }> = [];

    for (const row of rows) {
      if (row.co_code && row.btl_level != null) {
        eligible.push(row.id);
      } else {
        skipped.push({ id: row.id, question_text: row.question_text });
      }
    }

    let verified = 0;
    if (eligible.length > 0) {
      const { error: updateError } = await adminClient
        .from("faculty_question_bank")
        .update({ is_verified: true, updated_at: new Date().toISOString() })
        .in("id", eligible);

      if (updateError) {
        console.error("[qbank bulk-verify] update failed:", updateError.message);
        return apiError("Failed to update questions", 500);
      }

      verified = eligible.length;
    }

    return Response.json({ verified, skipped });
  } catch (err) {
    console.error("[qbank bulk-verify] Error:", err);
    return apiError(
      err instanceof Error ? err.message : "Failed to bulk verify",
      500
    );
  }
}
