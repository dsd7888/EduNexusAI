import fs from "fs";
const env = Object.fromEntries(fs.readFileSync(".env.local","utf8").split("\n").filter(l=>l.includes("=")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i),l.slice(i+1)];}));
for (const [k,v] of Object.entries(env)) if (!process.env[k]) process.env[k]=v;
const { createClient } = await import("@supabase/supabase-js");
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const { persistAppError } = await import("../src/lib/api/helpers.ts");
let pass=0,fail=0; function ok(n: string, c: boolean, d = ""): void {
  if (c) { pass++; console.log(`  PASS  ${n}`); }
  else { fail++; console.log(`  FAIL  ${n}  ${d}`); }
}

const realCanary=`abortfilter-real-${crypto.randomUUID()}`;
const abortCanary=`abortfilter-aborted-${crypto.randomUUID()}`;
persistAppError({scope:"[t]",message:realCanary,origin:"handled"});
persistAppError({scope:"[t]",message:`aborted ${abortCanary}`,origin:"handled"});
persistAppError({scope:"[t]",message:`AbortError: ${abortCanary}-2`,origin:"handled"});
await new Promise(r=>setTimeout(r,2500));
const { data: real } = await admin.from("app_error_logs").select("id").eq("message",realCanary);
const { data: ab } = await admin.from("app_error_logs").select("id").like("message",`%${abortCanary}%`);
ok("a genuine error is still persisted", (real?.length ?? 0)===1);
ok("aborted / AbortError rows are dropped", (ab?.length ?? 0)===0);
for (const r of real ?? []) await admin.from("app_error_logs").delete().eq("id", r.id);
console.log(`\n  PASS ${pass}  FAIL ${fail}`); process.exit(fail?1:0);
