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
import type { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  try {
    console.log("[ppt/build] POST request received");

    // Fire-and-forget cleanup of expired PPTs
    void fetch(
      new URL("/api/admin/cleanup-ppts", request.url).toString(),
      { method: "POST" }
    ).catch(() => {});

    const authResult = await requireRole(["faculty", "superadmin"]);
    if (authResult instanceof Response) return authResult;
    const { user, adminClient } = authResult;

    const body = await request.json().catch(() => ({} as Record<string, unknown>));
    const subjectId = String(body?.subjectId ?? "").trim();
    const presentationTitle = String(body?.presentationTitle ?? "").trim();
    const subject = String(body?.subject ?? "").trim();
    const topic = String(body?.topic ?? "").trim();
    // This route does not call routeAI directly (outline/batches are separate routes).
    // To log a closer-to-true total here, the frontend can pass accumulated Flash costs.
    const totalFlashCost =
      typeof (body as any)?.totalFlashCostInr === "number"
        ? Number((body as any).totalFlashCostInr)
        : Array.isArray((body as any)?.batchCostsInr)
          ? (body as any).batchCostsInr
              .map((x: unknown) => Number(x))
              .filter((n: number) => Number.isFinite(n))
              .reduce((a: number, b: number) => a + b, 0)
          : 0;
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
          const imageBase64 = await generateImagenImage(fullPrompt);

          if (imageBase64) {
            // Imagen cost estimate: ~$0.04 per image (imagen-4.0-fast) or
            // ~$0.02 (gemini-2.5-flash-image), use conservative estimate
            const imagenCostInr = 0.04 * 83.33; // ~₹3.33 per image
            totalImagenCost += imagenCostInr;
            console.log(
              `[ppt/imagen] Slide imagen cost: ₹${imagenCostInr.toFixed(2)}`
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
          console.warn("[ppt/build] Imagen failed for a slide — will use fallback");
        }
      }
    }

    const pptData: PPTSlideJSON = {
      presentationTitle,
      subject: subject || presentationTitle,
      topic: topic || presentationTitle,
      slides,
      addLogo,
      logoUrl: logoUrl || undefined,
    };

    const buffer = await generatePPTXBuffer(pptData);
    console.log("[ppt/build] PPTX buffer generated, uploading...");
    if (totalFlashCost > 0 || totalImagenCost > 0) {
      console.log(
        `[ppt] Generation complete — Flash cost: ₹${totalFlashCost.toFixed(4)}, Imagen cost: ₹${totalImagenCost.toFixed(2)}, TOTAL: ₹${(totalFlashCost + totalImagenCost).toFixed(2)}`
      );
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
          totalFlashCostInr: totalFlashCost,
          totalImagenCostInr: totalImagenCost,
          totalCostInr: totalFlashCost + totalImagenCost,
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

    console.log("[ppt/build] Done.", fileName);

    return Response.json({
      downloadUrl: signedData.signedUrl,
      title: presentationTitle,
      slideCount: slides.length,
      fileName,
      contentId: insertedRow.id,
    });
  } catch (err) {
    console.error("[ppt/build] Error:", err);
    const message =
      err instanceof Error ? err.message : "Failed to build presentation";
    return apiError(message, 500);
  }
}
