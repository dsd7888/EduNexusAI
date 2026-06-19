import { apiError, apiSuccess, requireRole } from "@/lib/api/helpers";
import { EXPLAINER_BUCKET } from "@/lib/explainer/storage";

/**
 * DELETE /api/explainer/[id] — remove an explainer the caller owns (or any, for
 * superadmin). Deletes the stored HTML from Storage, then the row. Mirrors the
 * "creator or superadmin" delete policy in the explainers migration.
 */
export async function DELETE(
  _request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole(["faculty", "superadmin", "dean", "hod"]);
  if (auth instanceof Response) return auth;
  const { user, profile, adminClient } = auth;

  const { id } = await ctx.params;
  if (!id) return apiError("Missing explainer id", 400);

  const { data: row, error } = await adminClient
    .from("explainers")
    .select("id, created_by, storage_path")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("[explainer/delete] lookup failed", error);
    return apiError("Failed to load explainer", 500);
  }
  if (!row) return apiError("Explainer not found", 404);

  const explainer = row as {
    id: string;
    created_by: string | null;
    storage_path: string;
  };

  const isOwner = explainer.created_by === user.id;
  const isSuperadmin = profile.role === "superadmin";
  if (!isOwner && !isSuperadmin) {
    return apiError("You can only delete your own explainers", 403);
  }

  // Remove the stored HTML first; a leftover file is harmless but we try.
  const { error: storageError } = await adminClient.storage
    .from(EXPLAINER_BUCKET)
    .remove([explainer.storage_path]);
  if (storageError) {
    console.warn(
      `[explainer/delete] storage remove failed for ${explainer.storage_path}: ${storageError.message}`
    );
  }

  const { error: deleteError } = await adminClient
    .from("explainers")
    .delete()
    .eq("id", id);
  if (deleteError) {
    console.error("[explainer/delete] row delete failed", deleteError);
    return apiError("Failed to delete explainer", 500);
  }

  return apiSuccess({ deleted: true, id });
}
