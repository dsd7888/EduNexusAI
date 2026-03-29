"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  BarChart2,
  BookOpen,
  CheckSquare,
  Database,
  GraduationCap,
  Upload,
  Users,
  Zap,
} from "lucide-react";
import { toast } from "sonner";

import { createBrowserClient } from "@/lib/db/supabase-browser";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

interface Stats {
  studentCount: number;
  facultyCount: number;
  subjectCount: number;
  contentCount: number;
  bankTotal: number;
  historyTotal: number;
}

interface UploadRow {
  title: string | null;
  type: string | null;
  created_at: string;
}

export default function SuperadminDashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [pendingApprovals, setPendingApprovals] = useState(0);
  const [recentUploads, setRecentUploads] = useState<UploadRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const run = async () => {
      try {
        const supabase = createBrowserClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
          setIsLoading(false);
          return;
        }

        // 1. Platform stats
        const [
          { count: studentCount },
          { count: facultyCount },
          { count: subjectCount },
          { count: contentCount },
          { count: bankTotal },
          { count: historyTotal },
        ] = await Promise.all([
          supabase
            .from("profiles")
            .select("id", { count: "exact", head: true })
            .eq("role", "student"),
          supabase
            .from("profiles")
            .select("id", { count: "exact", head: true })
            .eq("role", "faculty"),
          supabase
            .from("subjects")
            .select("id", { count: "exact", head: true }),
          supabase
            .from("generated_content")
            .select("id", { count: "exact", head: true })
            .eq("status", "ready"),
          supabase
            .from("placement_question_bank")
            .select("id", { count: "exact", head: true })
            .eq("is_stale", false),
          supabase
            .from("student_question_history")
            .select("id", { count: "exact", head: true }),
        ]);

        setStats({
          studentCount: studentCount ?? 0,
          facultyCount: facultyCount ?? 0,
          subjectCount: subjectCount ?? 0,
          contentCount: contentCount ?? 0,
          bankTotal: bankTotal ?? 0,
          historyTotal: historyTotal ?? 0,
        });

        // 2. Pending approvals
        const { count: approvalsCount } = await supabase
          .from("note_change_requests")
          .select("id", { count: "exact", head: true })
          .eq("status", "pending");
        setPendingApprovals(approvalsCount ?? 0);

        // 3. Recent uploads
        const { data: uploads } = await supabase
          .from("documents")
          .select("title, type, created_at")
          .eq("status", "ready")
          .order("created_at", { ascending: false })
          .limit(5);

        setRecentUploads((uploads ?? []) as UploadRow[]);
      } catch (err) {
        console.error("[superadmin/dashboard] load error:", err);
      } finally {
        setIsLoading(false);
      }
    };

    run();
  }, []);

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });

  const uploadTypeMeta = (type: string | null) => {
    if (type === "syllabus") {
      return {
        label: "Syllabus",
        badgeClass: "bg-blue-100 text-blue-700",
      };
    }
    if (type === "notes") {
      return {
        label: "Notes",
        badgeClass: "bg-emerald-100 text-emerald-700",
      };
    }
    if (type === "pyq") {
      return {
        label: "PYQ",
        badgeClass: "bg-amber-100 text-amber-800",
      };
    }
    return {
      label: type ?? "Other",
      badgeClass: "bg-slate-100 text-slate-700",
    };
  };

  return (
    <div className="space-y-8">
      {/* HEADER */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          EduNexus AI — Admin
        </h1>
        <p className="text-sm text-muted-foreground">
          Pilot Phase Dashboard
        </p>
      </div>

      {/* PLATFORM STATS */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              Students
            </CardTitle>
            <Users className="size-5 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">
              {isLoading ? "—" : stats?.studentCount ?? 0}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              Faculty
            </CardTitle>
            <GraduationCap className="size-5 text-emerald-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">
              {isLoading ? "—" : stats?.facultyCount ?? 0}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              Subjects
            </CardTitle>
            <BookOpen className="size-5 text-purple-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">
              {isLoading ? "—" : stats?.subjectCount ?? 0}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              Content Generated
            </CardTitle>
            <Zap className="size-5 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">
              {isLoading ? "—" : stats?.contentCount ?? 0}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              Questions in Bank
            </CardTitle>
            <Database className="size-5 text-purple-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">
              {isLoading ? "—" : stats?.bankTotal ?? 0}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {isLoading
                ? "—"
                : `${stats?.historyTotal ?? 0} student attempts tracked`}
            </p>
          </CardContent>
        </Card>
      </div>

      <Button
        size="sm"
        variant="outline"
        onClick={async () => {
          try {
            const res = await fetch("/api/admin/cleanup", { method: "POST" });
            const data = await res.json().catch(() => ({} as { error?: string }));
            if (!res.ok) {
              toast.error(data?.error ?? "Cleanup failed");
              return;
            }
            toast.success("Cleanup complete");
          } catch {
            toast.error("Cleanup failed");
          }
        }}
      >
        Run DB Cleanup
      </Button>

      {/* PENDING APPROVALS ALERT */}
      {pendingApprovals > 0 && (
        <Alert className="border-amber-300 bg-amber-50">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          <AlertTitle className="text-sm font-semibold text-amber-900">
            {pendingApprovals} note change request
            {pendingApprovals > 1 ? "s" : ""} pending review
          </AlertTitle>
          <AlertDescription className="mt-2 flex items-center justify-between gap-4 text-xs text-amber-900">
            <span>
              Review and approve or reject pending note updates from faculty.
            </span>
            <Button asChild size="sm" variant="outline">
              <Link href="/superadmin/approvals">Review Now →</Link>
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* QUICK ACTIONS */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold">Quick Actions</h2>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <Link href="/superadmin/upload">
            <Card className="h-full cursor-pointer border-dashed transition-colors hover:border-primary hover:bg-primary/5">
              <CardContent className="flex items-center justify-between gap-4 p-5">
                <div>
                  <p className="text-sm font-semibold">Upload Content</p>
                  <p className="text-xs text-muted-foreground">
                    Add syllabus, notes, or PYQs for subjects.
                  </p>
                </div>
                <Upload className="size-6 text-primary" />
              </CardContent>
            </Card>
          </Link>

          <Link href="/superadmin/faculty">
            <Card className="h-full cursor-pointer border-dashed transition-colors hover:border-primary hover:bg-primary/5">
              <CardContent className="flex items-center justify-between gap-4 p-5">
                <div>
                  <p className="text-sm font-semibold">Manage Faculty</p>
                  <p className="text-xs text-muted-foreground">
                    Assign subjects and manage faculty access.
                  </p>
                </div>
                <Users className="size-6 text-emerald-500" />
              </CardContent>
            </Card>
          </Link>

          <Link href="/superadmin/approvals">
            <Card className="h-full cursor-pointer border-dashed transition-colors hover:border-primary hover:bg-primary/5">
              <CardContent className="flex items-center justify-between gap-4 p-5">
                <div>
                  <p className="text-sm font-semibold">Approvals</p>
                  <p className="text-xs text-muted-foreground">
                    Review note change requests from faculty.
                  </p>
                </div>
                <CheckSquare className="size-6 text-amber-500" />
              </CardContent>
            </Card>
          </Link>

          <Link href="/superadmin/analytics">
            <Card className="h-full cursor-pointer border-dashed transition-colors hover:border-primary hover:bg-primary/5">
              <CardContent className="flex items-center justify-between gap-4 p-5">
                <div>
                  <p className="text-sm font-semibold">Analytics</p>
                  <p className="text-xs text-muted-foreground">
                    Track usage and learning outcomes across the platform.
                  </p>
                </div>
                <BarChart2 className="size-6 text-sky-500" />
              </CardContent>
            </Card>
          </Link>

          <Link href="/superadmin/subjects">
            <Card className="h-full cursor-pointer border-dashed transition-colors hover:border-primary hover:bg-primary/5">
              <CardContent className="flex items-center justify-between gap-4 p-5">
                <div>
                  <p className="text-sm font-semibold">Subjects</p>
                  <p className="text-xs text-muted-foreground">
                    Configure subjects and modules for the pilot.
                  </p>
                </div>
                <BookOpen className="size-6 text-purple-500" />
              </CardContent>
            </Card>
          </Link>

          <Card className="h-full cursor-not-allowed border-dashed bg-muted/40">
            <CardContent className="flex items-center justify-between gap-4 p-5">
              <div>
                <p className="text-sm font-semibold text-muted-foreground">
                  Settings (coming soon)
                </p>
                <p className="text-xs text-muted-foreground">
                  Platform configuration will be available in future phases.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* RECENT UPLOADS */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold">Recent Uploads</h2>
        {recentUploads.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No uploads yet — go to Upload to add content.
          </p>
        ) : (
          <Card>
            <CardContent className="divide-y px-0">
              {recentUploads.map((doc, idx) => {
                const meta = uploadTypeMeta(doc.type);
                return (
                  // eslint-disable-next-line react/no-array-index-key
                  <div
                    key={idx}
                    className="flex items-center justify-between px-6 py-3 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        {doc.title ?? "Untitled Document"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(doc.created_at)}
                      </p>
                    </div>
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${meta.badgeClass}`}
                    >
                      {meta.label}
                    </span>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

