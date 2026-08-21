import { createClient } from "@supabase/supabase-js";
import fs from "fs";
const env = Object.fromEntries(
  fs.readFileSync(".env.local", "utf8").split("\n").filter((l) => l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1)]; })
);
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

// Call with the REAL signature but a nonexistent student, so nothing is mutated.
// If the function exists we get either success or a FK/constraint error — both
// prove existence. Only "could not find the function" proves absence.
const FAKE = "00000000-0000-0000-0000-000000000000";

const { error: e5 } = await admin.rpc("upsert_placement_topic_mastery", {
  p_student_id: FAKE, p_track: "aptitude", p_topic: "__probe__",
  p_session_attempted: 0, p_session_correct: 0, p_session_accuracy: 0,
});
console.log("CP-05 upsert_placement_topic_mastery:",
  !e5 ? "EXISTS (call succeeded)"
  : /could not find the function/i.test(e5.message) ? `ABSENT — ${e5.message}`
  : `EXISTS (rejected as expected: ${e5.message.slice(0,120)})`);

const { error: e6 } = await admin.rpc("reserve_interview_followup", {
  p_user_id: FAKE, p_window_start: new Date().toISOString(), p_cap: 5,
});
console.log("CP-06 reserve_interview_followup:",
  !e6 ? "EXISTS (call succeeded)"
  : /could not find the function/i.test(e6.message) ? `ABSENT — ${e6.message}`
  : `EXISTS (rejected as expected: ${e6.message.slice(0,120)})`);

// CP-01: can a student rewrite their own role? The single highest-severity finding.
const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: "teststudent@gmail.com" });
const { data: v } = await anon.auth.verifyOtp({ token_hash: link!.properties.hashed_token, type: "magiclink" });
const asStudent = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
  global: { headers: { Authorization: `Bearer ${v!.session!.access_token}` } },
});
const { error: escErr } = await asStudent.from("profiles")
  .update({ role: "superadmin" }).eq("id", v!.session!.user.id);
console.log("CP-01 self-escalation to superadmin:",
  escErr ? `BLOCKED (${escErr.code}: ${escErr.message.slice(0,80)})` : "*** ALLOWED — CP-01 IS NOT LIVE ***");

// Confirm the role really is unchanged (an update matching 0 rows also returns no error)
const { data: after } = await admin.from("profiles").select("role").eq("id", v!.session!.user.id).single();
console.log("  role after attempt:", after?.role);
