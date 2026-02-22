import {
  createAdminClient,
  createServerClientForRequestResponse,
} from "@/lib/db/supabase-server";
import { type NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  try {
    const response = NextResponse.next();
    const supabase = createServerClientForRequestResponse(request, response);
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const adminClient = createAdminClient();
    const { data: profile } = await adminClient
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (
      !profile ||
      !["superadmin", "faculty", "student"].includes(profile.role)
    ) {
      return NextResponse.json(
        { error: "Forbidden: superadmin, faculty, or student only" },
        { status: 403 }
      );
    }

    const subjectId = request.nextUrl.searchParams.get("subjectId");
    if (!subjectId) {
      return NextResponse.json(
        { error: "subjectId is required" },
        { status: 400 }
      );
    }

    const { data: row, error: fetchError } = await adminClient
      .from("subject_content")
      .select("content, reference_books")
      .eq("subject_id", subjectId)
      .maybeSingle();

    if (fetchError) {
      console.error("[subjects/content] GET error:", fetchError);
      return NextResponse.json(
        { error: fetchError.message },
        { status: 500 }
      );
    }

    if (!row) {
      return NextResponse.json(null);
    }

    return NextResponse.json({
      content: row.content ?? "",
      referenceBooks: row.reference_books ?? "",
    });
  } catch (err) {
    console.error("[subjects/content] GET error:", err);
    const message = err instanceof Error ? err.message : "Failed to fetch content";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const response = NextResponse.next();
    const supabase = createServerClientForRequestResponse(request, response);
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const adminClient = createAdminClient();
    const { data: profile } = await adminClient
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (!profile || profile.role !== "superadmin") {
      return NextResponse.json(
        { error: "Forbidden: Superadmin only" },
        { status: 403 }
      );
    }

    const body = await request.json();
    const subjectId = String(body?.subjectId ?? "").trim();
    const content = String(body?.content ?? "");
    const referenceBooks = String(body?.referenceBooks ?? "");

    if (!subjectId) {
      return NextResponse.json(
        { error: "subjectId is required" },
        { status: 400 }
      );
    }

    if (!content.trim()) {
      return NextResponse.json(
        { error: "content is required and cannot be empty" },
        { status: 400 }
      );
    }

    const { data: subject, error: subjError } = await adminClient
      .from("subjects")
      .select("id")
      .eq("id", subjectId)
      .single();

    if (subjError || !subject) {
      return NextResponse.json({ error: "Subject not found" }, { status: 404 });
    }

    const { data: existing } = await adminClient
      .from("subject_content")
      .select("subject_id")
      .eq("subject_id", subjectId)
      .maybeSingle();

    if (existing) {
      const { error: updateError } = await adminClient
        .from("subject_content")
        .update({
          content: content.trim(),
          reference_books: referenceBooks.trim(),
        })
        .eq("subject_id", subjectId);

      if (updateError) {
        console.error("[subjects/content] POST update error:", updateError);
        return NextResponse.json(
          { error: updateError.message },
          { status: 500 }
        );
      }
    } else {
      const { error: insertError } = await adminClient
        .from("subject_content")
        .insert({
          subject_id: subjectId,
          content: content.trim(),
          reference_books: referenceBooks.trim(),
          created_by: user.id,
        });

      if (insertError) {
        console.error("[subjects/content] POST insert error:", insertError);
        return NextResponse.json(
          { error: insertError.message },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({
      success: true,
      message: "Syllabus content saved",
    });
  } catch (err) {
    console.error("[subjects/content] POST error:", err);
    const message = err instanceof Error ? err.message : "Failed to save content";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
