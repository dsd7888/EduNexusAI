/**
 * One-off (review item E): remove the retired `explainers` private Storage
 * bucket. Supabase blocks direct SQL DELETE on storage tables, so the bucket
 * must go through the Storage API — empty it, then delete it.
 *
 *   npx tsx scripts/drop-explainers-bucket.ts
 *
 * Idempotent: a missing bucket is treated as already done.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const raw = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
for (const line of raw.split("\n")) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const eq = t.indexOf("=");
  if (eq === -1) continue;
  const k = t.slice(0, eq).trim();
  let v = t.slice(eq + 1).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  if (!process.env[k]) process.env[k] = v;
}

async function main() {
  const { createAdminClient } = await import("@/lib/db/supabase-server");
  const admin = createAdminClient();

  const { data: buckets, error: listErr } = await admin.storage.listBuckets();
  if (listErr) {
    console.error("listBuckets failed:", listErr.message);
    process.exit(1);
  }
  if (!buckets?.some((b) => b.id === "explainers")) {
    console.log("Bucket 'explainers' does not exist — nothing to do.");
    process.exit(0);
  }

  const { error: emptyErr } = await admin.storage.emptyBucket("explainers");
  if (emptyErr) {
    console.error("emptyBucket failed:", emptyErr.message);
    process.exit(1);
  }
  console.log("Emptied bucket 'explainers'.");

  const { error: delErr } = await admin.storage.deleteBucket("explainers");
  if (delErr) {
    console.error("deleteBucket failed:", delErr.message);
    process.exit(1);
  }
  console.log("Deleted bucket 'explainers'. ✓");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
