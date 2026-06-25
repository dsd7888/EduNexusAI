import { requireRole, apiError } from "@/lib/api/helpers";
import type { NextRequest } from "next/server";

const PAGE_SIZE = 20;

export async function GET(request: NextRequest) {
  try {
    const authResult = await requireRole(["faculty", "superadmin", "dean", "hod"]);
    if (authResult instanceof Response) return authResult;
    const { user, adminClient } = authResult;

    const url = new URL(request.url);
    const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10));
    const from = (page - 1) * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    const { data, error, count } = await adminClient
      .from("generated_content")
      .select("id, title, metadata, created_at, status", { count: "exact" })
      .eq("type", "ppt")
      .eq("generated_by", user.id)
      .order("created_at", { ascending: false })
      .range(from, to);

    if (error) {
      console.error("[ppt/history] query error:", error);
      return apiError("Failed to load history", 500);
    }

    const rows = (data ?? []).map((row) => {
      const meta = (row.metadata ?? {}) as Record<string, unknown>;
      return {
        id: row.id as string,
        title: row.title as string,
        subject: (meta.subject as string | undefined) ?? null,
        topic: (meta.topic as string | undefined) ?? null,
        slideCount: (meta.slideCount as number | undefined) ?? null,
        created_at: row.created_at as string,
        status: row.status as string,
      };
    });

    return Response.json({ rows, total: count ?? 0, page, pageSize: PAGE_SIZE });
  } catch (err) {
    console.error("[ppt/history] error:", err);
    return apiError("Internal server error", 500);
  }
}
