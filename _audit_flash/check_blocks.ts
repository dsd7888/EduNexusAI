import { loadEnvLocal } from "../src/lib/testing/httpHarness";
import { createClient } from "@supabase/supabase-js";

async function main() {
  loadEnvLocal();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const admin = createClient(url, key);

  const { data: rows } = await admin
    .from("study_notes")
    .select("module_id, blocks")
    .eq("subject_id", "113969c6-5c0e-452b-8689-33c5cae95ae5")
    .not("module_id", "is", null);

  let idx = 0;
  for (const row of rows ?? []) {
    const blocks = (row as any)?.blocks ?? [];
    for (const b of blocks) {
      const title = b.title ?? b.name ?? "?";
      const hasWorked = b.kind === "formula" && b.workedExample;
      console.log(idx, row.module_id, b.kind, title, b.kind === "formula" ? (hasWorked ? "HAS workedExample" : "no example") : "");
      idx++;
    }
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
