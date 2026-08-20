import { createClient } from "@supabase/supabase-js";
import fs from "fs";
const env = Object.fromEntries(fs.readFileSync(".env.local","utf8").split("\n").filter(l=>l.includes("=")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i),l.slice(i+1)];}));
const admin=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY);

const { data: u } = await admin.auth.admin.listUsers();
const probes = (u?.users ?? []).filter(x => /pilot\.flow\.probe|relogin\.probe|profread\.probe|loginprobe|pilot\.one|pilot\.two|good\.one|bad\.cohort|long\.name/.test(x.email ?? ""));
console.log(`probe auth users left: ${probes.length}`);
for (const p of probes) { await admin.auth.admin.deleteUser(p.id); console.log(`  deleted ${p.email}`); }

const { data: pr } = await admin.from("profiles").select("email").or("email.like.%@edunexus-harness.invalid,email.like.pilot.%@ppsu.ac.in");
console.log(`harness profile rows: ${pr?.length ?? 0}`, (pr??[]).map(x=>x.email).join(", "));

const { data: ael } = await admin.from("app_error_logs").select("id").like("message","pilot-verify-canary-%");
console.log(`canary error rows: ${ael?.length ?? 0}`);

const today = new Date().toISOString().slice(0,10);
const { data: ua } = await admin.from("usage_analytics").select("event_type,event_count")
  .in("event_type",["chat_suggestions","placement_prep_generate"]).eq("date",today);
console.log(`seeded usage rows left: ${ua?.length ?? 0}`, JSON.stringify(ua ?? []));

const { count: errCount } = await admin.from("app_error_logs").select("id",{count:"exact",head:true});
console.log(`total app_error_logs rows (real errors seen today): ${errCount}`);
if ((errCount ?? 0) > 0) {
  const { data: recent } = await admin.from("app_error_logs").select("scope,message,origin,created_at").order("created_at",{ascending:false}).limit(5);
  for (const r of recent ?? []) console.log(`   ${r.origin}  ${r.scope}  ${String(r.message).slice(0,90)}`);
}
