/**
 * The pilot's actual day-one flow, end to end in a real browser:
 * temp password -> login -> forced /auth/change-password -> new password ->
 * student dashboard, with subjects visible. Then re-login with the NEW
 * password and confirm the gate does not fire again.
 *
 * This is the flow 50 students will run once each. It had never been tested
 * for a student (only faculty), and CP-01's RLS lockdown lands right on top
 * of the flag-clearing write it depends on.
 */
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import fs from "fs";

const env = Object.fromEntries(fs.readFileSync(".env.local","utf8").split("\n").filter(l=>l.includes("=")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i),l.slice(i+1)];}));
const BASE = process.env.VERIFY_BASE ?? "http://localhost:3000";
const admin=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY);
let pass=0,fail=0; function ok(n: string, c: boolean, d = ""): void {
  if (c) { pass++; console.log(`  PASS  ${n}`); }
  else { fail++; console.log(`  FAIL  ${n}  ${d}`); }
}

const EMAIL="pilot.flow.probe@edunexus-harness.invalid";
const csv = fs.readdirSync(".").filter(f=>f.startsWith("student-credentials-")).sort().pop()!;
const line = fs.readFileSync(csv,"utf8").split("\n").find(l=>l.startsWith(EMAIL))!;
// email,full_name,branch,semester,temp_password,status  (full_name may be quoted)
const TEMP = line.split(",").slice(-2)[0];
const NEWPW = "PilotProbe!" + Math.random().toString(36).slice(2,10) + "A9";
console.log(`\nAccount: ${EMAIL}\nTemp password from CSV: ${TEMP}\n`);

const browser=await chromium.launch();
const ctx=await browser.newContext({viewport:{width:1280,height:900}});
const page=await ctx.newPage();
const errs:string[]=[];
page.on("console",m=>{if(m.type()==="error")errs.push(m.text());});
page.on("pageerror",e=>errs.push(`pageerror: ${e.message}`));

try {
  // 1. Sign in with the temp password
  await page.goto(`${BASE}/login`,{waitUntil:"domcontentloaded"});
  await page.locator('input[type="email"]').waitFor({ state: "visible" });
  await page.waitForTimeout(1200);
  await page.locator('input[type="email"]').click();
  await page.locator('input[type="email"]').fill(EMAIL);
  await page.locator('input[type="password"]').click();
  await page.locator('input[type="password"]').fill(TEMP);
  await page.getByRole("button",{name:/sign in|log in|login/i}).first().click();
  // /auth/loading is a client-side role router that hops onward. waitForFunction
  // is the wrong tool — it dies with "execution context destroyed" the moment the
  // navigation happens. waitForURL is navigation-aware.
  await page.waitForURL(/\/auth\/change-password/, { timeout: 45000 });
  ok("temp password signs in", !page.url().includes("/login"), `url=${page.url()}`);

  // 2. Forced straight to change-password, not the dashboard
  ok("redirected to /auth/change-password", page.url().includes("/auth/change-password"), `url=${page.url()}`);
  await page.screenshot({path:"_cp_pilot_verify/screens/06-forced-change.png"});

  // 3. The gate must hold — try to bypass it by URL
  await page.goto(`${BASE}/student/dashboard`,{waitUntil:"domcontentloaded"});
  await page.waitForTimeout(2500);
  ok("cannot bypass the gate by typing /student/dashboard",
     page.url().includes("/auth/change-password"), `url=${page.url()}`);

  // 4. Set a real password
  await page.goto(`${BASE}/auth/change-password`,{waitUntil:"domcontentloaded"});
  await page.waitForTimeout(1200);
  const pw = page.locator('input[type="password"]');
  const n = await pw.count();
  console.log(`     (password inputs on the form: ${n})`);
  for (let i=0;i<n;i++) await pw.nth(i).fill(NEWPW);   // new + confirm
  const submitBtn = page.locator("button[type=submit], button").filter({ hasText: /update|change|set password|save/i }).first();
  console.log(`     (submit button text: ${JSON.stringify(await submitBtn.innerText().catch(()=>"<none>"))})`);
  await submitBtn.click();
  // The success state is a card on the SAME url, not a redirect.
  const reachedDone = await page.waitForFunction(
    () => /password updated/i.test(document.body.innerText), { timeout: 30000 }
  ).then(()=>true).catch(()=>false);
  const afterText = await page.innerText("body");
  ok("success card 'Password updated' appears", reachedDone, afterText.slice(0,300).replace(/\n/g," "));
  await page.screenshot({path:"_cp_pilot_verify/screens/06b-done.png"});

  // The bug this run found: the CTA used to be a hardcoded faculty link.
  ok("success CTA does NOT point at a faculty route",
     !(await page.locator('a[href^="/faculty"]').count()),
     `faculty links: ${await page.locator('a[href^="/faculty"]').count()}`);
  const cta = await page.locator("a[href]").last().getAttribute("href");
  ok("success CTA points at the student dashboard", cta === "/student/dashboard", `href=${cta}`);
  ok("success copy is not the faculty 'add your first subject' line",
     !/add your first subject/i.test(afterText), afterText.slice(0,200).replace(/\n/g," "));

  // 5. must_change_password actually cleared (CP-01 made this an admin-client write)
  await new Promise(r=>setTimeout(r,1500));
  const { data: prof } = await admin.from("profiles").select("must_change_password, branch, semester").eq("email",EMAIL).single();
  ok("must_change_password cleared in the DB", prof?.must_change_password === false, JSON.stringify(prof));
  ok("branch/semester survived the flow", prof?.branch==="CSE" && prof?.semester===3, JSON.stringify(prof));

  // 6. Student can now reach the app and actually SEES subjects
  await page.goto(`${BASE}/student/subjects`,{waitUntil:"domcontentloaded"});
  await page.waitForTimeout(3500);
  const body = await page.innerText("body");
  ok("reaches /student/subjects after the change", page.url().includes("/student/subjects"), `url=${page.url()}`);
  ok("subject list is NOT empty for this cohort",
     !/no subjects|nothing here|empty/i.test(body) && body.length>300,
     body.slice(0,220).replace(/\n/g," "));
  await page.screenshot({path:"_cp_pilot_verify/screens/07-subjects.png",fullPage:true});

  // 7. Fresh login with the NEW password must not re-trigger the gate
  const ctx2=await browser.newContext({viewport:{width:1280,height:900}});
  const p2=await ctx2.newPage();
  const p2errs:string[]=[];
  p2.on("console",m=>{if(m.type()==="error")p2errs.push(m.text());});
  p2.on("response", async r => {
    if (r.url().includes("/auth/v1/token")) {
      let detail = "";
      try { detail = JSON.stringify(await r.json()).slice(0,220); } catch {}
      console.log(`     [auth token] status=${r.status()} ${detail}`);
    }
  });
  await p2.goto(`${BASE}/login`,{waitUntil:"domcontentloaded"});
  // Wait for hydration: filling before React attaches leaves the controlled
  // inputs' state empty, and the form rejects with "Please enter your email."
  await p2.locator('input[type="email"]').waitFor({ state: "visible" });
  await p2.waitForTimeout(1200);
  await p2.locator('input[type="email"]').click();
  await p2.locator('input[type="email"]').fill(EMAIL);
  await p2.locator('input[type="password"]').click();
  await p2.locator('input[type="password"]').fill(NEWPW);
  const filled = await p2.locator('input[type="email"]').inputValue();
  ok("login form actually holds the email before submit", filled === EMAIL, `got "${filled}"`);
  await p2.getByRole("button",{name:/sign in|log in|login/i}).first().click();
  await p2.waitForURL(/\/student\//, { timeout: 45000 }).catch(()=>{});
  await p2.waitForTimeout(1500);
  const p2body = await p2.innerText("body").catch(()=>"");
  if (p2.url().includes("/login")) console.log(`     [login page text] ${p2body.replace(/\n/g," ").slice(0,260)}`);
  if (p2errs.length) console.log(`     [p2 console errors] ${p2errs.slice(0,3).join(" | ")}`);
  ok("re-login with the new password goes straight to the app",
     !p2.url().includes("/auth/change-password") && !p2.url().includes("/login"), `url=${p2.url()}`);
  await ctx2.close();

  // 8. Old temp password must no longer work
  const anon2=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const { error: oldErr } = await anon2.auth.signInWithPassword({ email:EMAIL, password:TEMP });
  ok("old temp password is rejected after the change", !!oldErr, oldErr?.message ?? "STILL ACCEPTED");

  ok("no console errors across the whole onboarding flow", errs.length===0, errs.slice(0,3).join(" | "));
} finally {
  await browser.close();
  const { data: u } = await admin.auth.admin.listUsers();
  const probe = u?.users.find(x=>x.email===EMAIL);
  if (probe) { await admin.auth.admin.deleteUser(probe.id); console.log(`\ncleanup: deleted ${EMAIL}`); }
  const { data: residue } = await admin.from("profiles").select("id").eq("email",EMAIL);
  console.log(`cleanup residue: ${residue?.length ?? 0} profile rows left (want 0)`);
  console.log(`\n──────────────\n  PASS ${pass}   FAIL ${fail}\n`);
  process.exit(fail?1:0);
}
