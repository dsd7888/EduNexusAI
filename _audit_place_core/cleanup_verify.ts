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

  for (const table of ["student_placement_profiles", "placement_topic_mastery", "placement_question_attempts", "practice_attempts"]) {
    const { data } = await admin.from(table).select("student_id").limit(1000);
    const ids = [...new Set((data ?? []).map((r: any) => r.student_id))];
    for (const id of ids) {
      const { data: u } = await admin.auth.admin.getUserById(id as string);
      console.log(`${table} -> student_id=${id} email=${u?.user?.email ?? "(user not found / already deleted)"}`);
    }
  }
}
main().catch((e) => { console.error("FATAL:", e); process.exitCode = 1; });
