import type { ReactNode } from "react";

import {
  CheckCircle,
  GraduationCap,
  LayoutDashboard,
  Upload,
  Users,
} from "lucide-react";

import { NavLink } from "@/components/layout/NavLink";
import { LogoutButton } from "@/components/layout/LogoutButton";
import { Badge } from "@/components/ui/badge";

interface LayoutProps {
  children: ReactNode;
}

export default function SuperadminLayout({ children }: LayoutProps) {
  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <aside className="fixed inset-y-0 left-0 flex w-64 flex-col border-r bg-card">
        <div className="flex items-center gap-2 border-b px-4 py-4">
          <GraduationCap className="size-6 text-primary" />
          <div className="flex flex-col">
            <span className="text-sm font-semibold">EduNexus AI</span>
            <span className="text-xs text-muted-foreground">
              Admin Portal
            </span>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto space-y-1 px-2 py-4">
          <NavLink href="/superadmin/dashboard">
            <LayoutDashboard className="size-4" />
            <span>Dashboard</span>
          </NavLink>
          <NavLink href="/superadmin/upload">
            <Upload className="size-4" />
            <span>Upload Content</span>
          </NavLink>
          <NavLink href="/superadmin/approvals">
            <CheckCircle className="size-4" />
            <span>Approvals</span>
          </NavLink>
          <NavLink href="/superadmin/faculty">
            <Users className="size-4" />
            <span>Faculty Management</span>
          </NavLink>
        </nav>

        <div className="flex-shrink-0 border-t px-4 py-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">User</p>
              <p className="truncate text-xs text-muted-foreground">
                —
              </p>
            </div>
            <Badge className="shrink-0">Admin</Badge>
          </div>
          <LogoutButton />
        </div>
      </aside>

      <main className="ml-64 flex-1 overflow-auto p-6">{children}</main>
    </div>
  );
}
