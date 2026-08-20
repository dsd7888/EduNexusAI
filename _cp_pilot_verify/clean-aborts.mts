import { createClient } from "@supabase/supabase-js";
import fs from "fs";
const env = Object.fromEntries(fs.readFileSync(".env.local","utf8").split("\n").filter(l=>l.includes("=")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i),l.slice(i+1)];}));
const admin=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY);
const { data } = await admin.from("app_error_logs").select("id").ilike("message","%aborted%");
for (const r of data ?? []) await admin.from("app_error_logs").delete().eq("id", r.id);
const { count } = await admin.from("app_error_logs").select("id",{count:"exact",head:true});
console.log(`removed ${data?.length ?? 0} pre-filter abort rows; app_error_logs now has ${count} row(s)`);
