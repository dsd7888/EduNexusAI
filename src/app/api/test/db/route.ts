import { createAdminClient } from "@/lib/db/supabase-server";

export async function GET() {
  try {
    const supabase = createAdminClient();
    const { data, error: queryError } = await supabase
      .from("subjects")
      .select("*")
      .limit(1);

    if (queryError) {
      throw new Error(queryError.message);
    }

    return Response.json({
      success: true,
      message: "DB connected",
      data,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return Response.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
