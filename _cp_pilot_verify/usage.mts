import { createClient } from "@supabase/supabase-js";
import fs from "fs";
const env = Object.fromEntries(fs.readFileSync(".env.local","utf8").split("\n").filter(l=>l.includes("=")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i),l.slice(i+1)];}));
const admin=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY);
const today=new Date().toISOString().slice(0,10);
const { data: u } = await admin.from("profiles").select("id").eq("email","teststudent@gmail.com").single();
const { data } = await admin.from("usage_analytics").select("event_type,event_count").eq("user_id",u!.id).eq("date",today);
console.log("teststudent usage today:", JSON.stringify(data));
if (process.argv.includes("--reset")) {
  await admin.from("usage_analytics").delete().eq("user_id",u!.id).eq("date",today)
    .in("event_type",["placement_prep_generate","chat_suggestions"]);
  console.log("reset placement_prep_generate + chat_suggestions for teststudent");
}
