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

    // Fire-and-forget cleanup of expired PPTs
    void fetch(
      new URL("/api/admin/cleanup-ppts", request.url).toString(),
      { method: "POST" }
    ).catch(() => {});

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
      return Response.json(
        { error: "Failed to store presentation" },
        { status: 500 }
      );
    }

    const { data: signedData, error: signedError } = await adminClient.storage
      .from("generated-content")
      .createSignedUrl(filePath, 86400);

    if (signedError || !signedData) {
      return Response.json(
        { error: "Failed to get download URL" },
        { status: 500 }
      );
    }

    await adminClient.from("generated_content").insert({
      subject_id: subjectId,
      module_id: null,
      type: "ppt",
      title: pptData.presentationTitle,
      file_path: filePath,
      metadata: {
        fileName,
        slideCount: pptData.slides.length,
        subject,
        topic,
        slides,
        expires_at: expiresAt,
      },
      generated_by: user.id,
      status: "ready",
    });

    console.log("[ppt/build] Done.", fileName);

    return Response.json({
      downloadUrl: signedData.signedUrl,
      title: presentationTitle,
      slideCount: slides.length,
      fileName,
    });
  } catch (err) {
    console.error("[ppt/build] Error:", err);
    const message =
      err instanceof Error ? err.message : "Failed to build presentation";
    return Response.json({ error: message }, { status: 500 });
  }
}
