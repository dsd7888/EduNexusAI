import { requireRole, apiError } from "@/lib/api/helpers";
import { generatePPSUPaperPDF, type AssembledPaper } from "@/lib/qpaper/builder";
import type { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireRole(["faculty", "superadmin", "dean", "hod"]);
    if (authResult instanceof Response) return authResult;
    const { user, adminClient } = authResult;

    const body = (await request.json()) as { paper?: AssembledPaper };
    if (!body.paper || !Array.isArray(body.paper.sections)) {
      return apiError("paper payload required", 400);
    }

    const pdfBuffer = await generatePPSUPaperPDF(body.paper);
    const fileName = `qpaper_${Date.now()}_${user.id.slice(0, 8)}.pdf`;
    const filePath = `qpapers/${fileName}`;

    const { error: uploadError } = await adminClient.storage
      .from("generated-content")
      .upload(filePath, pdfBuffer, { contentType: "application/pdf" });
    if (uploadError) {
      console.error("[qpaper/export] Upload failed:", uploadError.message);
      return apiError("Failed to upload PDF", 500);
    }

    const { data: urlData } = adminClient.storage
      .from("generated-content")
      .getPublicUrl(filePath);

    return Response.json({ success: true, downloadUrl: urlData.publicUrl });
  } catch (err) {
    console.error("[qpaper/export] error:", err);
    return apiError(
      err instanceof Error ? err.message : "Failed to export PDF",
      500
    );
  }
}
