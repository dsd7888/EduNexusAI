"use client";

/**
 * Stage — "Finalize & Export": the action bar (generate, save-as-template, and
 * the PDF / Word / answer-key downloads) plus the save-as-template dialog.
 *
 * Owns the export-side loading flags and the template-save dialog state; the
 * assembled `paper` and its download URLs are shared state owned by the parent
 * (the generate flow there populates them).
 */

import { useState } from "react";
import { Download, FileText, Loader2, Lock, RefreshCw, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  buildTemplatePayload,
  type AssembledPaper,
  type BuilderSection,
  type ModuleRow,
  type PaperMetadata,
} from "./shared";

interface FinalizeExportStageProps {
  paper: AssembledPaper | null;
  downloadUrl: string | null;
  setDownloadUrl: React.Dispatch<React.SetStateAction<string | null>>;
  answerKeyUrl: string | null;
  setAnswerKeyUrl: React.Dispatch<React.SetStateAction<string | null>>;
  /** Per-block answer-key warnings from the last key generation, surfaced as a
   *  persistent non-blocking note by the parent. */
  setAnswerKeyWarnings: React.Dispatch<React.SetStateAction<string[]>>;
  /** Storage paths for the artifacts, captured so the finalize event can
   *  persist them to qpaper_history (paths re-sign; URLs expire). */
  setPdfPath: React.Dispatch<React.SetStateAction<string | null>>;
  setDocxPath: React.Dispatch<React.SetStateAction<string | null>>;
  setAnswerKeyPath: React.Dispatch<React.SetStateAction<string | null>>;
  selectedSubjectId: string;
  isGenerating: boolean;
  progressMsg: string;
  onGenerate: () => void;
  /**
   * Called when the finished paper is downloaded: persists a history row and
   * clears the autosave draft. Accepts a path patch for artifacts produced in
   * the same tick (e.g. the just-exported .docx), since the parent's path state
   * hasn't flushed yet when this fires.
   */
  onFinalized: (patch?: { docxPath?: string | null }) => void;
  /** Called after a template is successfully saved so the template list can refresh. */
  onTemplateSaved?: () => void;
  // ── Inputs needed to assemble the save-as-template payload ──
  sections: BuilderSection[];
  modules: ModuleRow[];
  selectedModuleIds: string[];
  meta: PaperMetadata;
  totalMarksLive: number;
}

export function FinalizeExportStage({
  paper,
  downloadUrl,
  setDownloadUrl,
  answerKeyUrl,
  setAnswerKeyUrl,
  setAnswerKeyWarnings,
  setPdfPath,
  setDocxPath,
  setAnswerKeyPath,
  selectedSubjectId,
  isGenerating,
  progressMsg,
  onGenerate,
  onFinalized,
  onTemplateSaved,
  sections,
  modules,
  selectedModuleIds,
  meta,
  totalMarksLive,
}: FinalizeExportStageProps) {
  const [isGeneratingAnswerKey, setIsGeneratingAnswerKey] = useState(false);
  const [isReExporting, setIsReExporting] = useState(false);
  const [isExportingDocx, setIsExportingDocx] = useState(false);
  const [isExportingAnswerKeyDocx, setIsExportingAnswerKeyDocx] = useState(false);

  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saveScope, setSaveScope] = useState<"personal" | "school">("personal");
  const [saveIsDefault, setSaveIsDefault] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // ─── Save template (explicit) ──────────────────────────────────────────
  const saveTemplate = async () => {
    const name = saveName.trim();
    if (!name) {
      toast.error("Enter a template name");
      return;
    }
    setIsSaving(true);
    try {
      const payload = buildTemplatePayload(name, {
        sections,
        modules,
        selectedModuleIds,
        meta,
        totalMarksLive,
        selectedSubjectId,
      });
      const res = await fetch("/api/qpaper/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...payload,
          scope: saveScope,
          is_default: saveIsDefault,
        }),
      });
      if (res.status === 409) {
        const err = await res.json() as { error?: string };
        toast.error(err.error ?? "A template with that name already exists");
        return;
      }
      if (!res.ok) throw new Error(await res.text());
      toast.success(`Saved "${name}"`);
      setSaveOpen(false);
      setSaveName("");
      setSaveScope("personal");
      setSaveIsDefault(false);
      onTemplateSaved?.();
    } catch (err) {
      console.error(err);
      toast.error("Failed to save template");
    } finally {
      setIsSaving(false);
    }
  };

  // ─── Generate answer key ───────────────────────────────────────────────
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

  // ─── Export Answer Key Word (.docx) ───────────────────────────────────
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

  // ─── Export Word (.docx) ───────────────────────────────────────────────
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

  // ─── Re-export PDF ─────────────────────────────────────────────────────
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
    <>
      {/* ── Generate / Save / Download ───────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3 pt-2">
        <Button
          onClick={onGenerate}
          disabled={isGenerating || !selectedSubjectId}
          size="lg"
          className="flex-1 min-w-48"
        >
          {isGenerating ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin" />
              {progressMsg || "Generating..."}
            </>
          ) : (
            "Generate Question Paper"
          )}
        </Button>

        <Button
          variant="outline"
          size="lg"
          onClick={() => {
            setSaveName("");
            setSaveScope("personal");
            setSaveIsDefault(false);
            setSaveOpen(true);
          }}
        >
          <Save className="mr-2 size-4" />
          Save as template
        </Button>

        {downloadUrl && (
          <Button
            size="lg"
            onClick={() => {
              window.open(downloadUrl, "_blank");
              onFinalized();
            }}
          >
            <Download className="mr-2 size-4" />
            Download Question Paper
          </Button>
        )}

        {paper && !answerKeyUrl && (
          <Button
            variant="outline"
            size="lg"
            onClick={handleGenerateAnswerKey}
            disabled={isGeneratingAnswerKey}
          >
            {isGeneratingAnswerKey ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <Lock className="mr-2 size-4" />
            )}
            {isGeneratingAnswerKey
              ? "Generating answer key..."
              : "Generate Answer Key"}
          </Button>
        )}

        {answerKeyUrl && (
          <Button
            variant="outline"
            size="lg"
            onClick={() => window.open(answerKeyUrl, "_blank")}
          >
            <Lock className="mr-2 size-4" />
            Download Answer Key
          </Button>
        )}

        {answerKeyUrl && paper && (
          <Button
            variant="outline"
            size="lg"
            onClick={exportAnswerKeyDocx}
            disabled={isExportingAnswerKeyDocx}
          >
            {isExportingAnswerKeyDocx ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <FileText className="mr-2 size-4" />
            )}
            Download Answer Key (Word)
          </Button>
        )}

        {paper && (
          <Button
            variant="outline"
            size="lg"
            onClick={reExportPdf}
            disabled={isReExporting}
          >
            {isReExporting ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 size-4" />
            )}
            Update PDF
          </Button>
        )}

        {paper && (
          <Button
            variant="outline"
            size="lg"
            onClick={exportDocx}
            disabled={isExportingDocx}
          >
            {isExportingDocx ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <FileText className="mr-2 size-4" />
            )}
            Download Word (.docx)
          </Button>
        )}
      </div>

      {paper && (
        <p className="text-xs text-muted-foreground -mt-1">
          Answer key includes marking scheme and model answers for all
          questions including OR alternatives.
        </p>
      )}

      {/* ── Save-as-template dialog ─────────────────────────────────── */}
      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save as template</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {/* Name */}
            <div className="space-y-1.5">
              <Label htmlFor="tpl-name" className="text-xs">
                Template name
              </Label>
              <Input
                id="tpl-name"
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                placeholder="My ESE template"
                className="h-9 text-sm"
                autoFocus
              />
            </div>

            {/* Scope */}
            <div className="space-y-1.5">
              <span className="text-xs font-medium">Visibility</span>
              <div className="flex flex-col gap-2 pt-0.5">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="tpl-scope"
                    value="personal"
                    checked={saveScope === "personal"}
                    onChange={() => setSaveScope("personal")}
                    className="accent-primary"
                  />
                  <span className="text-sm">Personal — only visible to me</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="tpl-scope"
                    value="school"
                    checked={saveScope === "school"}
                    onChange={() => setSaveScope("school")}
                    className="accent-primary"
                  />
                  <span className="text-sm">Shared — visible to all faculty</span>
                </label>
              </div>
            </div>

            {/* Default checkbox */}
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={saveIsDefault}
                onChange={(e) => setSaveIsDefault(e.target.checked)}
                className="accent-primary"
              />
              <span className="text-sm">Set as my default template</span>
            </label>

            <p className="text-[11px] text-muted-foreground">
              Saves the current structure and metadata. Load it later from the
              templates panel above.
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setSaveOpen(false)}
              disabled={isSaving}
            >
              Cancel
            </Button>
            <Button onClick={saveTemplate} disabled={isSaving || !saveName.trim()}>
              {isSaving ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <Save className="mr-2 size-4" />
              )}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
