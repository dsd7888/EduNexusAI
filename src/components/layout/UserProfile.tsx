"use client";

import { useEffect, useState } from "react";

import { createBrowserClient } from "@/lib/db/supabase-browser";
import { Skeleton } from "@/components/ui/skeleton";

type Profile = {
  full_name: string | null;
  role: "superadmin" | "faculty" | "student" | string;
  branch: string | null;
  semester: number | null;
  email: string | null;
};

export function UserProfile() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    const run = async () => {
      try {
        const supabase = createBrowserClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user || !isMounted) {
          if (isMounted) setIsLoading(false);
          return;
        }

        const { data } = await supabase
          .from("profiles")
          .select("full_name, role, branch, semester, email")
          .eq("id", user.id)
          .single();

        if (!isMounted) return;
        setProfile(data as Profile);
      } catch (err) {
        console.error("[UserProfile] Failed to load profile:", err);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    run();

    return () => {
      isMounted = false;
    };
  }, []);

  const initial =
    (profile?.full_name ?? "")
      .trim()
      .charAt(0)
      .toUpperCase() || "?";

  const role = profile?.role ?? "";
  let roleLabel = "User";
  let roleClass =
    "inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-700";

  if (role === "superadmin") {
    roleLabel = "Superadmin";
    roleClass =
      "inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-700";
  } else if (role === "faculty") {
    roleLabel = "Faculty";
    roleClass =
      "inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700";
  } else if (role === "student") {
    roleLabel = "Student";
    roleClass =
      "inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-700";
  }

  return (
    <div className="border-t pt-4">
      {isLoading ? (
        <div className="flex items-center gap-3">
          <Skeleton className="h-9 w-9 rounded-full" />
          <div className="flex flex-1 flex-col gap-1">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-3 w-16" />
          </div>
        </div>
      ) : profile ? (
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
            {initial}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">
              {profile.full_name ?? profile.email ?? "User"}
            </p>
            <div className="mt-0.5 flex flex-wrap items-center gap-1">
              <span className={roleClass}>{roleLabel}</span>
              {profile.role === "student" && profile.semester != null && (
                <span className="text-[11px] text-muted-foreground">
                  Sem {profile.semester}
                  {profile.branch
                    ? ` · ${String(profile.branch).toUpperCase()}`
                    : ""}
                </span>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-sm font-bold text-muted-foreground">
            ?
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">Guest</p>
            <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-700">
              Not signed in
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

