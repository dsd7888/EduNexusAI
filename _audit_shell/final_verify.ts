import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadEnvLocal(): void {
  const raw = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (!process.env[key]) process.env[key] = val;
  }
}
loadEnvLocal();

async function main() {
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await admin
    .from("profiles")
    .select("email, role, branch, department")
    .in("email", [
      "teststudent@gmail.com",
      "teststudent2@gmail.com",
      "teststudent3@gmail.com",
      "admin@edunexus.com",
      "unnati.shukla@ppsu.ac.in",
    ]);
  console.log(JSON.stringify(data, null, 2), error);

  const { data: leftover } = await admin
    .from("profiles")
    .select("email")
    .ilike("email", "%cp-harness-%");
  console.log("leftover cp-harness-* profiles:", leftover);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
