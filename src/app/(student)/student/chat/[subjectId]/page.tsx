"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import MarkdownRenderer from "@/components/chat/MarkdownRenderer";
import { createBrowserClient } from "@/lib/db/supabase-browser";
import { Download, HelpCircle, Lightbulb, Loader2, Sparkles, X, Zap } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Role = "user" | "assistant";

type ChatMessage = {
  role: Role;
  content: string;
};

type SubjectRow = {
  id: string;
  name: string;
  code: string;
  semester: number;
  branch: string;
};

type InteractivePayload = {
  html: string;
  markdown: string;
} | null;

function parseInteractiveHtml(content: string): InteractivePayload {
  const re = /```interactive-html\s*([\s\S]*?)```/i;
  const match = content.match(re);
  if (!match) return null;
  const html = match[1]?.trim() ?? "";
  if (!html) return null;
  return {
    html,
    markdown: content.replace(re, "").trim(),
  };
}

function InteractiveHtmlViewer({ htmlContent }: { htmlContent: string }) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [iframeHeight, setIframeHeight] = useState("520px");

  useEffect(() => {
    const update = () => setIframeHeight(window.innerWidth < 640 ? "400px" : "520px");
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  return (
    <div className="my-6 rounded-xl overflow-hidden border border-blue-200 bg-gradient-to-br from-blue-50 to-indigo-50 shadow-sm">
      {/* Header bar */}
      <div className="bg-white border-b border-blue-200 px-4 py-2.5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
          <span className="text-sm font-medium text-gray-700">Interactive Visualization</span>
        </div>
        <div className="flex gap-2 flex-wrap sm:flex-nowrap">
          <button
            onClick={() => setIsFullscreen(true)}
            className="px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-1.5"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
            </svg>
            <span className="hidden sm:inline">Expand</span>
          </button>
          <button
            onClick={() => {
              const blob = new Blob([htmlContent], { type: "text/html" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = "visualization.html";
              a.click();
              URL.revokeObjectURL(url);
            }}
            className="px-3 py-1.5 text-xs font-medium bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors flex items-center gap-1.5"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            <span className="hidden sm:inline">Download</span>
          </button>
        </div>
      </div>

      {/* Visualization container */}
      <div className="relative bg-white">
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-white bg-opacity-90 z-10">
            <div className="flex flex-col items-center gap-3">
              <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-gray-600">Loading visualization...</p>
            </div>
          </div>
        )}
        <iframe
          srcDoc={htmlContent}
          title="Interactive visualization"
          className="w-full border-0"
          style={{ height: iframeHeight }}
          sandbox="allow-scripts allow-same-origin"
          onLoad={() => setIsLoading(false)}
        />
      </div>

      {/* Fullscreen modal */}
      {isFullscreen && (
        <div className="fixed inset-0 z-50 bg-black bg-opacity-75 backdrop-blur-sm flex items-center justify-center sm:p-4 p-0">
          <div className="bg-white sm:rounded-2xl rounded-none w-full h-full max-w-7xl sm:max-h-[95vh] max-h-full flex flex-col shadow-2xl">
            <div className="px-4 sm:px-6 py-3 sm:py-4 border-b flex justify-between items-center bg-gradient-to-r from-blue-50 to-indigo-50">
              <h3 className="text-lg font-semibold text-gray-800">Interactive Visualization</h3>
              <button
                onClick={() => setIsFullscreen(false)}
                className="px-4 py-2 text-sm font-medium bg-gray-700 text-white rounded-lg hover:bg-gray-800 transition-colors"
              >
                Close
              </button>
            </div>
            <iframe
              srcDoc={htmlContent}
              title="Interactive visualization fullscreen"
              className="flex-1 w-full border-0"
              sandbox="allow-scripts allow-same-origin"
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default function StudentSubjectChatPage() {
  const params = useParams<{ subjectId: string }>();
  const subjectId = params?.subjectId;

  const [subject, setSubject] = useState<SubjectRow | null>(null);
  const [syllabusContent, setSyllabusContent] = useState<string>("");
  const [hasSyllabus, setHasSyllabus] = useState<boolean | null>(null);
  const [suggestedPrompts, setSuggestedPrompts] = useState<string[]>([]);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [showResumeBanner, setShowResumeBanner] = useState(false);
  const [resumedCount, setResumedCount] = useState(0);
  const [hoveredMessageId, setHoveredMessageId] = useState<number | null>(null);
  const [struggleTopic, setStruggleTopic] = useState<string | null>(null);
  const [hasShownStruggleBanner, setHasShownStruggleBanner] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isRateLimited, setIsRateLimited] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const [loadingSubject, setLoadingSubject] = useState(true);
  const [loadingSyllabus, setLoadingSyllabus] = useState(true);

  const bottomRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading, scrollToBottom]);

  useEffect(() => {
    if (!subjectId) return;

    const run = async () => {
      setLoadingSubject(true);
      try {
        const supabase = createBrowserClient();
        const { data, error } = await supabase
          .from("subjects")
          .select("id, name, code, semester, branch")
          .eq("id", subjectId)
          .single();
        if (error || !data) {
          setSubject(null);
          return;
        }
        setSubject(data as SubjectRow);
      } finally {
        setLoadingSubject(false);
      }
    };

    run();
  }, [subjectId]);

  useEffect(() => {
    if (!subjectId) return;

    const run = async () => {
      setLoadingSyllabus(true);
      try {
        const res = await fetch(
          `/api/subjects/content?subjectId=${encodeURIComponent(subjectId)}`
        );
        const json = await res.json().catch(() => null);
        if (!res.ok) {
          setHasSyllabus(false);
          setSyllabusContent("");
          return;
        }
        if (!json) {
          setHasSyllabus(false);
          setSyllabusContent("");
          return;
        }
        setHasSyllabus(true);
        setSyllabusContent(String(json.content ?? ""));
      } finally {
        setLoadingSyllabus(false);
      }
    };

    run();
  }, [subjectId]);

  useEffect(() => {
    if (!subjectId) return;
    if (!hasSyllabus) return;

    let cancelled = false;

    const run = async () => {
      try {
        // Resume the last open session for this subject, or start fresh.
        const sessionRes = await fetch("/api/chat/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subjectId }),
        });
        if (sessionRes.ok) {
          const { sessionId: sid, isResumed, messageCount } =
            await sessionRes.json();
          if (cancelled) return;
          setSessionId(sid);

          if (isResumed && messageCount > 0) {
            // Load the last 20 messages of the resumed session on mount.
            const supabase = createBrowserClient();
            const { data: rows } = await supabase
              .from("chat_messages")
              .select("role, content, created_at")
              .eq("session_id", sid)
              .order("created_at", { ascending: false })
              .limit(20);
            if (cancelled) return;
            const ordered = (rows ?? [])
              .slice()
              .reverse()
              .map((r: { role: Role; content: string }) => ({
                role: r.role,
                content: r.content,
              }));
            if (ordered.length > 0) {
              setMessages(ordered);
              setResumedCount(messageCount);
              setShowResumeBanner(true);
            }
          }
        }

        const res = await fetch("/api/chat/suggestions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subjectId, syllabusContent }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || cancelled) return;
        const prompts = Array.isArray(json?.suggestions)
          ? json.suggestions
          : [];
        setSuggestedPrompts(prompts.slice(0, 4));
      } catch {
        // ignore
      }
    };

    run();

    return () => {
      cancelled = true;
    };
  }, [subjectId, hasSyllabus, syllabusContent]);

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || !subjectId || isRateLimited) return;

      setMessages((prev) => [...prev, { role: "user", content: trimmed }]);
      setInputValue("");
      setIsLoading(true);
      // Dismiss the struggle nudge once the student sends their next message.
      setStruggleTopic(null);

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            subjectId,
            message: trimmed,
            history: messages
              .slice(-6)
              .map((m) => ({ role: m.role, content: m.content })),
            sessionId,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.status === 429) {
          setIsRateLimited(true);
          const friendly =
            "You've reached your daily chat limit. Come back tomorrow! 📚";
          setMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              content:
                typeof data?.message === "string" && data.message
                  ? `${data.message}\n\n${friendly}`
                  : friendly,
            },
          ]);
          return;
        }

        if (res.status === 404 && data?.error === "no_syllabus") {
          setMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              content:
                "⚠️ This subject has no syllabus content yet. Please ask your admin to add content.",
            },
          ]);
          return;
        }

        if (!res.ok) {
          setMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              content: "I couldn't process that request. Please try again.",
            },
          ]);
          return;
        }
        const reply = String(
          data?.content ?? data?.response ?? data?.message ?? ""
        );
        setMessages((prev) => [...prev, { role: "assistant", content: reply }]);

        // Struggle nudge — at most once per session.
        if (
          data?.struggle_detected === true &&
          typeof data?.topic === "string" &&
          data.topic &&
          !hasShownStruggleBanner
        ) {
          setStruggleTopic(data.topic);
          setHasShownStruggleBanner(true);
        }
      } catch {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: "Network error. Please try again.",
          },
        ]);
      } finally {
        setIsLoading(false);
        requestAnimationFrame(() => inputRef.current?.focus());
      }
    },
    [
      subjectId,
      sessionId,
      isRateLimited,
      inputValue,
      messages,
      hasShownStruggleBanner,
    ]
  );

  const handleSubmit = async () => {
    await sendMessage(inputValue);
  };

  const handleStartFresh = useCallback(async () => {
    if (!subjectId) return;
    try {
      const res = await fetch("/api/chat/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subjectId, force_new: true }),
      });
      if (!res.ok) return;
      const { sessionId: sid } = await res.json();
      setSessionId(sid);
      setMessages([]);
      setResumedCount(0);
      setShowResumeBanner(false);
    } catch {
      // ignore — keep the current resumed session if the call fails
    }
  }, [subjectId]);

  async function handleExportChat() {
    if (!sessionId || messages.length === 0) return;
    setIsExporting(true);
    try {
      const res = await fetch("/api/chat/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      if (!res.ok) throw new Error("Export failed");

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `chat-${subject?.name ?? "notes"}-${new Date()
        .toISOString()
        .slice(0, 10)}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // Silent fail — export is a convenience feature, don't interrupt chat
      console.error("[chat/export] failed");
    } finally {
      setIsExporting(false);
    }
  }

  const handleKeyDown: React.KeyboardEventHandler<HTMLInputElement> = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const suggestionCards = useMemo(() => {
    const fallback = [
      "Summarize the syllabus and key units.",
      "Explain the most important concepts for exams.",
      "Give me 5 practice questions with answers.",
      "Teach me Unit 1 step-by-step.",
    ];
    const prompts = suggestedPrompts.length > 0 ? suggestedPrompts : fallback;
    const icons = [Lightbulb, HelpCircle, Zap, Lightbulb] as const;

    return prompts.slice(0, 4).map((p, idx) => ({
      text: p,
      Icon: icons[idx] ?? Lightbulb,
    }));
  }, [suggestedPrompts]);

  if (loadingSubject) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-1/2" />
        <Skeleton className="h-6 w-1/3" />
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-1/2" />
          </CardHeader>
          <CardContent className="space-y-3">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-2/3" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!subject) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Subject not found</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          The subject you’re trying to open doesn’t exist.
        </CardContent>
        <CardFooter>
          <Button asChild variant="secondary">
            <Link href="/student/subjects">Back to subjects</Link>
          </Button>
        </CardFooter>
      </Card>
    );
  }

  if (!loadingSyllabus && hasSyllabus === false) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{subject.name} ({subject.code})</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          No syllabus has been uploaded for this subject yet. Please check back soon.
        </CardContent>
        <CardFooter>
          <Button asChild variant="secondary">
            <Link href="/student/subjects">Back to subjects</Link>
          </Button>
        </CardFooter>
      </Card>
    );
  }

  return (
    <div className="flex h-[calc(100vh-7rem)] flex-col">
      <div className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b bg-background/80 px-2 py-3 backdrop-blur">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold sm:text-base">
            <span className="block sm:hidden">
              {subject.name.length > 20
                ? `${subject.name.slice(0, 20)}…`
                : subject.name}
            </span>
            <span className="hidden sm:inline">
              {subject.name}{" "}
              <span className="text-muted-foreground">
                ({subject.code})
              </span>
            </span>
          </div>
          <div className="text-[11px] text-muted-foreground sm:text-xs">
            Semester {subject.semester} • {subject.branch}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {messages.length > 0 && sessionId && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleExportChat}
              disabled={isExporting}
              className="gap-1.5 text-xs"
            >
              {isExporting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Download className="w-3.5 h-3.5" />
              )}
              {isExporting ? "Exporting..." : "Export PDF"}
            </Button>
          )}
          <Badge className="hidden shrink-0 bg-emerald-600 text-white hover:bg-emerald-600 sm:inline-flex">
            Syllabus-locked ✓
          </Badge>
        </div>
      </div>

      {showResumeBanner && (
        <div className="flex items-center justify-between gap-2 border-b bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
          <span className="min-w-0 truncate">
            Continuing your last session — {resumedCount}{" "}
            {resumedCount === 1 ? "message" : "messages"}
          </span>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleStartFresh}
              className="h-6 px-2 text-xs"
            >
              Start fresh
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowResumeBanner(false)}
              className="h-6 w-6"
              aria-label="Dismiss"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}

      <ScrollArea className="flex-1 px-2 py-4 sm:px-3">
        {messages.length === 0 ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {suggestionCards.map(({ text, Icon }, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => {
                  setInputValue(text);
                  sendMessage(text);
                }}
                className="text-left"
              >
                <Card className="transition-shadow hover:shadow-md">
                  <CardHeader className="flex flex-row items-start justify-between gap-3">
                    <div className="min-w-0">
                      <CardTitle className="text-sm font-semibold">
                        {text}
                      </CardTitle>
                    </div>
                    <Icon className="size-5 shrink-0 text-muted-foreground" />
                  </CardHeader>
                </Card>
              </button>
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((m, idx) =>
              m.role === "user" ? (
                <div key={idx} className="flex justify-end">
                  <div className="max-w-[90%] rounded-2xl bg-blue-600 px-4 py-2 text-sm sm:text-[0.95rem] text-white">
                    {m.content}
                  </div>
                </div>
              ) : (
                <div
                  key={idx}
                  className="flex justify-start"
                  onMouseEnter={() => setHoveredMessageId(idx)}
                  onMouseLeave={() => setHoveredMessageId(null)}
                >
                  <Card className="max-w-[90%] border bg-card">
                    <CardContent className="px-4 py-3">
                      {(() => {
                        const interactive = parseInteractiveHtml(m.content);
                        if (!interactive) return <MarkdownRenderer content={m.content} />;
                        return (
                          <>
                            {interactive.markdown ? (
                              <MarkdownRenderer content={interactive.markdown} />
                            ) : null}
                            <InteractiveHtmlViewer htmlContent={interactive.html} />
                          </>
                        );
                      })()}
                      {hoveredMessageId === idx &&
                        !m.content.includes("interactive-html") &&
                        !isLoading && (
                          <div className="mt-2 flex justify-end">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                const vizPrompt =
                                  "Create an interactive visualization for the concept explained in your last response. Use the interactive-html format.";
                                setInputValue(vizPrompt);
                                sendMessage(vizPrompt);
                              }}
                              className="h-7 gap-1 rounded-md border border-border/60 px-2 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                              aria-label="Visualize this concept"
                            >
                              <Sparkles className="h-3.5 w-3.5" />
                              Visualize
                            </Button>
                          </div>
                        )}
                    </CardContent>
                  </Card>
                </div>
              )
            )}

            {isLoading && (
              <div className="flex justify-start">
                <Card className="max-w-[90%] border bg-card">
                  <CardContent className="px-4 py-3">
                    <div className="flex items-center gap-1 text-sm text-muted-foreground">
                      <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-muted-foreground/60" />
                      <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-muted-foreground/60 [animation-delay:150ms]" />
                      <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-muted-foreground/60 [animation-delay:300ms]" />
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}
          </div>
        )}

        <div ref={bottomRef} />
      </ScrollArea>

      <div className="sticky bottom-0 z-10 border-t bg-background/80 px-1 py-3 backdrop-blur">
        {struggleTopic && (
          <div className="mb-2 flex items-center justify-between gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            <span className="min-w-0 truncate">
              Looks like{" "}
              <span className="font-semibold">{struggleTopic}</span> is tricky —
              want a quick quiz?
            </span>
            <div className="flex shrink-0 items-center gap-1">
              <Button
                asChild
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs font-medium text-amber-900 hover:bg-amber-100 dark:text-amber-200 dark:hover:bg-amber-900/40"
              >
                <Link
                  href={
                    subjectId
                      ? `/student/quiz?subjectId=${subjectId}`
                      : "/student/quiz"
                  }
                >
                  Try quiz →
                </Link>
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setStruggleTopic(null)}
                className="h-7 w-7 text-amber-900 hover:bg-amber-100 dark:text-amber-200 dark:hover:bg-amber-900/40"
                aria-label="Dismiss"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}
        <div className="flex items-center gap-2">
          <Input
            ref={inputRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`Ask anything about ${subject.name}...`}
            disabled={isLoading || isRateLimited}
            className="h-12 text-base"
          />
          <Button
            onClick={handleSubmit}
            disabled={isLoading || isRateLimited || !inputValue.trim()}
            className="h-12 px-3 sm:px-4"
          >
            <span className="text-sm sm:text-base">Send</span>
          </Button>
        </div>
        {isRateLimited && (
          <p className="mt-2 text-xs text-muted-foreground">
            You've reached your daily chat limit. Come back tomorrow! 📚
          </p>
        )}
      </div>
    </div>
  );
}

