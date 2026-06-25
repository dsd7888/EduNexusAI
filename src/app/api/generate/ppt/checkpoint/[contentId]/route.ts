import { requireRole, apiError } from "@/lib/api/helpers";
import type { SlideContent } from "@/lib/ppt/generator";
import type { NextRequest } from "next/server";

type RouteContext = {
  params: Promise<{ contentId: string }>;
};

// Statuses the client is allowed to advance a row through mid-generation.
const ADVANCE_STATUSES = [
  "generating_content",
  "generating_diagrams",
  "building",
] as const;
type AdvanceStatus = (typeof ADVANCE_STATUSES)[number];

const TERMINAL_STATUSES = ["completed", "failed", "abandoned"];

/**
 * Merge a freshly-completed batch of slides into an existing generated_content
 * checkpoint row (Task 2). Called after EVERY content batch and EVERY diagram
 * batch resolves (success or failure-placeholder), so worst-case loss on
 * interruption is one in-flight batch rather than the whole deck.
 *
 * Concurrency note: the client serializes these calls (one in flight at a time)
 * so the read-modify-write of metadata.slides cannot lose updates.
 */
export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const { contentId } = await params;

    const authResult = await requireRole([
      "faculty",
      "superadmin",
      "dean",
      "hod",
    ]);
    if (authResult instanceof Response) return authResult;
    const { user, profile, adminClient } = authResult;

    const body = await request
      .json()
      .catch(() => ({} as Record<string, unknown>));

    const slideIndices = Array.isArray(body?.slideIndices)
      ? (body.slideIndices as unknown[])
          .map((n) => Number(n))
          .filter((n) => Number.isInteger(n) && n >= 0)
      : [];
    const incomingSlides = Array.isArray(body?.slides)
      ? (body.slides as SlideContent[])
      : [];
    const costInr =
      typeof body?.costInr === "number" && Number.isFinite(body.costInr)
        ? body.costInr
        : 0;
    const statusRaw = String(body?.status ?? "");
    const status: AdvanceStatus | null = ADVANCE_STATUSES.includes(
      statusRaw as AdvanceStatus
    )
      ? (statusRaw as AdvanceStatus)
      : null;

    if (!status) {
      return apiError(
        `status must be one of: ${ADVANCE_STATUSES.join(", ")}`,
        400
      );
    }
    if (slideIndices.length !== incomingSlides.length) {
      return apiError(
        "slideIndices and slides must be the same length",
        400
      );
    }

    const { data: row, error: loadError } = await adminClient
      .from("generated_content")
      .select("id, generated_by, metadata, status")
      .eq("id", contentId)
      .eq("type", "ppt")
      .single();

    if (loadError || !row) {
      return apiError("Generation not found", 404);
    }

    const typedRow = row as {
      id: string;
      generated_by: string;
      metadata: Record<string, unknown> | null;
      status: string;
    };

    if (profile.role === "faculty" && typedRow.generated_by !== user.id) {
      return apiError("Forbidden", 403);
    }

    // Don't resurrect a finished/abandoned generation — a late batch from an
    // already-resumed-or-cleaned run must not flip it back to "generating".
    if (TERMINAL_STATUSES.includes(typedRow.status)) {
      return apiError(`Generation is already ${typedRow.status}`, 409);
    }

    const metadata = (typedRow.metadata ?? {}) as Record<string, unknown>;
    const slides: (SlideContent | null)[] = Array.isArray(metadata.slides)
      ? [...(metadata.slides as (SlideContent | null)[])]
      : [];

    // Merge each completed slide into its correct global index.
    slideIndices.forEach((globalIdx, k) => {
      if (globalIdx < slides.length) {
        slides[globalIdx] = incomingSlides[k] ?? slides[globalIdx];
      }
    });

    const prevCost =
      typeof metadata.totalFlashCostInr === "number"
        ? metadata.totalFlashCostInr
        : 0;

    const { error: updateError } = await adminClient
      .from("generated_content")
      .update({
        metadata: {
          ...metadata,
          slides,
          totalFlashCostInr: prevCost + costInr,
        },
        status,
      })
      .eq("id", contentId);

    if (updateError) {
      console.error("[ppt/checkpoint] update error:", updateError);
      return apiError("Failed to save checkpoint", 500);
    }

    const filled = slides.filter((s) => s != null).length;
    console.log(
      `[ppt/checkpoint] ${contentId} merged ${slideIndices.length} slide(s) → ${filled}/${slides.length}, status=${status}`
    );

    return Response.json({ ok: true, slidesDone: filled, slidesTotal: slides.length });
  } catch (err) {
    console.error("[ppt/checkpoint] error:", err);
    return apiError("Internal server error", 500);
  }
}
