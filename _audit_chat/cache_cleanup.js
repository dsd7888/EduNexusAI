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
const SUBJECT_ID = "74e25bc8-d2bc-4a11-8242-e0fefae8f3af";

(async () => {
  const since = "2026-08-16T00:00:00Z";
  const { data, error } = await admin
    .from("semantic_cache")
    .select("id, query_text, created_at")
    .eq("subject_id", SUBJECT_ID)
    .gte("created_at", since);
  console.log("cache rows created today for this subject:", JSON.stringify(data, null, 2), error);
  if (data && data.length) {
    const ids = data.map((r) => r.id);
    const { error: delErr } = await admin.from("semantic_cache").delete().in("id", ids);
    console.log(`deleted ${ids.length} audit-created cache rows`, delErr);
  }
})();
