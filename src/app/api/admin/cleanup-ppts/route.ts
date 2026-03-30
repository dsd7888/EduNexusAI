import { createAdminClient, createServerClient } from "@/lib/db/supabase-server";
import type { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const adminClient = createAdminClient();
    const { data: profile } = await adminClient
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    const role = (profile as { role?: string } | null)?.role;
    if (role !== "superadmin") {
      return Response.json({ error: "Forbidden: Superadmin only" }, { status: 403 });
    }

    const { data: rows } = await adminClient
      .from("generated_content")
      .select("id, file_path, metadata")
      .eq("type", "ppt")
      .not("file_path", "is", null);

    let deleted = 0;
    const now = new Date();

    for (const row of rows ?? []) {
      const expiresAt = (row.metadata as Record<string, unknown> | null)?.expires_at;
      if (!expiresAt) continue;
      if (new Date(expiresAt as string) > now) continue;

      if (row.file_path) {
        await adminClient.storage
          .from("generated-content")
          .remove([row.file_path]);
      }

      await adminClient
        .from("generated_content")
        .update({
          file_path: null,
          metadata: { ...(row.metadata as object), cleaned_up: true },
        })
        .eq("id", row.id);

      deleted++;
    }

    console.log(`[cleanup-ppts] Deleted ${deleted} expired presentation(s)`);
    return Response.json({ deleted });
  } catch (err) {
    console.error("[cleanup-ppts] Error:", err);
    return Response.json({ error: "Cleanup failed" }, { status: 500 });
  }
}
