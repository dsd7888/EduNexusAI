"use client";

/**
 * Main-area STATE 1 — "Builder": the default view while no paper has been
 * generated yet. Quick-start presets + Paper Details up top, the drag-drop
 * section/question editor in the middle, and a single prominent Generate
 * action at the bottom ("Save as template" is secondary — a small link, not
 * an equal-weight button).
 */

import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { SubjectRow } from "@/hooks/useSupabaseData";
import { BuilderSectionsEditor } from "./BuilderSectionsEditor";
import { SaveTemplateAction } from "./SaveTemplateAction";
import { TemplateStructureStage } from "./TemplateStructureStage";
import type { BuilderSection, ModuleRow, PaperMetadata } from "./shared";

interface BuilderViewProps {
  selectedSubject: SubjectRow | undefined;
  meta: PaperMetadata;
  setMeta: React.Dispatch<React.SetStateAction<PaperMetadata>>;
  metaOpen: boolean;
  setMetaOpen: React.Dispatch<React.SetStateAction<boolean>>;
  totalMarksLive: number;
  onApplyEse: () => void;
  onApplyQuiz: () => void;
  onClearBuilder: () => void;

  sections: BuilderSection[];
  setSections: React.Dispatch<React.SetStateAction<BuilderSection[]>>;
  targetMarks: number;
  flatLayout: boolean;

  modules: ModuleRow[];
  selectedModuleIds: string[];
  selectedSubjectId: string;
  onTemplateSaved?: () => void;

  isGenerating: boolean;
  onGenerate: () => void;
}

export function BuilderView({
  selectedSubject,
  meta,
  setMeta,
  metaOpen,
  setMetaOpen,
  totalMarksLive,
  onApplyEse,
  onApplyQuiz,
  onClearBuilder,
  sections,
  setSections,
  targetMarks,
  flatLayout,
  modules,
  selectedModuleIds,
  selectedSubjectId,
  onTemplateSaved,
  isGenerating,
  onGenerate,
}: BuilderViewProps) {
  return (
    <div className="space-y-6">
      <TemplateStructureStage
        selectedSubject={selectedSubject}
        meta={meta}
        setMeta={setMeta}
        metaOpen={metaOpen}
        setMetaOpen={setMetaOpen}
        totalMarksLive={totalMarksLive}
        sectionsCount={sections.length}
        onApplyEse={onApplyEse}
        onApplyQuiz={onApplyQuiz}
        onClearBuilder={onClearBuilder}
      />

      <BuilderSectionsEditor
        sections={sections}
        setSections={setSections}
        targetMarks={targetMarks}
        totalMarksLive={totalMarksLive}
        flatLayout={flatLayout}
      />

      <div className="space-y-2">
        <Button
          onClick={onGenerate}
          disabled={isGenerating || !selectedSubjectId}
          size="lg"
          className="w-full"
        >
          Generate Paper
        </Button>

        <div className="flex justify-center">
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
