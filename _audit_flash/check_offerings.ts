import { loadEnvLocal } from "../src/lib/testing/httpHarness";
import { createClient } from "@supabase/supabase-js";

async function main() {
  loadEnvLocal();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const admin = createClient(url, key);

  const ids = [
    "37912b3a-98b0-43b6-8403-e33ac4bd5f3e",
    "113969c6-5c0e-452b-8689-33c5cae95ae5",
    "74e25bc8-d2bc-4a11-8242-e0fefae8f3af",
  ];
  const { data } = await admin
    .from("subject_offerings")
    .select("*")
    .in("subject_id", ids);
  console.log(JSON.stringify(data, null, 2));
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
