import {
  generatePPTXBuffer,
  type PPTSlideJSON,
  type SlideContent,
} from "@/lib/ppt/generator";
import { generateImagenImage, buildImagenPrompt } from "@/lib/ai/imagen";
import {
  createAdminClient,
  createServerClient,
} from "@/lib/db/supabase-server";
import { requireAuth, requireRole, apiError, apiSuccess } from "@/lib/api/helpers";
import { backfillRelatedContentId } from "@/lib/ai/costLogger";
import { calculateImageCostInr } from "@/lib/ai/pricing";
import type { AILogContext } from "@/lib/ai/providers/types";
import type { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  try {
    console.log("[ppt/build] POST request received");

    // Fire-and-forget cleanup of expired PPTs
    void fetch(
      new URL("/api/admin/cleanup-ppts", request.url).toString(),
      { method: "POST" }
    ).catch(() => {});

    const authResult = await requireRole(["faculty", "superadmin", "dean", "hod"]);
    if (authResult instanceof Response) return authResult;
    const { user, profile, adminClient } = authResult;

    const body = await request.json().catch(() => ({} as Record<string, unknown>));
    const subjectId = String(body?.subjectId ?? "").trim();
    // contentId of the checkpoint row created by the outline route. When
    // present, build finalizes (UPDATEs) that row instead of inserting a new
    // one (Task 3). Absent only for legacy/edge callers.
    const contentId = String(body?.contentId ?? "").trim() || null;
    const presentationTitle = String(body?.presentationTitle ?? "").trim();
    const subject = String(body?.subject ?? "").trim();
    const topic = String(body?.topic ?? "").trim();
    // This route does not call routeAI directly (outline/batches are separate routes).
    // The frontend forwards the accumulated TEXT-MODEL spend from the outline +
    // batch routes. NOTE: this number now includes Pro spend from intricate
    // diagrams and Flash→Pro escalations — it is NOT Flash-only (see totalTextModelCost
    // labelling below; the old "Flash cost" label under-counted real spend).
    const totalTextModelCost =
      typeof body?.totalFlashCostInr === "number"
        ? Number(body.totalFlashCostInr)
        : Array.isArray(body?.batchCostsInr)
          ? (body.batchCostsInr as unknown[])
              .map((x) => Number(x))
              .filter((n) => Number.isFinite(n))
              .reduce((a, b) => a + b, 0)
          : 0;
    // Optional per-path breakdown forwarded from the batch route's costByPath
    // telemetry (merged client-side). Logged when present so a deck's spend can
    // be split flash-direct / flash-failed-escalated-to-pro / pro-direct.
    const costByPath =
      body?.costByPath && typeof body.costByPath === "object"
        ? (body.costByPath as Record<string, { costInr?: number; timeMs?: number }>)
        : null;
    const addLogo = Boolean(body?.addLogo);
    const logoUrl =
      typeof body?.logoUrl === "string" ? body.logoUrl : "";
    const slidesRaw = body?.slides;
    const slides: SlideContent[] = Array.isArray(slidesRaw)
      ? (slidesRaw as SlideContent[])
      : [];

    if (!subjectId) {
      return apiError("subjectId is required", 400);
    }
    if (!presentationTitle) {
      return apiError("presentationTitle is required", 400);
    }
    if (slides.length === 0) {
      return apiError(
        "slides array is required and must not be empty",
        400
      );
    }

    const { data: subjectRow } = await adminClient
      .from("subjects")
      .select("code")
      .eq("id", subjectId)
      .maybeSingle();
    const subjectCode =
      typeof (subjectRow as { code?: unknown } | null)?.code === "string"
        ? ((subjectRow as { code: string }).code || null)
        : null;

    // ── Failed-slide guard (Task 1) ──────────────────────────────────────────
    // The batch route flags slides it could not generate (after in-loop parse
    // retries AND a whole-batch regenerate) with `_failed: true`; the frontend
    // stamps the same flag on placeholders when a batch request errors outright.
    // Either way the flag arrives here. A deck must never SILENTLY ship with a
    // failed TITLE slide — a "Content generation failed" title is a broken deck —
    // so abort loudly in that case. Non-title failures (overview/concept/etc.)
    // are recoverable via the Refine page, so warn loudly but proceed.
    const failedSlides = slides
      .map((s, idx) => ({ s: s as SlideContent & { _failed?: boolean }, idx }))
      .filter(({ s }) => s?._failed === true);
    if (failedSlides.length > 0) {
      const failedDesc = failedSlides
        .map(({ s, idx }) => `#${idx}(${s.type})"${String(s.title ?? "").slice(0, 40)}"`)
        .join(" | ");
      const titleFailed = failedSlides.some(({ s }) => s.type === "title");
      if (titleFailed) {
        console.error(
          `[ppt/build][abort] Refusing to ship a deck with a failed TITLE slide. Failed slides: ${failedDesc}`
        );
        return apiError(
          "Presentation generation failed on the title slide and was not shipped. Please regenerate.",
          502
        );
      }
      console.warn(
        `[ppt/build] Shipping deck with ${failedSlides.length} failed placeholder slide(s) — regenerate via Refine: ${failedDesc}`
      );
    }

    // Post-process: generate Imagen images for slides that need it
    const imagenSlides = slides
      .map((slide, idx) => ({ slide, idx }))
      .filter(
        (
          x
        ): x is {
          slide: SlideContent & { type: "diagram" | "dual_visual" };
          idx: number;
        } => {
          const slide = x.slide as SlideContent;
          if (
            slide == null ||
            typeof slide !== "object" ||
            !slide.imagenPrompt ||
            slide.imageBase64
          ) {
            return false;
          }
          if (slide.type === "diagram") {
            return (
              slide.diagramRenderType === "imagen" ||
              slide.diagramRenderType === "illustration"
            );
          }
          if (slide.type === "dual_visual") {
            return true;
          }
          return false;
        }
      );

    let totalImagenCost = 0;
    const imagenJobId = contentId ?? crypto.randomUUID();
    const imagenLogContext: AILogContext = {
      userId: user.id,
      userEmail: user.email ?? null,
      userRole: profile.role,
      subjectId,
      subjectCode,
      jobId: imagenJobId,
      relatedContentId: contentId,
      feature: "ppt_generation",
    };

    if (imagenSlides.length > 0) {
      console.log(`[ppt/build] Generating ${imagenSlides.length} Imagen image(s)`);

      const imagenResults = await Promise.allSettled(
        imagenSlides.map(async ({ slide, idx }) => {
          const fullPrompt = buildImagenPrompt({
            slideTitle: slide.title,
            subject: subject || presentationTitle,
            topic: topic || presentationTitle,
            imagenPrompt: slide.imagenPrompt!,
            renderHint:
              slide.type === "dual_visual"
                ? "dual"
                : slide.diagramRenderType ?? null,
          });
          // Intricate diagrams earn the higher-fidelity Pro image model; the
          // diagramComplexity tag rides along on the slide from the batch route.
          const complexity = slide.diagramComplexity ?? "standard";
          const imageBase64 = await generateImagenImage(fullPrompt, {
            complexity,
            logContext: {
              ...imagenLogContext,
              metadata: {
                slideIndex: idx,
                renderHint:
                  slide.type === "dual_visual"
                    ? "dual"
                    : slide.diagramRenderType ?? null,
                diagramComplexity: complexity,
              },
            },
          });

          if (imageBase64) {
            // Image cost estimate: Pro image tier (~$0.10) costs more than the
            // Flash tier (~$0.02–0.04); use a per-tier estimate, not one bucket.
            const { costInr: imagenCostInr } = calculateImageCostInr(
              complexity,
              1
            );
            totalImagenCost += imagenCostInr;
            console.log(
              `[ppt/imagen] Slide image cost (tier=${complexity}): ₹${imagenCostInr.toFixed(2)}`
            );
          }

          return { idx, imageBase64 };
        })
      );

      for (const result of imagenResults) {
        if (result.status === "fulfilled" && result.value.imageBase64) {
          slides[result.value.idx] = {
            ...slides[result.value.idx],
            imageBase64: result.value.imageBase64,
          };
          console.log(`[ppt/build] Imagen image generated for slide ${result.value.idx}`);
        } else {
          const reason =
            result.status === "rejected"
              ? result.reason
              : "returned null";
          console.warn(`[ppt/build] Imagen failed for a slide — will use fallback: ${reason}`);
        }
      }
    }

    const pptData: PPTSlideJSON = {
      presentationTitle,
      subject: subject || presentationTitle,
      topic: topic || presentationTitle,
      slides,
      aiLogContext: imagenLogContext,
      addLogo,
      logoUrl: logoUrl || undefined,
    };

    const buffer = await generatePPTXBuffer(pptData);
    console.log("[ppt/build] PPTX buffer generated, uploading...");
    if (totalTextModelCost > 0 || totalImagenCost > 0) {
      console.log(
        `[ppt] Generation complete — Text-model (Flash+Pro) cost: ₹${totalTextModelCost.toFixed(4)}, Image cost: ₹${totalImagenCost.toFixed(2)}, TOTAL: ₹${(totalTextModelCost + totalImagenCost).toFixed(2)}`
      );
      if (costByPath) {
        for (const [path, s] of Object.entries(costByPath)) {
          console.log(
            `[ppt][cost-by-path] path=${path} costInr=₹${Number(s?.costInr ?? 0).toFixed(4)} timeMs=${Number(s?.timeMs ?? 0)}`
          );
        }
      }
    }

    const subjectSlug = (pptData.subject ?? "subject")
      .replace(/[^a-zA-Z0-9]/g, "_")
      .replace(/_+/g, "_")
      .slice(0, 20);

    const topicSlug = (pptData.topic ?? "presentation")
      .replace(/[^a-zA-Z0-9]/g, "_")
      .replace(/_+/g, "_")
      .slice(0, 25);

    const date = new Date().toISOString().slice(0, 10);
    const fileName = `${subjectSlug}_${topicSlug}_${date}.pptx`;
    const filePath = `presentations/tmp/${fileName}`;
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    const { error: uploadError } = await adminClient.storage
      .from("generated-content")
      .upload(filePath, new Uint8Array(buffer), {
        contentType:
          "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        upsert: true,
        metadata: {
          created_at: new Date().toISOString(),
          expires_at: expiresAt,
          user_id: user.id,
        },
      });

    if (uploadError) {
      console.error("[ppt/build] Upload error:", uploadError);
      return apiError("Failed to store presentation", 500);
    }

    const { data: signedData, error: signedError } = await adminClient.storage
      .from("generated-content")
      .createSignedUrl(filePath, 86400);

    if (signedError || !signedData) {
      return apiError("Failed to get download URL", 500);
    }

    // Finalize the checkpoint row from the outline route (Task 3): UPDATE in
    // place rather than INSERT a new row, so the resumable record becomes the
    // completed record. Fall back to INSERT only if no contentId was supplied
    // (legacy callers) or the row has gone missing.
    let finalContentId: string | null = null;

    if (contentId) {
      const { data: existing } = await adminClient
        .from("generated_content")
        .select("id, generated_by, metadata")
        .eq("id", contentId)
        .eq("type", "ppt")
        .maybeSingle();

      const existingRow = existing as
        | {
            id: string;
            generated_by: string;
            metadata: Record<string, unknown> | null;
          }
        | null;

      if (existingRow && existingRow.generated_by === user.id) {
        const prevMeta = (existingRow.metadata ?? {}) as Record<string, unknown>;
        const { error: updateError } = await adminClient
          .from("generated_content")
          .update({
            title: pptData.presentationTitle,
            file_path: filePath,
            metadata: {
              ...prevMeta,
              fileName,
              presentationTitle,
              slideCount: pptData.slides.length,
              subject,
              topic,
              slides,
              expires_at: expiresAt,
              // Prefer the server-accumulated text-model cost from checkpoints;
              // fall back to the value the client passed if it is somehow larger.
              // (Metadata key kept as totalFlashCostInr for resume compatibility,
              // but the value is total text-model spend, Flash + Pro.)
              totalFlashCostInr: Math.max(
                typeof prevMeta.totalFlashCostInr === "number"
                  ? prevMeta.totalFlashCostInr
                  : 0,
                totalTextModelCost
              ),
              totalImagenCostInr: totalImagenCost,
              totalCostInr:
                (typeof prevMeta.totalFlashCostInr === "number"
                  ? Math.max(prevMeta.totalFlashCostInr, totalTextModelCost)
                  : totalTextModelCost) + totalImagenCost,
            },
            status: "completed",
          })
          .eq("id", contentId);

        if (updateError) {
          console.error("[ppt/build] Finalize update error:", updateError);
          return apiError("Failed to record generated content", 500);
        }
        finalContentId = contentId;
      }
    }

    if (!finalContentId) {
      const { data: insertedRow, error: insertError } = await adminClient
        .from("generated_content")
        .insert({
          subject_id: subjectId,
          module_id: null,
          type: "ppt",
          title: pptData.presentationTitle,
          file_path: filePath,
          metadata: {
            fileName,
            presentationTitle,
            slideCount: pptData.slides.length,
            subject,
            topic,
            slides,
            expires_at: expiresAt,
            totalFlashCostInr: totalTextModelCost,
            totalImagenCostInr: totalImagenCost,
            totalCostInr: totalTextModelCost + totalImagenCost,
          },
          generated_by: user.id,
          status: "completed",
        })
        .select("id")
        .single();

      if (insertError || !insertedRow) {
        console.error("[ppt/build] Insert error:", insertError);
        return apiError("Failed to record generated content", 500);
      }
      finalContentId = insertedRow.id;
    }

    if (!contentId && totalImagenCost > 0 && finalContentId) {
      await backfillRelatedContentId(imagenJobId, finalContentId);
    }

    console.log("[ppt/build] Done.", fileName);

    return Response.json({
      downloadUrl: signedData.signedUrl,
      title: presentationTitle,
      slideCount: slides.length,
      fileName,
      contentId: finalContentId,
    });
  } catch (err) {
    console.error("[ppt/build] Error:", err);
    const message =
      err instanceof Error ? err.message : "Failed to build presentation";
    return apiError(message, 500);
  }
}
