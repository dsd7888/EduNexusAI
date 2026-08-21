/**
 * Real production latency for the routes bug 2 was about. The practice page
 * shows "Still scoring your answers" past 5s; if submit routinely exceeds that,
 * the old code would have claimed FAILURE there instead.
 */
import { createClient } from "@supabase/supabase-js";
import fs from "fs";
const env = Object.fromEntries(fs.readFileSync(".env.local","utf8").split("\n").filter(l=>l.includes("=")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i),l.slice(i+1)];}));
const BASE = process.env.VERIFY_BASE ?? "http://localhost:3000";
const REF = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
const admin=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY);
const anon=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

const EMAIL=`lat-${crypto.randomUUID().slice(0,8)}@edunexus-harness.invalid`;
const { data: cu } = await admin.auth.admin.createUser({ email:EMAIL, password:`Pw!${crypto.randomUUID().slice(0,12)}`, email_confirm:true, user_metadata:{full_name:"Latency Probe"} });
const uid=cu!.user!.id;
await admin.from("profiles").upsert({ id:uid, email:EMAIL, full_name:"Latency Probe", role:"student", branch:"CSE", semester:3, must_change_password:false },{onConflict:"id"});
const { data: l } = await admin.auth.admin.generateLink({type:"magiclink",email:EMAIL});
const { data: v } = await anon.auth.verifyOtp({token_hash:l!.properties.hashed_token,type:"magiclink"});
const H={ "Content-Type":"application/json", Cookie:`sb-${REF}-auth-token=base64-${Buffer.from(JSON.stringify(v!.session),"utf8").toString("base64url")}` };
const { data: bank } = await admin.from("placement_question_bank").select("track,topic").eq("is_active",true).limit(1).single();

const times: number[] = [];
for (let i=1;i<=4;i++) {
  const t0=Date.now();
  const g=await fetch(`${BASE}/api/placement/prep/generate`,{method:"POST",headers:H,body:JSON.stringify({track:bank!.track,topic:bank!.topic})});
  const gb=await g.json(); const genMs=Date.now()-t0;
  const qs=gb.questions ?? gb.data?.questions ?? [];
  const attempts=qs.map((q:{id:string})=>({question_id:q.id,selected_answer:"A",is_correct:false,is_skipped:false,time_spent_seconds:3}));
  const t1=Date.now();
  const r=await fetch(`${BASE}/api/placement/prep/submit`,{method:"POST",headers:H,body:JSON.stringify({attempts,track:bank!.track,topic:bank!.topic,session_duration_seconds:20})});
  await r.text(); const subMs=Date.now()-t1;
  times.push(subMs);
  console.log(`run ${i}: generate ${genMs}ms (${gb.source ?? gb.data?.source})   submit ${subMs}ms  status=${r.status}${subMs>5000?"   <-- would have shown the OLD false-failure message":""}`);
}
const max=Math.max(...times), avg=Math.round(times.reduce((a,b)=>a+b,0)/times.length);
console.log(`\nsubmit: avg ${avg}ms, max ${max}ms   (5000ms = the "still scoring" threshold)`);
await admin.auth.admin.deleteUser(uid);
console.log("cleanup: probe deleted");
