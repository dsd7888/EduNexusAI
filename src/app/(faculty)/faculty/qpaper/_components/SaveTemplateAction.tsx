"use client";

/**
 * "Save as template" action — a trigger (styled by the caller) plus the dialog
 * that captures a name/visibility/default flag and posts the current builder
 * structure to /api/qpaper/templates. Used both in the builder state (as a
 * secondary action) and the done state (as a tertiary action), so the trigger
 * itself is left to the caller via `renderTrigger`.
 */

import { useState } from "react";
import { Loader2, Save } from "lucide-react";
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
  type BuilderSection,
  type ModuleRow,
  type PaperMetadata,
} from "./shared";

interface SaveTemplateActionProps {
  sections: BuilderSection[];
  modules: ModuleRow[];
  selectedModuleIds: string[];
  meta: PaperMetadata;
  totalMarksLive: number;
  selectedSubjectId: string;
  onTemplateSaved?: () => void;
  /** Renders the trigger element; receives an onClick to open the dialog. */
  renderTrigger: (onClick: () => void) => React.ReactNode;
}

export function SaveTemplateAction({
  sections,
  modules,
  selectedModuleIds,
  meta,
  totalMarksLive,
  selectedSubjectId,
  onTemplateSaved,
  renderTrigger,
}: SaveTemplateActionProps) {
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saveScope, setSaveScope] = useState<"personal" | "school">("personal");
  const [saveIsDefault, setSaveIsDefault] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const openDialog = () => {
    setSaveName("");
    setSaveScope("personal");
    setSaveIsDefault(false);
    setSaveOpen(true);
  };

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
        const err = (await res.json()) as { error?: string };
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

  return (
    <>
      {renderTrigger(openDialog)}

      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save as template</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
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
              templates panel.
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
