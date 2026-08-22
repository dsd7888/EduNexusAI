"use client";

/**
 * The past-paper upload dialog — one component, reached from every surface that
 * mentions PYQs (qpaper Sourcing, qpaper DoneView, qbank Generate, the Past
 * Papers tab). It is a dialog rather than a page on purpose: faculty always
 * arrive already holding a subject, so sending them to a separate upload screen
 * would make them re-pick it and lose their place in whatever they were doing.
 *
 * THREE DESIGN DECISIONS THAT MATTER, each load-bearing:
 *
 *  1. MULTI-FILE FROM THE START. Faculty have three to five papers sitting in
 *     one folder. A one-at-a-time flow means they upload one and stop, which
 *     lands the subject in the "thin" state — enough to enable PYQ-style
 *     generation, not enough for it to be good. The picker takes many files and
 *     uploads them sequentially.
 *
 *  2. SEQUENTIAL, NOT PARALLEL. Each file costs a Gemini Flash extraction call.
 *     Firing five at once risks a 429 that fails papers 3–5 for no reason the
 *     faculty can see or act on, and the per-file progress ("2 of 5") is more
 *     legible than five spinners. Slower, and correct.
 *
 *  3. THE RECEIPT IS THE PRODUCT. After each file the AI's actual reading is
 *     shown back: how many questions it found, which COs they covered, which
 *     COs no uploaded paper touches. An upload that disappears into a black hole
 *     never happens twice — the extraction receipt with a visible CO gap sitting
 *     next to "Add another paper" is the single highest-leverage element here.
 *
 * Year and exam type are INFERRED from the filename and left editable, rather
 * than asked for. "DS_EndSem_2024.pdf" should not require three form fields.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  FileUp,
  Loader2,
  Plus,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  EXAM_TYPES,
  EXAM_TYPE_LABELS,
  type ExamType,
  type PyqCoverage,
} from "@/lib/pyq/coverage";
import { NumericField } from "@/components/ui/numeric-field";
import { PYQ_BENEFIT_LONG, PYQ_UNLOCKS } from "./pyqCopy";

const MIN_YEAR = 2015;
const MAX_YEAR = new Date().getFullYear() + 1;
const MAX_BYTES = 15 * 1024 * 1024;

/**
 * "DS_EndSem_2024.pdf" → 2024. Takes the LAST 4-digit year in the name: paper
 * filenames often lead with a subject code that contains digits
 * ("CE201_2023.pdf"), and the year is conventionally the trailing token.
 */
function inferYear(fileName: string): number {
  const matches = fileName.match(/(20\d{2})/g);
  if (!matches) return MAX_YEAR - 1;
  const year = Number(matches[matches.length - 1]);
  return year >= MIN_YEAR && year <= MAX_YEAR ? year : MAX_YEAR - 1;
}

/** Best-effort exam-type guess from the filename; always editable after. */
function inferExamType(fileName: string): ExamType | "" {
  const n = fileName.toLowerCase();
  if (/mid[\s_-]?sem|midterm|mid[\s_-]?term|\bmse\b/.test(n)) return "mid_sem";
  if (/end[\s_-]?sem|\bese\b|final|semester[\s_-]?end/.test(n)) return "end_sem";
  if (/internal|\bcie\b|\bia[\s_-]?\d/.test(n)) return "internal";
  return "";
}

type Status = "queued" | "uploading" | "done" | "error";

interface QueueItem {
  key: string;
  file: File;
  year: number;
  examType: ExamType | "";
  status: Status;
  /** Populated on success — the extraction receipt for this file. */
  extracted: number | null;
  message: string | null;
}

interface UploadResponse {
  document_id: string;
  extracted_count: number;
  extraction_error: string | null;
  coverage: PyqCoverage;
}

interface PyqUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subjectId: string;
  subjectLabel?: string;
  /** Called with the server's freshly-computed coverage after each success. */
  onUploaded: (coverage: PyqCoverage) => void;
}

export function PyqUploadDialog({
  open,
  onOpenChange,
  subjectId,
  subjectLabel,
  onUploaded,
}: PyqUploadDialogProps) {
  const [items, setItems] = useState<QueueItem[]>([]);
  // Mirror of `items` for the upload loop to read. The loop runs across many
  // awaits while the faculty may still be editing the year/exam type of a
  // not-yet-uploaded row, and the `items` captured in this render's closure
  // would be frozen at loop start — sending the stale year for every file after
  // the first. The ref is the only thing in here that sees current state.
  const itemsRef = useRef<QueueItem[]>([]);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);
  const [busy, setBusy] = useState(false);
  const [coverage, setCoverage] = useState<PyqCoverage | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback((files: FileList | null) => {
    if (!files) return;
    const next: QueueItem[] = [];
    for (const file of Array.from(files)) {
      if (file.type !== "application/pdf") continue;
      if (file.size === 0 || file.size > MAX_BYTES) continue;
      next.push({
        key: `${file.name}:${file.size}:${file.lastModified}`,
        file,
        year: inferYear(file.name),
        examType: inferExamType(file.name),
        status: "queued",
        extracted: null,
        message: null,
      });
    }
    setItems((prev) => {
      const seen = new Set(prev.map((i) => i.key));
      return [...prev, ...next.filter((i) => !seen.has(i.key))];
    });
  }, []);

  const update = (key: string, patch: Partial<QueueItem>) =>
    setItems((prev) => prev.map((i) => (i.key === key ? { ...i, ...patch } : i)));

  const remove = (key: string) =>
    setItems((prev) => prev.filter((i) => i.key !== key));

  const pending = items.filter((i) => i.status === "queued" || i.status === "error");
  const succeeded = items.filter((i) => i.status === "done");

  const uploadAll = async () => {
    if (pending.length === 0 || busy) return;
    setBusy(true);
    // `pending` is this render's snapshot — the set of files to attempt. Each
    // row's live values are re-read from itemsRef inside the loop.
    for (const queued of pending) {
      update(queued.key, { status: "uploading", message: null });
      try {
        // Read the row's CURRENT year/exam type, not the values it had when the
        // loop started — see the itemsRef note above.
        const current =
          itemsRef.current.find((i) => i.key === queued.key) ?? queued;

        const form = new FormData();
        form.append("subject_id", subjectId);
        form.append("year", String(current.year));
        if (current.examType) form.append("exam_type", current.examType);
        form.append("file", current.file);

        const res = await fetch("/api/faculty/pyq/upload", {
          method: "POST",
          body: form,
        });
        const json = (await res.json()) as UploadResponse & { error?: string };

        if (!res.ok) {
          update(queued.key, {
            status: "error",
            message: json.error ?? "Upload failed",
          });
          continue;
        }

        setCoverage(json.coverage);
        onUploaded(json.coverage);

        if (json.extracted_count === 0) {
          // The file IS stored and counts as a paper — but saying "uploaded"
          // when nothing was read would be the black hole this dialog exists to
          // avoid. Name the outcome precisely.
          update(queued.key, {
            status: "error",
            extracted: 0,
            message:
              "Stored, but no questions could be read from it — if it's a scan, a text PDF works better.",
          });
        } else {
          update(queued.key, {
            status: "done",
            extracted: json.extracted_count,
            message: null,
          });
        }
      } catch {
        update(queued.key, { status: "error", message: "Network error" });
      }
    }
    setBusy(false);
  };

  const handleOpenChange = (next: boolean) => {
    if (busy) return; // never drop an in-flight extraction
    if (!next) {
      setItems([]);
      setCoverage(null);
    }
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            Add past papers
            {subjectLabel ? (
              <span className="text-muted-foreground font-normal"> · {subjectLabel}</span>
            ) : null}
          </DialogTitle>
          <DialogDescription>{PYQ_BENEFIT_LONG}</DialogDescription>
        </DialogHeader>

        {/* ── What this unlocks — shown only before the first upload, so it
            doesn't compete with the receipt afterwards. ────────────────── */}
        {succeeded.length === 0 && (
          <ul className="rounded-md border bg-muted/40 px-3 py-2 space-y-1">
            {PYQ_UNLOCKS.map((u) => (
              <li key={u.where} className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{u.where}</span> — {u.what}
              </li>
            ))}
          </ul>
        )}

        {/* ── File picker ──────────────────────────────────────────────── */}
        <div>
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf"
            multiple
            className="hidden"
            onChange={(e) => {
              addFiles(e.target.files);
              // Reset so re-picking the same file fires onChange again.
              e.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (!busy) addFiles(e.dataTransfer.files);
            }}
            className={cn(
              "w-full rounded-lg border-2 border-dashed px-4 py-6 text-center transition-colors",
              busy
                ? "opacity-60 cursor-not-allowed"
                : "hover:border-primary/50 hover:bg-muted/40"
            )}
          >
            <FileUp className="size-5 mx-auto mb-1.5 text-muted-foreground" />
            <p className="text-sm font-medium">
              Drop PDFs here, or click to choose
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Pick several at once — a few years of papers gives the AI a pattern
              to follow rather than one paper&apos;s quirks.
            </p>
          </button>
        </div>

        {/* ── Queue ────────────────────────────────────────────────────── */}
        {items.length > 0 && (
          <div className="space-y-1.5">
            {items.map((item) => (
              <div
                key={item.key}
                className={cn(
                  "rounded-md border px-3 py-2",
                  item.status === "done" && "border-emerald-200 bg-emerald-50/60",
                  item.status === "error" && "border-amber-200 bg-amber-50/60"
                )}
              >
                <div className="flex items-center gap-2">
                  <div className="shrink-0">
                    {item.status === "uploading" && (
                      <Loader2 className="size-4 animate-spin text-muted-foreground" />
                    )}
                    {item.status === "done" && (
                      <CheckCircle2 className="size-4 text-emerald-600" />
                    )}
                    {item.status === "error" && (
                      <AlertCircle className="size-4 text-amber-600" />
                    )}
                    {item.status === "queued" && (
                      <FileUp className="size-4 text-muted-foreground" />
                    )}
                  </div>

                  <p className="text-sm truncate flex-1 min-w-0">{item.file.name}</p>

                  {item.status === "queued" || item.status === "error" ? (
                    <>
                      <NumericField
                        min={MIN_YEAR}
                        max={MAX_YEAR}
                        value={item.year}
                        disabled={busy}
                        onChange={(n) => update(item.key, { year: n })}
                        className="h-8 w-20 text-sm"
                      />
                      <Select
                        value={item.examType || "unset"}
                        onValueChange={(v) =>
                          update(item.key, {
                            examType: v === "unset" ? "" : (v as ExamType),
                          })
                        }
                        disabled={busy}
                      >
                        <SelectTrigger className="h-8 w-28 text-xs">
                          <SelectValue placeholder="Exam type" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="unset">Not sure</SelectItem>
                          {EXAM_TYPES.map((t) => (
                            <SelectItem key={t} value={t}>
                              {EXAM_TYPE_LABELS[t]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 shrink-0 text-muted-foreground hover:text-destructive"
                        disabled={busy}
                        onClick={() => remove(item.key)}
                        title="Remove from queue"
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </>
                  ) : (
                    <span className="text-xs text-muted-foreground shrink-0 tabular-nums">
                      {item.year}
                      {item.examType ? ` · ${EXAM_TYPE_LABELS[item.examType]}` : ""}
                      {item.extracted != null && item.status === "done"
                        ? ` · ${item.extracted} questions`
                        : ""}
                    </span>
                  )}
                </div>

                {item.message && (
                  <p className="text-xs text-amber-700 mt-1 pl-6">{item.message}</p>
                )}
              </div>
            ))}
          </div>
        )}

        {/* ── The receipt ──────────────────────────────────────────────── */}
        {coverage && succeeded.length > 0 && (
          <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
            <p className="text-sm font-medium">
              This subject now has {coverage.papers} paper
              {coverage.papers === 1 ? "" : "s"} · {coverage.questions} question
              {coverage.questions === 1 ? "" : "s"} read
              {coverage.years.length > 0 && ` · ${coverage.years.join(", ")}`}
            </p>

            {coverage.coCoverage.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">
                  Course outcomes examined across your uploaded papers
                </p>
                <div className="flex flex-wrap gap-1">
                  {coverage.coCoverage.map((co) => (
                    <span
                      key={co.co_code}
                      className={cn(
                        "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-medium",
                        co.questions > 0
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : "border-muted-foreground/20 bg-background text-muted-foreground"
                      )}
                      title={
                        co.questions > 0
                          ? `${co.questions} question(s) across ${co.papers} paper(s)`
                          : "Not represented in any uploaded paper"
                      }
                    >
                      {co.co_code}
                      {co.questions > 0 ? ` ·${co.questions}` : ""}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* The gap + the next action, side by side. This pairing is what
                turns one upload into three. */}
            {coverage.missingCos.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {coverage.missingCos.join(", ")}{" "}
                {coverage.missingCos.length === 1 ? "isn't" : "aren't"} represented
                in any paper you&apos;ve uploaded — another year would likely cover{" "}
                {coverage.missingCos.length === 1 ? "it" : "them"}.
              </p>
            )}

            {coverage.state === "thin" && (
              <p className="text-xs text-amber-700">
                One paper shows you this author&apos;s habits, not the
                department&apos;s pattern. Two or more is where mirroring gets
                reliable.
              </p>
            )}
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          {succeeded.length > 0 && !busy && (
            <Button
              variant="outline"
              onClick={() => inputRef.current?.click()}
              className="mr-auto"
            >
              <Plus className="mr-1.5 size-4" />
              Add another paper
            </Button>
          )}
          <Button
            variant="ghost"
            onClick={() => handleOpenChange(false)}
            disabled={busy}
          >
            {succeeded.length > 0 ? "Done" : "Cancel"}
          </Button>
          <Button onClick={uploadAll} disabled={busy || pending.length === 0}>
            {busy ? (
              <>
                <Loader2 className="mr-1.5 size-4 animate-spin" />
                Reading {items.filter((i) => i.status === "uploading").length > 0
                  ? `${succeeded.length + 1} of ${items.length}`
                  : "…"}
              </>
            ) : (
              <>
                Upload {pending.length > 0 ? pending.length : ""} paper
                {pending.length === 1 ? "" : "s"}
              </>
            )}
          </Button>
        </DialogFooter>

        {busy && (
          <p className="text-xs text-muted-foreground text-center -mt-2">
            Reading each paper takes a few seconds — please keep this open.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
