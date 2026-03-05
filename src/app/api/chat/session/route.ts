import {
  createAdminClient,
  createServerClient,
} from "@/lib/db/supabase-server";
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

    const { data: profile, error: profileError } = await adminClient
      .from("profiles")
      .select("id, role")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      return Response.json(
        { error: "Failed to load profile" },
        { status: 500 }
      );
    }

    if ((profile as { role?: string }).role !== "student") {
      return Response.json(
        { error: "Forbidden: Students only" },
        { status: 403 }
      );
    }

    const body = await request.json().catch(() => ({} as any));
    const subjectId = String(body?.subjectId ?? "").trim();

    if (!subjectId) {
      return Response.json(
        { error: "subjectId is required" },
        { status: 400 }
      );
    }

    const { data, error: insertError } = await adminClient
      .from("chat_sessions")
      .insert({
        student_id: user.id,
        subject_id: subjectId,
      })
      .select("id")
      .single();

    if (insertError || !data) {
      console.error("[chat/session] insert error:", insertError);
      return Response.json(
        { error: "Failed to create session" },
        { status: 500 }
      );
    }

    return Response.json({ sessionId: data.id });
  } catch (err) {
    console.error("[chat/session] POST error:", err);
    const message =
      err instanceof Error ? err.message : "Failed to create chat session";
    return Response.json({ error: message }, { status: 500 });
  }
}

