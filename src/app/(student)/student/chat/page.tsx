"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpDown, BookOpen, MessageSquare } from "lucide-react";

import { CardSkeleton } from "@/components/layout/PageSkeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createBrowserClient } from "@/lib/db/supabase-browser";
import { buildProcessedSubjectGroups } from "@/lib/student/subjectGroups";
import { cn } from "@/lib/utils";

type ChatSubject = {
  id: string;
  name: string;
  code: string;
  branch: string;
  semester: number;
};

function hasUsableContent(data: unknown): boolean {
  if (data == null || typeof data !== "object") return false;
  const content = String((data as { content?: string }).content ?? "").trim();
  return content.length > 0;
}

export default function StudentChatHubPage() {
  const router = useRouter();
  const [subjects, setSubjects] = useState<ChatSubject[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [profileSemester, setProfileSemester] = useState<number | null>(null);
  const [contentBySubject, setContentBySubject] = useState<
    Record<string, boolean | undefined>
  >({});

  const [groupBy, setGroupBy] = useState<"semester" | "code" | "none">(
    "semester"
  );
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");

  const processedGroups = useMemo(
    () =>
      buildProcessedSubjectGroups(
        subjects,
        groupBy,
        sortOrder,
        profileSemester ?? 0
      ),
    [subjects, groupBy, sortOrder, profileSemester]
  );

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      setIsLoading(true);
      try {
        const supabase = createBrowserClient();
        const {
          data: { user },
          error: authError,
        } = await supabase.auth.getUser();

        if (authError || !user) {
          if (!cancelled) {
            setSubjects([]);
            setProfileSemester(null);
            setIsLoading(false);
          }
          return;
        }

        const { data: profile } = await supabase
          .from("profiles")
          .select("branch, semester")
          .eq("id", user.id)
          .single();

        const branch = profile?.branch as string | null | undefined;
        const semester = profile?.semester as number | null | undefined;

        if (!cancelled) {
          setProfileSemester(semester ?? null);
        }

        if (!branch) {
          if (!cancelled) {
            setSubjects([]);
            setIsLoading(false);
          }
          return;
        }

        const { data, error } = await supabase
          .from("subjects")
          .select("id, code, name, branch, semester")
          .eq("branch", branch)
          .order("semester", { ascending: true })
          .order("code", { ascending: true });

        if (error || !data) {
          if (!cancelled) setSubjects([]);
        } else if (!cancelled) {
          setSubjects(data as ChatSubject[]);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!subjects.length) {
      setContentBySubject({});
      return;
    }

    let cancelled = false;

    const checkContent = async () => {
      const next: Record<string, boolean> = {};
      await Promise.all(
        subjects.map(async (s) => {
          try {
            const res = await fetch(
              `/api/subjects/content?subjectId=${encodeURIComponent(s.id)}`
            );
            if (!res.ok) {
              next[s.id] = false;
              return;
            }
            const data = await res.json();
            next[s.id] = hasUsableContent(data);
          } catch {
            next[s.id] = false;
          }
        })
      );
      if (!cancelled) setContentBySubject(next);
    };

    void checkContent();
    return () => {
      cancelled = true;
    };
  }, [subjects]);

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <MessageSquare className="mt-0.5 size-8 text-primary" />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">AI Chat</h1>
          <p className="text-sm text-muted-foreground">
            Select a subject to start a conversation
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </div>
      ) : subjects.length === 0 ? (
        <Card>
          <CardHeader className="flex flex-row items-start gap-3 space-y-0">
            <BookOpen className="mt-0.5 size-5 text-muted-foreground" />
            <div>
              <CardTitle className="text-base">No subjects found</CardTitle>
              <p className="mt-2 text-sm text-muted-foreground">
                No subjects found for your branch. Contact your admin to add
                subjects.
              </p>
            </div>
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
                {group.items.map((subject) => {
                  const ready = contentBySubject[subject.id];
                  const checking = ready === undefined;
                  const isCurrentSem =
                    (subject.semester ?? 0) === (profileSemester ?? 0);

                  return (
                    <Card
                      key={subject.id}
                      className={cn(
                        "flex flex-col rounded-lg border",
                        isCurrentSem && "border-primary/40"
                      )}
                    >
                      <CardHeader className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge className="w-fit">{subject.code}</Badge>
                          {isCurrentSem ? (
                            <span className="rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                              Current
                            </span>
                          ) : null}
                        </div>
                        <CardTitle className="text-base font-semibold leading-snug">
                          {subject.name}
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="flex-1 text-xs text-muted-foreground">
                        Semester {subject.semester} · {subject.branch}
                      </CardContent>
                      <CardFooter className="flex flex-col gap-2 pt-0">
                        {checking ? (
                          <Button className="w-full" disabled variant="secondary">
                            Checking content…
                          </Button>
                        ) : ready ? (
                          <Button
                            className="w-full"
                            onClick={() =>
                              router.push(`/student/chat/${subject.id}`)
                            }
                          >
                            Start Chat
                          </Button>
                        ) : (
                          <p className="w-full text-center text-sm text-muted-foreground">
                            Content coming soon
                          </p>
                        )}
                      </CardFooter>
                    </Card>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
