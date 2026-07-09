import { routeAI } from "@/lib/ai/router";
import { parseExtractedSyllabus } from "@/lib/syllabus/parser";
import {
  SYLLABUS_EXTRACT_SYSTEM_PROMPT,
  SYLLABUS_EXTRACT_USER_PROMPT,
} from "@/lib/syllabus/prompts";
import type { ExtractedSyllabus } from "@/lib/syllabus/types";

interface ExtractLogContext {
  userId: string;
  userEmail: string | null;
  userRole: string;
  subjectId: string;
  subjectCode: string | null;
}

/**
 * Runs the Gemini syllabus-extraction call against a base64-encoded PDF and parses the
 * result. Shared by the superadmin extract route and the faculty self-serve upload
 * route so the Gemini-calling logic lives in exactly one place.
 *
 * Returns { extracted: null } when the model output can't be parsed — callers decide
 * how to surface that (the superadmin route 500s; the faculty route rolls back the
 * subject row it created).
 */
export async function extractSyllabusFromPdf(
  base64Data: string,
  logContext: ExtractLogContext
): Promise<{ extracted: ExtractedSyllabus | null; costInr: number }> {
  const jobId = crypto.randomUUID();
  const ai = await routeAI("syllabus_extract", {
    systemPrompt: SYLLABUS_EXTRACT_SYSTEM_PROMPT,
    messages: [{ role: "user", content: SYLLABUS_EXTRACT_USER_PROMPT }],
    attachments: [{ mediaType: "application/pdf", data: base64Data }],
    logContext: {
      userId: logContext.userId,
      userEmail: logContext.userEmail,
      userRole: logContext.userRole,
      subjectId: logContext.subjectId,
      subjectCode: logContext.subjectCode,
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
  }

  return { extracted, costInr: ai.costInr };
}
