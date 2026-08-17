 "use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

import {
  BookOpen,
  Brain,
  Clock,
  GraduationCap,
  LayoutDashboard,
  MessageSquare,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Target,
  User,
  X,
} from "lucide-react";

import { NavLink } from "@/components/layout/NavLink";
import { LogoutButton } from "@/components/layout/LogoutButton";
import { UserProfile } from "@/components/layout/UserProfile";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { SessionTracker } from "@/components/layout/SessionTracker";
import { cn } from "@/lib/utils";

interface LayoutProps {
  children: ReactNode;
}

const NAV_ITEMS = [
  { href: "/student/dashboard", label: "Dashboard", icon: <LayoutDashboard className="size-4" /> },
  { href: "/student/chat", label: "AI Chat", icon: <MessageSquare className="size-4" /> },
  { href: "/student/subjects", label: "Subjects", icon: <BookOpen className="size-4" /> },
  { href: "/student/quiz", label: "Quiz", icon: <Brain className="size-4" /> },
  { href: "/student/placement", label: "Placement", icon: <Target className="size-4" /> },
  { href: "/student/history", label: "Chat History", icon: <Clock className="size-4" /> },
  { href: "/student/profile", label: "Profile", icon: <User className="size-4" /> },
];

function SidebarContent({
  onNavigate,
  collapsed = false,
  onToggleCollapse,
}: {
  onNavigate: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  return (
    <>
      <div
        className={cn(
          "flex items-center justify-between gap-2 border-b py-4",
          collapsed ? "justify-center px-2" : "px-4"
        )}
      >
        {!collapsed && (
          <div className="flex items-center gap-2">
            <GraduationCap className="size-6 text-primary" />
            <div className="flex flex-col">
              <span className="text-sm font-semibold">EduNexus AI</span>
              <span className="text-xs text-muted-foreground">
                Student Portal
              </span>
            </div>
          </div>
        )}
        {collapsed && <GraduationCap className="size-6 shrink-0 text-primary" />}
        {onToggleCollapse && (
          <button
            type="button"
            onClick={onToggleCollapse}
            title={collapsed ? "Expand menu" : "Collapse menu"}
            className="hidden shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground lg:inline-flex"
          >
            {collapsed ? (
              <PanelLeftOpen className="size-4" />
            ) : (
              <PanelLeftClose className="size-4" />
            )}
          </button>
        )}
        <button
          type="button"
          className="inline-flex size-8 items-center justify-center rounded-md border bg-background text-muted-foreground hover:bg-muted lg:hidden"
          onClick={onNavigate}
          aria-label="Close menu"
        >
          <X className="size-4" />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto space-y-1 px-2 py-4">
        {NAV_ITEMS.map((item) => (
          <NavLink key={item.href} href={item.href} icon={item.icon} collapsed={collapsed}>
            {item.label}
          </NavLink>
        ))}
      </nav>

      {!collapsed && (
        <div className="shrink-0 px-4 py-4">
          <div className="mb-3">
            <UserProfile />
          </div>
          <LogoutButton />
        </div>
      )}
    </>
  );
}

export default function StudentLayout({ children }: LayoutProps) {
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  // Start expanded on both server and client render to keep hydration in
  // sync; the saved preference (if any) is applied after mount.
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    Promise.resolve().then(() => {
      const saved = localStorage.getItem("student_nav_collapsed");
      if (saved === "true") setCollapsed(true);
    });
  }, []);
  // Reset-on-navigation is done during render (React's documented pattern
  // for "adjust state when a prop changes") rather than in an effect, to
  // avoid an extra post-navigation render.
  const [prevPathname, setPrevPathname] = useState(pathname);
  if (pathname !== prevPathname) {
    setPrevPathname(pathname);
    setCollapsed(true);
  }

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      const next = !c;
      localStorage.setItem("student_nav_collapsed", String(next));
      return next;
    });
  };

  return (
    <div className="flex min-h-screen bg-background">
      <SessionTracker />
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
      <aside
        className={cn(
          "hidden lg:fixed lg:inset-y-0 lg:left-0 lg:flex lg:flex-col lg:border-r lg:bg-card lg:transition-[width] lg:duration-200 lg:ease-in-out",
          collapsed ? "lg:w-16" : "lg:w-64"
        )}
      >
        <SidebarContent
          onNavigate={() => setMobileMenuOpen(false)}
          collapsed={collapsed}
          onToggleCollapse={toggleCollapsed}
        />
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
            <SidebarContent onNavigate={() => setMobileMenuOpen(false)} />
          </aside>
        </div>
      )}

      {/* Main content */}
      <main
        className={cn(
          "h-dvh flex-1 overflow-auto px-4 pb-6 pt-20 sm:px-6 lg:px-8 lg:pt-6 lg:transition-[margin] lg:duration-200 lg:ease-in-out",
          collapsed ? "lg:ml-16" : "lg:ml-64"
        )}
      >
        <ErrorBoundary>{children}</ErrorBoundary>
      </main>
    </div>
  );
}
