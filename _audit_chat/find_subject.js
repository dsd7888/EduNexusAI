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
  const { data, error } = await admin.from("subject_content").select("subject_id, content").limit(500);
  if (error) {
    console.error(error);
    return;
  }
  const withContent = data.filter((r) => r.content && r.content.length > 200);
  console.log("subjects with content:", withContent.length, "of", data.length);
  const ids = withContent.slice(0, 5).map((r) => r.subject_id);
  const { data: subs } = await admin.from("subjects").select("id,name,code,branch,semester").in("id", ids);
  console.log(JSON.stringify(subs, null, 2));
})();
