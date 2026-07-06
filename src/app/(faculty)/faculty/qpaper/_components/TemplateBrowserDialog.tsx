"use client";

/**
 * "Browse Templates" button + dialog: My Templates / Shared Templates, each
 * searchable with a Load action. Lives in the setup panel (Section E);
 * extracted out of TemplateStructureStage so there's a single template
 * browser entry point instead of one per stage.
 */

import { useEffect, useState } from "react";
import { FolderOpen, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { PaperTemplateRow, SharedTemplateRow } from "@/lib/qpaper/templates";

function TemplateCard({
  tpl,
  byLine,
  onLoad,
  onDelete,
}: {
  tpl: PaperTemplateRow;
  byLine?: string;
  onLoad: () => void;
  onDelete?: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2 px-3 rounded-md border bg-card hover:bg-accent/30 transition-colors">
      <div className="min-w-0">
        <p className="text-sm font-medium truncate">
          {tpl.name}
          {tpl.is_default && (
            <span className="ml-2 text-[10px] text-primary font-semibold uppercase tracking-wide">
              default
            </span>
          )}
        </p>
        <p className="text-[11px] text-muted-foreground">
          {tpl.duration_minutes} min · {tpl.total_marks} marks
          {byLine ? ` · ${byLine}` : ""}
        </p>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {onDelete && tpl.is_owner && (
          <button
            type="button"
            onClick={onDelete}
            className="text-muted-foreground hover:text-destructive p-1"
            title="Delete template"
          >
            <Trash2 className="size-3.5" />
          </button>
        )}
        <Button size="sm" variant="outline" className="h-7 text-xs px-2" onClick={onLoad}>
          Load
        </Button>
      </div>
    </div>
  );
}

interface TemplateBrowserDialogProps {
  /** Increment to trigger a template list refetch (e.g. after saving). */
  refreshKey?: number;
  /** Called when the user clicks Load on a template row. */
  onLoadTemplate: (tpl: PaperTemplateRow) => void;
}

export function TemplateBrowserDialog({
  refreshKey,
  onLoadTemplate,
}: TemplateBrowserDialogProps) {
  const [myTemplates, setMyTemplates] = useState<PaperTemplateRow[]>([]);
  const [sharedTemplates, setSharedTemplates] = useState<SharedTemplateRow[]>([]);
  const [loadingTpl, setLoadingTpl] = useState(false);
  const [localRefreshKey, setLocalRefreshKey] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoadingTpl(true);
    fetch("/api/qpaper/templates")
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((data: { myTemplates?: PaperTemplateRow[]; sharedTemplates?: SharedTemplateRow[] }) => {
        if (!cancelled) {
          setMyTemplates(data.myTemplates ?? []);
          setSharedTemplates(data.sharedTemplates ?? []);
        }
      })
      .catch(() => {
        /* silently ignore — templates are not critical path */
      })
      .finally(() => {
        if (!cancelled) setLoadingTpl(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey, localRefreshKey]);

  const handleDelete = async (id: string) => {
    if (!window.confirm("Delete this template? This cannot be undone and will remove it for everyone it's shared with.")) return;
    const res = await fetch(`/api/qpaper/templates/${id}`, { method: "DELETE" });
    if (res.status === 403) {
      toast.error("You don't have permission to delete this template.");
      return;
    }
    if (!res.ok) {
      toast.error("Failed to delete template. Please try again.");
      return;
    }
    setLocalRefreshKey((k) => k + 1);
  };

  const q = search.toLowerCase();
  const filteredMy = myTemplates.filter((t) => t.name.toLowerCase().includes(q));
  const filteredShared = sharedTemplates.filter(
    (t) =>
      t.name.toLowerCase().includes(q) ||
      (t.creator_name ?? "").toLowerCase().includes(q)
  );

  return (
    <Dialog
      open={dialogOpen}
      onOpenChange={(open) => {
        setDialogOpen(open);
        if (!open) setSearch("");
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="w-full gap-1.5">
          <FolderOpen className="size-3.5" />
          Browse Templates
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Browse Templates</DialogTitle>
        </DialogHeader>

        <Input
          placeholder="Search by name or creator…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-8 text-sm"
        />

        {loadingTpl ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground py-4">
            <Loader2 className="size-3 animate-spin" /> Loading…
          </div>
        ) : (
          <div className="space-y-4">
            {/* My Templates */}
            <div className="space-y-1.5">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                My Templates
              </h3>
              {filteredMy.length === 0 ? (
                <p className="text-xs text-muted-foreground py-1">
                  {search
                    ? "No matching templates."
                    : "No saved templates yet. Use “Save as template” after building a structure."}
                </p>
              ) : (
                <ScrollArea className="max-h-64">
                  <div className="space-y-1 pr-3">
                    {filteredMy.map((tpl) => (
                      <TemplateCard
                        key={tpl.id}
                        tpl={tpl}
                        onLoad={() => {
                          onLoadTemplate(tpl);
                          setDialogOpen(false);
                        }}
                        onDelete={() => handleDelete(tpl.id)}
                      />
                    ))}
                  </div>
                </ScrollArea>
              )}
            </div>

            {/* Shared Templates */}
            <div className="space-y-1.5">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Shared Templates
              </h3>
              {filteredShared.length === 0 ? (
                <p className="text-xs text-muted-foreground py-1">
                  {search ? "No matching templates." : "No shared templates yet."}
                </p>
              ) : (
                <ScrollArea className="max-h-64">
                  <div className="space-y-1 pr-3">
                    {filteredShared.map((tpl) => (
                      <TemplateCard
                        key={tpl.id}
                        tpl={tpl}
                        byLine={`by ${tpl.creator_name ?? "Built-in"}`}
                        onLoad={() => {
                          onLoadTemplate(tpl);
                          setDialogOpen(false);
                        }}
                        onDelete={() => handleDelete(tpl.id)}
                      />
                    ))}
                  </div>
                </ScrollArea>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
