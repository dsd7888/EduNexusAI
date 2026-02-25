import type { ReactNode } from "react";

import {
  BookOpen,
  Brain,
  GraduationCap,
  History,
  LayoutDashboard,
  MessageCircle,
} from "lucide-react";

import { NavLink } from "@/components/layout/NavLink";
import { LogoutButton } from "@/components/layout/LogoutButton";
import { UserProfile } from "@/components/layout/UserProfile";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Badge } from "@/components/ui/badge";

interface LayoutProps {
  children: ReactNode;
}

export default function StudentLayout({ children }: LayoutProps) {
  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <aside className="fixed inset-y-0 left-0 flex w-64 flex-col border-r bg-card">
        <div className="flex items-center gap-2 border-b px-4 py-4">
          <GraduationCap className="size-6 text-primary" />
          <div className="flex flex-col">
            <span className="text-sm font-semibold">EduNexus AI</span>
            <span className="text-xs text-muted-foreground">
              Student Portal
            </span>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto space-y-1 px-2 py-4">
          <NavLink href="/student/dashboard">
            <LayoutDashboard className="size-4" />
            <span>Dashboard</span>
          </NavLink>
          <NavLink href="/student/chat">
            <MessageCircle className="size-4" />
            <span>AI Chat</span>
          </NavLink>
          <NavLink href="/student/subjects">
            <BookOpen className="size-4" />
            <span>Subjects</span>
          </NavLink>
          <NavLink href="/student/quiz">
            <Brain className="size-4" />
            <span>Quiz</span>
          </NavLink>
          <NavLink href="/student/history">
            <History className="size-4" />
            <span>History</span>
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
