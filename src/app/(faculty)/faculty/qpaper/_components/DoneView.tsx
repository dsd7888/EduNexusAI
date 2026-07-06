"use client";

/**
 * Main-area STATE 3 — "Done": the generated paper has arrived. A compact
 * success banner up top (with Regenerate), the existing review/validate
 * editor, then export actions restructured by importance — primary
 * (PDF/Word download), secondary (answer key, once requested), tertiary
 * (re-export / save-as-template, muted link-style since they're not the main
 * action once a paper already exists).
 */

import { useState } from "react";
import { Download, FileText, Loader2, Lock, RefreshCw, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { ReviewAndValidateStage } from "./ReviewAndValidateStage";
import { SaveTemplateAction } from "./SaveTemplateAction";
import type {
  AssembledPaper,
  BuilderSection,
  ModuleRow,
  PaperMetadata,
} from "./shared";

interface DoneViewProps {
  paper: AssembledPaper;
  setPaper: React.Dispatch<React.SetStateAction<AssembledPaper | null>>;
  downloadUrl: string | null;
  setDownloadUrl: React.Dispatch<React.SetStateAction<string | null>>;
  answerKeyUrl: string | null;
  setAnswerKeyUrl: React.Dispatch<React.SetStateAction<string | null>>;
  setAnswerKeyWarnings: React.Dispatch<React.SetStateAction<string[]>>;
  setPdfPath: React.Dispatch<React.SetStateAction<string | null>>;
  setDocxPath: React.Dispatch<React.SetStateAction<string | null>>;
  setAnswerKeyPath: React.Dispatch<React.SetStateAction<string | null>>;
  selectedSubjectId: string;
  onFinalized: (patch?: { docxPath?: string | null }) => void;
  onTemplateSaved?: () => void;

  sections: BuilderSection[];
  modules: ModuleRow[];
  selectedModuleIds: string[];
  meta: PaperMetadata;
  totalMarksLive: number;

  onSavedToBank: () => void;
  onGenerate: () => void;
  /** True once the paper has been edited (inline edit / relabel / regen) since
   *  it was generated — Regenerate confirms before discarding those edits. */
  paperEditedSinceGeneration: boolean;
  /** Scroll target for the resume-with-paper flow, owned by the page. */
  reviewRef: React.RefObject<HTMLDivElement | null>;

  // ── Non-blocking notes from the last generation / key generation ──
  bankFallbackCount: number;
  answerKeyWarnings: string[];
  unplaceablePreferred: Array<{ id: string; question_text: string }>;
}

export function DoneView({
  paper,
  setPaper,
  downloadUrl,
  setDownloadUrl,
  answerKeyUrl,
  setAnswerKeyUrl,
  setAnswerKeyWarnings,
  setPdfPath,
  setDocxPath,
  setAnswerKeyPath,
  selectedSubjectId,
  onFinalized,
  onTemplateSaved,
  sections,
  modules,
  selectedModuleIds,
  meta,
  totalMarksLive,
  onSavedToBank,
  onGenerate,
  paperEditedSinceGeneration,
  reviewRef,
  bankFallbackCount,
  answerKeyWarnings,
  unplaceablePreferred,
}: DoneViewProps) {
  const [isGeneratingAnswerKey, setIsGeneratingAnswerKey] = useState(false);
  const [isReExporting, setIsReExporting] = useState(false);
  const [isExportingDocx, setIsExportingDocx] = useState(false);
  const [isExportingAnswerKeyDocx, setIsExportingAnswerKeyDocx] = useState(false);

  const questionCount = paper.sections.reduce(
    (n, s) => n + s.questions.length,
    0
  );

  const handleRegenerate = () => {
    if (paperEditedSinceGeneration) {
      const ok = window.confirm(
        "You've made edits since this paper was generated. Regenerating will discard them and produce a fresh paper. Continue?"
      );
      if (!ok) return;
    }
    onGenerate();
  };

  const handleGenerateAnswerKey = async () => {
    if (!paper || !selectedSubjectId) return;
    setIsGeneratingAnswerKey(true);
    setAnswerKeyUrl(null);
    setAnswerKeyWarnings([]);
    try {
      const res = await fetch("/api/generate/qpaper/answer-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject_id: selectedSubjectId,
          paper,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as {
        downloadUrl: string;
        filePath?: string;
        warnings?: string[];
      };
      setAnswerKeyUrl(data.downloadUrl);
      setAnswerKeyPath(data.filePath ?? null);
      setAnswerKeyWarnings(data.warnings ?? []);
      if (data.warnings && data.warnings.length > 0) {
        toast.warning(
          `Answer key ready (with ${data.warnings.length} warning${
            data.warnings.length === 1 ? "" : "s"
          })`
        );
      } else {
        toast.success("Answer key generated!");
      }
    } catch (err) {
      console.error(err);
      toast.error("Failed to generate answer key");
    } finally {
      setIsGeneratingAnswerKey(false);
    }
  };

  const exportAnswerKeyDocx = async () => {
    if (!paper) return;
    setIsExportingAnswerKeyDocx(true);
    try {
      const res = await fetch("/api/generate/qpaper/export-docx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ qpaper_content: paper, answerKey: true }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as { downloadUrl: string; filePath?: string };
      window.open(data.downloadUrl, "_blank");
      toast.success("Answer key Word document ready");
    } catch (err) {
      console.error(err);
      toast.error("Failed to export answer key Word document");
    } finally {
      setIsExportingAnswerKeyDocx(false);
    }
  };

  const exportDocx = async () => {
    if (!paper) return;
    setIsExportingDocx(true);
    try {
      const res = await fetch("/api/generate/qpaper/export-docx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ qpaper_content: paper }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as { downloadUrl: string; filePath?: string };
      setDocxPath(data.filePath ?? null);
      window.open(data.downloadUrl, "_blank");
      onFinalized({ docxPath: data.filePath ?? null });
      toast.success("Word document ready");
    } catch (err) {
      console.error(err);
      toast.error("Failed to export Word document");
    } finally {
      setIsExportingDocx(false);
    }
  };

  const reExportPdf = async () => {
    if (!paper) return;
    setIsReExporting(true);
    try {
      const res = await fetch("/api/generate/qpaper/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paper }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as { downloadUrl: string; filePath?: string };
      setDownloadUrl(data.downloadUrl);
      setPdfPath(data.filePath ?? null);
      toast.success("Updated PDF ready");
    } catch (err) {
      console.error(err);
      toast.error("Failed to update PDF");
    } finally {
      setIsReExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* ── Success banner ────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3 rounded-lg border bg-emerald-50 border-emerald-200 px-4 py-3">
        <p className="text-sm text-emerald-800">
          <span className="font-semibold">Paper generated</span> · {questionCount}{" "}
          question{questionCount === 1 ? "" : "s"} · {paper.totalMarks ?? totalMarksLive}M
        </p>
        <Button variant="ghost" size="sm" onClick={handleRegenerate}>
          <RefreshCw className="mr-1.5 size-3.5" />
          Regenerate
        </Button>
      </div>

      {/* ── Non-blocking note: bank slots that fell back to fresh AI ──── */}
      {bankFallbackCount > 0 && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
          Bank allocation requested but {bankFallbackCount} question
          {bankFallbackCount === 1 ? "" : "s"} fell back to fresh generation due
          to insufficient verified coverage.
        </p>
      )}

      {/* ── Non-blocking note: answer-key blocks that failed to generate ──── */}
      {answerKeyWarnings.length > 0 && (
        <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 space-y-1">
          <p className="font-medium">
            The answer key was generated, but {answerKeyWarnings.length} block
            {answerKeyWarnings.length === 1 ? "" : "s"} could not be produced and{" "}
            {answerKeyWarnings.length === 1 ? "is" : "are"} missing from the PDF.
            Regenerate the answer key to retry, or fill{" "}
            {answerKeyWarnings.length === 1 ? "it" : "them"} in manually.
          </p>
          <ul className="list-disc list-inside space-y-0.5 text-amber-600">
            {answerKeyWarnings.map((w, i) => (
              <li key={i} className="truncate">
                {w}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Non-blocking note: preferred questions that couldn't be placed ── */}
      {unplaceablePreferred.length > 0 && (
        <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 space-y-1">
          <p className="font-medium">
            {unplaceablePreferred.length} of your selected Q Bank question
            {unplaceablePreferred.length === 1 ? "" : "s"} couldn&apos;t be
            placed in this paper — {unplaceablePreferred.length === 1 ? "its" : "their"}{" "}
            marks or type didn&apos;t match any slot here. Adjust the paper
            structure or pick different questions if you need{" "}
            {unplaceablePreferred.length === 1 ? "it" : "them"} included.
          </p>
          <ul className="list-disc list-inside space-y-0.5 text-amber-600">
            {unplaceablePreferred.map((q) => (
              <li key={q.id} className="truncate">
                {q.question_text}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Review + inline edit ─────────────────────────────────────── */}
      <div ref={reviewRef}>
        <ReviewAndValidateStage
          paper={paper}
          setPaper={setPaper}
          sections={sections}
          modules={modules}
          selectedModuleIds={selectedModuleIds}
          selectedSubjectId={selectedSubjectId}
          onSavedToBank={onSavedToBank}
        />
      </div>

      {/* ── Export actions ───────────────────────────────────────────── */}
      <div className="rounded-lg border bg-card p-4 space-y-4">
        {/* Primary row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Button
            size="lg"
            disabled={!downloadUrl}
            onClick={() => {
              if (!downloadUrl) return;
              window.open(downloadUrl, "_blank");
              onFinalized();
            }}
          >
            <Download className="mr-2 size-4" />
            Download PDF
          </Button>
          <Button
            size="lg"
            variant="outline"
            onClick={exportDocx}
            disabled={isExportingDocx}
          >
            {isExportingDocx ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <FileText className="mr-2 size-4" />
            )}
            Download Word
          </Button>
        </div>

        {/* Secondary row — answer key */}
        <div className="space-y-1.5 border-t pt-3">
          <div className="flex flex-wrap gap-2">
            {!answerKeyUrl ? (
              <Button
                variant="outline"
                size="sm"
                onClick={handleGenerateAnswerKey}
                disabled={isGeneratingAnswerKey}
              >
                {isGeneratingAnswerKey ? (
                  <Loader2 className="mr-2 size-3.5 animate-spin" />
                ) : (
                  <Lock className="mr-2 size-3.5" />
                )}
                {isGeneratingAnswerKey
                  ? "Generating answer key..."
                  : "Generate Answer Key"}
              </Button>
            ) : (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => window.open(answerKeyUrl, "_blank")}
                >
                  <Lock className="mr-2 size-3.5" />
                  Answer Key PDF
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={exportAnswerKeyDocx}
                  disabled={isExportingAnswerKeyDocx}
                >
                  {isExportingAnswerKeyDocx ? (
                    <Loader2 className="mr-2 size-3.5 animate-spin" />
                  ) : (
                    <FileText className="mr-2 size-3.5" />
                  )}
                  Answer Key Word
                </Button>
              </>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground">
            Includes model answers and marking scheme for all questions.
          </p>
        </div>

        {/* Tertiary row */}
        <div className="flex items-center gap-3 border-t pt-3">
          <button
            type="button"
            onClick={reExportPdf}
            disabled={isReExporting}
            className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
          >
            {isReExporting ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <RefreshCw className="size-3" />
            )}
            Update PDF
          </button>
          <span className="text-muted-foreground text-xs">·</span>
          <SaveTemplateAction
            sections={sections}
            modules={modules}
            selectedModuleIds={selectedModuleIds}
            meta={meta}
            totalMarksLive={totalMarksLive}
            selectedSubjectId={selectedSubjectId}
            onTemplateSaved={onTemplateSaved}
            renderTrigger={(onClick) => (
              <button
                type="button"
                onClick={onClick}
                className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
              >
                <Save className="size-3" />
                Save as template
              </button>
            )}
          />
        </div>
      </div>
    </div>
  );
}
