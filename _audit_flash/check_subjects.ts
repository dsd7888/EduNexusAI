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
  const { data: subs } = await admin
    .from("subjects")
    .select("id, code, name, branch, semester")
    .in("id", ids);
  console.log(JSON.stringify(subs, null, 2));

  // module breakpoints / count per subject
  for (const id of ids) {
    const { data: mods } = await admin
      .from("study_notes")
      .select("module_id")
      .eq("subject_id", id)
      .not("module_id", "is", null);
    console.log(id, "module rows:", mods?.length);
  }

  // Check subject_offerings or similar join for branch access
  const { data: offerings, error } = await admin
    .from("subject_offerings")
    .select("*")
    .limit(3);
  console.log("subject_offerings sample:", offerings, error?.message);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
