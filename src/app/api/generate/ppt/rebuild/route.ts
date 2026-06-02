import {
  generatePPTXBuffer,
  type SlideContent,
} from "@/lib/ppt/generator";
import {
  createAdminClient,
  createServerClient,
} from "@/lib/db/supabase-server";
import type { NextRequest } from "next/server";

function normalizeForGenerator(
  slide: Record<string, unknown>
): Record<string, unknown> {
  if (slide.svg && !slide.svgCode) slide.svgCode = slide.svg;
  if (slide.mermaid && !slide.mermaidCode) slide.mermaidCode = slide.mermaid;

  if (!slide.example && slide.type === "example") {
    slide.example = {
      problem: slide.exampleProblem ?? slide.title ?? "",
      steps: slide.bullets ?? slide.steps ?? [],
      answer: slide.exampleAnswer ?? "",
    };
  }

  if (
    !slide.q &&
    slide.type === "practice" &&
    slide.question
  ) {
    slide.q = {
      text: slide.question,
      options: slide.options ?? [],
      answer: slide.answer ?? "",
      explanation: slide.explanation ?? "",
    };
  }

  return slide;
}

export async function POST(req: NextRequest) {
  try {
    // 1. Auth check — faculty or superadmin
    const supabase = createAdminClient();
    const serverClient = await createServerClient();

    const {
      data: { user },
    } = await serverClient.auth.getUser();

    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (
      !profile ||
      !["faculty", "superadmin"].includes((profile as { role: string }).role)
    ) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }

    const role = (profile as { role: string }).role;

    // 2. Parse body
    const body = await req
      .json()
      .catch(() => ({} as Record<string, unknown>));

    const contentId =
      typeof body?.contentId === "string" ? body.contentId.trim() : "";
    const slidesRaw = body?.slides;
    const slides: SlideContent[] = Array.isArray(slidesRaw)
      ? (slidesRaw as SlideContent[])
      : [];
    const presentationTitle =
      typeof body?.presentationTitle === "string"
        ? body.presentationTitle
        : "";
    const subject = typeof body?.subject === "string" ? body.subject : "";
    const topic = typeof body?.topic === "string" ? body.topic : "";

    if (!contentId || slides.length === 0) {
      return Response.json({ error: "Invalid request" }, { status: 400 });
    }
    if (slides.length > 60) {
      return Response.json(
        { error: "Presentation exceeds 60 slides maximum" },
        { status: 400 }
      );
    }

    // 3. Ownership check
    const { data: existing } = await supabase
      .from("generated_content")
      .select("generated_by")
      .eq("id", contentId)
      .single();

    if (!existing) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }

    const existingRow = existing as { generated_by: string };

    if (role === "faculty" && existingRow.generated_by !== user.id) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }

    // 4. Generate PPTX
    const normalizedSlides = slides.map((s) =>
      normalizeForGenerator(s as unknown as Record<string, unknown>)
    ) as unknown as SlideContent[];

    const buffer = await generatePPTXBuffer({
      presentationTitle: presentationTitle || "Refined Presentation",
      subject: subject || presentationTitle || "subject",
      topic: topic || presentationTitle || "topic",
      slides: normalizedSlides,
    });

    // 5. Upload to Supabase Storage
    const fileName = `ppt_refined_${Date.now()}_${contentId.slice(0, 8)}.pptx`;
    const filePath = `presentations/${fileName}`;

    const { error: uploadError } = await supabase.storage
      .from("generated-content")
      .upload(filePath, new Uint8Array(buffer), {
        contentType:
          "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        upsert: false,
      });

    if (uploadError) {
      console.error("[ppt/rebuild] Upload error:", uploadError);
      return Response.json(
        { error: "Failed to upload rebuilt presentation" },
        { status: 500 }
      );
    }

    const {
      data: { publicUrl },
    } = supabase.storage.from("generated-content").getPublicUrl(filePath);

    // 6. Update generated_content row (full metadata overwrite)
    await supabase
      .from("generated_content")
      .update({
        file_path: filePath,
        metadata: {
          presentationTitle,
          subject,
          topic,
          slideCount: slides.length,
          slides,
          lastRefinedAt: new Date().toISOString(),
        },
      })
      .eq("id", contentId);

    // 7. Return
    return Response.json({
      downloadUrl: publicUrl,
      slideCount: slides.length,
    });
  } catch (err) {
    console.error("[ppt/rebuild] Error:", err);
    const message =
      err instanceof Error ? err.message : "Failed to rebuild presentation";
    return Response.json({ error: message }, { status: 500 });
  }
}
