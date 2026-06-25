"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Clock,
  Download,
  Loader2,
  RotateCcw,
  Trash2,
  Wand2,
  X,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface HistoryRow {
  id: string;
  title: string;
  subject: string | null;
  topic: string | null;
  slideCount: number | null;
  created_at: string;
  status: string;
  slidesCompleted?: number | null;
  totalSlides?: number | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onResumeGeneration?: (params: { contentId: string }) => void;
}

function StatusIcon({ status }: { status: string }) {
  if (status === "completed")
    return <CheckCircle2 className="size-4 text-green-500 shrink-0" />;
  if (status === "processing" || status === "in_progress")
    return <Loader2 className="size-4 animate-spin text-primary shrink-0" />;
  if (status === "failed")
    return <XCircle className="size-4 text-destructive shrink-0" />;
  if (status === "abandoned")
    return <AlertCircle className="size-4 text-amber-500 shrink-0" />;
  return <Clock className="size-4 text-muted-foreground shrink-0" />;
}

function statusLabel(status: string): string {
  switch (status) {
    case "completed":
      return "Completed";
    case "processing":
    case "in_progress":
      return "In progress";
    case "failed":
      return "Failed";
    case "abandoned":
      return "Abandoned";
    default:
      return status;
  }
}

export function MyGenerationsPanel({ open, onClose, onResumeGeneration }: Props) {
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [resumingId, setResumingId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(() => {
    setIsLoading(true);
    fetch("/api/generate/ppt/history")
      .then((r) => r.json())
      .then((data: { rows: HistoryRow[] }) => {
        setRows(
          (data.rows ?? []).map((row) => {
            const meta = (row as unknown as { metadata?: Record<string, unknown> }).metadata ?? {};
            return {
              ...row,
              slidesCompleted:
                (meta.slidesCompleted as number | undefined) ?? null,
              totalSlides: (meta.totalSlides as number | undefined) ?? null,
            };
          })
        );
        setLoaded(true);
      })
      .catch((err) => {
        console.error("[MyGenerationsPanel] load failed", err);
        toast.error("Failed to load past presentations");
      })
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(() => {
    if (open && !loaded) load();
  }, [open, loaded, load]);

  const handleDelete = async (id: string, title: string) => {
    if (
      !confirm(
        `Delete "${title}"? This permanently removes the file and cannot be undone.`
      )
    )
      return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/generate/ppt/download/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(await res.text());
      setRows((prev) => prev.filter((r) => r.id !== id));
      toast.success("Presentation deleted");
    } catch (err) {
      console.error("[MyGenerationsPanel] delete failed", err);
      toast.error("Delete failed. Please try again.");
    } finally {
      setDeletingId(null);
    }
  };

  const handleDownload = async (id: string, title: string) => {
    setDownloadingId(id);
    try {
      const res = await fetch(`/api/generate/ppt/download/${id}`);
      if (!res.ok) throw new Error(await res.text());
      const { downloadUrl } = (await res.json()) as { downloadUrl: string };
      const a = document.createElement("a");
      a.href = downloadUrl;
      a.download = `${title}.pptx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch {
      toast.error("Download failed. The file may no longer be available.");
    } finally {
      setDownloadingId(null);
    }
  };

  const handleResume = async (row: HistoryRow) => {
    if (onResumeGeneration) {
      onResumeGeneration({ contentId: row.id });
      onClose();
      return;
    }
    setResumingId(row.id);
    try {
      const res = await fetch("/api/generate/ppt/resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contentId: row.id }),
      });
      if (!res.ok) throw new Error(await res.text());
      toast.success("Generation resumed");
      load();
    } catch {
      toast.error("Resume is not yet available for this generation.");
    } finally {
      setResumingId(null);
    }
  };

  const handleRetry = async (row: HistoryRow) => {
    setResumingId(row.id);
    try {
      const res = await fetch("/api/generate/ppt/resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contentId: row.id, retry: true }),
      });
      if (!res.ok) throw new Error(await res.text());
      toast.success("Retry started");
      load();
    } catch {
      toast.error("Retry is not yet available. Start a new generation instead.");
    } finally {
      setResumingId(null);
    }
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className={cn(
          "fixed inset-0 z-40 bg-black/40",
          "transition-opacity duration-200",
          open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        )}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        role="dialog"
        aria-label="My Generations"
        aria-modal="true"
        className={cn(
          "fixed right-0 top-0 h-full w-[440px] z-50 bg-background border-l flex flex-col",
          "transition-transform duration-200 ease-out",
          open ? "translate-x-0" : "translate-x-full"
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b px-5 py-4 shrink-0">
          <h2 className="text-base font-semibold">My Generations</h2>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={load}
              title="Refresh"
              disabled={isLoading}
            >
              {isLoading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RotateCcw className="size-4" />
              )}
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={onClose}>
              <X className="size-4" />
            </Button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {isLoading && !loaded ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground text-sm gap-2">
              <Loader2 className="size-4 animate-spin" />
              Loading…
            </div>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground text-sm gap-2">
              <p>No presentations yet.</p>
              <p className="text-xs">Generate your first one to see it here.</p>
            </div>
          ) : (
            <ul className="divide-y">
              {rows.map((row) => {
                const isProcessing =
                  row.status === "processing" || row.status === "in_progress";
                const isFailed = row.status === "failed";
                const isAbandoned = row.status === "abandoned";
                const isCompleted = row.status === "completed";
                const progressText =
                  isProcessing &&
                  row.slidesCompleted != null &&
                  row.totalSlides != null
                    ? `${row.slidesCompleted} of ${row.totalSlides} slides`
                    : isProcessing
                    ? "In progress…"
                    : null;

                return (
                  <li
                    key={row.id}
                    className="flex flex-col gap-3 px-5 py-4"
                  >
                    {/* Title row */}
                    <div className="flex items-start gap-2 min-w-0">
                      <StatusIcon status={row.status} />
                      <div className="min-w-0 flex-1">
                        <p
                          className="font-medium text-sm truncate"
                          title={row.title}
                        >
                          {row.title}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">
                          {[row.subject, row.topic].filter(Boolean).join(" · ")}
                          {row.slideCount != null
                            ? ` · ${row.slideCount} slides`
                            : ""}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(row.created_at).toLocaleString()}
                        </p>
                      </div>
                      <Badge
                        variant={
                          isCompleted
                            ? "default"
                            : isFailed
                            ? "destructive"
                            : "secondary"
                        }
                        className="shrink-0 text-xs"
                      >
                        {statusLabel(row.status)}
                      </Badge>
                    </div>

                    {/* Progress text for in-progress */}
                    {progressText && (
                      <p className="text-xs text-primary font-medium pl-6">
                        {progressText}
                      </p>
                    )}

                    {/* Action row */}
                    <div className="flex items-center gap-2 pl-6 flex-wrap">
                      {isCompleted && (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={downloadingId === row.id}
                            onClick={() => handleDownload(row.id, row.title)}
                            className="h-7 text-xs"
                          >
                            {downloadingId === row.id ? (
                              <Loader2 className="size-3 animate-spin" />
                            ) : (
                              <Download className="size-3" />
                            )}
                            Download
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            asChild
                            className="h-7 text-xs"
                          >
                            <Link href={`/faculty/generate/refine/${row.id}`}>
                              <Wand2 className="size-3" />
                              Refine
                            </Link>
                          </Button>
                        </>
                      )}

                      {isProcessing && (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={resumingId === row.id}
                          onClick={() => handleResume(row)}
                          className="h-7 text-xs"
                        >
                          {resumingId === row.id ? (
                            <Loader2 className="size-3 animate-spin" />
                          ) : (
                            <ChevronRight className="size-3" />
                          )}
                          Resume
                        </Button>
                      )}

                      {(isFailed || isAbandoned) && (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={resumingId === row.id}
                          onClick={() => handleRetry(row)}
                          className="h-7 text-xs"
                        >
                          {resumingId === row.id ? (
                            <Loader2 className="size-3 animate-spin" />
                          ) : (
                            <RotateCcw className="size-3" />
                          )}
                          Retry
                        </Button>
                      )}

                      {/* Delete — always shown */}
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="size-7 text-muted-foreground hover:text-destructive ml-auto"
                        disabled={deletingId === row.id}
                        onClick={() => handleDelete(row.id, row.title)}
                        title="Delete"
                      >
                        {deletingId === row.id ? (
                          <Loader2 className="size-3 animate-spin" />
                        ) : (
                          <Trash2 className="size-3" />
                        )}
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}

// Keep backward-compatible named export for any existing import
export { MyGenerationsPanel as MyGenerationsList };
