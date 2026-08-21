/** Does prep/submit fail on a student's FIRST-EVER placement submission? */
import { createClient } from "@supabase/supabase-js";
import fs from "fs";
const env = Object.fromEntries(fs.readFileSync(".env.local","utf8").split("\n").filter(l=>l.includes("=")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i),l.slice(i+1)];}));
const SUPABASE_URL=env.NEXT_PUBLIC_SUPABASE_URL, REF=new URL(SUPABASE_URL).hostname.split(".")[0];
const BASE = process.env.VERIFY_BASE ?? "http://localhost:3000";
const admin=createClient(SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY), anon=createClient(SUPABASE_URL,env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

const EMAIL=`firstsub-${crypto.randomUUID().slice(0,8)}@edunexus-harness.invalid`;
const { data: cu } = await admin.auth.admin.createUser({ email:EMAIL, password:`Pw!${crypto.randomUUID().slice(0,12)}`, email_confirm:true, user_metadata:{full_name:"First Submit Probe"} });
const uid = cu!.user!.id;
await admin.from("profiles").upsert({ id:uid, email:EMAIL, full_name:"First Submit Probe", role:"student", branch:"CSE", semester:3, must_change_password:false },{onConflict:"id"});

const { data: l } = await admin.auth.admin.generateLink({type:"magiclink",email:EMAIL});
const { data: v } = await anon.auth.verifyOtp({token_hash:l!.properties.hashed_token,type:"magiclink"});
const cookie=`sb-${REF}-auth-token=base64-${Buffer.from(JSON.stringify(v!.session),"utf8").toString("base64url")}`;
const H={ "Content-Type":"application/json", Cookie: cookie };

// does this fresh student have a placement profile / mastery row? (they shouldn't)
const { data: spp } = await admin.from("student_placement_profiles").select("student_id").eq("student_id",uid);
console.log(`student_placement_profiles rows for fresh student: ${spp?.length ?? 0}`);

const { data: bank } = await admin.from("placement_question_bank").select("track,topic").eq("is_active",true).limit(1).single();

for (const attemptNo of [1,2,3]) {
  const g = await fetch(`${BASE}/api/placement/prep/generate`,{method:"POST",headers:H,body:JSON.stringify({track:bank!.track,topic:bank!.topic})});
  const gb = await g.json();
  const qs = gb.questions ?? gb.data?.questions ?? [];
  const attempts = qs.map((q: { id: string }) => ({ question_id:q.id, selected_answer:"A", is_correct:false, is_skipped:false, time_spent_seconds:3 }));
  const r = await fetch(`${BASE}/api/placement/prep/submit`,{method:"POST",headers:H,
    body: JSON.stringify({ attempts, track:bank!.track, topic:bank!.topic, session_duration_seconds:20 })});
  const text = await r.text();
  console.log(`submit #${attemptNo}: status=${r.status}  ${r.ok ? "OK" : text.slice(0,300)}`);
}

await admin.auth.admin.deleteUser(uid);
console.log("\ncleanup: probe deleted");
