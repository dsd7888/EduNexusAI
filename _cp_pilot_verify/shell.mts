/**
 * Regression sweep: the ThemeToggle removal edited (student)/layout.tsx, which
 * renders on every student screen. Confirms the toggle is gone, nothing else
 * broke, and no page logs a console error.
 */
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import fs from "fs";
const env = Object.fromEntries(fs.readFileSync(".env.local","utf8").split("\n").filter(l=>l.includes("=")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i),l.slice(i+1)];}));
const URLB="http://localhost:3000", REF=new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
const admin=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY), anon=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
let pass=0,fail=0; function ok(n: string, c: boolean, d = ""): void {
  if (c) { pass++; console.log(`  PASS  ${n}`); }
  else { fail++; console.log(`  FAIL  ${n}  ${d}`); }
}

const {data:link}=await admin.auth.admin.generateLink({type:"magiclink",email:"teststudent@gmail.com"});
const {data:v}=await anon.auth.verifyOtp({token_hash:link!.properties.hashed_token,type:"magiclink"});
const browser=await chromium.launch();
const ctx=await browser.newContext({viewport:{width:1280,height:900}});
await ctx.addCookies([{name:`sb-${REF}-auth-token`,value:"base64-"+Buffer.from(JSON.stringify(v!.session),"utf8").toString("base64url"),domain:"localhost",path:"/",httpOnly:false,secure:false,sameSite:"Lax"}]);

const PAGES=["/student/dashboard","/student/subjects","/student/profile","/student/history","/student/quiz","/student/placement","/student/chat"];
for (const p of PAGES) {
  const page=await ctx.newPage();
  const errs:string[]=[];
  page.on("console",m=>{if(m.type()==="error")errs.push(m.text());});
  page.on("pageerror",e=>errs.push(`pageerror: ${e.message}`));
  await page.goto(URLB+p,{waitUntil:"domcontentloaded"});
  await page.waitForTimeout(2500);
  const body=await page.innerText("body");
  const themeBtns = await page.getByRole("button",{name:/theme|dark mode|light mode/i}).count();
  ok(`${p} — renders`, body.length>120, `len=${body.length}`);
  ok(`${p} — no theme toggle`, themeBtns===0, `found ${themeBtns}`);
  ok(`${p} — no console errors`, errs.length===0, errs.slice(0,2).join(" | "));
  if (p==="/student/dashboard") await page.screenshot({path:"_cp_pilot_verify/screens/05-dashboard.png",fullPage:true});
  await page.close();
}
// html must not carry .dark now that nothing can set it
const page=await ctx.newPage();
await page.goto(URLB+"/student/dashboard",{waitUntil:"domcontentloaded"});
await page.waitForTimeout(1200);
ok("html has no .dark class", !(await page.locator("html").getAttribute("class") ?? "").includes("dark"));
await browser.close();
console.log(`\n──────────────\n  PASS ${pass}   FAIL ${fail}\n`);
process.exit(fail?1:0);
