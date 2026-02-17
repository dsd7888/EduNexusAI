"use client";

import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";

import { createBrowserClient } from "@/lib/db/supabase-browser";
import { Button } from "@/components/ui/button";

export function LogoutButton() {
  const router = useRouter();

  const handleLogout = async () => {
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
