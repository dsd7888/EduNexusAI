/** Isolate: after a forced password change, does the NEW password actually work? */
import { createClient } from "@supabase/supabase-js";
import fs from "fs";
const env = Object.fromEntries(fs.readFileSync(".env.local","utf8").split("\n").filter(l=>l.includes("=")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i),l.slice(i+1)];}));
const admin=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY);
const EMAIL="relogin.probe@edunexus-harness.invalid";
const TEMP="TempPw123456";
const NEWPW="BrandNewPw!7788";

// clean slate
const { data: pre } = await admin.auth.admin.listUsers();
const old = pre?.users.find(u=>u.email===EMAIL);
if (old) await admin.auth.admin.deleteUser(old.id);

const { data: created, error: cErr } = await admin.auth.admin.createUser({
  email: EMAIL, password: TEMP, email_confirm: true, user_metadata:{ full_name:"Relogin Probe" },
});
if (cErr) { console.error("createUser failed:", cErr.message); process.exit(1); }
await admin.from("profiles").upsert({ id: created.user!.id, email: EMAIL, full_name:"Relogin Probe",
  role:"student", branch:"CSE", semester:3, must_change_password:true }, { onConflict:"id" });

const fresh = () => createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { auth:{ autoRefreshToken:false, persistSession:false } });

// 1. temp password works
const c1 = fresh();
const { error: e1 } = await c1.auth.signInWithPassword({ email:EMAIL, password:TEMP });
console.log("1. sign in with TEMP:", e1 ? `FAIL ${e1.message}` : "OK");

// 2. change the password on that session (what the page does)
const { error: uErr } = await c1.auth.updateUser({ password: NEWPW });
console.log("2. updateUser(newPassword):", uErr ? `FAIL ${uErr.message}` : "OK");

// 3. brand-new client, sign in with the NEW password
await new Promise(r=>setTimeout(r,1500));
const c2 = fresh();
const { data: s2, error: e2 } = await c2.auth.signInWithPassword({ email:EMAIL, password:NEWPW });
console.log("3. sign in with NEW password:", e2 ? `FAIL ${e2.message}` : `OK (user ${s2.user?.email})`);

// 4. old password must be dead
const c3 = fresh();
const { error: e3 } = await c3.auth.signInWithPassword({ email:EMAIL, password:TEMP });
console.log("4. sign in with OLD temp password:", e3 ? `correctly rejected (${e3.message})` : "*** STILL ACCEPTED ***");

await admin.auth.admin.deleteUser(created.user!.id);
console.log("\ncleanup: probe user deleted");
