import { requireRole, apiError } from "@/lib/api/helpers";
import type { SlideContent, SlideOutline } from "@/lib/ppt/generator";
import type { NextRequest } from "next/server";

const TERMINAL_STATUSES = ["completed", "failed", "abandoned"];

/**
 * Most-recent non-terminal PPT generation for the current user (Task 4).
 * Powers the "Resume: N of M slides done" prompt on the generate page. Returns
 * everything the client needs to re-run only the unfinished batches and then
 * finalize the same row: the saved outline, the partially-filled slides array,
 * and the original generation parameters.
 */
export async function GET(_request: NextRequest) {
  try {
    const authResult = await requireRole([
      "faculty",
      "superadmin",
      "dean",
      "hod",
    ]);
    if (authResult instanceof Response) return authResult;
    const { user, adminClient } = authResult;

    const { data, error } = await adminClient
      .from("generated_content")
      .select("id, subject_id, module_id, title, metadata, status, created_at")
      .eq("type", "ppt")
      .eq("generated_by", user.id)
      .not("status", "in", `(${TERMINAL_STATUSES.join(",")})`)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error("[ppt/resumable] query error:", error);
      return apiError("Failed to load resumable generation", 500);
    }

    if (!data) {
      return Response.json({ resumable: null });
    }

    const row = data as {
      id: string;
      subject_id: string;
      module_id: string | null;
      title: string;
      metadata: Record<string, unknown> | null;
      status: string;
      created_at: string;
    };

    const meta = (row.metadata ?? {}) as Record<string, unknown>;
    const outline = meta.outline as SlideOutline | undefined;
    const slides = Array.isArray(meta.slides)
      ? (meta.slides as (SlideContent | null)[])
      : [];

    // A row with no usable outline can't be resumed; treat as nothing pending.
    if (!outline || !Array.isArray(outline.outline) || outline.outline.length === 0) {
      return Response.json({ resumable: null });
    }

    const slidesDone = slides.filter((s) => s != null).length;

    return Response.json({
      resumable: {
        contentId: row.id,
        subjectId: row.subject_id,
        moduleId: (meta.moduleId as string | null) ?? row.module_id ?? null,
        customTopic: (meta.customTopic as string | null) ?? null,
        depth: (meta.depth as string | undefined) ?? "intermediate",
        title: row.title,
        subject: (meta.subject as string | undefined) ?? "",
        topic: (meta.topic as string | undefined) ?? "",
        presentationTitle:
          (meta.presentationTitle as string | undefined) ?? row.title,
        outline,
        slides,
        slidesDone,
        slidesTotal: outline.outline.length,
        totalFlashCostInr:
          typeof meta.totalFlashCostInr === "number"
            ? meta.totalFlashCostInr
            : 0,
        status: row.status,
        created_at: row.created_at,
      },
    });
  } catch (err) {
    console.error("[ppt/resumable] error:", err);
    return apiError("Internal server error", 500);
  }
}
