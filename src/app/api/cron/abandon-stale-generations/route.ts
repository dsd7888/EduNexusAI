import { createAdminClient } from "@/lib/db/supabase-server";
import type { NextRequest } from "next/server";

// Rows untouched for this long with no terminal status are considered dead
// (tab closed mid-run, crashed client, etc.) and get marked abandoned so they
// stop surfacing as "resume" candidates. updated_at is bumped by the
// generated_content_updated_at trigger on every checkpoint, so an actively
// progressing generation never trips this.
const STALE_MINUTES = 20;

const TERMINAL_STATUSES = ["completed", "failed", "abandoned"];

/**
 * Stale-job backstop (Task 5). Invoked by the Vercel cron defined in
 * vercel.json. Defense-in-depth only — resume-on-return and the double-submit
 * guard are the primary protections; this just sweeps records that were
 * orphaned anyway.
 *
 * Auth: when CRON_SECRET is set, require `Authorization: Bearer <CRON_SECRET>`
 * (Vercel cron sends exactly this header automatically). When unset (local
 * dev), allow through so the route can be exercised manually.
 */
export async function GET(request: NextRequest) {
  try {
    const secret = process.env.CRON_SECRET;
    if (secret) {
      const auth = request.headers.get("authorization");
      if (auth !== `Bearer ${secret}`) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
      }
    }

    const adminClient = createAdminClient();
    const cutoff = new Date(
      Date.now() - STALE_MINUTES * 60 * 1000
    ).toISOString();

    const { data, error } = await adminClient
      .from("generated_content")
      .update({ status: "abandoned" })
      .eq("type", "ppt")
      .not("status", "in", `(${TERMINAL_STATUSES.join(",")})`)
      .lt("updated_at", cutoff)
      .select("id");

    if (error) {
      console.error("[cron/abandon-stale] update error:", error);
      return Response.json({ error: "Failed to sweep" }, { status: 500 });
    }

    const count = data?.length ?? 0;
    console.log(`[cron/abandon-stale] marked ${count} stale generation(s) abandoned`);
    return Response.json({ ok: true, abandoned: count });
  } catch (err) {
    console.error("[cron/abandon-stale] error:", err);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
