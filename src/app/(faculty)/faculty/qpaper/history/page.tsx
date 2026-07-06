"use client";

/**
 * Faculty Q-paper history — browse previously finalized papers and re-download
 * their artifacts. Rows are written by the builder's finalize event
 * (see ../page.tsx handleFinalized) into `qpaper_history`.
 *
 * Reads go through the browser Supabase client directly: RLS on qpaper_history
 * scopes SELECT to own rows (plus oversight roles). The PDF and .docx live in
 * the public `generated-content` bucket, so their links are minted client-side
 * via getPublicUrl; the confidential answer key is re-signed on demand by
 * /api/qpaper/history/answer-key-link.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Download,
  FileText,
  Loader2,
  Lock,
  Pencil,
  Trash2,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { createBrowserClient } from "@/lib/db/supabase-browser";
import { useFacultySubjects } from "@/hooks/useSupabaseData";
import { toast } from "sonner";

interface HistoryRow {
  id: string;
  subject_id: string | null;
  label: string | null;
  total_marks: number | null;
  pdf_path: string | null;
  docx_path: string | null;
  answer_key_path: string | null;
  created_at: string;
}

export default function QpaperHistoryPage() {
  const { subjects } = useFacultySubjects();
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  // Row id currently fetching its (signed) answer-key link.
  const [signingId, setSigningId] = useState<string | null>(null);
  // Ids of rows whose stored snapshot has a full paper (so they can be reopened
  // for editing). null = not yet determined / query unavailable → allow all,
  // and let the builder fall back gracefully for any row that lacks a paper.
  const [resumableIds, setResumableIds] = useState<Set<string> | null>(null);
  // Row queued for deletion (drives the confirm dialog); id being deleted.
  const [deleteTarget, setDeleteTarget] = useState<HistoryRow | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const subjectById = useMemo(
    () => new Map(subjects.map((s) => [s.id, s])),
    [subjects]
  );

  useEffect(() => {
    let cancelled = false;
    const supabase = createBrowserClient();
    supabase
      .from("qpaper_history")
      .select(
        "id, subject_id, label, total_marks, pdf_path, docx_path, answer_key_path, created_at"
      )
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.error("[qpaper history] load failed", error);
          toast.error("Failed to load paper history");
        }
        setRows((data ?? []) as HistoryRow[]);
        setIsLoading(false);
      });

    // Determine which rows carry a resumable paper snapshot without pulling the
    // (potentially large) structure_summary blobs into the list — a filtered
    // id-only query. On error, leave resumableIds null so the button shows for
    // all rows and the builder handles any legacy row gracefully.
    supabase
      .from("qpaper_history")
      .select("id")
      .not("structure_summary->paper", "is", null)
      .then(({ data, error }) => {
        if (cancelled || error) return;
        setResumableIds(new Set((data ?? []).map((r) => r.id as string)));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // PDF / DOCX live in the public bucket — getPublicUrl is pure string-building.
  const openPublic = (path: string) => {
    const supabase = createBrowserClient();
    const { data } = supabase.storage
      .from("generated-content")
      .getPublicUrl(path);
    window.open(data.publicUrl, "_blank");
  };

  // Answer key is confidential — re-sign a short-lived URL on demand.
  const openAnswerKey = async (id: string) => {
    setSigningId(id);
    try {
      const res = await fetch(`/api/qpaper/history/answer-key-link?id=${id}`);
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as { downloadUrl: string };
      window.open(data.downloadUrl, "_blank");
    } catch (err) {
      console.error(err);
      toast.error("Failed to open answer key");
    } finally {
      setSigningId(null);
    }
  };

  const subjectLabel = (row: HistoryRow) => {
    const s = row.subject_id ? subjectById.get(row.subject_id) : undefined;
    if (s) return `${s.code} · ${s.name}`;
    return row.label || "Untitled paper";
  };

  // Delete a paper and its stored files. Removes the row from the list on
  // success so storage isn't left holding papers no one uses.
  const confirmDelete = async () => {
    const target = deleteTarget;
    if (!target) return;
    setDeleteTarget(null);
    setDeletingId(target.id);
    try {
      const res = await fetch("/api/qpaper/history/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: target.id }),
      });
      if (!res.ok) throw new Error(await res.text());
      setRows((prev) => prev.filter((r) => r.id !== target.id));
      toast.success("Paper deleted");
    } catch (err) {
      console.error(err);
      toast.error("Couldn't delete this paper");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FileText className="size-6" />
            Past Question Papers
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Reopen a paper to edit it, or re-download what you generated before
          </p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link href="/faculty/qpaper">
            <ArrowLeft className="mr-2 size-4" />
            Back to builder
          </Link>
        </Button>
      </div>

      {!isLoading && rows.length > 0 && (
        <div className="flex items-start gap-2 rounded-md border bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground">
          <Trash2 className="size-3.5 mt-0.5 shrink-0" />
          <p>
            Keep this list tidy — deleting papers you no longer need also removes
            their stored PDF, Word, and answer-key files, freeing up space.
            Deletion is permanent and can&apos;t be undone.
          </p>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="mr-2 size-5 animate-spin" />
          Loading…
        </div>
      ) : rows.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          No papers yet. Generate and download a paper from the{" "}
          <Link href="/faculty/qpaper" className="underline">
            builder
          </Link>{" "}
          and it&apos;ll show up here.
        </Card>
      ) : (
        <div className="space-y-3">
          {rows.map((row) => (
            <Card
              key={row.id}
              className="p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="font-medium truncate">{subjectLabel(row)}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {new Date(row.created_at).toLocaleString()}
                  {row.total_marks != null && ` · ${row.total_marks} marks`}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                {(resumableIds === null || resumableIds.has(row.id)) && (
                  <Button variant="default" size="sm" asChild>
                    <Link href={`/faculty/qpaper?resumeHistory=${row.id}`}>
                      <Pencil className="mr-2 size-4" />
                      Open &amp; Edit
                    </Link>
                  </Button>
                )}
                {row.pdf_path && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => openPublic(row.pdf_path!)}
                  >
                    <Download className="mr-2 size-4" />
                    PDF
                  </Button>
                )}
                {row.docx_path && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => openPublic(row.docx_path!)}
                  >
                    <FileText className="mr-2 size-4" />
                    Word
                  </Button>
                )}
                {row.answer_key_path && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => openAnswerKey(row.id)}
                    disabled={signingId === row.id}
                  >
                    {signingId === row.id ? (
                      <Loader2 className="mr-2 size-4 animate-spin" />
                    ) : (
                      <Lock className="mr-2 size-4" />
                    )}
                    Answer Key
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => setDeleteTarget(row)}
                  disabled={deletingId === row.id}
                  aria-label="Delete paper"
                >
                  {deletingId === row.id ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Trash2 className="size-4" />
                  )}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this paper?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget ? `"${subjectLabel(deleteTarget)}" ` : "This paper "}
              and its stored PDF, Word, and answer-key files will be permanently
              deleted. This can&apos;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
