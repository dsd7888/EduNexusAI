import { requireRole, apiError } from "@/lib/api/helpers";
import { generateQpaperDocx } from "@/lib/qpaper/docxBuilder";
import type { AssembledPaper } from "@/lib/qpaper/builder";
import type { NextRequest } from "next/server";

const DOCX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const SIGNED_URL_TTL = 3600; // 1 hour

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireRole(["faculty", "superadmin", "dean", "hod"]);
    if (authResult instanceof Response) return authResult;
    const { user, adminClient } = authResult;

    let body: { qpaper_content?: AssembledPaper; paper?: AssembledPaper; answerKey?: boolean };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return apiError("Invalid JSON body", 400);
    }

    const paper = body.qpaper_content ?? body.paper;
    if (!paper || !Array.isArray(paper.sections)) {
      return apiError("qpaper_content payload required", 400);
    }

    const answerKey = body.answerKey === true;
    const docxBuffer = await generateQpaperDocx(paper, { answerKey });

    const suffix = answerKey ? "answerkey" : "qpaper";
    const fileName = `${suffix}_${Date.now()}_${user.id.slice(0, 8)}.docx`;
    const filePath = `qpapers/${fileName}`;

    const { error: uploadError } = await adminClient.storage
      .from("generated-content")
      .upload(filePath, docxBuffer, { contentType: DOCX_CONTENT_TYPE });
    if (uploadError) {
      console.error("[qpaper/export-docx] Upload failed:", uploadError.message);
      return apiError("Failed to upload Word document", 500);
    }

    // Signed URL (1hr) — answer-key copies are confidential; keep them private.
    const { data: signed, error: signError } = await adminClient.storage
      .from("generated-content")
      .createSignedUrl(filePath, SIGNED_URL_TTL);
    if (signError || !signed) {
      console.error("[qpaper/export-docx] Sign failed:", signError?.message);
      return apiError("Failed to create download link", 500);
    }

    return Response.json({
      success: true,
      downloadUrl: signed.signedUrl,
      filePath,
    });
  } catch (err) {
    console.error("[qpaper/export-docx] error:", err);
    return apiError(
      err instanceof Error ? err.message : "Failed to export Word document",
      500
    );
  }
}
