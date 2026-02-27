"use client";

import "katex/dist/katex.min.css";

import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkMath from "remark-math";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { createBrowserClient } from "@/lib/db/supabase-browser";
import { Clock, Download, Loader2, MessageSquare } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

type Role = "user" | "assistant";

type SessionListItem = {
  id: string;
  subjectName: string;
  subjectCode: string;
  createdAt: string;
  messageCount: number;
};

type ChatMessageRow = {
  role: Role;
  content: string;
  created_at: string;
};

type SelectedSession = {
  id: string;
  subjectName: string;
  subjectCode: string;
  createdAt: string;
  messages: ChatMessageRow[];
};

export default function StudentHistoryPage() {
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [selectedSession, setSelectedSession] =
    useState<SelectedSession | null>(null);
  const [isLoadingSessions, setIsLoadingSessions] = useState(true);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [exportingId, setExportingId] = useState<string | null>(null);

  useEffect(() => {
    const run = async () => {
      setIsLoadingSessions(true);
      try {
        const supabase = createBrowserClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) {
          setSessions([]);
          return;
        }

        const { data, error } = await supabase
          .from("chat_sessions")
          .select(
            `
            id,
            created_at,
            subject_id,
            subjects(name, code),
            chat_messages(id)
          `
          )
          .eq("student_id", user.id)
          .order("created_at", { ascending: false })
          .limit(3);

        if (error || !data) {
          setSessions([]);
          return;
        }

        const mapped: SessionListItem[] = (data as any[]).map((row) => {
          const subjectRel = row.subjects as { name: string; code: string };
          const msgs = (row.chat_messages as any[]) ?? [];
          return {
            id: row.id as string,
            createdAt: row.created_at as string,
            subjectName: subjectRel?.name ?? "Subject",
            subjectCode: subjectRel?.code ?? "",
            messageCount: msgs.length,
          };
        });

        // filter sessions with at least 1 message
        setSessions(mapped.filter((s) => s.messageCount > 0));
      } catch (err) {
        console.error("[student/history] load sessions error:", err);
        setSessions([]);
      } finally {
        setIsLoadingSessions(false);
      }
    };

    run();
  }, []);

  const handleSelectSession = async (session: SessionListItem) => {
    setSelectedSession({
      id: session.id,
      subjectName: session.subjectName,
      subjectCode: session.subjectCode,
      createdAt: session.createdAt,
      messages: [],
    });
    setIsLoadingMessages(true);
    try {
      const supabase = createBrowserClient();
      const { data, error } = await supabase
        .from("chat_messages")
        .select("role, content, created_at")
        .eq("session_id", session.id)
        .order("created_at", { ascending: true });

      if (error || !data) {
        setSelectedSession((prev) =>
          prev && prev.id === session.id ? { ...prev, messages: [] } : prev
        );
        return;
      }

      setSelectedSession((prev) =>
        prev && prev.id === session.id
          ? { ...prev, messages: data as ChatMessageRow[] }
          : prev
      );
    } catch (err) {
      console.error("[student/history] load messages error:", err);
    } finally {
      setIsLoadingMessages(false);
    }
  };

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });

  const formatDateTime = (iso: string) =>
    new Date(iso).toLocaleString("en-IN");

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Clock className="size-6 text-primary" />
        <h1 className="text-2xl font-semibold tracking-tight">
          Chat History
        </h1>
      </div>

      <div className="flex flex-col gap-4 md:flex-row">
        {/* LEFT: Sessions */}
        <div className="md:w-1/3 space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground">
            Recent Conversations
          </h2>
          {isLoadingSessions ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Card key={i} className="p-3">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="mt-2 h-3 w-24" />
                  <Skeleton className="mt-2 h-3 w-20" />
                </Card>
              ))}
            </div>
          ) : sessions.length === 0 ? (
            <Card className="p-4 text-sm text-muted-foreground">
              <p>No chat history yet.</p>
              <Link
                href="/student/subjects"
                className="mt-2 inline-flex text-xs text-primary hover:underline"
              >
                Start a conversation →
              </Link>
            </Card>
          ) : (
            <div className="space-y-2">
              {sessions.map((s) => {
                const isSelected = selectedSession?.id === s.id;
                return (
                  <Card
                    key={s.id}
                    className={cn(
                      "cursor-pointer p-3 transition-colors",
                      isSelected &&
                        "border-primary bg-primary/5 dark:bg-primary/10"
                    )}
                    onClick={() => handleSelectSession(s)}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <Badge variant="secondary" className="text-xs">
                        {s.subjectCode || "Subject"}
                      </Badge>
                      <span className="text-[11px] text-muted-foreground">
                        {formatDate(s.createdAt)}
                      </span>
                    </div>
                    <p className="mt-1 truncate text-sm font-medium">
                      {s.subjectName}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {s.messageCount} message
                      {s.messageCount !== 1 ? "s" : ""}
                    </p>
                  </Card>
                );
              })}
            </div>
          )}
        </div>

        {/* RIGHT: Messages */}
        <div className="md:w-2/3">
          <Card className="h-full">
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              {selectedSession ? (
                <>
                  <div className="min-w-0">
                    <CardTitle className="truncate text-sm font-semibold">
                      {selectedSession.subjectName} (
                      {selectedSession.subjectCode})
                    </CardTitle>
                    <p className="text-xs text-muted-foreground">
                      {formatDateTime(selectedSession.createdAt)}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={exportingId === selectedSession.id}
                    onClick={async () => {
                      setExportingId(selectedSession.id);
                      try {
                        const res = await fetch("/api/chat/export", {
                          method: "POST",
                          headers: {
                            "Content-Type": "application/json",
                          },
                          body: JSON.stringify({
                            sessionId: selectedSession.id,
                          }),
                        });
                        if (!res.ok) {
                          const json = await res.json().catch(() => null);
                          throw new Error(
                            json?.error ?? "Failed to export chat"
                          );
                        }
                        const blob = await res.blob();
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = `chat-${selectedSession.subjectCode}-${formatDate(
                          selectedSession.createdAt
                        )}.pdf`;
                        document.body.appendChild(a);
                        a.click();
                        a.remove();
                        URL.revokeObjectURL(url);
                      } catch (err) {
                        console.error(err);
                        alert(
                          err instanceof Error
                            ? err.message
                            : "Failed to export chat"
                        );
                      } finally {
                        setExportingId(null);
                      }
                    }}
                  >
                    {exportingId === selectedSession.id ? (
                      <>
                        <Loader2 className="mr-1 size-4 animate-spin" />
                        Exporting...
                      </>
                    ) : (
                      <>
                        <Download className="mr-1 size-4" />
                        Export PDF
                      </>
                    )}
                  </Button>
                </>
              ) : (
                <>
                  <CardTitle className="text-sm font-semibold">
                    Conversation
                  </CardTitle>
                </>
              )}
            </CardHeader>
            <CardContent className="border-t pt-4">
              {!selectedSession ? (
                <div className="flex h-[300px] flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
                  <MessageSquare className="size-10 text-muted-foreground/60" />
                  <p>Select a conversation to view.</p>
                </div>
              ) : (
                <ScrollArea className="max-h-[calc(100vh-200px)] pr-2">
                  <div className="space-y-4">
                    {isLoadingMessages ? (
                      <>
                        {Array.from({ length: 3 }).map((_, idx) => (
                          <div
                            key={idx}
                            className={cn(
                              "flex",
                              idx % 2 === 0
                                ? "justify-end"
                                : "justify-start"
                            )}
                          >
                            <Skeleton className="h-10 w-2/3 rounded-2xl" />
                          </div>
                        ))}
                      </>
                    ) : selectedSession.messages.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        No messages in this conversation.
                      </p>
                    ) : (
                      selectedSession.messages.map((m, idx) =>
                        m.role === "user" ? (
                          <div
                            key={idx}
                            className="flex justify-end text-sm"
                          >
                            <div className="max-w-[80%]">
                              <div className="rounded-2xl bg-blue-600 px-4 py-2 text-white">
                                {m.content}
                              </div>
                              <div className="mt-0.5 text-[10px] text-muted-foreground text-right">
                                {formatDateTime(m.created_at)}
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div
                            key={idx}
                            className="flex justify-start text-sm"
                          >
                            <div className="max-w-[80%]">
                              <Card className="border bg-card">
                                <CardContent className="px-4 py-3">
                                  <ReactMarkdown
                                    remarkPlugins={[remarkMath]}
                                    rehypePlugins={[rehypeKatex]}
                                  >
                                    {m.content}
                                  </ReactMarkdown>
                                </CardContent>
                              </Card>
                              <div className="mt-0.5 text-[10px] text-muted-foreground">
                                {formatDateTime(m.created_at)}
                              </div>
                            </div>
                          </div>
                        )
                      )
                    )}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

