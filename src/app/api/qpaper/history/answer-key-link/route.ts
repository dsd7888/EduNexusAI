/**
 * Mint a fresh, short-lived signed URL for a history row's answer key.
 *
 * qpaper_history stores the answer key as a Storage *path* (not a URL) so it
 * stays confidential — re-download links are signed on demand here rather than
 * persisted. The PDF and .docx artifacts are in the public bucket and are
 * linked client-side via getPublicUrl, so they don't need this route.
 *
 * Access mirrors the table's RLS: a faculty member can re-sign their own
 * paper's answer key; superadmin/dean/hod (oversight tiers) can re-sign any.
 */

import { requireRole, apiError } from "@/lib/api/helpers";
import type { NextRequest } from "next/server";

const SIGNED_URL_TTL = 3600; // 1 hour
const OVERSIGHT_ROLES = new Set(["superadmin", "dean", "hod"]);

export async function GET(request: NextRequest) {
  try {
    const authResult = await requireRole(["faculty", "superadmin", "dean", "hod"]);
    if (authResult instanceof Response) return authResult;
    const { user, profile, adminClient } = authResult;

    const id = (request.nextUrl.searchParams.get("id") ?? "").trim();
    if (!id) return apiError("id is required", 400);

    const { data: row, error } = await adminClient
      .from("qpaper_history")
      .select("faculty_id, answer_key_path")
      .eq("id", id)
      .maybeSingle();
    if (error) {
      console.error("[qpaper/history/answer-key-link] lookup failed:", error.message);
      return apiError("Failed to load history entry", 500);
    }
    if (!row) return apiError("History entry not found", 404);

    // Ownership: own row, or an oversight role.
    if (row.faculty_id !== user.id && !OVERSIGHT_ROLES.has(profile.role)) {
      return apiError("Forbidden", 403);
    }
    if (!row.answer_key_path) {
      return apiError("No answer key for this paper", 404);
    }

    const { data: signed, error: signError } = await adminClient.storage
      .from("generated-content")
      .createSignedUrl(row.answer_key_path, SIGNED_URL_TTL);
    if (signError || !signed) {
      console.error(
        "[qpaper/history/answer-key-link] sign failed:",
        signError?.message
      );
      return apiError("Failed to create download link", 500);
    }

    return Response.json({ success: true, downloadUrl: signed.signedUrl });
  } catch (err) {
    console.error("[qpaper/history/answer-key-link] error:", err);
    return apiError(
      err instanceof Error ? err.message : "Failed to create download link",
      500
    );
  }
}
