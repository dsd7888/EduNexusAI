import {
  buildOutlinePrompt,
  buildBatchContentPrompt,
  generatePPTXBuffer,
  parseOutlineResponse,
  parseBatchContent,
  type PPTSlideJSON,
  type SlideContent,
} from "@/lib/ppt/generator";
import { routeAI } from "@/lib/ai/router";
import {
  createAdminClient,
  createServerClient,
} from "@/lib/db/supabase-server";
import type { NextRequest } from "next/server";

const VALID_DEPTHS = ["basic", "intermediate", "advanced"] as const;
type Depth = (typeof VALID_DEPTHS)[number];

export async function POST(request: NextRequest) {
  try {
    console.log("[ppt] POST request received");

    const supabase = await createServerClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      console.log("[ppt] Unauthorized: no user");
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const adminClient = createAdminClient();
    const { data: profile, error: profileError } = await adminClient
      .from("profiles")
      .select("id, role")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      console.error("[ppt] Profile fetch error:", profileError?.message);
      return Response.json(
        { error: "Failed to load profile" },
        { status: 500 }
      );
    }

    const role = (profile as { role?: string }).role;
    if (role !== "faculty" && role !== "superadmin") {
      console.log("[ppt] Forbidden: role", role);
      return Response.json(
        { error: "Forbidden: Faculty or Superadmin only" },
        { status: 403 }
      );
    }

    const body = await request.json().catch(() => ({} as Record<string, unknown>));
    const subjectId = String(body?.subjectId ?? "").trim();
    const moduleName =
      body?.moduleName != null ? String(body.moduleName).trim() || undefined : undefined;
    const customTopic =
      body?.customTopic != null ? String(body.customTopic).trim() || undefined : undefined;
    const depthRaw = String(body?.depth ?? "intermediate").toLowerCase();
    const depth: Depth = VALID_DEPTHS.includes(depthRaw as Depth)
      ? (depthRaw as Depth)
      : "intermediate";

    if (!subjectId) {
      return Response.json(
        { error: "subjectId is required" },
        { status: 400 }
      );
    }
    if (!moduleName && !customTopic) {
      return Response.json(
        { error: "At least one of moduleName or customTopic is required" },
        { status: 400 }
      );
    }

    console.log("[ppt] Fetching subject_content for subjectId:", subjectId);
    const { data: contentRow, error: contentError } = await adminClient
      .from("subject_content")
      .select("content")
      .eq("subject_id", subjectId)
      .maybeSingle();

    if (contentError) {
      console.error("[ppt] subject_content error:", contentError.message);
      return Response.json(
        { error: "Failed to load syllabus content" },
        { status: 500 }
      );
    }
    if (!contentRow) {
      console.log("[ppt] No subject_content found");
      return Response.json(
        { error: "Syllabus content not found for this subject" },
        { status: 404 }
      );
    }

    console.log("[ppt] Fetching subject name and code");
    const { data: subject, error: subjectError } = await adminClient
      .from("subjects")
      .select("id, name, code")
      .eq("id", subjectId)
      .single();

    if (subjectError || !subject) {
      console.log("[ppt] Subject not found");
      return Response.json(
        { error: "Subject not found" },
        { status: 404 }
      );
    }

    const subjectName = (subject as { name?: string }).name ?? "";
    const subjectCode = (subject as { code?: string }).code ?? "";
    const syllabusContent = String(
      (contentRow as { content?: string }).content ?? ""
    );

    // PHASE 1: Outline
    console.log("[ppt] Phase 1: Generating outline...");
    const outlinePrompt = buildOutlinePrompt({
      subjectName,
      subjectCode,
      syllabusContent,
      moduleName,
      customTopic,
      depth,
    });
    const outlineAi = await routeAI("ppt_gen", {
      messages: [{ role: "user", content: outlinePrompt }],
    });
    const outlineRaw = String(outlineAi.content ?? "");
    const outline = parseOutlineResponse(outlineRaw);
    if (!outline) {
      console.error("[ppt] Failed to parse outline JSON");
      return Response.json(
        { error: "Failed to generate outline" },
        { status: 500 }
      );
    }
    console.log(
      "[ppt] Phase 1 complete. Slides planned:",
      outline.outline.length
    );

    // PHASE 2: Content in batches
    console.log("[ppt] Phase 2: Generating slide content in batches...");
    const BATCH_SIZE = 8;
    const allSlides: SlideContent[] = [];

    for (let i = 0; i < outline.outline.length; i += BATCH_SIZE) {
      const batch = outline.outline.slice(i, i + BATCH_SIZE);
      const batchIndex = Math.floor(i / BATCH_SIZE) + 1;
      console.log(
        `[ppt] Batch ${batchIndex}: slides ${i + 1}-${i + batch.length}`
      );

      const batchPrompt = buildBatchContentPrompt({
        subjectName,
        syllabusContent,
        depth,
        slides: batch,
      });

      const batchAi = await routeAI("ppt_gen", {
        messages: [{ role: "user", content: batchPrompt }],
      });
      const batchRaw = String(batchAi.content ?? "");
      const batchContent = parseBatchContent(batchRaw);

      if (batchContent && Array.isArray(batchContent)) {
        allSlides.push(...batchContent);
        console.log(
          `[ppt] Batch ${batchIndex} complete, got ${batchContent.length} slides`
        );
      } else {
        console.error(`[ppt] Batch ${batchIndex} failed, skipping`);
      }

      if (i + BATCH_SIZE < outline.outline.length) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    console.log(
      "[ppt] Phase 2 complete. Total slides generated:",
      allSlides.length
    );

    const pptData: PPTSlideJSON = {
      presentationTitle: outline.presentationTitle,
      subject: outline.subject,
      topic: outline.topic,
      slides: allSlides,
    };

    const buffer = await generatePPTXBuffer(pptData);
    console.log("[ppt] PPTX buffer generated, uploading...");

    const fileName = `ppt_${Date.now()}_${user.id.slice(0, 8)}.pptx`;
    const filePath = `presentations/${fileName}`;

    const { error: uploadError } = await adminClient.storage
      .from("generated-content")
      .upload(filePath, buffer, {
        contentType:
          "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        upsert: false,
      });

    if (uploadError) {
      console.error("[ppt] Upload failed:", uploadError.message);
      return Response.json(
        { error: "Failed to upload presentation" },
        { status: 500 }
      );
    }

    const { data: urlData } = adminClient.storage
      .from("generated-content")
      .getPublicUrl(filePath);

    const topicLabel = (moduleName || customTopic) ?? "";
    await adminClient.from("generated_content").insert({
      subject_id: subjectId,
      module_id: null,
      type: "ppt",
      title: pptData.presentationTitle,
      file_path: filePath,
      metadata: {
        slideCount: pptData.slides.length,
        depth,
        topic: topicLabel,
        downloadUrl: urlData.publicUrl,
      },
      generated_by: user.id,
      status: "completed",
    });

    console.log("[ppt] Done. Download URL:", urlData.publicUrl);

    return Response.json({
      success: true,
      downloadUrl: urlData.publicUrl,
      title: pptData.presentationTitle,
      slideCount: pptData.slides.length,
    });
  } catch (err) {
    console.error("[ppt] Error:", err);
    const message =
      err instanceof Error ? err.message : "Failed to generate presentation";
    return Response.json({ error: message }, { status: 500 });
  }
}
