import { requireRole, apiError, apiSuccess } from "@/lib/api/helpers";
import type { NextRequest } from "next/server";

export async function DELETE(
  _request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireRole(["faculty", "superadmin", "dept_admin", "dean", "hod"]);
    if (authResult instanceof Response) return authResult;
    const { adminClient } = authResult;

    const { id } = await ctx.params;
    if (!id) return apiError("id is required", 400);

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
