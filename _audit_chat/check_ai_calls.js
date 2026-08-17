const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
const env = {};
fs.readFileSync(".env.local", "utf8").split("\n").forEach((l) => {
  const t = l.trim();
  if (!t || t.startsWith("#")) return;
  const eq = t.indexOf("=");
  if (eq === -1) return;
  let val = t.slice(eq + 1).trim();
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    val = val.slice(1, -1);
  }
  env[t.slice(0, eq).trim()] = val;
});
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

(async () => {
  const { data, error } = await admin
    .from("ai_call_logs")
    .select("id, task, feature, created_at, output_tokens, cost_inr, job_id")
    .gte("created_at", "2026-08-16T15:22:00Z")
    .lte("created_at", "2026-08-16T15:26:00Z")
    .order("created_at", { ascending: true });
  console.log(JSON.stringify(data, null, 2), error);
  console.log("total rows:", data ? data.length : 0);
})();
