"use client";

/**
 * Syllabus → "Past Papers" tab: the subject-level home for PYQ management.
 *
 * WHY IT LIVES UNDER SYLLABUS rather than getting its own nav entry. Past
 * papers are subject CONTENT, the same category as the syllabus itself and the
 * CO mappings beside it — not a tool like Q Paper or Q Bank. Faculty already
 * come here to manage what the platform knows about a subject, and a top-level
 * nav item would advertise the feature far more loudly than a pilot-stage data
 * request deserves. The persuading happens where the absence costs something
 * (the inert PYQ-style row in the Q Paper builder); this tab is where someone
 * who has decided to act comes to do the work and see what they have.
 *
 * The readiness checklist at the top frames past papers as ONE ROW among the
 * subject's content, not as a special plea. That framing is deliberate: a
 * system with standards reads very differently from a feature being marketed
 * at you, and faculty respond to the first.
 */

import { useCallback, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  Loader2,
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { usePyqCoverage } from "@/hooks/usePyqCoverage";
import { PyqUploadDialog } from "@/components/pyq/PyqUploadDialog";
import {
  examTypeLabel,
  type PyqCoverage,
  type PyqPaper,
} from "@/lib/pyq/coverage";
import {
  PYQ_BENEFIT_LONG,
  PYQ_UNLOCKS,
  PYQ_UPLOAD_CTA,
} from "@/components/pyq/pyqCopy";
import { cn } from "@/lib/utils";

interface PastPapersTabProps {
  subjectId: string;
  subjectLabel?: string;
  /** Module and CO counts from the page's already-loaded syllabus data —
   *  reused so the readiness checklist costs no extra query. */
  moduleCount: number;
  coCount: number;
  /** Verified Q Bank questions, if the page knows; null hides that row. */
  verifiedBankCount?: number | null;
}

function ReadinessRow({
  done,
  label,
  detail,
  action,
}: {
  done: boolean;
  label: string;
  detail: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 py-1.5">
      {done ? (
        <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />
      ) : (
        <span className="size-4 shrink-0 rounded-[3px] border border-muted-foreground/40" />
      )}
      <span className="text-sm font-medium w-32 shrink-0">{label}</span>
      <span
        className={cn(
          "text-sm flex-1 min-w-0",
          done ? "text-muted-foreground" : "text-foreground"
        )}
      >
        {detail}
      </span>
      {action}
    </div>
  );
}

export function PastPapersTab({
  subjectId,
  subjectLabel,
  moduleCount,
  coCount,
  verifiedBankCount = null,
}: PastPapersTabProps) {
  const { coverage, papers, applyCoverage, refresh } = usePyqCoverage(subjectId, {
    withPapers: true,
  });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleDelete = useCallback(
    async (paper: PyqPaper) => {
      const ok = window.confirm(
        `Remove "${paper.title}"? Its ${paper.question_count} extracted question` +
          `${paper.question_count === 1 ? "" : "s"} will be removed too, and ` +
          `generation will stop drawing on this paper.`
      );
      if (!ok) return;
      setDeletingId(paper.id);
      try {
        const res = await fetch(`/api/faculty/pyq/${paper.id}`, {
          method: "DELETE",
        });
        const json = (await res.json()) as {
          coverage?: PyqCoverage;
          error?: string;
        };
        if (!res.ok) {
          toast.error(json.error ?? "Could not remove that paper");
          return;
        }
        toast.success("Paper removed");
        if (json.coverage) applyCoverage(json.coverage);
        else refresh();
      } catch {
        toast.error("Could not remove that paper");
      } finally {
        setDeletingId(null);
      }
    },
    [applyCoverage, refresh]
  );

  const loading = coverage === null;
  const hasPapers = !!coverage && coverage.state !== "none";

  return (
    <div className="space-y-4">
      {/* ── Why this exists ──────────────────────────────────────────── */}
      <div className="rounded-md border border-primary/20 bg-primary/5 px-4 py-3 space-y-2">
        <p className="text-sm text-muted-foreground">{PYQ_BENEFIT_LONG}</p>
        <ul className="space-y-0.5">
          {PYQ_UNLOCKS.map((u) => (
            <li key={u.where} className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{u.where}</span> — {u.what}
            </li>
          ))}
        </ul>
      </div>

      {/* ── Readiness checklist ──────────────────────────────────────── */}
      <div className="rounded-lg border bg-card p-4">
        <h3 className="text-sm font-semibold mb-1">Subject readiness</h3>
        <p className="text-xs text-muted-foreground mb-2">
          What the platform has to work with for this subject.
        </p>
        <div className="divide-y">
          <ReadinessRow
            done={moduleCount > 0}
            label="Syllabus"
            detail={
              moduleCount > 0
                ? `${moduleCount} module${moduleCount === 1 ? "" : "s"}`
                : "No modules recorded"
            }
          />
          <ReadinessRow
            done={coCount > 0}
            label="Course outcomes"
            detail={
              coCount > 0
                ? `${coCount} CO${coCount === 1 ? "" : "s"} defined`
                : "No course outcomes recorded"
            }
          />
          <ReadinessRow
            done={hasPapers}
            label="Past papers"
            detail={
              loading
                ? "Checking…"
                : hasPapers
                  ? `${coverage.papers} paper${coverage.papers === 1 ? "" : "s"} · ` +
                    `${coverage.questions} question${coverage.questions === 1 ? "" : "s"} read` +
                    (coverage.years.length ? ` · ${coverage.years.join(", ")}` : "")
                  : "None uploaded"
            }
            action={
              <Button
                size="sm"
                variant={hasPapers ? "outline" : "default"}
                onClick={() => setDialogOpen(true)}
                disabled={loading}
              >
                <Upload className="mr-1.5 size-3.5" />
                {hasPapers ? "Add more" : PYQ_UPLOAD_CTA}
              </Button>
            }
          />
          {verifiedBankCount !== null && (
            <ReadinessRow
              done={verifiedBankCount > 0}
              label="Question bank"
              detail={
                verifiedBankCount > 0
                  ? `${verifiedBankCount} verified question${verifiedBankCount === 1 ? "" : "s"}`
                  : "No verified questions"
              }
            />
          )}
        </div>
      </div>

      {/* ── Coverage detail — only meaningful once papers exist ──────── */}
      {hasPapers && coverage.coCoverage.length > 0 && (
        <div className="rounded-lg border bg-card p-4 space-y-2">
          <h3 className="text-sm font-semibold">Coverage by course outcome</h3>
          <p className="text-xs text-muted-foreground">
            Which outcomes your uploaded papers actually examine. Past papers
            carry no module numbers, so this CO mapping is the bridge back to
            your syllabus.
          </p>
          <div className="flex flex-wrap gap-1.5 pt-1">
            {coverage.coCoverage.map((co) => (
              <span
                key={co.co_code}
                title={
                  co.questions > 0
                    ? `${co.questions} question(s) across ${co.papers} paper(s)`
                    : "Not represented in any uploaded paper"
                }
                className={cn(
                  "inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs font-medium",
                  co.questions > 0
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : "border-muted-foreground/20 bg-background text-muted-foreground"
                )}
              >
                {co.co_code}
                {co.questions > 0 && (
                  <span className="tabular-nums opacity-70">{co.questions}</span>
                )}
              </span>
            ))}
          </div>

          {coverage.missingCos.length > 0 && (
            <p className="text-xs text-muted-foreground pt-1">
              <AlertTriangle className="inline size-3 mr-1 -mt-0.5 text-amber-600" />
              {coverage.missingCos.join(", ")}{" "}
              {coverage.missingCos.length === 1 ? "is" : "are"} not represented in
              any uploaded paper — questions targeting{" "}
              {coverage.missingCos.length === 1 ? "it" : "them"} will be written
              fresh rather than mirrored. Another year usually closes the gap.
            </p>
          )}

          {coverage.state === "thin" && (
            <p className="text-xs text-amber-700 pt-1">
              With one paper on file, mirroring reproduces that paper&apos;s
              quirks as if they were the department&apos;s pattern. Two or more
              years is where it becomes reliable.
            </p>
          )}
        </div>
      )}

      {/* ── The papers themselves ────────────────────────────────────── */}
      <div className="rounded-lg border bg-card">
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b">
          <h3 className="text-sm font-semibold">
            Uploaded papers
            {papers && papers.length > 0 && (
              <Badge variant="secondary" className="ml-2 px-1.5 py-0 text-[10px] font-normal">
                {papers.length}
              </Badge>
            )}
          </h3>
          {hasPapers && (
            <Button size="sm" variant="outline" onClick={() => setDialogOpen(true)}>
              <Upload className="mr-1.5 size-3.5" />
              Add another
            </Button>
          )}
        </div>

        {loading || papers === null ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">Loading…</p>
        ) : papers.length === 0 ? (
          <div className="px-4 py-8 text-center space-y-3">
            <FileText className="size-8 mx-auto text-muted-foreground/50" />
            <div className="space-y-1">
              <p className="text-sm font-medium">No past papers yet</p>
              <p className="text-xs text-muted-foreground max-w-md mx-auto">
                Drop in a few years&apos; papers — mid-sem and end-sem both help.
                Each one is read automatically; you&apos;ll see exactly what was
                found before you leave the dialog.
              </p>
            </div>
            <Button onClick={() => setDialogOpen(true)}>
              <Upload className="mr-1.5 size-4" />
              {PYQ_UPLOAD_CTA}
            </Button>
          </div>
        ) : (
          <ul className="divide-y">
            {papers.map((paper) => (
              <li
                key={paper.id}
                className="flex items-center gap-3 px-4 py-2.5"
              >
                <FileText className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm truncate">{paper.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {paper.year ?? "Year unknown"}
                    {examTypeLabel(paper.exam_type)
                      ? ` · ${examTypeLabel(paper.exam_type)}`
                      : ""}
                    {" · "}
                    {paper.question_count > 0 ? (
                      `${paper.question_count} question${paper.question_count === 1 ? "" : "s"} extracted`
                    ) : (
                      <span className="text-amber-700">
                        no questions could be read from this file
                      </span>
                    )}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={() => handleDelete(paper)}
                  disabled={deletingId === paper.id}
                  title="Remove this paper"
                >
                  {deletingId === paper.id ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="size-3.5" />
                  )}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <PyqUploadDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        subjectId={subjectId}
        subjectLabel={subjectLabel}
        onUploaded={applyCoverage}
      />
    </div>
  );
}
