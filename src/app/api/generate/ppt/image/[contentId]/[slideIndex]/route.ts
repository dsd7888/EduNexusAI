import {
  createAdminClient,
  createServerClient,
} from "@/lib/db/supabase-server";

type RouteContext = {
  params: Promise<{ contentId: string; slideIndex: string }>;
};

export async function GET(_request: Request, { params }: RouteContext) {
  try {
    const { contentId, slideIndex: slideIndexStr } = await params;
    const slideIndex = parseInt(slideIndexStr, 10);

    if (!contentId || isNaN(slideIndex) || slideIndex < 0) {
      return Response.json({ error: "Invalid request" }, { status: 400 });
    }

    const supabase = createAdminClient();
    const serverClient = await createServerClient();

    const {
      data: { user },
    } = await serverClient.auth.getUser();

    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    const profileRow = profile as { role: string } | null;

    if (
      !profileRow ||
      !["faculty", "superadmin", "dean", "hod"].includes(profileRow.role)
    ) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }

    const { data, error } = await supabase
      .from("generated_content")
      .select("id, metadata, generated_by")
      .eq("id", contentId)
      .eq("status", "completed")
      .single();

    if (error || !data) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }

    const row = data as {
      id: string;
      metadata: Record<string, unknown> | null;
      generated_by: string;
    };

    if (profileRow.role === "faculty" && row.generated_by !== user.id) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }

    const metadata = row.metadata ?? {};
    const slides = (metadata as { slides?: unknown[] }).slides;

    if (!Array.isArray(slides) || slideIndex >= slides.length) {
      return Response.json(
        { error: "Slide not found" },
        { status: 404 }
      );
    }

    const slide = slides[slideIndex] as Record<string, unknown> | null;
    const imageBase64 = (slide?.imageBase64 ?? "") as string;

    if (!imageBase64) {
      return Response.json(
        { error: "No image available for this slide" },
        { status: 404 }
      );
    }

    return Response.json({ imageBase64 });
  } catch (err) {
    console.error("[ppt/image] Error:", err);
    const message =
      err instanceof Error ? err.message : "Failed to fetch image";
    return Response.json({ error: message }, { status: 500 });
  }
}
