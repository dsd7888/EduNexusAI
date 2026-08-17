import { loadEnvLocal } from "../src/lib/testing/httpHarness";
import { createClient } from "@supabase/supabase-js";

async function main() {
  loadEnvLocal();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const admin = createClient(url, key);
  const { data } = await admin
    .from("subject_offerings")
    .select("*")
    .eq("subject_id", "b862c433-29d1-4e43-ac54-4a1369a7f195");
  console.log(JSON.stringify(data, null, 2));

  const { data: modules } = await admin
    .from("modules")
    .select("id, name, module_number")
    .eq("subject_id", "b862c433-29d1-4e43-ac54-4a1369a7f195")
    .order("module_number");
  console.log(JSON.stringify(modules, null, 2));
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
