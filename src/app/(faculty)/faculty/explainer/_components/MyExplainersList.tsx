"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronLeft, ChevronRight, Copy, Play, Volume2 } from "lucide-react";
import {
  copyExplainerLink,
  formatDuration,
  type ExplainerListItem,
  type PreviewExplainer,
} from "./shared";

const PER_PAGE = 6;

interface Props {
  subjectId: string;
  /** Bump to force a refetch (after a generate / delete). */
  refreshKey: number;
  onPreview: (explainer: PreviewExplainer) => void;
}

/**
 * Fetched data is tagged with the request key it belongs to, so switching
 * subject/page derives back to "loading" without any synchronous setState in an
 * effect (the codebase convention — see qbank/page.tsx). The page number is
 * likewise stored against its subject so a subject change resets to page 1
 * purely by derivation.
 */
export function MyExplainersList({ subjectId, refreshKey, onPreview }: Props) {
  const [pageState, setPageState] = useState({ subjectId: "", page: 1 });
  const page = pageState.subjectId === subjectId ? pageState.page : 1;
  const setPage = (next: number) => setPageState({ subjectId, page: next });

  const reqKey = `${subjectId}|${page}|${refreshKey}`;
  const [data, setData] = useState<{
    key: string;
    items: ExplainerListItem[];
    total: number;
  }>({ key: "", items: [], total: 0 });

  useEffect(() => {
    if (!subjectId) return;
    let cancelled = false;
    const params = new URLSearchParams({
      subject_id: subjectId,
      page: String(page),
      per_page: String(PER_PAGE),
    });
    fetch(`/api/explainer/list?${params.toString()}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("list failed"))))
      .then((d: { explainers: ExplainerListItem[]; total: number }) => {
        if (!cancelled) {
          setData({ key: reqKey, items: d.explainers ?? [], total: d.total ?? 0 });
        }
      })
      .catch(() => {
        if (!cancelled) setData({ key: reqKey, items: [], total: 0 });
      });
    return () => {
      cancelled = true;
    };
  }, [subjectId, page, refreshKey, reqKey]);

  const ready = data.key === reqKey;
  const items = ready ? data.items : [];
  const total = ready ? data.total : 0;
  const loading = !!subjectId && !ready;
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

  if (loading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-6 text-center">
        <p className="text-sm text-muted-foreground">
          No explainers yet for this subject
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {items.map((item) => (
        <div
          key={item.id}
          className="flex items-center gap-3 rounded-lg border border-border bg-card/60 p-3"
        >
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium" title={item.topic}>
              {item.topic}
            </p>
            <div className="mt-1 flex items-center gap-2">
              <Badge variant="secondary" className="text-[10px]">
                {formatDuration(item.duration_seconds)}
              </Badge>
              {item.has_audio && (
                <Badge
                  variant="outline"
                  className="gap-1 text-[10px] text-emerald-400 border-emerald-400/40"
                >
                  <Volume2 className="size-3" />
                  Audio
                </Badge>
              )}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              size="icon"
              variant="ghost"
              className="size-8"
              title="Copy link"
              onClick={() => copyExplainerLink(item.short_code)}
            >
              <Copy className="size-4" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="size-8"
              title="Preview"
              onClick={() =>
                onPreview({
                  id: item.id,
                  short_code: item.short_code,
                  topic: item.topic,
                  duration_seconds: item.duration_seconds,
                  has_audio: item.has_audio,
                  url: `/e/${item.short_code}`,
                })
              }
            >
              <Play className="size-4" />
            </Button>
          </div>
        </div>
      ))}

      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-1">
          <Button
            size="sm"
            variant="ghost"
            disabled={page <= 1}
            onClick={() => setPage(Math.max(1, page - 1))}
          >
            <ChevronLeft className="size-4" />
            Prev
          </Button>
          <span className="text-xs text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          <Button
            size="sm"
            variant="ghost"
            disabled={page >= totalPages}
            onClick={() => setPage(Math.min(totalPages, page + 1))}
          >
            Next
            <ChevronRight className="size-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
