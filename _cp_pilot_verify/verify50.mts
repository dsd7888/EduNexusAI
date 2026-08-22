import { createClient } from "@supabase/supabase-js";
import fs from "fs";
const env = Object.fromEntries(fs.readFileSync(".env.local","utf8").split("\n").filter(l=>l.includes("=")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i),l.slice(i+1)];}));
const BASE = process.env.VERIFY_BASE ?? "http://localhost:3000";
const admin=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY);
let pass=0,fail=0;
function ok(n:string,c:boolean,d=""):void{ if(c){pass++;console.log(`  PASS  ${n}`);} else {fail++;console.log(`  FAIL  ${n}  ${d}`);} }

const { data: rows } = await admin.from("profiles")
  .select("email,role,branch,semester,must_change_password")
  .like("email","stu%@edunexus-trial.com");

ok("all 50 profiles exist", rows?.length===50, `got ${rows?.length}`);
ok("every one is role=student", (rows??[]).every(r=>r.role==="student"));
ok("every one is CSE sem 3", (rows??[]).every(r=>r.branch==="CSE" && r.semester===3));
ok("every one is flagged must_change_password", (rows??[]).every(r=>r.must_change_password===true));

// no duplicates / no gaps
const nums = (rows??[]).map(r=>Number(String(r.email).match(/stu(\d+)@/)![1])).sort((a,b)=>a-b);
ok("numbering is exactly 1..50 with no gaps or dupes",
   nums.length===50 && nums[0]===1 && nums[49]===50 && new Set(nums).size===50);

// spot-check a real sign-in with the issued temp password, against PRODUCTION
const csv = fs.readdirSync(".").filter(f=>f.startsWith("student-credentials-")).sort().pop()!;
const lines = fs.readFileSync(csv,"utf8").trim().split("\n").slice(1);
const pick = [0, 24, 49].map(i=>lines[i]);
for (const line of pick) {
  const parts = line.split(",");
  const email = parts[0], pw = parts[parts.length-2];
  const cli = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth:{persistSession:false} });
  const { error } = await cli.auth.signInWithPassword({ email, password: pw });
  ok(`temp password works for ${email}`, !error, error?.message ?? "");
}

// and that the gate actually fires for one of them on the deployed build
const REF = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth:{persistSession:false} });
const { data: l } = await admin.auth.admin.generateLink({ type:"magiclink", email:"stu1@edunexus-trial.com" });
const { data: v } = await anon.auth.verifyOtp({ token_hash:l!.properties.hashed_token, type:"magiclink" });
const cookie = `sb-${REF}-auth-token=base64-${Buffer.from(JSON.stringify(v!.session),"utf8").toString("base64url")}`;
const r = await fetch(`${BASE}/student/dashboard`, { headers:{ Cookie: cookie }, redirect:"manual" });
const loc = r.headers.get("location") ?? "";
ok("forced-password-change gate fires on the deployed build",
   r.status>=300 && r.status<400 && loc.includes("/auth/change-password"), `status=${r.status} location=${loc}`);

console.log(`\n──────────────\n  PASS ${pass}   FAIL ${fail}\n`);
process.exit(fail?1:0);
