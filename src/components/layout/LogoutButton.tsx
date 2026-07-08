"use client";

import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";

import { createBrowserClient } from "@/lib/db/supabase-browser";
import { Button } from "@/components/ui/button";
import { endSession } from "@/lib/session/client";

export function LogoutButton() {
  const router = useRouter();

  const handleLogout = async () => {
    // End the tracked session before signing out (best-effort, short timeout inside).
    await endSession("manual_logout");
    const supabase = createBrowserClient();
    await supabase.auth.signOut();
    router.push("/login");
  };

  return (
    <Button
      variant="ghost"
      size="sm"
      className="w-full justify-start gap-2 text-muted-foreground hover:text-foreground"
      onClick={handleLogout}
    >
      <LogOut className="h-4 w-4" />
      Sign Out
    </Button>
  );
}
