import { loadEnvLocal } from "../src/lib/testing/httpHarness";
import { createClient } from "@supabase/supabase-js";

async function main() {
  loadEnvLocal();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const admin = createClient(url, key);

  const { data: rows, error } = await admin
    .from("study_notes")
    .select("*")
    .eq("subject_id", "113969c6-5c0e-452b-8689-33c5cae95ae5")
    .not("module_id", "is", null)
    .limit(1);
  console.log(error);
  console.log(JSON.stringify(rows, null, 2).slice(0, 3000));
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
