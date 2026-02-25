import type { ReactNode } from "react";

import {
  BarChart2,
  FileText,
  GitPullRequest,
  GraduationCap,
  LayoutDashboard,
  Presentation,
  Sparkles,
} from "lucide-react";

import { NavLink } from "@/components/layout/NavLink";
import { LogoutButton } from "@/components/layout/LogoutButton";
import { UserProfile } from "@/components/layout/UserProfile";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Badge } from "@/components/ui/badge";

interface LayoutProps {
  children: ReactNode;
}

export default function FacultyLayout({ children }: LayoutProps) {
  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <aside className="fixed inset-y-0 left-0 flex w-64 flex-col border-r bg-card">
        <div className="flex items-center gap-2 border-b px-4 py-4">
          <GraduationCap className="size-6 text-primary" />
          <div className="flex flex-col">
            <span className="text-sm font-semibold">EduNexus AI</span>
            <span className="text-xs text-muted-foreground">
              Faculty Workspace
            </span>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto space-y-1 px-2 py-4">
          <NavLink href="/faculty/dashboard">
            <LayoutDashboard className="size-4" />
            <span>Dashboard</span>
          </NavLink>
          <NavLink href="/faculty/generate">
            <Presentation className="size-4" />
            <span>Generate PPT</span>
          </NavLink>
          <NavLink href="/faculty/qpaper">
            <FileText className="size-4" />
            <span>Question Paper</span>
          </NavLink>
          <NavLink href="/faculty/refine">
            <Sparkles className="size-4" />
            <span>Refine Content</span>
          </NavLink>
          <NavLink href="/faculty/analytics">
            <BarChart2 className="size-4" />
            <span>Analytics</span>
          </NavLink>
          <NavLink href="/faculty/request-change">
            <GitPullRequest className="size-4" />
            <span>Request Change</span>
          </NavLink>
        </nav>

        <div className="flex-shrink-0 px-4 py-4">
          <div className="mb-3">
            <UserProfile />
          </div>
          <LogoutButton />
        </div>
      </aside>

      <main className="ml-64 flex-1 overflow-auto p-6">
        <ErrorBoundary>{children}</ErrorBoundary>
      </main>
    </div>
  );
}
