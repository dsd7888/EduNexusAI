import type { NextRequest } from "next/server";
import { handleAssessmentRequest } from "@/lib/assessment/routeHandler";

/** POST /api/assessment/exam-sim — see routeHandler.ts (modes are thin config). */
export async function POST(request: NextRequest) {
  return handleAssessmentRequest(request, "exam_sim");
}
