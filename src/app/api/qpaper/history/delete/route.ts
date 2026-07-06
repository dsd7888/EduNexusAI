/**
 * Delete a finalized paper from history — the row and its Storage artifacts.
 *
 * Removing the qpaper_history row alone would orphan the PDF/Word/answer-key
 * files in the `generated-content` bucket, so this route deletes those objects
 * first (best-effort) and then the row, reclaiming storage. Access mirrors the
 * table's RLS: a faculty member deletes their own paper; oversight roles
 * (superadmin/dean/hod) may delete any.
 */

import { requireRole, apiError } from "@/lib/api/helpers";
import type { NextRequest } from "next/server";

const OVERSIGHT_ROLES = new Set(["superadmin", "dean", "hod"]);

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireRole(["faculty", "superadmin", "dean", "hod"]);
    if (authResult instanceof Response) return authResult;
    const { user, profile, adminClient } = authResult;

    const body = (await request.json().catch(() => ({}))) as { id?: string };
    const id = (body.id ?? "").trim();
    if (!id) return apiError("id is required", 400);

    const { data: row, error } = await adminClient
      .from("qpaper_history")
      .select("faculty_id, pdf_path, docx_path, answer_key_path")
      .eq("id", id)
      .maybeSingle();
    if (error) {
      console.error("[qpaper/history/delete] lookup failed:", error.message);
      return apiError("Failed to load history entry", 500);
    }
    if (!row) return apiError("History entry not found", 404);

    // Ownership: own row, or an oversight role.
    if (row.faculty_id !== user.id && !OVERSIGHT_ROLES.has(profile.role)) {
      return apiError("Forbidden", 403);
    }

    // Remove Storage objects first (best-effort — a failure here shouldn't block
    // deleting the row, but is logged so orphans can be swept later).
    const paths = [row.pdf_path, row.docx_path, row.answer_key_path].filter(
      (p): p is string => Boolean(p)
    );
    if (paths.length > 0) {
      const { error: storageError } = await adminClient.storage
        .from("generated-content")
        .remove(paths);
      if (storageError) {
        console.error(
          "[qpaper/history/delete] storage cleanup failed:",
          storageError.message
        );
      }
    }

    const { error: deleteError } = await adminClient
      .from("qpaper_history")
      .delete()
      .eq("id", id);
    if (deleteError) {
      console.error("[qpaper/history/delete] delete failed:", deleteError.message);
      return apiError("Failed to delete paper", 500);
    }

    return Response.json({ success: true });
  } catch (err) {
    console.error("[qpaper/history/delete] error:", err);
    return apiError(
      err instanceof Error ? err.message : "Failed to delete paper",
      500
    );
  }
}
