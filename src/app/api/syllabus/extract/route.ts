import type { NextRequest } from "next/server";
import { routeAI } from "@/lib/ai/router";
import { apiError, requireRole } from "@/lib/api/helpers";
import { parseExtractedSyllabus } from "@/lib/syllabus/parser";
import {
  SYLLABUS_EXTRACT_SYSTEM_PROMPT,
  SYLLABUS_EXTRACT_USER_PROMPT,
} from "@/lib/syllabus/prompts";

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

    const jobId = crypto.randomUUID();
    const ai = await routeAI("syllabus_extract", {
      systemPrompt: SYLLABUS_EXTRACT_SYSTEM_PROMPT,
      messages: [{ role: "user", content: SYLLABUS_EXTRACT_USER_PROMPT }],
      attachments: [{ mediaType: "application/pdf", data: base64Data }],
      logContext: {
        userId: user.id,
        userEmail: user.email ?? null,
        userRole: profile.role,
        subjectId,
        subjectCode: null,
        jobId,
        relatedContentId: null,
        feature: "syllabus",
      },
    });

    const raw = String(ai.content ?? "");
    console.log(`[syllabus/extract] raw length=${raw.length}`);
    const extracted = parseExtractedSyllabus(raw);

    if (!extracted) {
      console.error(
        "[syllabus/extract] All parse attempts failed. Preview:",
        raw.slice(0, 500)
      );
      return apiError("Failed to parse extracted syllabus", 500);
    }

    return Response.json({
      extracted,
      subject_id: subjectId,
      costInr: ai.costInr,
    });
  } catch (err) {
    console.error("[syllabus/extract] Error:", err);
    const message = err instanceof Error ? err.message : "Extraction failed";
    return apiError(message, 500);
  }
}
