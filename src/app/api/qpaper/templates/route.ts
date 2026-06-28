import { requireRole, apiError, apiSuccess } from "@/lib/api/helpers";
import {
  PRESET_TEMPLATES,
  PRESET_ORDER,
  type PresetKey,
} from "@/lib/qpaper/templates";
import type { NextRequest } from "next/server";

export async function GET(_request: NextRequest) {
  try {
    const authResult = await requireRole(["faculty", "superadmin", "dept_admin", "dean", "hod"]);
    if (authResult instanceof Response) return authResult;
    const { user, adminClient } = authResult;

    // One-time global seed: if no preset rows exist anywhere, insert all 3.
    const { count: presetCount, error: countErr } = await adminClient
      .from("qpaper_templates")
      .select("id", { count: "exact", head: true })
      .eq("is_preset", true);

    if (!countErr && (presetCount ?? 0) === 0) {
      const seedRows = PRESET_ORDER.map((key: PresetKey) => {
        const preset = PRESET_TEMPLATES[key];
        return {
          subject_id: null,
          created_by: null,
          name: preset.name,
          is_default: false,
          is_preset: true,
          is_snapshot: false,
          scope: "school",
          university_name: preset.university_name,
          exam_title: preset.exam_title,
          duration_minutes: preset.duration_minutes,
          total_marks: preset.total_marks,
          instructions: preset.instructions,
          structure: preset.structure,
        };
      });
      const { error: seedError } = await adminClient
        .from("qpaper_templates")
        .insert(seedRows);
      if (seedError) {
        console.error("[qpaper/templates seed]", seedError.message);
      }
    }

    // My templates: own rows that are not snapshots.
    const { data: myTemplates, error: myErr } = await adminClient
      .from("qpaper_templates")
      .select("*")
      .eq("created_by", user.id)
      .eq("is_snapshot", false)
      .order("is_preset", { ascending: false })
      .order("created_at", { ascending: false });

    if (myErr) {
      console.error("[qpaper/templates GET my]", myErr.message);
      return apiError("Failed to load templates", 500);
    }

    // Shared templates: school-scoped, not snapshots, with creator name joined.
    const { data: sharedRaw, error: sharedErr } = await adminClient
      .from("qpaper_templates")
      .select("*, profiles(full_name)")
      .eq("scope", "school")
      .eq("is_snapshot", false)
      .order("is_preset", { ascending: false })
      .order("created_at", { ascending: false });

    if (sharedErr) {
      console.error("[qpaper/templates GET shared]", sharedErr.message);
      return apiError("Failed to load shared templates", 500);
    }

    const sharedTemplates = (sharedRaw ?? []).map((row) => {
      const { profiles, ...rest } = row as Record<string, unknown> & {
        profiles: { full_name?: string | null } | null;
      };
      return {
        ...rest,
        creator_name:
          rest.created_by == null
            ? null
            : (profiles?.full_name ?? null),
      };
    });

    return apiSuccess({ myTemplates: myTemplates ?? [], sharedTemplates });
  } catch (err) {
    console.error("[qpaper/templates GET error]", err);
    return apiError("Failed to load templates", 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireRole(["faculty", "superadmin", "dept_admin", "dean", "hod"]);
    if (authResult instanceof Response) return authResult;
    const { user, adminClient } = authResult;

    const body = (await request.json()) as Record<string, unknown>;
    const name = String(body.name ?? "").trim();
    const structure = body.structure;

    if (!name || !structure || typeof structure !== "object") {
      return apiError("name and structure are required", 400);
    }

    const subjectId =
      typeof body.subject_id === "string" && body.subject_id.trim()
        ? body.subject_id.trim()
        : null;

    const isSnapshot = Boolean(body.is_snapshot ?? false);
    const scope =
      typeof body.scope === "string" &&
      ["personal", "school", "department"].includes(body.scope)
        ? (body.scope as "personal" | "school" | "department")
        : "personal";
    const isDefault = Boolean(body.is_default ?? false);

    // Name-uniqueness check (snapshots are throwaway — skip the check for them).
    if (!isSnapshot) {
      let dupeQuery = adminClient
        .from("qpaper_templates")
        .select("name")
        .eq("is_snapshot", false)
        .ilike("name", name);

      if (scope === "personal") {
        dupeQuery = dupeQuery.eq("created_by", user.id).eq("scope", "personal");
      } else {
        // school / department: check all rows with that scope regardless of creator.
        dupeQuery = dupeQuery.eq("scope", scope);
      }

      const { data: existing } = await dupeQuery.limit(1);
      if (existing && existing.length > 0) {
        return apiError(
          `A template named "${(existing[0] as { name: string }).name}" already exists`,
          409
        );
      }
    }

    // Reset the user's own default before setting a new one.
    if (isDefault) {
      await adminClient
        .from("qpaper_templates")
        .update({ is_default: false })
        .eq("created_by", user.id);
    }

    const insertRow = {
      subject_id: subjectId,
      created_by: user.id,
      name,
      is_default: isDefault,
      is_snapshot: isSnapshot,
      scope,
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
