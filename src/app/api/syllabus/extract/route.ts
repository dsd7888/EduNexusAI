import type { NextRequest } from "next/server";
import { apiError, requireRole } from "@/lib/api/helpers";
import { extractSyllabusFromPdf } from "@/lib/syllabus/extract";

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireRole(["superadmin"]);
    if (authResult instanceof Response) return authResult;
    const { user, profile } = authResult;

    const formData = await request.formData();
    const pdf = formData.get("pdf") as File | null;
    const subjectId = String(formData.get("subject_id") ?? "").trim();

    if (!subjectId) return apiError("subject_id is required", 400);
    if (!pdf || !(pdf instanceof File) || pdf.size === 0) {
      return apiError("PDF file is required", 400);
    }
    if (pdf.type !== "application/pdf") {
      return apiError("Only PDF files are accepted", 400);
    }

    const arrayBuffer = await pdf.arrayBuffer();
    const base64Data = Buffer.from(arrayBuffer).toString("base64");
    console.log(
      `[syllabus/extract] subject=${subjectId} pdfBytes=${arrayBuffer.byteLength}`
    );

    const { extracted, costInr } = await extractSyllabusFromPdf(base64Data, {
      userId: user.id,
      userEmail: user.email ?? null,
      userRole: profile.role,
      subjectId,
      subjectCode: null,
    });

    if (!extracted) {
      return apiError("Failed to parse extracted syllabus", 500);
    }

    return Response.json({
      extracted,
      subject_id: subjectId,
      costInr,
    });
  } catch (err) {
    console.error("[syllabus/extract] Error:", err);
    const message = err instanceof Error ? err.message : "Extraction failed";
    return apiError(message, 500);
  }
}
