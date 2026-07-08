import type { NextRequest } from "next/server";
import { requireRole, apiError, apiSuccess } from "@/lib/api/helpers";
import { getPerFaculty, type FacultyRow } from "@/lib/pilot-analysis/queries";

// GET /api/pilot-analysis/per-faculty?sort=cost|hours|failures|name
// One row per faculty (zero-activity faculty included as zero rows). Superadmin only.
export async function GET(request: NextRequest) {
  const auth = await requireRole(["superadmin"]);
  if (auth instanceof Response) return auth;
  try {
    const rows = await getPerFaculty(auth.adminClient);
    const sort = request.nextUrl.searchParams.get("sort");
    const sorted = [...rows];
    switch (sort) {
      case "cost":
        sorted.sort((a, b) => b.totalCostInr - a.totalCostInr);
        break;
      case "hours":
        sorted.sort((a, b) => b.hoursUsed - a.hoursUsed);
        break;
      case "failures":
        sorted.sort((a, b) => b.failureCount - a.failureCount);
        break;
      case "name":
      default:
        sorted.sort((a, b) => a.name.localeCompare(b.name));
    }
    return apiSuccess({ faculty: sorted as FacultyRow[] });
  } catch (err) {
    console.error("[pilot-analysis/per-faculty]", err);
    return apiError("Failed to load per-faculty data", 500);
  }
}
