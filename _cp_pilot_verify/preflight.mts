import { createClient } from "@supabase/supabase-js";
import fs from "fs";

const env = Object.fromEntries(
  fs.readFileSync(".env.local", "utf8").split("\n").filter((l) => l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1)]; })
);
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

// 1. Is app_error_logs really there?
const { error: aelErr } = await admin.from("app_error_logs").select("id").limit(1);
console.log("app_error_logs reachable:", aelErr ? `NO — ${aelErr.message}` : "YES");

// 2. Do the CP-05/CP-06 RPCs exist? (ledger's word only, until now)
const { error: rpc5 } = await admin.rpc("upsert_placement_topic_mastery", {});
console.log("upsert_placement_topic_mastery:", /could not find|does not exist/i.test(rpc5?.message ?? "") ? `MISSING — ${rpc5?.message}` : "EXISTS (arg error expected)");

// 3. Student accounts available to test with
const { data: students } = await admin.from("profiles")
  .select("id, email, branch, semester, role, must_change_password")
  .eq("role", "student").limit(10);
console.log("\nstudents:", JSON.stringify(students, null, 2));

// 4. Offerings — what cohorts have subjects?
const { data: offerings } = await admin.from("subject_offerings").select("branch, semester");
const counts = new Map<string, number>();
for (const o of offerings ?? []) counts.set(`${o.branch}|${o.semester}`, (counts.get(`${o.branch}|${o.semester}`) ?? 0) + 1);
console.log("\nofferings:", [...counts.entries()].map(([k, v]) => `${k} -> ${v}`).join(", "));

// 5. Placement bank — needed for a real prep session
const { count: bankCount } = await admin.from("placement_question_bank")
  .select("id", { count: "exact", head: true });
console.log("placement_question_bank rows:", bankCount);
