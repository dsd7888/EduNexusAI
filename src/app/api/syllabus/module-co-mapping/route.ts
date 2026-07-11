import type { NextRequest } from "next/server";
import { apiError, apiSuccess, requireRole } from "@/lib/api/helpers";
import { assertSubjectAccess } from "@/lib/api/subjectAccess";

export async function GET(request: NextRequest) {
  try {
    const authResult = await requireRole(["faculty", "superadmin", "dept_admin"]);
    if (authResult instanceof Response) return authResult;
    const { user, profile, adminClient } = authResult;

    const subjectId = request.nextUrl.searchParams.get("subject_id");
    if (!subjectId) return apiError("subject_id is required", 400);

    const accessError = await assertSubjectAccess(
      adminClient,
      profile.role,
      user.id,
      subjectId
    );
    if (accessError) return accessError;

    const { data: moduleRows, error: modulesError } = await adminClient
      .from("modules")
      .select("id, module_number, name")
      .eq("subject_id", subjectId)
      .order("module_number");
    if (modulesError) {
      console.error("[module-co-mapping GET] modules:", modulesError.message);
      return apiError("Failed to load modules", 500);
    }
    const modules = moduleRows ?? [];
    if (modules.length === 0) return apiSuccess({ mappings: [] });

    const { data: mappingRows, error: mappingError } = await adminClient
      .from("module_co_mapping")
      .select("id, module_id, co_code, confidence, source")
      .in(
        "module_id",
        modules.map((m) => m.id)
      );
    if (mappingError) {
      console.error("[module-co-mapping GET] mappings:", mappingError.message);
      return apiError("Failed to load module CO mappings", 500);
    }

    const moduleById = new Map(modules.map((m) => [m.id, m]));
    const mappings = (mappingRows ?? []).map((r) => {
      const mod = moduleById.get(r.module_id);
      return {
        id: r.id,
        module_id: r.module_id,
        module_number: mod?.module_number ?? null,
        module_name: mod?.name ?? null,
        co_code: r.co_code,
        confidence: r.confidence,
        source: r.source,
      };
    });

    return apiSuccess({ mappings });
  } catch (err) {
    console.error("[module-co-mapping GET] Error:", err);
    const message = err instanceof Error ? err.message : "Load failed";
    return apiError(message, 500);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const authResult = await requireRole(["faculty", "superadmin", "dept_admin"]);
    if (authResult instanceof Response) return authResult;
    const { user, profile, adminClient } = authResult;

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return apiError("Invalid JSON body", 400);
    }

    const moduleId = typeof body.module_id === "string" ? body.module_id : "";
    const coCode = typeof body.co_code === "string" ? body.co_code.trim() : "";
    const action = body.action === "add" || body.action === "remove" ? body.action : "";
    if (!moduleId || !coCode || !action) {
      return apiError("module_id, co_code, and action ('add'|'remove') are required", 400);
    }

    const { data: moduleRow, error: moduleError } = await adminClient
      .from("modules")
      .select("id, subject_id")
      .eq("id", moduleId)
      .maybeSingle();
    if (moduleError) {
      console.error("[module-co-mapping PATCH] module lookup:", moduleError.message);
      return apiError("Failed to load module", 500);
    }
    if (!moduleRow) return apiError("Module not found", 404);

    const accessError = await assertSubjectAccess(
      adminClient,
      profile.role,
      user.id,
      moduleRow.subject_id
    );
    if (accessError) return accessError;

    if (action === "add") {
      const { error: upsertError } = await adminClient
        .from("module_co_mapping")
        .upsert(
          {
            module_id: moduleId,
            co_code: coCode,
            source: "faculty_verified",
            confidence: "high",
          },
          { onConflict: "module_id,co_code" }
        );
      if (upsertError) {
        console.error("[module-co-mapping PATCH] upsert:", upsertError.message);
        return apiError("Failed to save mapping", 500);
      }
    } else {
      const { error: deleteError } = await adminClient
        .from("module_co_mapping")
        .delete()
        .eq("module_id", moduleId)
        .eq("co_code", coCode);
      if (deleteError) {
        console.error("[module-co-mapping PATCH] delete:", deleteError.message);
        return apiError("Failed to remove mapping", 500);
      }
    }

    return apiSuccess({ ok: true });
  } catch (err) {
    console.error("[module-co-mapping PATCH] Error:", err);
    const message = err instanceof Error ? err.message : "Update failed";
    return apiError(message, 500);
  }
}
