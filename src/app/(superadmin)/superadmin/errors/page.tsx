"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface ErrorRow {
  id: string;
  created_at: string;
  scope: string;
  route: string | null;
  http_method: string | null;
  user_email_snapshot: string | null;
  user_role_snapshot: string | null;
  message: string;
  stack: string | null;
  origin: "handled" | "unhandled";
}

interface ScopeCount {
  scope: string;
  count: number;
}

interface ErrorsResponse {
  errors: ErrorRow[];
  total: number;
  truncated: boolean;
  sinceHours: number;
  topScopes: ScopeCount[];
}

const WINDOWS = [
  { value: "1", label: "Last hour" },
  { value: "24", label: "Last 24 hours" },
  { value: "168", label: "Last 7 days" },
];

export default function ErrorsPage() {
  const [data, setData] = useState<ErrorsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sinceHours, setSinceHours] = useState("24");
  const [expanded, setExpanded] = useState<string | null>(null);

  // Guards against a slow response for a previously-selected window landing
  // after a faster one for the current window and overwriting it — the exact
  // stale-response bug CLAUDE.md's verification protocol calls out.
  const requestIdRef = useRef(0);

  const load = useCallback(async (hours: string) => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/admin/errors?sinceHours=${hours}&limit=200`);
      const body = await res.json();

      if (requestId !== requestIdRef.current) return;

      if (!res.ok) {
        setError(body?.error ?? "Could not load error logs.");
        setData(null);
        return;
      }
      setData(body as ErrorsResponse);
    } catch {
      if (requestId !== requestIdRef.current) return;
      setError("Could not reach the server.");
      setData(null);
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(sinceHours);
  }, [load, sinceHours]);

  const errors = data?.errors ?? [];

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Runtime Errors</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Server-side failures from student-facing routes. An empty list here
            is the good outcome.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={sinceHours} onValueChange={setSinceHours}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WINDOWS.map((w) => (
                <SelectItem key={w.value} value={w.value}>
                  {w.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            onClick={() => void load(sinceHours)}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
            <span className="ml-2">Refresh</span>
          </Button>
        </div>
      </div>

      {error && (
        <Card className="border-destructive">
          <CardContent className="flex items-start gap-3 pt-6">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-destructive" />
            <p className="text-sm">{error}</p>
          </CardContent>
        </Card>
      )}

      {loading && !data && (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      )}

      {data && (
        <>
          {data.topScopes.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Most frequent</CardTitle>
                <CardDescription>
                  {data.total} error{data.total === 1 ? "" : "s"} in the selected
                  window
                  {data.truncated && " (list truncated at 200)"}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {data.topScopes.slice(0, 8).map((s) => (
                  <div
                    key={s.scope}
                    className="flex items-center justify-between gap-4 text-sm"
                  >
                    <span className="truncate font-mono">{s.scope}</span>
                    <Badge variant="secondary">{s.count}</Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {errors.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <p className="text-sm text-muted-foreground">
                  No errors recorded in this window.
                </p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Newest first</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {errors.map((row) => {
                  const isOpen = expanded === row.id;
                  return (
                    <div
                      key={row.id}
                      className="rounded-md border p-3 text-sm"
                    >
                      <button
                        type="button"
                        onClick={() => setExpanded(isOpen ? null : row.id)}
                        className="flex w-full flex-col gap-1 text-left"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge
                            variant={
                              row.origin === "unhandled"
                                ? "destructive"
                                : "secondary"
                            }
                          >
                            {row.origin}
                          </Badge>
                          <span className="font-mono text-xs">{row.scope}</span>
                          <span className="ml-auto text-xs text-muted-foreground">
                            {new Date(row.created_at).toLocaleString()}
                          </span>
                        </div>
                        <p className="break-words">{row.message}</p>
                        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                          {row.route && (
                            <span>
                              {row.http_method ?? ""} {row.route}
                            </span>
                          )}
                          {row.user_email_snapshot && (
                            <span>{row.user_email_snapshot}</span>
                          )}
                          {row.user_role_snapshot && (
                            <span>{row.user_role_snapshot}</span>
                          )}
                        </div>
                      </button>

                      {isOpen && row.stack && (
                        <pre className="mt-3 max-h-80 overflow-auto rounded bg-muted p-3 text-xs">
                          {row.stack}
                        </pre>
                      )}
                      {isOpen && !row.stack && (
                        <p className="mt-3 text-xs text-muted-foreground">
                          No stack trace was captured for this error.
                        </p>
                      )}
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
