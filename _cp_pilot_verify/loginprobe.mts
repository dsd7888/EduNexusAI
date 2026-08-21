import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import fs from "fs";
const env = Object.fromEntries(fs.readFileSync(".env.local","utf8").split("\n").filter(l=>l.includes("=")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i),l.slice(i+1)];}));
const BASE="http://localhost:3000";
const admin=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY);
const EMAIL="loginprobe@edunexus-harness.invalid", PW="ProbePw123456";

const { data: pre } = await admin.auth.admin.listUsers();
const old = pre?.users.find(u=>u.email===EMAIL);
if (old) await admin.auth.admin.deleteUser(old.id);
const { data: c } = await admin.auth.admin.createUser({ email:EMAIL, password:PW, email_confirm:true, user_metadata:{full_name:"Login Probe"} });
// must_change_password TRUE — the exact state of all 50 pilot students on day one
await admin.from("profiles").upsert({ id:c.user!.id, email:EMAIL, full_name:"Login Probe", role:"student", branch:"CSE", semester:3, must_change_password:true },{onConflict:"id"});

const browser=await chromium.launch();
const ctx=await browser.newContext({viewport:{width:1280,height:900}});
const page=await ctx.newPage();
page.on("console",m=>console.log(`   [console.${m.type()}] ${m.text().slice(0,180)}`));
page.on("pageerror",e=>console.log(`   [pageerror] ${e.message.slice(0,180)}`));
page.on("response", r => { if (r.url().includes("/auth/v1/token") || r.url().includes("/auth/v1/user")) console.log(`   [net] ${r.status()} ${r.url().split("?")[0].slice(-40)}`); });

await page.goto(`${BASE}/login`,{waitUntil:"domcontentloaded"});
await page.waitForTimeout(1500);
console.log("filling form...");
await page.locator('input[type="email"]').fill(EMAIL);
await page.locator('input[type="password"]').fill(PW);
await page.getByRole("button",{name:/sign in|log in|login/i}).first().click();

for (let i=1;i<=12;i++) {
  await page.waitForTimeout(2000);
  const t = (await page.innerText("body").catch(()=>"")).replace(/\n/g," ").slice(0,120);
  console.log(`  t+${i*2}s  url=${new URL(page.url()).pathname}  body="${t}"`);
  if (page.url().includes("/auth/change-password")) { console.log("  -> reached change-password"); break; }
}
await page.screenshot({path:"_cp_pilot_verify/screens/08-login-probe.png",fullPage:true});
await browser.close();
await admin.auth.admin.deleteUser(c.user!.id);
console.log("\ncleanup: probe user deleted");
