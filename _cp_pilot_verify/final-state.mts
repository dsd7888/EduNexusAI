import { createClient } from "@supabase/supabase-js";
import fs from "fs";
const env = Object.fromEntries(fs.readFileSync(".env.local","utf8").split("\n").filter(l=>l.includes("=")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i),l.slice(i+1)];}));
const admin=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY);

const { data: off } = await admin.from("subject_offerings").select("subject_id").eq("branch","CSE").eq("semester",3);
const { data: mods } = await admin.from("modules").select("id").eq("subject_id", off![0].subject_id);
const ids=(mods??[]).map(m=>m.id);
const { count: notes } = await admin.from("study_notes").select("id",{count:"exact",head:true}).in("module_id", ids);
console.log(`notes coverage after the cold-start run: ${notes}/${ids.length} modules`);

const today=new Date().toISOString().slice(0,10);
const { data: spend } = await admin.from("ai_call_logs").select("cost_inr").gte("created_at",`${today}T00:00:00.000Z`);
const total=(spend??[]).reduce((s,r)=>s+Number(r.cost_inr||0),0);
console.log(`AI spend today (all verification): ₹${total.toFixed(2)} across ${spend?.length} calls`);

const { count: errs } = await admin.from("app_error_logs").select("id",{count:"exact",head:true});
console.log(`app_error_logs rows: ${errs}`);
if ((errs??0)>0) {
  const { data: rows } = await admin.from("app_error_logs").select("scope,message,origin").order("created_at",{ascending:false}).limit(5);
  for (const r of rows??[]) console.log(`   ${r.origin}  ${r.scope}  ${String(r.message).slice(0,80)}`);
}
const { data: u } = await admin.auth.admin.listUsers();
const probes=(u?.users??[]).filter(x=>/harness\.invalid/.test(x.email??""));
console.log(`harness auth users left: ${probes.length}`, probes.map(p=>p.email).join(", "));
