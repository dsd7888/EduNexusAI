 "use client";

import type { ReactNode } from "react";
import { useState } from "react";

import {
  BookOpen,
  Brain,
  Clock,
  GraduationCap,
  History,
  LayoutDashboard,
  MessageSquare,
  Menu,
  Target,
  User,
  X,
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
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const SidebarContent = () => (
    <>
      <div className="flex items-center justify-between gap-2 border-b px-4 py-4">
        <div className="flex items-center gap-2">
          <GraduationCap className="size-6 text-primary" />
          <div className="flex flex-col">
            <span className="text-sm font-semibold">EduNexus AI</span>
            <span className="text-xs text-muted-foreground">
              Student Portal
            </span>
          </div>
        </div>
        <button
          type="button"
          className="inline-flex size-8 items-center justify-center rounded-md border bg-background text-muted-foreground hover:bg-muted lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
          aria-label="Close menu"
        >
          <X className="size-4" />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto space-y-1 px-2 py-4">
        <NavLink href="/student/dashboard">
          <LayoutDashboard className="size-4" />
          <span>Dashboard</span>
        </NavLink>
        <NavLink href="/student/chat">
          <MessageSquare className="size-4" />
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
        <NavLink href="/student/placement">
          <Target className="size-4" />
          <span>Placement Prep</span>
        </NavLink>
        <NavLink href="/student/placement/history">
          <History className="size-4" />
          <span>Test History</span>
        </NavLink>
        <NavLink href="/student/history">
          <Clock className="size-4" />
          <span>Chat History</span>
        </NavLink>
        <NavLink href="/student/profile">
          <User className="size-4" />
          <span>Profile</span>
        </NavLink>
      </nav>

      <div className="shrink-0 px-4 py-4">
        <div className="mb-3">
          <UserProfile />
        </div>
        <LogoutButton />
      </div>
    </>
  );

  return (
    <div className="flex min-h-screen bg-background">
      {/* Mobile top bar */}
      <div className="fixed inset-x-0 top-0 z-30 flex items-center justify-between border-b bg-background/80 px-4 py-3 backdrop-blur lg:hidden">
        <button
          type="button"
          className="inline-flex size-9 items-center justify-center rounded-md border bg-background text-muted-foreground hover:bg-muted"
          onClick={() => setMobileMenuOpen(true)}
          aria-label="Open menu"
        >
          <Menu className="size-5" />
        </button>
        <div className="flex flex-col items-center">
          <span className="text-sm font-semibold">EduNexus AI</span>
          <span className="text-[11px] text-muted-foreground">
            Student Portal
          </span>
        </div>
        <div className="flex items-center justify-center">
          <div className="flex size-9 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
            S
          </div>
        </div>
      </div>

      {/* Desktop sidebar */}
      <aside className="hidden lg:fixed lg:inset-y-0 lg:left-0 lg:flex lg:w-64 lg:flex-col lg:border-r lg:bg-card">
        <SidebarContent />
      </aside>

      {/* Mobile sidebar overlay */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-40 flex lg:hidden">
          <button
            type="button"
            className="h-full w-full bg-black/50"
            onClick={() => setMobileMenuOpen(false)}
            aria-label="Close menu overlay"
          />
          <aside className="relative h-full w-72 max-w-full bg-card shadow-lg flex flex-col border-r">
            <SidebarContent />
          </aside>
        </div>
      )}

      {/* Main content */}
      <main className="flex-1 overflow-auto px-4 pb-6 pt-20 sm:px-6 lg:ml-64 lg:px-8 lg:pt-6">
        <ErrorBoundary>{children}</ErrorBoundary>
      </main>
    </div>
  );
}
