import { createServerClient } from "@/lib/db/supabase-server";
import { redirect } from "next/navigation";

export default async function HomePage() {
  const supabase = await createServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!profile) {
    redirect("/login");
  }

  switch (profile.role) {
    case "superadmin":
    case "dept_admin":
      redirect("/superadmin/dashboard");
    case "faculty":
      redirect("/faculty/dashboard");
    case "student":
      redirect("/student/subjects");
    default:
      redirect("/login");
  }
}

