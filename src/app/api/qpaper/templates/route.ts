import { requireRole, apiError, apiSuccess } from "@/lib/api/helpers";
import {
  PRESET_TEMPLATES,
  PRESET_ORDER,
  type PresetKey,
} from "@/lib/qpaper/templates";
import type { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  try {
    const authResult = await requireRole(["faculty", "superadmin", "dept_admin"]);
    if (authResult instanceof Response) return authResult;
    const { adminClient } = authResult;

    const url = new URL(request.url);
    const subjectId = url.searchParams.get("subject_id");
    if (!subjectId) return apiError("subject_id is required", 400);

    const { data: existingRows, error } = await adminClient
      .from("qpaper_templates")
      .select("*")
      .eq("subject_id", subjectId)
      .order("is_default", { ascending: false })
      .order("created_at", { ascending: false });
    let rows = existingRows;

    if (error) {
      console.error("[qpaper/templates GET]", error.message);
      return apiError("Failed to load templates", 500);
    }

    if (!rows || rows.length === 0) {
      // Seed all three presets the first time we're asked for this subject.
      const seedRows = PRESET_ORDER.map((key: PresetKey) => {
        const preset = PRESET_TEMPLATES[key];
        return {
          subject_id: subjectId,
          created_by: authResult.user.id,
          name: preset.name,
          is_default: preset.is_default,
          university_name: preset.university_name,
          exam_title: preset.exam_title,
          duration_minutes: preset.duration_minutes,
          total_marks: preset.total_marks,
          instructions: preset.instructions,
          structure: preset.structure,
        };
      });

      const { data: seeded, error: seedError } = await adminClient
        .from("qpaper_templates")
        .insert(seedRows)
        .select("*");

      if (seedError) {
        console.error("[qpaper/templates seed]", seedError.message);
        return apiError("Failed to seed default templates", 500);
      }
      rows = seeded ?? [];
    }

    return apiSuccess({ templates: rows ?? [] });
  } catch (err) {
    console.error("[qpaper/templates GET error]", err);
    return apiError("Failed to load templates", 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireRole(["faculty", "superadmin", "dept_admin"]);
    if (authResult instanceof Response) return authResult;
    const { user, adminClient } = authResult;

    const body = (await request.json()) as Record<string, unknown>;
    const subjectId = String(body.subject_id ?? "").trim();
    const name = String(body.name ?? "").trim();
    const structure = body.structure;

    if (!subjectId || !name || !structure || typeof structure !== "object") {
      return apiError("subject_id, name and structure are required", 400);
    }

    const isDefault = Boolean(body.is_default ?? false);

    if (isDefault) {
      await adminClient
        .from("qpaper_templates")
        .update({ is_default: false })
        .eq("subject_id", subjectId);
    }

    const insertRow = {
      subject_id: subjectId,
      created_by: user.id,
      name,
      is_default: isDefault,
      university_name:
        typeof body.university_name === "string" && body.university_name.trim()
          ? body.university_name
          : "P P Savani University",
      exam_title:
        typeof body.exam_title === "string" ? body.exam_title : null,
      duration_minutes: Number(body.duration_minutes ?? 150),
      total_marks: Number(body.total_marks ?? 60),
      instructions: Array.isArray(body.instructions)
        ? (body.instructions as unknown[]).map((s) => String(s))
        : null,
      structure,
    };

    const { data, error } = await adminClient
      .from("qpaper_templates")
      .insert(insertRow)
      .select("*")
      .single();

    if (error) {
      console.error("[qpaper/templates POST]", error.message);
      return apiError("Failed to save template", 500);
    }

    return apiSuccess({ template: data });
  } catch (err) {
    console.error("[qpaper/templates POST error]", err);
    return apiError("Failed to save template", 500);
  }
}
