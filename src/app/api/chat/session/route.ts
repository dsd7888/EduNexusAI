import {
  createAdminClient,
  createServerClient,
} from "@/lib/db/supabase-server";
import type { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
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

  if ((profile as { role?: string } | null)?.role !== "student") {
    return Response.json({ error: "Forbidden: Students only" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({} as { subjectId?: string }));
  const subjectId = String(body?.subjectId ?? "").trim();

  if (!subjectId) {
    return Response.json({ error: "subjectId is required" }, { status: 400 });
  }

  const { data, error } = await adminClient
    .from("chat_sessions")
    .insert({
      student_id: user.id,
      subject_id: subjectId,
    })
    .select("id")
    .single();

  if (error || !data) {
    return Response.json({ error: "Failed to create session" }, { status: 500 });
  }

  return Response.json({ sessionId: data.id });
}

