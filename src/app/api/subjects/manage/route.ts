 import {
   createAdminClient,
   createServerClientForRequestResponse,
 } from "@/lib/db/supabase-server";
 import { type NextRequest, NextResponse } from "next/server";
 
 type ManageType = "subject" | "module";
 type ManageAction = "create" | "delete";
 
 export async function POST(request: NextRequest) {
   try {
     const response = NextResponse.next();
     const supabase = createServerClientForRequestResponse(request, response);
     const {
       data: { user },
       error: authError,
     } = await supabase.auth.getUser();
 
     if (authError || !user) {
       return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
     }
 
     const adminClient = createAdminClient();
     const { data: profile, error: profileError } = await adminClient
       .from("profiles")
       .select("role")
       .eq("id", user.id)
       .single();
 
     if (profileError || !profile) {
       return NextResponse.json({ error: "Profile not found" }, { status: 500 });
     }
 
     if (profile.role !== "superadmin") {
       return NextResponse.json(
         { error: "Forbidden: Superadmin only" },
         { status: 403 }
       );
     }
 
     const body = await request.json();
     const type = body?.type as ManageType | undefined;
     const action = body?.action as ManageAction | undefined;
     const data = body?.data as Record<string, unknown> | undefined;
 
     if (!type || !action || !data) {
       return NextResponse.json(
         { error: "type, action, and data are required" },
         { status: 400 }
       );
     }
 
     if (type === "subject" && action === "create") {
       const name = String(data?.name ?? "").trim();
       const code = String(data?.code ?? "").trim().toUpperCase();
       const department = String(data?.department ?? "").trim();
       const branch = String(data?.branch ?? "").trim();
       const semesterRaw = data?.semester;
       const semester =
         typeof semesterRaw === "number"
           ? semesterRaw
           : Number(String(semesterRaw ?? ""));
 
       if (!name || !code || !department || !branch || !semester) {
         return NextResponse.json(
           { error: "Missing required fields" },
           { status: 400 }
         );
       }
 
       const { data: created, error: insertError } = await adminClient
         .from("subjects")
         .insert({
           name,
           code,
           department,
           branch,
           semester,
         })
         .select("id")
         .single();
 
       if (insertError) {
         console.error("[subjects/manage] subject create error:", insertError);
         if (insertError.code === "23505") {
           return NextResponse.json(
             { error: "Subject already exists (duplicate code)" },
             { status: 409 }
           );
         }
         return NextResponse.json({ error: insertError.message }, { status: 500 });
       }
 
       return NextResponse.json({ success: true, id: created?.id ?? null });
     }
 
     if (type === "subject" && action === "delete") {
       const subjectId = String(data?.subjectId ?? "").trim();
       if (!subjectId) {
         return NextResponse.json(
           { error: "subjectId is required" },
           { status: 400 }
         );
       }
 
       const { error: deleteError } = await adminClient
         .from("subjects")
         .delete()
         .eq("id", subjectId);
 
       if (deleteError) {
         console.error("[subjects/manage] subject delete error:", deleteError);
         return NextResponse.json({ error: deleteError.message }, { status: 500 });
       }
 
       return NextResponse.json({ success: true });
     }
 
     if (type === "module" && action === "create") {
       const subjectId = String(data?.subjectId ?? "").trim();
       const name = String(data?.name ?? "").trim();
       const descriptionRaw = data?.description;
       const description =
         descriptionRaw === null || descriptionRaw === undefined
           ? null
           : String(descriptionRaw).trim() || null;
       const moduleNumberRaw = data?.moduleNumber;
       const moduleNumber =
         typeof moduleNumberRaw === "number"
           ? moduleNumberRaw
           : Number(String(moduleNumberRaw ?? ""));
 
       if (!subjectId || !name || !moduleNumber) {
         return NextResponse.json(
           { error: "subjectId, moduleNumber, and name are required" },
           { status: 400 }
         );
       }
 
       const { data: subj, error: subjError } = await adminClient
         .from("subjects")
         .select("id")
         .eq("id", subjectId)
         .single();
 
       if (subjError || !subj) {
         return NextResponse.json({ error: "Subject not found" }, { status: 400 });
       }
 
       const { data: created, error: insertError } = await adminClient
         .from("modules")
         .insert({
           subject_id: subjectId,
           module_number: moduleNumber,
           name,
           description,
         })
         .select("id")
         .single();
 
       if (insertError) {
         console.error("[subjects/manage] module create error:", insertError);
         if (insertError.code === "23505") {
           return NextResponse.json(
             { error: "Module already exists (duplicate module number for subject)" },
             { status: 409 }
           );
         }
         return NextResponse.json({ error: insertError.message }, { status: 500 });
       }
 
       return NextResponse.json({ success: true, id: created?.id ?? null });
     }
 
     if (type === "module" && action === "delete") {
       const moduleId = String(data?.moduleId ?? "").trim();
       if (!moduleId) {
         return NextResponse.json(
           { error: "moduleId is required" },
           { status: 400 }
         );
       }
 
       const { error: deleteError } = await adminClient
         .from("modules")
         .delete()
         .eq("id", moduleId);
 
       if (deleteError) {
         console.error("[subjects/manage] module delete error:", deleteError);
         return NextResponse.json({ error: deleteError.message }, { status: 500 });
       }
 
       return NextResponse.json({ success: true });
     }
 
     return NextResponse.json(
       { error: "Unsupported type/action" },
       { status: 400 }
     );
   } catch (err) {
     console.error("[subjects/manage] POST error:", err);
     const message = err instanceof Error ? err.message : "Request failed";
     return NextResponse.json({ error: message }, { status: 500 });
   }
 }
