import {
  createAdminClient,
  createServerClient,
} from "@/lib/db/supabase-server";

type RouteContext = {
  params: Promise<{ contentId: string }>;
};

export async function GET(_request: Request, { params }: RouteContext) {
  try {
    const { contentId } = await params;
    console.log("[ppt/content] GET", contentId);

    const supabase = createAdminClient();
    const serverClient = await createServerClient();

    const {
      data: { user },
    } = await serverClient.auth.getUser();

    if (!user) {
      console.log("[ppt/content] user: <none>");
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    const profileRow = profile as { role: string } | null;
    console.log(
      "[ppt/content] user:",
      user.id,
      "role:",
      profileRow?.role
    );

    if (
      !profileRow ||
      !["faculty", "superadmin"].includes(profileRow.role)
    ) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }

    const { data, error } = await supabase
      .from("generated_content")
      .select("id, title, metadata, subject_id, generated_by, status")
      .eq("id", contentId)
      .eq("status", "completed")
      .single();

    console.log(
      "[ppt/content] row found:",
      !!data,
      "error:",
      error?.message
    );

    if (error || !data) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }

    const row = data as {
      id: string;
      title: string;
      metadata: Record<string, unknown> | null;
      subject_id: string;
      generated_by: string;
      status?: string;
    };

    if (profileRow.role === "faculty" && row.generated_by !== user.id) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }

    const metadata = row.metadata ?? {};
    const slides = (metadata as { slides?: unknown }).slides;

    console.log(
      "[ppt/content] slides count:",
      Array.isArray(slides) ? slides.length : 0
    );

    if (!slides || !Array.isArray(slides) || slides.length === 0) {
      return Response.json(
        {
          error:
            "Slide data not available. This presentation was generated before refinement was supported.",
        },
        { status: 400 }
      );
    }

    const meta = metadata as {
      presentationTitle?: string;
      subject?: string;
      topic?: string;
    };

    return Response.json({
      contentId: row.id,
      title: row.title,
      presentationTitle: meta.presentationTitle ?? row.title,
      subject: meta.subject ?? "",
      topic: meta.topic ?? "",
      slides,
    });
  } catch (err) {
    console.error("[ppt/content/:contentId] Error:", err);
    const message =
      err instanceof Error ? err.message : "Failed to fetch content";
    return Response.json({ error: message }, { status: 500 });
  }
}
