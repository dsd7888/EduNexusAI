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
  const { data: sessions, error } = await admin
    .from("chat_sessions")
    .select("id, student_id, subject_id, created_at")
    .eq("subject_id", "74e25bc8-d2bc-4a11-8242-e0fefae8f3af")
    .order("created_at", { ascending: false })
    .limit(20);
  console.log("recent crypto-subject sessions:", JSON.stringify(sessions, null, 2), error);

  if (sessions && sessions.length) {
    for (const s of sessions) {
      const { data: prof } = await admin.from("profiles").select("id,email").eq("id", s.student_id).maybeSingle();
      console.log(`session ${s.id} -> profile exists: ${!!prof} (${prof?.email ?? "ORPHANED, profile gone"})`);
    }
  }
})();
