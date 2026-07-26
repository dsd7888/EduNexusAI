/**
 * Stale-assessment sweep. Mirrors /api/cron/abandon-stale-generations (§10).
 *
 * A session left 'in_progress' for longer than STALE_HOURS is presumed dead —
 * closed tab, crashed client, student walked away. It is marked 'abandoned' so
 * it stops occupying in-progress state, but its student_question_attempts rows
 * are LEFT INTACT: whatever the student actually answered is real practice
 * history and feeds the 30-day bank exclusion. Abandoning a session discards
 * the session, never the evidence.
 *
 * Auth: when CRON_SECRET is set, require `Authorization: Bearer <CRON_SECRET>`
 * (Vercel cron sends exactly this). Unset (local dev) allows manual runs.
 */

import { createAdminClient } from "@/lib/db/supabase-server";
import type { NextRequest } from "next/server";

const STALE_HOURS = 4;

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
      Date.now() - STALE_HOURS * 60 * 60 * 1000
    ).toISOString();

    const { data, error } = await adminClient
      .from("quiz_sessions")
      .update({ status: "abandoned" })
      .eq("status", "in_progress")
      .lt("started_at", cutoff)
      .select("id");

    if (error) {
      console.error("[cron/abandon-stale-assessments] update error:", error);
      return Response.json({ error: "Failed to sweep" }, { status: 500 });
    }

    const count = data?.length ?? 0;
    console.log(
      `[cron/abandon-stale-assessments] marked ${count} stale session(s) abandoned`
    );
    return Response.json({ ok: true, abandoned: count });
  } catch (err) {
    console.error("[cron/abandon-stale-assessments] error:", err);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
