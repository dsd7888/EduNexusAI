import { apiError } from "@/lib/api/helpers";
import type { createAdminClient } from "@/lib/db/supabase-server";

type AdminClient = ReturnType<typeof createAdminClient>;

/** Faculty may only touch a subject they're assigned to; superadmin/dept_admin bypass. */
export async function assertSubjectAccess(
  adminClient: AdminClient,
  role: string,
  userId: string,
  subjectId: string
): Promise<Response | null> {
  if (role !== "faculty") return null;
  const { data: assignment } = await adminClient
    .from("faculty_assignments")
    .select("subject_id")
    .eq("faculty_id", userId)
    .eq("subject_id", subjectId)
    .maybeSingle();
  if (!assignment) {
    return apiError("Forbidden: subject is not assigned to this faculty", 403);
  }
  return null;
}
