import {
  buildQPaperPrompt,
  parseQPaperResponse,
  generateQPaperPDF,
  type QPaperConfig,
  type GeneratedQPaper,
} from "@/lib/qpaper/generator";
import { routeAI } from "@/lib/ai/router";
import {
  createAdminClient,
  createServerClient,
} from "@/lib/db/supabase-server";
import type { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  try {
    console.log("[qpaper] POST request received");

    const supabase = await createServerClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      console.log("[qpaper] Unauthorized: no user");
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const adminClient = createAdminClient();
    const { data: profile, error: profileError } = await adminClient
      .from("profiles")
      .select("id, role")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      console.error("[qpaper] Profile fetch error:", profileError?.message);
      return Response.json(
        { error: "Failed to load profile" },
        { status: 500 }
      );
    }

    const role = (profile as { role?: string }).role;
    if (role !== "faculty" && role !== "superadmin") {
      console.log("[qpaper] Forbidden: role", role);
      return Response.json(
        { error: "Forbidden: Faculty or Superadmin only" },
        { status: 403 }
      );
    }

    const body = await request.json().catch(() => ({} as any));
    const subjectId = String(body?.subjectId ?? "").trim();
    const config = body?.config as QPaperConfig | undefined;

    if (!subjectId) {
      return Response.json(
        { error: "subjectId is required" },
        { status: 400 }
      );
    }
    if (!config) {
      return Response.json(
        { error: "config is required" },
        { status: 400 }
      );
    }

    console.log("[qpaper] Fetching subject_content for subjectId:", subjectId);
    const { data: contentRow, error: contentError } = await adminClient
      .from("subject_content")
      .select("content")
      .eq("subject_id", subjectId)
      .maybeSingle();

    if (contentError) {
      console.error("[qpaper] subject_content error:", contentError.message);
      return Response.json(
        { error: "Failed to load syllabus content" },
        { status: 500 }
      );
    }
    if (!contentRow) {
      console.log("[qpaper] No subject_content found");
      return Response.json(
        { error: "Syllabus content not found for this subject" },
        { status: 404 }
      );
    }

    console.log("[qpaper] Fetching subject name and code");
    const { data: subject, error: subjectError } = await adminClient
      .from("subjects")
      .select("id, name, code")
      .eq("id", subjectId)
      .single();

    if (subjectError || !subject) {
      console.log("[qpaper] Subject not found");
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

    console.log("[qpaper] Fetching PYQ documents...");
    const { data: pyqDocs, error: pyqError } = await adminClient
      .from("documents")
      .select("id, title, file_path, year")
      .eq("subject_id", subjectId)
      .eq("type", "pyq")
      .eq("status", "ready")
      .order("year", { ascending: false })
      .limit(5);

    if (pyqError) {
      console.error("[qpaper] PYQ fetch error:", pyqError.message);
    }

    const docs = pyqDocs ?? [];
    console.log("[qpaper] Found PYQ documents:", docs.length);

    let pyqContext: string;
    if (docs.length > 0) {
      const titles = docs
        .map(
          (d: any) =>
            `${d.title ?? "Untitled"} (${d.year ?? "year N/A"})`
        )
        .join("; ");
      pyqContext =
        `Previous Year Questions available for this subject: ${titles}\n` +
        "Use these to understand the university exam style and question patterns.\n" +
        "Key insight: match the complexity, terminology and format of these papers.";
    } else {
      pyqContext =
        "No previous year questions uploaded yet. " +
        "Generate questions based on syllabus content and standard university examination patterns.";
    }

    const prompt = buildQPaperPrompt({
      config,
      syllabusContent,
      pyqContext,
      uniquenessMode: config.uniquenessMode,
    });

    console.log("[qpaper] Generating question paper...");
    const ai = await routeAI("qpaper_gen", {
      messages: [{ role: "user", content: prompt }],
    });
    const raw = String(ai.content ?? "");

    const paper = parseQPaperResponse(raw);
    if (!paper) {
      return Response.json(
        { error: "Failed to parse generated question paper" },
        { status: 500 }
      );
    }

    const totalQuestions = paper.sections.reduce(
      (acc, s) => acc + s.questions.length,
      0
    );
    console.log("[qpaper] Generated", totalQuestions, "questions");

    const pdfBuffer = await generateQPaperPDF(paper as GeneratedQPaper);

    const fileName = `qpaper_${Date.now()}_${user.id.slice(0, 8)}.pdf`;
    const filePath = `qpapers/${fileName}`;

    const { error: uploadError } = await adminClient.storage
      .from("generated-content")
      .upload(filePath, pdfBuffer, {
        contentType: "application/pdf",
      });

    if (uploadError) {
      console.error("[qpaper] Upload failed:", uploadError.message);
      return Response.json(
        { error: "Failed to upload question paper" },
        { status: 500 }
      );
    }

    const { data: urlData } = adminClient.storage
      .from("generated-content")
      .getPublicUrl(filePath);

    await adminClient.from("generated_content").insert({
      subject_id: subjectId,
      module_id: null,
      type: "qpaper",
      title: paper.title,
      file_path: filePath,
      metadata: {
        totalMarks: paper.totalMarks,
        totalQuestions,
        sections: paper.sections.length,
        uniquenessMode: config.uniquenessMode,
        downloadUrl: urlData.publicUrl,
      },
      generated_by: user.id,
      status: "completed",
    });

    return Response.json({
      success: true,
      paper,
      downloadUrl: urlData.publicUrl,
      totalQuestions,
    });
  } catch (err) {
    console.error("[qpaper] Error:", err);
    const message =
      err instanceof Error ? err.message : "Failed to generate question paper";
    return Response.json({ error: message }, { status: 500 });
  }
}

