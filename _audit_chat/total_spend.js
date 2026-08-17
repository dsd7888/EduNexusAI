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
    .select("cost_inr, task")
    .gte("created_at", "2026-08-16T15:20:00Z");
  if (error) return console.error(error);
  const total = data.reduce((s, r) => s + (r.cost_inr ?? 0), 0);
  console.log(`total rows: ${data.length}, total cost_inr: ${total.toFixed(2)}`);
  const byTask = {};
  for (const r of data) byTask[r.task] = (byTask[r.task] ?? 0) + 1;
  console.log(JSON.stringify(byTask, null, 2));
})();
