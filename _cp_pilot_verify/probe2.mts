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
page.on("request",r=>{if(r.url().includes("prep/submit"))console.log("   >>> SUBMIT REQUEST FIRED");});
await page.goto(`http://localhost:3000/student/placement/prep/${b!.track}/practice?topic=${encodeURIComponent(b!.topic as string)}`,{waitUntil:"networkidle"});
await page.waitForTimeout(2500);

const OPT = () => page.locator('button').filter({ hasText: /^\s*[A-D]\s*\./ });
{
  const bs = await page.locator("button").all();
  for (const b of bs) {
    const tc = await b.evaluate((e) => e.textContent);
    if (tc && /[A-D]/.test(tc.slice(0,3))) console.log(`  textContent=${JSON.stringify(tc.slice(0,40))}`);
  }
}
for (let step=1; step<=15; step++) {
  const optCount = await OPT().count();
  const nextBtn = page.getByRole("button",{name:"Next →",exact:true});
  const finBtn  = page.getByRole("button",{name:"Finish",exact:true});
  const nCount = await nextBtn.count(), fCount = await finBtn.count();
  const nEn = nCount ? await nextBtn.isEnabled() : false;
  const fEn = fCount ? await finBtn.isEnabled() : false;
  console.log(`step ${step}: options=${optCount} next(${nCount},en=${nEn}) finish(${fCount},en=${fEn})`);

  if (optCount === 0 && nCount === 0 && fCount === 0) { console.log("   -> no controls; likely results screen"); break; }
  if (optCount > 0) {
    await OPT().first().click();
    await page.waitForTimeout(400);
    console.log(`   clicked option A; next now en=${await page.getByRole("button",{name:"Next →",exact:true}).count() ? await page.getByRole("button",{name:"Next →",exact:true}).isEnabled() : "n/a"} finish en=${await page.getByRole("button",{name:"Finish",exact:true}).count() ? await page.getByRole("button",{name:"Finish",exact:true}).isEnabled() : "n/a"}`);
  }
  const fin2 = page.getByRole("button",{name:"Finish",exact:true});
  if (await fin2.count() && await fin2.isEnabled()) { console.log("   -> clicking FINISH"); await fin2.click(); break; }
  const nx2 = page.getByRole("button",{name:"Next →",exact:true});
  if (await nx2.count() && await nx2.isEnabled()) { await nx2.click(); await page.waitForTimeout(500); }
  else { console.log("   -> stuck: neither next nor finish enabled"); break; }
}
await page.waitForTimeout(8000);
const body = await page.innerText("body");
console.log("\n--- body after finish (first 700 chars) ---\n" + body.slice(0,700));
await page.screenshot({path:"_cp_pilot_verify/screens/probe-results.png",fullPage:true});
await browser.close();
