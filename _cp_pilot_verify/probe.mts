import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import fs from "fs";
const env = Object.fromEntries(fs.readFileSync(".env.local","utf8").split("\n").filter(l=>l.includes("=")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i),l.slice(i+1)];}));
const SUPABASE_URL=env.NEXT_PUBLIC_SUPABASE_URL, REF=new URL(SUPABASE_URL).hostname.split(".")[0];
const admin=createClient(SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY), anon=createClient(SUPABASE_URL,env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
const {data:link}=await admin.auth.admin.generateLink({type:"magiclink",email:"teststudent@gmail.com"});
const {data:v}=await anon.auth.verifyOtp({token_hash:link!.properties.hashed_token,type:"magiclink"});
const {data:b}=await admin.from("placement_question_bank").select("track,topic").eq("is_active",true).limit(1).single();
const browser=await chromium.launch();
const ctx=await browser.newContext({viewport:{width:1280,height:900}});
await ctx.addCookies([{name:`sb-${REF}-auth-token`,value:"base64-"+Buffer.from(JSON.stringify(v!.session),"utf8").toString("base64url"),domain:"localhost",path:"/",httpOnly:false,secure:false,sameSite:"Lax"}]);
const page=await ctx.newPage();
await page.goto(`http://localhost:3000/student/placement/prep/${b!.track}/practice?topic=${encodeURIComponent(b!.topic as string)}`,{waitUntil:"networkidle"});
await page.waitForTimeout(2500);
const buttons = await page.locator("button").all();
console.log(`\n${buttons.length} buttons on the question screen:\n`);
for (const [i,btn] of buttons.entries()) {
  const t=(await btn.innerText().catch(()=>"")).replace(/\n/g," ").slice(0,70);
  const cls=(await btn.getAttribute("class").catch(()=>""))?.slice(0,60);
  console.log(`  [${i}] text="${t}"  enabled=${await btn.isEnabled().catch(()=>"?")}  class="${cls}"`);
}
await page.screenshot({path:"_cp_pilot_verify/screens/probe-question.png",fullPage:true});
await browser.close();
