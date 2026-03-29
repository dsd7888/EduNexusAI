"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BookOpen, MessageSquare } from "lucide-react";

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
  const [contentBySubject, setContentBySubject] = useState<
    Record<string, boolean | undefined>
  >({});

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

        if (!branch || semester == null) {
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
          .eq("semester", semester)
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
                No subjects found for your branch and semester. Contact your
                admin to add subjects.
              </p>
            </div>
          </CardHeader>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {subjects.map((subject) => {
            const ready = contentBySubject[subject.id];
            const checking = ready === undefined;

            return (
              <Card key={subject.id} className="flex flex-col">
                <CardHeader className="space-y-2">
                  <Badge className="w-fit">{subject.code}</Badge>
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
      )}
    </div>
  );
}
