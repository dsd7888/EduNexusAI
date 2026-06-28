import { requireRole, apiError, apiSuccess } from "@/lib/api/helpers";
import type { NextRequest } from "next/server";

export async function DELETE(
  _request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireRole(["faculty", "superadmin", "dept_admin", "dean", "hod"]);
    if (authResult instanceof Response) return authResult;
    const { user, profile, adminClient } = authResult;

    const { id } = await ctx.params;
    if (!id) return apiError("id is required", 400);

    const { data: row, error: fetchErr } = await adminClient
      .from("qpaper_templates")
      .select("id, created_by")
      .eq("id", id)
      .maybeSingle();

    if (fetchErr) {
      console.error("[qpaper/templates DELETE fetch]", fetchErr.message);
      return apiError("Failed to delete template", 500);
    }
    if (!row) return apiError("Template not found", 404);

    const isOwner = row.created_by === user.id;
    const isAdmin = profile.role === "superadmin" || profile.role === "dept_admin";
    if (!isOwner && !isAdmin) {
      return apiError("You can only delete your own templates", 403);
    }

    const { error } = await adminClient
      .from("qpaper_templates")
      .delete()
      .eq("id", id);

    if (error) {
      console.error("[qpaper/templates DELETE]", error.message);
      return apiError("Failed to delete template", 500);
    }

    return apiSuccess({ ok: true });
  } catch (err) {
    console.error("[qpaper/templates DELETE error]", err);
    return apiError("Failed to delete template", 500);
  }
}
