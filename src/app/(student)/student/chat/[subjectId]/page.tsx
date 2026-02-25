"use client";

import "katex/dist/katex.min.css";

import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkMath from "remark-math";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { createBrowserClient } from "@/lib/db/supabase-browser";
import { BookOpen, HelpCircle, Lightbulb, Zap } from "lucide-react";
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

export default function StudentSubjectChatPage() {
  const params = useParams<{ subjectId: string }>();
  const subjectId = params?.subjectId;

  const [subject, setSubject] = useState<SubjectRow | null>(null);
  const [syllabusContent, setSyllabusContent] = useState<string>("");
  const [hasSyllabus, setHasSyllabus] = useState<boolean | null>(null);
  const [suggestedPrompts, setSuggestedPrompts] = useState<string[]>([]);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isRateLimited, setIsRateLimited] = useState(false);

  const [loadingSubject, setLoadingSubject] = useState(true);
  const [loadingSyllabus, setLoadingSyllabus] = useState(true);

  const bottomRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const historyForRequest = useMemo(() => {
    const last = messages.slice(-6);
    return last;
  }, [messages]);

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

    const run = async () => {
      try {
        const res = await fetch("/api/chat/suggestions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subjectId, syllabusContent }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) return;
        const prompts = Array.isArray(json?.suggestions)
          ? json.suggestions
          : [];
        setSuggestedPrompts(prompts.slice(0, 4));
      } catch {
        // ignore
      }
    };

    run();
  }, [subjectId, hasSyllabus, syllabusContent]);

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || !subjectId || isRateLimited) return;

      setMessages((prev) => [...prev, { role: "user", content: trimmed }]);
      setInputValue("");
      setIsLoading(true);

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            subjectId,
            message: trimmed,
            history: historyForRequest,
          }),
        });
        const json = await res.json().catch(() => ({}));
        if (res.status === 429) {
          setIsRateLimited(true);
          const friendly =
            "You've reached your daily chat limit. Come back tomorrow! 📚";
          setMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              content:
                typeof json?.message === "string" && json.message
                  ? `${json.message}\n\n${friendly}`
                  : friendly,
            },
          ]);
          return;
        }

        if (!res.ok) {
          setMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              content: json?.error ?? "Something went wrong. Please try again.",
            },
          ]);
          return;
        }
        const reply = String(
          json?.content ?? json?.response ?? json?.message ?? ""
        );
        setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
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
    [historyForRequest, subjectId, isRateLimited]
  );

  const handleSubmit = async () => {
    await sendMessage(inputValue);
  };

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
    const icons = [BookOpen, Lightbulb, HelpCircle, Zap] as const;

    return prompts.slice(0, 4).map((p, idx) => ({
      text: p,
      Icon: icons[idx] ?? BookOpen,
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
      <div className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b bg-background/80 px-1 py-3 backdrop-blur">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">
            {subject.name} <span className="text-muted-foreground">({subject.code})</span>
          </div>
          <div className="text-xs text-muted-foreground">
            Semester {subject.semester} • {subject.branch}
          </div>
        </div>
        <Badge className="shrink-0 bg-emerald-600 text-white hover:bg-emerald-600">
          Syllabus-locked ✓
        </Badge>
      </div>

      <ScrollArea className="flex-1 px-1 py-4">
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
                  <div className="max-w-[85%] rounded-2xl bg-blue-600 px-4 py-2 text-sm text-white">
                    {m.content}
                  </div>
                </div>
              ) : (
                <div key={idx} className="flex justify-start">
                  <Card className="max-w-[85%] border bg-card">
                    <CardContent className="px-4 py-3">
                      <ReactMarkdown
                        remarkPlugins={[remarkMath]}
                        rehypePlugins={[rehypeKatex]}
                        components={{
                          p: ({ children }) => (
                            <p className="mb-2 last:mb-0">{children}</p>
                          ),
                          ul: ({ children }) => (
                            <ul className="list-disc pl-4 mb-2 space-y-1">
                              {children}
                            </ul>
                          ),
                          ol: ({ children }) => (
                            <ol className="list-decimal pl-4 mb-2 space-y-1">
                              {children}
                            </ol>
                          ),
                          li: ({ children }) => (
                            <li className="text-sm">{children}</li>
                          ),
                          strong: ({ children }) => (
                            <strong className="font-semibold">{children}</strong>
                          ),
                          h3: ({ children }) => (
                            <h3 className="font-semibold text-base mt-3 mb-1">
                              {children}
                            </h3>
                          ),
                          h4: ({ children }) => (
                            <h4 className="font-semibold text-sm mt-2 mb-1">
                              {children}
                            </h4>
                          ),
                          hr: () => <hr className="my-3 border-border" />,
                          code: ({ children }) => (
                            <code className="bg-muted px-1 py-0.5 rounded text-xs font-mono">
                              {children}
                            </code>
                          ),
                        }}
                      >
                        {m.content}
                      </ReactMarkdown>
                    </CardContent>
                  </Card>
                </div>
              )
            )}

            {isLoading && (
              <div className="flex justify-start">
                <Card className="max-w-[85%] border bg-card">
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
        <div className="flex items-center gap-2">
          <Input
            ref={inputRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`Ask anything about ${subject.name}...`}
            disabled={isLoading || isRateLimited}
          />
          <Button
            onClick={handleSubmit}
            disabled={isLoading || isRateLimited || !inputValue.trim()}
          >
            Send
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

