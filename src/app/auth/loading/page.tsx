"use client";

import { createBrowserClient } from "@/lib/db/supabase-browser";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

type UserRole = "superadmin" | "dept_admin" | "faculty" | "student";

function getDashboardForRole(role: UserRole): string {
  if (role === "superadmin" || role === "dept_admin") return "/superadmin/dashboard";
  if (role === "faculty") return "/faculty/dashboard";
  if (role === "student") return "/student/dashboard";
  return "/";
}

export default function AuthLoadingPage() {
  const router = useRouter();

  useEffect(() => {
    async function redirectByRole() {
      const supabase = createBrowserClient();

      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();

      if (authError || !user) {
        router.replace("/login");
        return;
      }

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .single();

      if (profileError || !profile?.role) {
        router.replace("/login");
        return;
      }

      const role = profile.role as UserRole;
      const dashboard = getDashboardForRole(role);
      router.replace(dashboard);
    }

    redirectByRole();
  }, [router]);

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-4">
        <Loader2 className="size-10 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Redirecting...</p>
      </div>
    </div>
  );
}
