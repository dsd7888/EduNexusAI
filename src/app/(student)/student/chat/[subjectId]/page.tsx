"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { createBrowserClient } from "@/lib/db/supabase-browser";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { ChatHeader } from "./_components/ChatHeader";
import { Composer } from "./_components/Composer";
import { MessageList } from "./_components/MessageList";
import { RecencyNudge } from "./_components/RecencyNudge";
import { StruggleNudge } from "./_components/StruggleNudge";
import { extractTrailingChip } from "./_components/helpers";
import { sendChatMessage } from "./_components/streamClient";
import type { RequestedMode, SubjectRow, UiMessage } from "./_components/types";

const QUOTA_LIMITS = { chat: 50, research: 10 } as const;

function genId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function StudentSubjectChatPage() {
  const params = useParams<{ subjectId: string }>();
  const subjectId = params?.subjectId;

  const [subject, setSubject] = useState<SubjectRow | null>(null);
  const [syllabusContent, setSyllabusContent] = useState<string>("");
  const [hasSyllabus, setHasSyllabus] = useState<boolean | null>(null);
  const [suggestedPrompts, setSuggestedPrompts] = useState<string[]>([
    "Summarize the syllabus and key units.",
    "Explain the most important concepts for exams.",
    "Give me 5 practice questions with answers.",
    "Teach me Unit 1 step-by-step.",
  ]);

  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isResumed, setIsResumed] = useState(false);
  const [sessionCreatedAt, setSessionCreatedAt] = useState<Date | null>(null);

  const [mode, setMode] = useState<RequestedMode>("auto");
  const [inputValue, setInputValue] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isRateLimited, setIsRateLimited] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  // Set only while an SSE token stream is actively arriving (meta received,
  // not yet done/error) — gates the beforeunload guard. A separate ref (not
  // state) provides the synchronous double-send lock: state updates land
  // after a re-render, which is too late to block a second call arriving in
  // the same tick (e.g. Enter key-repeat).
  const [isStreamActive, setIsStreamActive] = useState(false);
  const isSendingRef = useRef(false);

  const [recencyNudgeVisible, setRecencyNudgeVisible] = useState(false);
  const [struggleTopic, setStruggleTopic] = useState<string | null>(null);
  // A resumed session's last loaded message was role=user with no assistant
  // reply — set once on load, cleared as soon as any new exchange starts.
  const [orphanMessage, setOrphanMessage] = useState<string | null>(null);

  const [quotaChat, setQuotaChat] = useState(0);
  const [quotaResearch, setQuotaResearch] = useState(0);

  const [loadingSubject, setLoadingSubject] = useState(true);
  const [loadingSyllabus, setLoadingSyllabus] = useState(true);

  const struggleDismissKey = subjectId ? `chat_struggle_dismissed_${subjectId}` : "";

  // ── Load subject ─────────────────────────────────────────────────────
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
        setSubject(error || !data ? null : (data as SubjectRow));
      } finally {
        setLoadingSubject(false);
      }
    };
    run();
  }, [subjectId]);

  // ── Load syllabus content ───────────────────────────────────────────
  useEffect(() => {
    if (!subjectId) return;
    const run = async () => {
      setLoadingSyllabus(true);
      try {
        const res = await fetch(`/api/subjects/content?subjectId=${encodeURIComponent(subjectId)}`);
        const json = await res.json().catch(() => null);
        if (!res.ok || !json) {
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

  // ── Session resume/create + suggestions + quota seed ────────────────
  useEffect(() => {
    if (!subjectId || !hasSyllabus) return;
    let cancelled = false;

    const run = async () => {
      try {
        const sessionRes = await fetch("/api/chat/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subjectId }),
        });
        if (sessionRes.ok) {
          const { sessionId: sid, isResumed: resumed, messageCount } = await sessionRes.json();
          if (cancelled) return;
          setSessionId(sid);
          setIsResumed(resumed);

          const supabase = createBrowserClient();

          if (resumed) {
            const { data: sessionRow } = await supabase
              .from("chat_sessions")
              .select("created_at")
              .eq("id", sid)
              .single();
            if (!cancelled && sessionRow?.created_at) {
              setSessionCreatedAt(new Date(sessionRow.created_at as string));
            }
          }

          if (resumed && messageCount > 0) {
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
              .map((r: { role: "user" | "assistant"; content: string }) => {
                if (r.role === "user") {
                  return { id: genId(), role: "user" as const, content: r.content };
                }
                const trailing = extractTrailingChip(r.content);
                return {
                  id: genId(),
                  role: "assistant" as const,
                  content: trailing ? trailing.remaining : r.content,
                  status: "done" as const,
                  trailingChip: trailing?.chip,
                };
              });
            if (ordered.length > 0) {
              setMessages(ordered);
              const last = ordered[ordered.length - 1];
              if (last.role === "user") {
                setOrphanMessage(last.content);
              }
            }
          }

          // Seed today's quota usage from usage_analytics (RLS: own rows only).
          const today = new Date().toISOString().slice(0, 10);
          const { data: usageRows } = await supabase
            .from("usage_analytics")
            .select("event_type, event_count")
            .eq("date", today);
          if (!cancelled && usageRows) {
            let chatCount = 0;
            let researchCount = 0;
            for (const row of usageRows as { event_type: string; event_count: number }[]) {
              if (row.event_type === "chat") chatCount += row.event_count ?? 0;
              if (row.event_type === "research") researchCount += row.event_count ?? 0;
            }
            setQuotaChat(chatCount);
            setQuotaResearch(researchCount);
          }
        }

        const res = await fetch("/api/chat/suggestions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subjectId, syllabusContent }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || cancelled) return;
        const prompts = Array.isArray(json?.suggestions) ? json.suggestions : [];
        if (prompts.length > 0) setSuggestedPrompts(prompts.slice(0, 4));
      } catch {
        // ignore — suggestions/quota are non-critical enhancements
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [subjectId, hasSyllabus, syllabusContent]);

  // ── Warn on refresh/close while a stream is actively arriving ──────────
  // In-app navigation (Next router / Link) is deliberately left alone —
  // beforeunload only fires on an actual page unload (refresh/close/external
  // nav), never on client-side route changes, so this can't block those.
  // Part A's eager user-row persist means a lost in-app navigation is
  // recoverable via the resume card on return; a lost tab isn't, hence the
  // native prompt here.
  useEffect(() => {
    if (!isStreamActive) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isStreamActive]);

  // ── Core exchange runner — shared by send / retry / regenerate / etc ──
  const runExchange = useCallback(
    async (
      userText: string,
      requestedMode: RequestedMode,
      opts?: { retryAssistantId?: string }
    ) => {
      const trimmed = userText.trim();
      if (!trimmed || !subjectId || !sessionId || isSendingRef.current || isRateLimited) return;

      // Synchronous lock — closes the double-Enter/double-click race: two
      // calls arriving in the same tick both read isSendingRef before either
      // sets it, unlike isSending state (which only updates after a re-render).
      isSendingRef.current = true;
      setIsSending(true);
      setIsStreamActive(false);
      setRecencyNudgeVisible(false);
      setOrphanMessage(null);

      let assistantId: string;
      if (opts?.retryAssistantId) {
        assistantId = opts.retryAssistantId;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, status: "thinking", content: "", errorMessage: undefined, citations: undefined, trailingChip: undefined, cached: undefined }
              : m
          )
        );
      } else {
        assistantId = genId();
        setMessages((prev) => [
          ...prev,
          { id: genId(), role: "user", content: trimmed },
          {
            id: assistantId,
            role: "assistant",
            content: "",
            status: "thinking",
            respondingTo: trimmed,
            requestedMode,
          },
        ]);
      }

      let accumulated = "";
      const applyStruggle = (struggle: { struggle_detected: true; topic: string } | null) => {
        if (!struggle?.struggle_detected) return;
        if (typeof window !== "undefined" && sessionStorage.getItem(struggleDismissKey) === "1") {
          return;
        }
        setStruggleTopic(struggle.topic);
      };

      await sendChatMessage(
        { subjectId, message: trimmed, sessionId, mode: requestedMode },
        {
          onMeta: (meta) => {
            // Only the SSE branch (standard/reasoning) ever emits a meta
            // frame — this is what "a stream is in progress" means for the
            // beforeunload guard below.
            setIsStreamActive(true);
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? {
                      ...m,
                      status: "streaming",
                      effectiveMode: meta.mode,
                      autoElevated: requestedMode === "auto" && meta.mode === "reasoning",
                    }
                  : m
              )
            );
            if (meta.recencySuggested && meta.mode !== "research") setRecencyNudgeVisible(true);
          },
          onChunk: (text) => {
            accumulated += text;
            const snapshot = accumulated;
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantId ? { ...m, content: snapshot, status: "streaming" } : m))
            );
          },
          onError: (msg) => {
            setIsStreamActive(false);
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantId ? { ...m, status: "error", errorMessage: msg, retryable: true } : m))
            );
          },
          onDone: ({ struggle }) => {
            setIsStreamActive(false);
            setQuotaChat((c) => c + 1);
            const trailing = extractTrailingChip(accumulated);
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? {
                      ...m,
                      status: "done",
                      content: trailing ? trailing.remaining : accumulated,
                      trailingChip: trailing?.chip,
                    }
                  : m
              )
            );
            applyStruggle(struggle);
          },
          onJson: (data) => {
            const trailing = extractTrailingChip(data.response);
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? {
                      ...m,
                      status: "done",
                      content: trailing ? trailing.remaining : data.response,
                      trailingChip: trailing?.chip,
                      cached: data.cached === true,
                      effectiveMode: data.mode,
                      citations: data.citations,
                    }
                  : m
              )
            );
            if (data.recencySuggested && data.mode !== "research") setRecencyNudgeVisible(true);
            if (data.mode === "research") setQuotaResearch((c) => c + 1);
            applyStruggle(data.struggle ?? null);
          },
          onFatal: (payload) => {
            if (payload.status === 429) {
              setIsRateLimited(true);
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? { ...m, status: "error", errorMessage: payload.message ?? "Daily limit reached.", retryable: false }
                    : m
                )
              );
              return;
            }
            if (payload.error === "no_syllabus") {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? {
                        ...m,
                        status: "error",
                        errorMessage: payload.message ?? "This subject has no syllabus content yet.",
                        retryable: false,
                      }
                    : m
                )
              );
              return;
            }
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? {
                      ...m,
                      status: "error",
                      errorMessage: payload.message ?? "Something went wrong. Please try again.",
                      retryable: payload.retryable !== false,
                    }
                  : m
              )
            );
          },
          onNetworkError: () => {
            setIsStreamActive(false);
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, status: "error", errorMessage: "The response was interrupted. Please try again.", retryable: true }
                  : m
              )
            );
          },
        }
      );

      isSendingRef.current = false;
      setIsSending(false);
      setIsStreamActive(false);
    },
    [subjectId, sessionId, isRateLimited, struggleDismissKey]
  );

  const handleSend = () => {
    const text = inputValue;
    setInputValue("");
    runExchange(text, mode);
  };

  const onSuggestionSelect = (text: string) => runExchange(text, mode);

  const onRetry = useCallback(
    (id: string) => {
      const msg = messages.find((m) => m.id === id);
      if (!msg?.respondingTo) return;
      runExchange(msg.respondingTo, msg.requestedMode ?? "auto", { retryAssistantId: id });
    },
    [messages, runExchange]
  );

  const onSimplify = useCallback(
    (id: string) => {
      const msg = messages.find((m) => m.id === id);
      if (!msg?.respondingTo) return;
      runExchange(`Explain the same thing more simply, shorter: ${msg.respondingTo}`, mode);
    },
    [messages, runExchange, mode]
  );

  const onGoDeeper = useCallback(
    (id: string) => {
      const msg = messages.find((m) => m.id === id);
      if (!msg?.respondingTo) return;
      runExchange(`Go deeper on the same topic, more rigor: ${msg.respondingTo}`, mode);
    },
    [messages, runExchange, mode]
  );

  const onVisualize = useCallback(
    (id: string) => {
      void id;
      runExchange(
        "Create an interactive visualization for the concept explained in your last response. Use the interactive-html format.",
        mode
      );
    },
    [runExchange, mode]
  );

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
      setIsResumed(false);
      setSessionCreatedAt(null);
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
      a.download = `chat-${subject?.name ?? "notes"}-${new Date().toISOString().slice(0, 10)}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      console.error("[chat/export] failed");
    } finally {
      setIsExporting(false);
    }
  }

  const dismissStruggle = () => {
    setStruggleTopic(null);
    if (typeof window !== "undefined" && struggleDismissKey) {
      sessionStorage.setItem(struggleDismissKey, "1");
    }
  };

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
          <CardTitle>
            {subject.name} ({subject.code})
          </CardTitle>
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

  const quota =
    mode === "research"
      ? { used: quotaResearch, limit: QUOTA_LIMITS.research, label: "Research" }
      : { used: quotaChat, limit: QUOTA_LIMITS.chat, label: "Chat" };

  return (
    <div className="flex h-[calc(100vh-7rem)] flex-col">
      <ChatHeader
        subject={subject}
        isResumed={isResumed}
        sessionCreatedAt={sessionCreatedAt}
        quotaUsed={quota.used}
        quotaLimit={quota.limit}
        quotaLabel={quota.label}
        hasMessages={messages.length > 0}
        isExporting={isExporting}
        onExport={handleExportChat}
        onStartFresh={handleStartFresh}
      />

      <MessageList
        messages={messages}
        suggestedPrompts={suggestedPrompts}
        onSuggestionSelect={onSuggestionSelect}
        onRetry={onRetry}
        onRegenerate={onRetry}
        onSimplify={onSimplify}
        onGoDeeper={onGoDeeper}
        onVisualize={onVisualize}
        orphanMessage={orphanMessage}
        onGetOrphanAnswer={() => orphanMessage && runExchange(orphanMessage, mode)}
      />

      <div className="sticky bottom-0 z-10 border-t bg-background/80 px-1 py-3 backdrop-blur">
        {recencyNudgeVisible && (
          <RecencyNudge
            onSwitchToResearch={() => {
              setMode("research");
              setRecencyNudgeVisible(false);
            }}
            onDismiss={() => setRecencyNudgeVisible(false)}
          />
        )}
        {struggleTopic && subjectId && (
          <StruggleNudge topic={struggleTopic} subjectId={subjectId} onDismiss={dismissStruggle} />
        )}

        <Composer
          value={inputValue}
          onChange={setInputValue}
          onSend={handleSend}
          mode={mode}
          onModeChange={setMode}
          disabled={isSending || isRateLimited}
          isSending={isSending}
          placeholder={
            isRateLimited
              ? "Daily limit reached — come back tomorrow"
              : `Ask anything about ${subject.name}...`
          }
        />
        {isRateLimited && (
          <p className="mt-2 text-xs text-muted-foreground">
            You&apos;ve reached your daily chat limit. Come back tomorrow! 📚
          </p>
        )}
      </div>
    </div>
  );
}
