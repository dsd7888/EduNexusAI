const { createBrowserClient } = require("@supabase/ssr");
const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
const { randomUUID } = require("crypto");

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

(async () => {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const admin = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

  const email = `cp-audit-curl-${randomUUID().slice(0, 8)}@edunexus-harness.invalid`;
  const { data: created } = await admin.auth.admin.createUser({
    email,
    password: `Hx-${randomUUID()}`,
    email_confirm: true,
  });
  const userId = created.user.id;
  for (let i = 0; i < 20; i++) {
    const { data } = await admin.from("profiles").select("id").eq("id", userId).maybeSingle();
    if (data) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  await admin.from("profiles").update({ role: "student", branch: "CSE", semester: 1, department: "Engineering" }).eq("id", userId);

  const jar = new Map();
  const browserLike = createBrowserClient(url, anonKey, {
    isSingleton: false,
    cookies: {
      getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })),
      setAll: (list) => { for (const { name, value } of list) jar.set(name, value); },
    },
  });
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  await browserLike.auth.verifyOtp({ type: "email", token_hash: link.properties.hashed_token });

  const cookieHeader = [...jar.entries()].map(([n, v]) => `${n}=${encodeURIComponent(v)}`).join("; ");
  fs.writeFileSync("_audit_chat/curl_cookie.txt", cookieHeader);
  fs.writeFileSync("_audit_chat/curl_userid.txt", userId);
  console.log("USER_ID=" + userId);
  console.log("EMAIL=" + email);
  console.log("wrote _audit_chat/curl_cookie.txt");
})();
