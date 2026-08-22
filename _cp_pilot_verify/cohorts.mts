import { createClient } from "@supabase/supabase-js";
import fs from "fs";
const env = Object.fromEntries(fs.readFileSync(".env.local","utf8").split("\n").filter(l=>l.includes("=")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i),l.slice(i+1)];}));
const admin=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY);

const { data: off } = await admin.from("subject_offerings").select("branch,semester,subject_id");
const groups = new Map<string,string[]>();
for (const o of off ?? []) {
  const k=`${o.branch}|${o.semester}`;
  groups.set(k, [...(groups.get(k) ?? []), o.subject_id]);
}
for (const [k, ids] of [...groups.entries()].sort()) {
  const { data: subs } = await admin.from("subjects").select("id,code,name").in("id", ids);
  const { data: mods } = await admin.from("modules").select("id,subject_id").in("subject_id", ids);
  const modIds=(mods??[]).map(m=>m.id);
  const { count: notes } = modIds.length
    ? await admin.from("study_notes").select("id",{count:"exact",head:true}).in("module_id", modIds)
    : { count: 0 };
  console.log(`${k.replace("|"," sem ")}  —  ${ids.length} subject(s), ${mods?.length ?? 0} modules, ${notes} with notes`);
  for (const s of subs ?? []) console.log(`      ${s.code}  ${s.name}`);
}
const { count: students } = await admin.from("profiles").select("id",{count:"exact",head:true}).eq("role","student");
console.log(`\nexisting student accounts: ${students}`);
