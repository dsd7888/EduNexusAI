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
  const ids = [
    "2f22e9ef-28f2-49c6-8747-38fe53cf418f",
    "33236016-820e-4914-801d-819c41ae2964",
    "b9de7809-cf8d-4cae-88e1-e91a5d0a96b5",
  ];
  const { data, error } = await admin.from("chat_sessions").select("id, student_id").in("id", ids);
  console.log("found leftover sessions (should be empty if cascade worked):", JSON.stringify(data), error);

  const { data: msgs } = await admin.from("chat_messages").select("id, session_id").in("session_id", ids);
  console.log("found leftover messages:", JSON.stringify(msgs));

  const { count: usageCount } = await admin
    .from("usage_analytics")
    .select("id", { count: "exact", head: true })
    .eq("subject_id", "74e25bc8-d2bc-4a11-8242-e0fefae8f3af");
  console.log("usage_analytics rows remaining for this subject:", usageCount);
})();
