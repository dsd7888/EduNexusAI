/** Can a student read their OWN profile row through the browser client?
 *  /auth/loading depends on it; on failure it router.replace("/login"). */
import { createClient } from "@supabase/supabase-js";
import fs from "fs";
const env = Object.fromEntries(fs.readFileSync(".env.local","utf8").split("\n").filter(l=>l.includes("=")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i),l.slice(i+1)];}));
const admin=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY);

const EMAIL="profread.probe@edunexus-harness.invalid";
const PW="ProbePw123456";
const { data: pre } = await admin.auth.admin.listUsers();
const old = pre?.users.find(u=>u.email===EMAIL);
if (old) await admin.auth.admin.deleteUser(old.id);
const { data: c } = await admin.auth.admin.createUser({ email:EMAIL, password:PW, email_confirm:true, user_metadata:{full_name:"Prof Read Probe"} });
await admin.from("profiles").upsert({ id:c.user!.id, email:EMAIL, full_name:"Prof Read Probe", role:"student", branch:"CSE", semester:3, must_change_password:true },{onConflict:"id"});

const cli = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth:{persistSession:false} });
const { data: s, error: se } = await cli.auth.signInWithPassword({ email:EMAIL, password:PW });
console.log("sign in:", se ? `FAIL ${se.message}` : "OK");

// exactly what /auth/loading does
const { data: prof, error: pe } = await cli.from("profiles").select("role").eq("id", s!.user.id).single();
console.log("own-profile .select('role').single():", pe ? `FAIL  code=${pe.code} msg=${pe.message}` : `OK role=${prof?.role}`);

const { data: full, error: fe } = await cli.from("profiles").select("*").eq("id", s!.user.id);
console.log("own-profile select('*'):", fe ? `FAIL ${fe.message}` : `OK ${full?.length} row(s)`);

// and the existing test student, for comparison
const { data: l2 } = await admin.auth.admin.generateLink({type:"magiclink",email:"teststudent@gmail.com"});
const cli2 = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth:{persistSession:false} });
const { data: v2 } = await cli2.auth.verifyOtp({ token_hash:l2!.properties.hashed_token, type:"magiclink" });
const { data: p2, error: e2 } = await cli2.from("profiles").select("role").eq("id", v2!.user!.id).single();
console.log("teststudent own-profile read:", e2 ? `FAIL ${e2.message}` : `OK role=${p2?.role}`);

await admin.auth.admin.deleteUser(c.user!.id);
console.log("\ncleanup: probe user deleted");
