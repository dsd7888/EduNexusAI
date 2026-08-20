/**
 * Verifies the pilot-readiness commit (53efa20) against the live DB + dev server.
 * Cleans up every row it creates, in finally AND on signals (CLAUDE.md rule).
 */
import { createClient } from "@supabase/supabase-js";
import fs from "fs";

const env = Object.fromEntries(
  fs.readFileSync(".env.local","utf8").split("\n").filter(l=>l.includes("="))
    .map(l=>{const i=l.indexOf("=");return [l.slice(0,i),l.slice(i+1)];})
);
// createAdminClient() reads process.env, which Next populates for the dev
// server but nothing populates for a bare tsx process. Without this the
// helpers under test can't reach the DB at all.
for (const [k, val] of Object.entries(env)) if (!process.env[k]) process.env[k] = val;

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const REF = new URL(SUPABASE_URL).hostname.split(".")[0];
const BASE = "http://localhost:3000";
const admin = createClient(SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const anon  = createClient(SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

let pass=0, fail=0;
function ok(n: string, c: boolean, d = ""): void {
  if (c) { pass++; console.log(`  PASS  ${n}`); }
  else { fail++; console.log(`  FAIL  ${n}  ${d}`); }
}

const created: { table: string; id: string }[] = [];
const seeded: { user: string; event: string }[] = [];
async function cleanup() {
  for (const c of created) await admin.from(c.table).delete().eq("id", c.id);
  for (const s of seeded) await admin.from("usage_analytics").delete()
    .eq("user_id", s.user).eq("event_type", s.event).eq("date", new Date().toISOString().slice(0,10));
}
for (const sig of ["SIGINT","SIGTERM","SIGHUP","SIGPIPE"] as const)
  process.on(sig, () => { void cleanup().then(()=>process.exit(1)); });

try {
  const { data: link } = await admin.auth.admin.generateLink({ type:"magiclink", email:"teststudent@gmail.com" });
  const { data: v } = await anon.auth.verifyOtp({ token_hash: link!.properties.hashed_token, type:"magiclink" });
  const session = v!.session!, uid = session.user.id;
  const cookie = `sb-${REF}-auth-token=base64-${Buffer.from(JSON.stringify(session),"utf8").toString("base64url")}`;
  const H = { "Content-Type":"application/json", Cookie: cookie };
  const TODAY = new Date().toISOString().slice(0,10);

  // ── 1. app_error_logs write path (migration now applied) ──────────────────
  console.log("\n1. app_error_logs write path");
  const { persistAppError } = await import("../src/lib/api/helpers.ts");
  const canary = `pilot-verify-canary-${crypto.randomUUID()}`;
  persistAppError({
    scope: "[pilot-verify]", route: "/api/__probe__", httpMethod: "POST",
    userId: uid, userEmail: "teststudent@gmail.com", userRole: "student",
    message: canary, stack: "Error: synthetic\n  at probe", origin: "handled",
  });
  await new Promise(r => setTimeout(r, 2500));
  const { data: rows } = await admin.from("app_error_logs").select("*").eq("message", canary);
  ok("a row landed in app_error_logs", (rows?.length ?? 0) === 1, `got ${rows?.length}`);
  if (rows?.[0]) {
    created.push({ table:"app_error_logs", id: rows[0].id });
    ok("every column round-tripped",
      rows[0].scope==="[pilot-verify]" && rows[0].route==="/api/__probe__" &&
      rows[0].user_id===uid && rows[0].origin==="handled" && !!rows[0].stack,
      JSON.stringify(rows[0]).slice(0,200));
  }
  // RLS: the table must be invisible to a real student session
  const asStudent = createClient(SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { global:{ headers:{ Authorization:`Bearer ${session.access_token}` } } });
  const { data: sRows, error: sErr } = await asStudent.from("app_error_logs").select("*");
  ok("student session reads ZERO error rows", (sRows?.length ?? 0) === 0, `got ${sRows?.length}`);
  ok("...and gets no error either (RLS match-none, not a broken query)", !sErr, sErr?.message ?? "");
  ok("canary appears nowhere in the student's payload", !JSON.stringify(sRows ?? []).includes(canary));

  // superadmin read route
  const { data: su } = await admin.from("profiles").select("email").eq("role","superadmin").limit(1).single();
  if (su?.email) {
    const { data: sl } = await admin.auth.admin.generateLink({ type:"magiclink", email: su.email });
    const { data: sv } = await anon.auth.verifyOtp({ token_hash: sl!.properties.hashed_token, type:"magiclink" });
    const sc = `sb-${REF}-auth-token=base64-${Buffer.from(JSON.stringify(sv!.session),"utf8").toString("base64url")}`;
    const r = await fetch(`${BASE}/api/admin/errors?sinceHours=1`, { headers:{ Cookie: sc } });
    const b = await r.json();
    ok("superadmin CAN read /api/admin/errors", r.status===200, `${r.status} ${JSON.stringify(b).slice(0,150)}`);
    ok("...and the canary is in it", JSON.stringify(b).includes(canary));
  }
  const rStudent = await fetch(`${BASE}/api/admin/errors`, { headers:{ Cookie: cookie } });
  ok("student is REJECTED by /api/admin/errors", rStudent.status===403 || rStudent.status===401, `got ${rStudent.status}`);

  // ── 2. chat_suggestions cap degrades instead of erroring ──────────────────
  console.log("\n2. chat_suggestions cap (degrade, don't 429)");
  const { data: subj } = await admin.from("subject_offerings")
    .select("subject_id").eq("branch","CSE").eq("semester",3).limit(1).single();
  const SUBJ = subj!.subject_id as string;
  await admin.from("usage_analytics").delete().eq("user_id",uid).eq("event_type","chat_suggestions").eq("date",TODAY);
  await admin.from("usage_analytics").insert({ user_id:uid, event_type:"chat_suggestions", date:TODAY, event_count:30, subject_id:SUBJ });
  seeded.push({ user:uid, event:"chat_suggestions" });

  const { count: before } = await admin.from("ai_call_logs")
    .select("id",{count:"exact",head:true}).eq("user_id",uid).gte("created_at",new Date(Date.now()-60000).toISOString());
  const sugRes = await fetch(`${BASE}/api/chat/suggestions`, { method:"POST", headers:H,
    body: JSON.stringify({ subjectId: SUBJ, syllabusContent: "Data structures: arrays, stacks, queues, trees." }) });
  const sug = await sugRes.json();
  ok("at cap, suggestions still returns 200 (no 429)", sugRes.status===200, `got ${sugRes.status}`);
  ok("at cap, returns exactly 4 suggestions", Array.isArray(sug.suggestions) && sug.suggestions.length===4);
  ok("at cap, returns the DEFAULT set", String(sug.suggestions?.[0]).includes("most important concept"), String(sug.suggestions?.[0]));
  await new Promise(r=>setTimeout(r,2000));
  const { count: after } = await admin.from("ai_call_logs")
    .select("id",{count:"exact",head:true}).eq("user_id",uid).gte("created_at",new Date(Date.now()-62000).toISOString());
  ok("at cap, NO ai_call_logs row was written (no spend)", (after ?? 0) === (before ?? 0), `${before} -> ${after}`);

  // ── 3. placement_prep_generate: bank path free, generation path capped ────
  console.log("\n3. placement_prep_generate cap ordering (bank free, generation capped)");
  await admin.from("usage_analytics").delete().eq("user_id",uid).eq("event_type","placement_prep_generate").eq("date",TODAY);
  await admin.from("usage_analytics").insert({ user_id:uid, event_type:"placement_prep_generate", date:TODAY, event_count:25, subject_id:null });
  seeded.push({ user:uid, event:"placement_prep_generate" });

  // Disposable student: teststudent has now attempted every bank question for
  // this topic across repeated runs, and seenIds excludes anything attempted in
  // the last 30 days — so the bank can no longer serve it and the request
  // correctly falls through to the capped generation path. That drift would
  // make this assertion test the fixture rather than the ordering decision.
  const capEmail = `capprobe-${crypto.randomUUID().slice(0,8)}@edunexus-harness.invalid`;
  const { data: capUser } = await admin.auth.admin.createUser({
    email: capEmail, password: `Pw!${crypto.randomUUID().slice(0,12)}`, email_confirm: true,
    user_metadata: { full_name: "Cap Probe" },
  });
  const capUid = capUser!.user!.id;
  await admin.from("profiles").upsert({ id: capUid, email: capEmail, full_name: "Cap Probe",
    role: "student", branch: "CSE", semester: 3, must_change_password: false }, { onConflict: "id" });
  const { data: capLink } = await admin.auth.admin.generateLink({ type:"magiclink", email: capEmail });
  const { data: capV } = await anon.auth.verifyOtp({ token_hash: capLink!.properties.hashed_token, type:"magiclink" });
  const capH = { "Content-Type":"application/json",
    Cookie: `sb-${REF}-auth-token=base64-${Buffer.from(JSON.stringify(capV!.session),"utf8").toString("base64url")}` };
  // Put this fresh student at the cap.
  await admin.from("usage_analytics").insert({ user_id: capUid, event_type:"placement_prep_generate", date: TODAY, event_count: 25, subject_id: null });

  const { data: bank } = await admin.from("placement_question_bank").select("track,topic").eq("is_active",true).limit(1).single();
  const bankRes = await fetch(`${BASE}/api/placement/prep/generate`, { method:"POST", headers:capH,
    body: JSON.stringify({ track: bank!.track, topic: bank!.topic }) });
  const bankBody = await bankRes.json();
  const src = bankBody.source ?? bankBody.data?.source;
  ok("at cap, a BANK-covered topic still succeeds (not charged)", bankRes.status===200, `got ${bankRes.status}`);
  ok("...and it was served from the bank", src==="bank", `source=${src}`);

  const novelRes = await fetch(`${BASE}/api/placement/prep/generate`, { method:"POST", headers:capH,
    body: JSON.stringify({ track:"aptitude", topic:`Probability of ${crypto.randomUUID().slice(0,8)} events` }) });
  ok("at cap, a NOVEL topic (needs generation) is 429'd", novelRes.status===429, `got ${novelRes.status}`);
  await admin.auth.admin.deleteUser(capUid);

  // ── 4. Budget guard ───────────────────────────────────────────────────────
  console.log("\n4. AI budget guard");
  const { assertAiBudget, AiBudgetExceededError, resetAiBudgetCache } = await import("../src/lib/ai/budget.ts");
  process.env.AI_KILL_SWITCH = "true";
  let killed = false;
  try { await assertAiBudget("probe"); } catch (e) { killed = e instanceof AiBudgetExceededError && (e as { reason?: string }).reason === "kill_switch"; }
  ok("AI_KILL_SWITCH=true blocks immediately", killed);

  process.env.AI_KILL_SWITCH = "false";
  process.env.AI_DAILY_BUDGET_INR = "0.0001";
  resetAiBudgetCache();
  let overBudget = false;
  try { await assertAiBudget("probe"); } catch (e) { overBudget = e instanceof AiBudgetExceededError && (e as { reason?: string }).reason === "daily_budget"; }
  ok("a tiny AI_DAILY_BUDGET_INR blocks on real logged spend", overBudget);

  process.env.AI_DAILY_BUDGET_INR = "0";
  resetAiBudgetCache();
  let disabledOk = true;
  try { await assertAiBudget("probe"); } catch { disabledOk = false; }
  ok("AI_DAILY_BUDGET_INR=0 disables the ceiling", disabledOk);

  // Fail-open: if the spend total can't be read, AI must NOT go offline.
  const savedUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "";
  process.env.AI_DAILY_BUDGET_INR = "0.0001";
  resetAiBudgetCache();
  let failedOpen = true;
  try { await assertAiBudget("probe"); } catch { failedOpen = false; }
  ok("unreadable spend total FAILS OPEN (does not block every student)", failedOpen);
  process.env.NEXT_PUBLIC_SUPABASE_URL = savedUrl;

  process.env.AI_DAILY_BUDGET_INR = "999999";
  resetAiBudgetCache();
  let normalOk = true;
  try { await assertAiBudget("probe"); } catch { normalOk = false; }
  ok("a generous budget lets calls through", normalOk);
} finally {
  await cleanup();
  const { data: residue } = await admin.from("app_error_logs").select("id").like("message","pilot-verify-canary-%");
  console.log(`\ncleanup residue check: ${residue?.length ?? 0} canary rows left (want 0)`);
  console.log(`\n──────────────\n  PASS ${pass}   FAIL ${fail}\n`);
  process.exit(fail ? 1 : 0);
}
