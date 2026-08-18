"use client";

import { MonoTag } from "@/components/ui/mono-tag";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import MarkdownRenderer from "@/components/chat/MarkdownRenderer";
import { createBrowserClient } from "@/lib/db/supabase-browser";
import { Clock, Download, Loader2, MessageSquare } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

type Role = "user" | "assistant";

type SessionListItem = {
  id: string;
  created_at: string;
  subject_id: string;
  subjects: {
    name: string | null;
    code: string | null;
  } | null;
  message_count: number;
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

        const { data: sessionsData } = await supabase
          .from("chat_sessions")
          .select(
            `
            id,
            created_at,
            subject_id,
            subjects (
              name,
              code
            )
          `
          )
          .eq("student_id", user.id)
          .order("created_at", { ascending: false })
          .limit(10);

        // For each session, count messages
        const sessionsWithCount = await Promise.all(
          (sessionsData || []).map(async (session) => {
            const { count } = await supabase
              .from("chat_messages")
              .select("id", { count: "exact", head: true })
              .eq("session_id", session.id);
            return {
              ...session,
              message_count: count || 0,
            } as unknown as SessionListItem;
          })
        );

        // Keep only sessions with messages, take last 3
        const sessions = sessionsWithCount
          .filter((s) => s.message_count > 0)
          .slice(0, 3);

        setSessions(sessions);
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
      subjectName: session.subjects?.name ?? "Unknown Subject",
      subjectCode: session.subjects?.code ?? "",
      createdAt: session.created_at,
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
        <Clock className="size-6 text-ochre" />
        <h1 className="font-plex-serif text-display-sm font-semibold text-ink">
          Chat History
        </h1>
      </div>

      <div className="flex flex-col gap-4 md:flex-row">
        {/* LEFT: Sessions */}
        <div className="space-y-3 md:w-1/3">
          <h2 className="font-plex-sans text-label font-semibold uppercase tracking-[0.04em] text-ink-500">
            Recent Conversations
          </h2>
          {isLoadingSessions ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="rounded-8 border border-ink-200 bg-paper p-3">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="mt-2 h-3 w-24" />
                  <Skeleton className="mt-2 h-3 w-20" />
                </div>
              ))}
            </div>
          ) : sessions.length === 0 ? (
            <div className="rounded-8 border border-ink-200 bg-paper p-4 font-plex-sans text-body-sm text-ink-500">
              <p>No chat history yet.</p>
              <Link
                href="/student/subjects"
                className="mt-2 inline-flex rounded-4 text-xs text-ink-700 underline-offset-2 transition-colors duration-180 ease-out hover:text-ink-900 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-900"
              >
                Start a conversation →
              </Link>
            </div>
          ) : (
            <div className="space-y-2">
              {sessions.map((session) => {
                const isSelected = selectedSession?.id === session.id;
                return (
                  <div
                    key={session.id}
                    className={cn(
                      "cursor-pointer rounded-8 border border-ink-200 bg-paper p-3 transition-colors duration-180 ease-out hover:border-ink-400",
                      isSelected && "border-ochre"
                    )}
                    onClick={() => handleSelectSession(session)}
                  >
                    {/* Subject name — most prominent */}
                    <div className="font-plex-sans text-body-sm font-semibold text-ink">
                      {session.subjects?.name || "Unknown Subject"}
                    </div>

                    {/* Subject code tag */}
                    <MonoTag className="mt-1">{session.subjects?.code}</MonoTag>

                    {/* Message count + date on same line */}
                    <div className="mt-2 flex items-center justify-between">
                      <span className="font-plex-sans text-xs text-ink-500">
                        {session.message_count} messages
                      </span>
                      <span className="font-plex-sans text-xs text-ink-500">
                        {formatDate(session.created_at)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* RIGHT: Messages */}
        <div className="md:w-2/3">
          <div className="flex h-full flex-col rounded-12 border border-ink-200 bg-paper">
            <div className="flex flex-row items-center justify-between gap-2 p-4">
              {selectedSession ? (
                <>
                  <div className="min-w-0">
                    <div className="font-plex-sans text-body-sm font-semibold text-ink">
                      {selectedSession.subjectName}
                    </div>
                    <div className="font-plex-sans text-xs text-ink-500">
                      {new Date(
                        selectedSession.createdAt
                      ).toLocaleDateString("en-IN", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                      {" · "}
                      {isLoadingMessages
                        ? "..."
                        : `${selectedSession.messages.length} messages`}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={exportingId === selectedSession.id}
                    className="flex h-11 items-center gap-1.5 rounded-8 border border-ink-200 px-3 font-plex-sans text-body-sm font-medium text-ink-700 transition-colors duration-180 ease-out hover:border-ink-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-900 disabled:pointer-events-none disabled:opacity-50"
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
                        <Loader2 className="size-4 animate-spin" />
                        Exporting...
                      </>
                    ) : (
                      <>
                        <Download className="size-4" />
                        Export PDF
                      </>
                    )}
                  </button>
                </>
              ) : (
                <p className="font-plex-sans text-body-sm font-semibold text-ink">
                  Conversation
                </p>
              )}
            </div>
            <div className="border-t border-ink-100 p-4">
              {!selectedSession ? (
                <div className="flex h-[300px] flex-col items-center justify-center gap-2 text-center font-plex-sans text-body-sm text-ink-500">
                  <MessageSquare className="size-10 text-ink-300" />
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
                            <Skeleton className="h-10 w-2/3 rounded-12" />
                          </div>
                        ))}
                      </>
                    ) : selectedSession.messages.length === 0 ? (
                      <p className="font-plex-sans text-xs text-ink-500">
                        No messages in this conversation.
                      </p>
                    ) : (
                      selectedSession.messages.map((m, idx) =>
                        m.role === "user" ? (
                          <div
                            key={idx}
                            className="flex justify-end font-plex-sans text-body-sm"
                          >
                            <div className="max-w-[80%]">
                              <div className="rounded-12 bg-ink px-4 py-2 text-paper">
                                {m.content}
                              </div>
                              <div className="mt-0.5 text-right text-[10px] text-ink-500">
                                {formatDateTime(m.created_at)}
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div
                            key={idx}
                            className="flex justify-start font-plex-sans text-body-sm"
                          >
                            <div className="max-w-[80%]">
                              <div className="rounded-12 border border-ink-200 bg-paper px-4 py-3">
                                <MarkdownRenderer content={m.content} />
                              </div>
                              <div className="mt-0.5 text-[10px] text-ink-500">
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
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

