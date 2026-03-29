import {
  generatePPTXBuffer,
  type PPTSlideJSON,
  type SlideContent,
} from "@/lib/ppt/generator";
import {
  createAdminClient,
  createServerClient,
} from "@/lib/db/supabase-server";
import type { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  try {
    console.log("[ppt/build] POST request received");

    const supabase = await createServerClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const adminClient = createAdminClient();
    const { data: profile, error: profileError } = await adminClient
      .from("profiles")
      .select("id, role")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      return Response.json(
        { error: "Failed to load profile" },
        { status: 500 }
      );
    }

    const role = (profile as { role?: string }).role;
    if (role !== "faculty" && role !== "superadmin") {
      return Response.json(
        { error: "Forbidden: Faculty or Superadmin only" },
        { status: 403 }
      );
    }

    const body = await request.json().catch(() => ({} as Record<string, unknown>));
    const subjectId = String(body?.subjectId ?? "").trim();
    const presentationTitle = String(body?.presentationTitle ?? "").trim();
    const subject = String(body?.subject ?? "").trim();
    const topic = String(body?.topic ?? "").trim();
    const addLogo = Boolean(body?.addLogo);
    const logoUrl =
      typeof body?.logoUrl === "string" ? body.logoUrl : "";
    const slidesRaw = body?.slides;
    const slides: SlideContent[] = Array.isArray(slidesRaw)
      ? (slidesRaw as SlideContent[])
      : [];

    if (!subjectId) {
      return Response.json(
        { error: "subjectId is required" },
        { status: 400 }
      );
    }
    if (!presentationTitle) {
      return Response.json(
        { error: "presentationTitle is required" },
        { status: 400 }
      );
    }
    if (slides.length === 0) {
      return Response.json(
        { error: "slides array is required and must not be empty" },
        { status: 400 }
      );
    }

    const pptData: PPTSlideJSON = {
      presentationTitle,
      subject: subject || presentationTitle,
      topic: topic || presentationTitle,
      slides,
      addLogo: addLogo ?? false,
      logoUrl: logoUrl ?? "",
    };

    const buffer = await generatePPTXBuffer(pptData);
    console.log("[ppt/build] PPTX buffer generated, uploading...");

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
      console.error("[ppt/build] Upload failed:", uploadError.message);
      return Response.json(
        { error: "Failed to upload presentation" },
        { status: 500 }
      );
    }

    const { data: urlData } = adminClient.storage
      .from("generated-content")
      .getPublicUrl(filePath);

    await adminClient.from("generated_content").insert({
      subject_id: subjectId,
      module_id: null,
      type: "ppt",
      title: pptData.presentationTitle,
      file_path: filePath,
      metadata: {
        slideCount: pptData.slides.length,
        topic,
        downloadUrl: urlData.publicUrl,
      },
      generated_by: user.id,
      status: "completed",
    });

    console.log("[ppt/build] Done. Download URL:", urlData.publicUrl);

    return Response.json({
      success: true,
      downloadUrl: urlData.publicUrl,
      title: presentationTitle,
      slideCount: slides.length,
    });
  } catch (err) {
    console.error("[ppt/build] Error:", err);
    const message =
      err instanceof Error ? err.message : "Failed to build presentation";
    return Response.json({ error: message }, { status: 500 });
  }
}
