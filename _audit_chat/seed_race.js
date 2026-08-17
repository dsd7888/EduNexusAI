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
const userId = fs.readFileSync("_audit_chat/curl_userid.txt", "utf8").trim();
const SUBJECT_ID = "74e25bc8-d2bc-4a11-8242-e0fefae8f3af";

(async () => {
  const today = new Date().toISOString().slice(0, 10);
  await admin.from("usage_analytics").delete().eq("user_id", userId).eq("event_type", "chat").eq("date", today);
  await admin.from("usage_analytics").insert({
    date: today,
    user_id: userId,
    subject_id: SUBJECT_ID,
    event_type: "chat",
    event_count: 49,
  });
  console.log("seeded 49/50 for curl user", userId);
})();
