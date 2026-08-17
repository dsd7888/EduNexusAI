import { loadEnvLocal } from "../src/lib/testing/httpHarness";
import { createClient } from "@supabase/supabase-js";

async function main() {
  loadEnvLocal();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const admin = createClient(url, key);
  const { data } = await admin.from("profiles").select("id, email, branch, semester, role").eq("email", "teststudent@gmail.com").maybeSingle();
  console.log(JSON.stringify(data, null, 2));
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
