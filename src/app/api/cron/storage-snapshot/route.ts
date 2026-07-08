import { createAdminClient } from "@/lib/db/supabase-server";
import type { NextRequest } from "next/server";

/**
 * Daily storage/DB size snapshot for the Pilot Analysis system-health card.
 * Invoked by the Vercel cron defined in vercel.json. Calls two SECURITY DEFINER
 * RPCs (get_db_size_bytes / get_storage_size_bytes) and records one row.
 *
 * Auth: when CRON_SECRET is set, require `Authorization: Bearer <CRON_SECRET>`
 * (Vercel cron sends exactly this header automatically). When unset (local dev),
 * allow through so the route can be exercised manually. Same pattern as
 * cron/abandon-stale-generations.
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
    const [dbRes, storageRes] = await Promise.all([
      adminClient.rpc("get_db_size_bytes"),
      adminClient.rpc("get_storage_size_bytes"),
    ]);

    if (dbRes.error || storageRes.error) {
      console.error("[cron/storage-snapshot] rpc error:", dbRes.error, storageRes.error);
      return Response.json({ error: "Failed to read sizes" }, { status: 500 });
    }

    const dbSize = Number(dbRes.data ?? 0);
    const storageSize = Number(storageRes.data ?? 0);

    const { error } = await adminClient.from("storage_usage_snapshots").insert({
      db_size_bytes: dbSize,
      storage_size_bytes: storageSize,
    });
    if (error) {
      console.error("[cron/storage-snapshot] insert error:", error);
      return Response.json({ error: "Failed to record snapshot" }, { status: 500 });
    }

    return Response.json({ ok: true, dbSizeBytes: dbSize, storageSizeBytes: storageSize });
  } catch (err) {
    console.error("[cron/storage-snapshot] error:", err);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
