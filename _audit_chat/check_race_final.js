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

(async () => {
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await admin
    .from("usage_analytics")
    .select("event_count")
    .eq("user_id", userId)
    .eq("event_type", "chat")
    .eq("date", today);
  const total = (data ?? []).reduce((s, r) => s + (r.event_count ?? 0), 0);
  console.log(`final chat usage_analytics total for curl-race user (limit 50): ${total}`);

  // cleanup
  await admin.from("usage_analytics").delete().eq("user_id", userId);
  const { data: sessions } = await admin.from("chat_sessions").select("id").eq("student_id", userId);
  const ids = (sessions ?? []).map((s) => s.id);
  if (ids.length) {
    await admin.from("chat_messages").delete().in("session_id", ids);
    await admin.from("chat_sessions").delete().in("id", ids);
  }
  await admin.from("profiles").delete().eq("id", userId);
  await admin.auth.admin.deleteUser(userId);
  console.log("curl-race user cleaned up");
})();
