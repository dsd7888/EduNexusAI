"use client";

import MarkdownRenderer from "@/components/chat/MarkdownRenderer";
import { createBrowserClient } from "@/lib/db/supabase-browser";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CardSkeleton } from "@/components/layout/PageSkeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ArrowUpDown, BookOpen } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { buildProcessedSubjectGroups } from "@/lib/student/subjectGroups";
import { cn } from "@/lib/utils";

interface SubjectRow {
  id: string;
  code: string;
  name: string;
  department: string;
  branch: string;
  semester: number;
}

function SubjectCard({
  subject,
  isCurrent,
  onOpenNotes,
}: {
  subject: SubjectRow;
  isCurrent: boolean;
  onOpenNotes: (id: string) => void;
}) {
  return (
    <Card
      className={cn(
        "rounded-lg border p-4 transition-shadow hover:shadow-md sm:p-6",
        isCurrent && "border-primary/40"
      )}
    >
      <CardHeader className="p-0 pb-3 sm:pb-4">
        <CardTitle className="text-xl font-bold">{subject.code}</CardTitle>
        <CardDescription>{subject.name}</CardDescription>
        <Badge variant="secondary" className="mt-2 w-fit">
          {subject.department}
        </Badge>
      </CardHeader>
      <CardFooter className="p-0 pt-2 sm:pt-3">
        <div className="flex w-full flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Button asChild size="sm" className="min-w-[80px] flex-1">
            <Link href={`/student/chat/${subject.id}`}>Chat</Link>
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-w-[80px] flex-1"
            onClick={() => onOpenNotes(subject.id)}
          >
            <BookOpen className="mr-1 size-4" />
            Quick Notes
          </Button>
          <Button asChild variant="outline" size="sm" className="min-w-[80px] flex-1">
            <Link href={`/student/quiz?subjectId=${subject.id}`}>Quiz</Link>
          </Button>
        </div>
      </CardFooter>
    </Card>
  );
}

export default function StudentSubjectsPage() {
  const [name, setName] = useState<string>("Student");
  const [branch, setBranch] = useState<string | null>(null);
  const [semester, setSemester] = useState<number | null>(null);
  const [subjects, setSubjects] = useState<SubjectRow[]>([]);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [loadingSubjects, setLoadingSubjects] = useState(true);

  const [groupBy, setGroupBy] = useState<"semester" | "code" | "none">(
    "semester"
  );
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");

  // Quick Notes modal state
  const [notesSubjectId, setNotesSubjectId] = useState<string | null>(null);
  const [notesMode, setNotesMode] = useState<"subject" | "module">("subject");
  const [selectedModuleId, setSelectedModuleId] = useState("");
  const [modules, setModules] = useState<
    { id: string; name: string; module_number: number }[]
  >([]);
  const [notesContent, setNotesContent] = useState("");
  const [notesLoading, setNotesLoading] = useState(false);
  const [notesFromCache, setNotesFromCache] = useState(false);
  const [copied, setCopied] = useState(false);

  const fetchProfile = useCallback(async () => {
    setLoadingProfile(true);
    try {
      const supabase = createBrowserClient();
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();
      if (authError || !user) {
        setBranch(null);
        setSemester(null);
        return;
      }
      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name, branch, semester")
        .eq("id", user.id)
        .single();
      setName(profile?.full_name?.trim() ? profile.full_name : "Student");
      setBranch(profile?.branch ?? null);
      setSemester(profile?.semester ?? null);
    } finally {
      setLoadingProfile(false);
    }
  }, []);

  const fetchSubjects = useCallback(async () => {
    if (branch == null) {
      setLoadingSubjects(false);
      setSubjects([]);
      return;
    }
    setLoadingSubjects(true);
    try {
      const supabase = createBrowserClient();
      const { data, error } = await supabase
        .from("subjects")
        .select("id, name, code, department, branch, semester")
        .eq("branch", branch)
        .order("semester", { ascending: true })
        .order("code", { ascending: true });
      if (error) {
        setSubjects([]);
        return;
      }
      setSubjects((data ?? []) as SubjectRow[]);
    } finally {
      setLoadingSubjects(false);
    }
  }, [branch]);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  useEffect(() => {
    if (!loadingProfile) {
      fetchSubjects();
    }
  }, [loadingProfile, fetchSubjects]);

  const canLoadSubjects = branch != null;
  const showEmptyState =
    !loadingProfile &&
    !loadingSubjects &&
    (!canLoadSubjects || subjects.length === 0);

  const profile = useMemo(
    () => ({ semester: semester ?? 0 }),
    [semester]
  );

  const processedGroups = useMemo(
    () =>
      buildProcessedSubjectGroups(
        subjects,
        groupBy,
        sortOrder,
        profile.semester
      ),
    [subjects, groupBy, sortOrder, profile.semester]
  );

  const activeSubject =
    notesSubjectId != null
      ? subjects.find((s) => s.id === notesSubjectId) ?? null
      : null;

  const handleOpenNotes = (subjectId: string) => {
    setNotesSubjectId(subjectId);
    setNotesMode("subject");
    setSelectedModuleId("");
    setModules([]);
    setNotesContent("");
    setNotesFromCache(false);
    setNotesLoading(false);
    setCopied(false);
  };

  useEffect(() => {
    if (!notesSubjectId || notesMode !== "module") return;
    if (modules.length > 0) return;
    const run = async () => {
      try {
        const supabase = createBrowserClient();
        const { data, error } = await supabase
          .from("modules")
          .select("id, name, module_number")
          .eq("subject_id", notesSubjectId)
          .order("module_number");
        if (!error && data) {
          setModules(
            (data as any[]).map((m) => ({
              id: m.id as string,
              name: m.name as string,
              module_number: m.module_number as number,
            }))
          );
        }
      } catch (err) {
        console.error("[subjects/notes] module load error:", err);
      }
    };
    run();
  }, [notesSubjectId, notesMode, modules.length]);

  const handleGenerateNotes = async () => {
    if (!notesSubjectId) return;
    setNotesLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("subjectId", notesSubjectId);
      if (notesMode === "module" && selectedModuleId) {
        params.set("moduleId", selectedModuleId);
      }
      const res = await fetch(`/api/notes?${params.toString()}`);
      const json = await res.json().catch(() => null);
      if (!res.ok || !json) {
        throw new Error(json?.error ?? "Failed to load notes");
      }
      setNotesContent(String(json.notes ?? ""));
      setNotesFromCache(Boolean(json.fromCache));
    } catch (err) {
      console.error(err);
      alert(
        err instanceof Error ? err.message : "Failed to load quick notes"
      );
    } finally {
      setNotesLoading(false);
    }
  };

  const handleExportNotesPDF = async () => {
    if (!activeSubject || !notesContent) return;
    const topicName =
      notesMode === "module"
        ? modules.find((m) => m.id === selectedModuleId)?.name ??
          activeSubject.name
        : activeSubject.name;
    try {
      const res = await fetch("/api/notes/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          notesContent,
          subjectName: activeSubject.name,
          topicName,
        }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        throw new Error(json?.error ?? "Failed to export PDF");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "quick-notes.pdf";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      alert(
        err instanceof Error ? err.message : "Failed to export quick notes"
      );
    }
  };

  const handleCopyNotes = async () => {
    if (!notesContent) return;
    try {
      await navigator.clipboard.writeText(notesContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  const handleCloseNotes = () => {
    setNotesSubjectId(null);
    setNotesMode("subject");
    setSelectedModuleId("");
    setModules([]);
    setNotesContent("");
    setNotesFromCache(false);
    setNotesLoading(false);
    setCopied(false);
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{`Hi ${name} 👋`}</h1>
        <p className="text-muted-foreground text-sm">
          Branch: {branch ?? "—"} | Semester {semester ?? "—"}
        </p>
      </div>

      {loadingProfile || loadingSubjects ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      ) : showEmptyState ? (
        <Card>
          <CardHeader>
            <CardTitle>No subjects found</CardTitle>
            <CardDescription>
              No subjects found for your branch. Please contact your admin.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">Group by:</span>
            <div className="flex overflow-hidden rounded-md border text-xs font-medium">
              {(["semester", "code", "none"] as const).map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => setGroupBy(opt)}
                  className={cn(
                    "px-3 py-1.5 transition-colors",
                    groupBy === opt
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted"
                  )}
                >
                  {opt === "semester"
                    ? "Semester"
                    : opt === "code"
                      ? "Subject Code"
                      : "All"}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() =>
                setSortOrder((o) => (o === "asc" ? "desc" : "asc"))
              }
              className="flex items-center gap-1 rounded border px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowUpDown className="size-3" />
              {sortOrder === "asc" ? "A → Z" : "Z → A"}
            </button>
          </div>

          {processedGroups.map((group) => (
            <div key={group.label ?? "all"} className="space-y-4">
              {group.label ? (
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    <h3
                      className={cn(
                        "text-sm font-semibold uppercase tracking-wide",
                        group.isCurrent
                          ? "text-primary"
                          : "text-muted-foreground"
                      )}
                    >
                      {group.label}
                    </h3>
                    {group.isCurrent ? (
                      <span className="rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                        Current
                      </span>
                    ) : null}
                  </div>
                  <div className="h-px flex-1 bg-border" />
                  <span className="text-xs text-muted-foreground">
                    {group.items.length} subject
                    {group.items.length !== 1 ? "s" : ""}
                  </span>
                </div>
              ) : null}
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                {group.items.map((s) => (
                  <SubjectCard
                    key={s.id}
                    subject={s}
                    isCurrent={(s.semester ?? 0) === (profile?.semester ?? 0)}
                    onOpenNotes={handleOpenNotes}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      <Dialog open={notesSubjectId !== null} onOpenChange={(open) => {
        if (!open) handleCloseNotes();
      }}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {activeSubject
                ? `Quick Notes — ${activeSubject.name} (${activeSubject.code})`
                : "Quick Notes"}
            </DialogTitle>
          </DialogHeader>
          <div className="mt-2 space-y-4">
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant={notesMode === "subject" ? "default" : "outline"}
                onClick={() => {
                  setNotesMode("subject");
                  setSelectedModuleId("");
                }}
              >
                📖 Full Subject
              </Button>
              <Button
                type="button"
                size="sm"
                variant={notesMode === "module" ? "default" : "outline"}
                onClick={() => setNotesMode("module")}
              >
                📑 By Module
              </Button>
            </div>

            {notesMode === "module" && (
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground">
                  Module
                </label>
                <select
                  className="w-full rounded-md border bg-background px-2 py-1 text-sm"
                  value={selectedModuleId}
                  onChange={(e) => setSelectedModuleId(e.target.value)}
                >
                  <option value="">Select a module</option>
                  {modules.map((m) => (
                    <option key={m.id} value={m.id}>
                      Module {m.module_number}: {m.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="space-y-2">
              <Button
                type="button"
                className="w-full"
                onClick={handleGenerateNotes}
                disabled={
                  notesLoading ||
                  !notesSubjectId ||
                  (notesMode === "module" && !selectedModuleId)
                }
              >
                {notesLoading ? "Generating notes..." : "Generate Notes"}
              </Button>
              {notesLoading && (
                <p className="text-xs text-muted-foreground">
                  {notesFromCache
                    ? "⚡ Loading from cache..."
                    : "Please wait while notes are generated..."}
                </p>
              )}
            </div>

            {notesContent && (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <Badge
                    variant={notesFromCache ? "secondary" : "default"}
                    className="text-xs"
                  >
                    {notesFromCache ? "⚡ Cached" : "✨ Freshly Generated"}
                  </Badge>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleCopyNotes}
                    >
                      {copied ? "Copied!" : "Copy Text"}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleExportNotesPDF}
                    >
                      Export PDF
                    </Button>
                  </div>
                </div>
                <div className="max-h-[60vh] overflow-y-auto rounded-md border p-3 text-sm">
                  <MarkdownRenderer content={notesContent} />
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
