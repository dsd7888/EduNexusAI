import { createClient } from "@supabase/supabase-js";
import fs from "fs";
const env = Object.fromEntries(fs.readFileSync(".env.local","utf8").split("\n").filter(l=>l.includes("=")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i),l.slice(i+1)];}));
const BASE = process.env.VERIFY_BASE ?? "http://localhost:3000";
const REF = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
const admin=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY);
const anon=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

// Which CSE-3 subjects have modules, and how many already have notes?
const { data: off } = await admin.from("subject_offerings").select("subject_id").eq("branch","CSE").eq("semester",3);
for (const o of off ?? []) {
  const { data: subj } = await admin.from("subjects").select("id,code,name").eq("id",o.subject_id).single();
  const { count: mods } = await admin.from("modules").select("id",{count:"exact",head:true}).eq("subject_id",o.subject_id);
  const { data: modIds } = await admin.from("modules").select("id").eq("subject_id",o.subject_id);
  const ids = (modIds ?? []).map(m=>m.id);
  const { count: notes } = ids.length
    ? await admin.from("study_notes").select("id",{count:"exact",head:true}).in("module_id", ids)
    : { count: 0 };
  console.log(`${subj?.code} ${subj?.name}: ${mods} modules, ${notes} with notes`);
}

const { data: l } = await admin.auth.admin.generateLink({type:"magiclink",email:"teststudent@gmail.com"});
const { data: v } = await anon.auth.verifyOtp({token_hash:l!.properties.hashed_token,type:"magiclink"});
const H={ "Content-Type":"application/json", Cookie:`sb-${REF}-auth-token=base64-${Buffer.from(JSON.stringify(v!.session),"utf8").toString("base64url")}` };

const target = off?.[0]?.subject_id;
if (target) {
  console.log(`\nPOST /api/notes/subject/${target}/generate ...`);
  const t0=Date.now();
  const r=await fetch(`${BASE}/api/notes/subject/${target}/generate`,{method:"POST",headers:H});
  const body=await r.text();
  const ms=Date.now()-t0;
  console.log(`  status=${r.status}  ${ms}ms  (${(ms/1000).toFixed(1)}s of the 300s ceiling)`);
  console.log(`  ${body.slice(0,220)}`);
}
