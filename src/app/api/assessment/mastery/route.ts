import type { NextRequest } from "next/server";
import { handleAssessmentRequest } from "@/lib/assessment/routeHandler";

/** POST /api/assessment/mastery — see routeHandler.ts (modes are thin config). */
export async function POST(request: NextRequest) {
  return handleAssessmentRequest(request, "mastery");
}
