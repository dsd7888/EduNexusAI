"use client";

import { FlaskConical, Loader2, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  LANGUAGE_PRESETS,
  subjectNeedsLanguage,
  type UiPractical,
} from "./shared";
import type { SubjectRow } from "@/hooks/useSupabaseData";

interface Props {
  subjects: SubjectRow[];
  isLoadingSubjects: boolean;
  selectedSubjectId: string;
  onSelectSubject: (id: string) => void;
  practicals: UiPractical[];
  loadingData: boolean;
  language: string | null;
  onLanguageChange: (v: string | null) => void;
  globalInstruction: string;
  onGlobalInstructionChange: (v: string) => void;
  onPlanPath: () => void;
  planning: boolean;
}

export function SetupStage({
  subjects,
  isLoadingSubjects,
  selectedSubjectId,
  onSelectSubject,
  practicals,
  loadingData,
  language,
  onLanguageChange,
  globalInstruction,
  onGlobalInstructionChange,
  onPlanPath,
  planning,
}: Props) {
  // The selector appears only when the subject genuinely has coding practicals;
  // otherwise language stays null and the generator is told not to emit code.
  const needsLanguage = subjectNeedsLanguage(practicals);
  const isPreset = language != null && LANGUAGE_PRESETS.includes(language);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FlaskConical className="size-4" />
            Lab Manual
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Subject</Label>
            <Select
              value={selectedSubjectId}
              onValueChange={onSelectSubject}
              disabled={isLoadingSubjects}
            >
              <SelectTrigger>
                <SelectValue
                  placeholder={
                    isLoadingSubjects ? "Loading subjects…" : "Select a subject"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {subjects.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.code} — {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {loadingData && (
            <p className="text-muted-foreground flex items-center gap-2 text-sm">
              <Loader2 className="size-3 animate-spin" />
              Loading the syllabus…
            </p>
          )}

          {!loadingData && selectedSubjectId && practicals.length === 0 && (
            <p className="text-sm text-amber-600 dark:text-amber-500">
              This subject has no practicals in its syllabus, so there is nothing
              to build a lab manual from.
            </p>
          )}

          {practicals.length > 0 && (
            <>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Practicals from the syllabus</Label>
                  <Badge variant="secondary">{practicals.length}</Badge>
                </div>
                <div className="rounded-md border">
                  <ul className="divide-y text-sm">
                    {practicals.map((p) => (
                      <li
                        key={p.practicalNo}
                        className="flex items-start gap-3 px-3 py-2"
                      >
                        <span className="text-muted-foreground w-8 shrink-0 tabular-nums">
                          #{p.practicalNo}
                        </span>
                        <span className="flex-1">{p.title}</span>
                        <span className="text-muted-foreground shrink-0">
                          {p.hours}h
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
                <p className="text-muted-foreground text-xs">
                  Titles and hours come from the syllabus and are never rewritten
                  by AI.
                </p>
              </div>

              {needsLanguage && (
                <div className="space-y-2">
                  <Label>Programming language</Label>
                  <div className="flex gap-2">
                    <Select
                      value={isPreset ? (language as string) : "__custom"}
                      onValueChange={(v) =>
                        onLanguageChange(v === "__custom" ? "" : v)
                      }
                    >
                      <SelectTrigger className="w-40">
                        <SelectValue placeholder="Language" />
                      </SelectTrigger>
                      <SelectContent>
                        {LANGUAGE_PRESETS.map((l) => (
                          <SelectItem key={l} value={l}>
                            {l}
                          </SelectItem>
                        ))}
                        <SelectItem value="__custom">Other…</SelectItem>
                      </SelectContent>
                    </Select>
                    {!isPreset && (
                      <Input
                        value={language ?? ""}
                        onChange={(e) => onLanguageChange(e.target.value)}
                        placeholder="e.g. SQL, MATLAB, VHDL"
                        className="flex-1"
                      />
                    )}
                  </div>
                  <p className="text-muted-foreground text-xs">
                    Every code scaffold will be written in this language. Changing
                    it later means regenerating — cached content is per-language.
                  </p>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="global-instruction">
                  Instruction for the whole manual{" "}
                  <span className="text-muted-foreground">(optional)</span>
                </Label>
                <Textarea
                  id="global-instruction"
                  value={globalInstruction}
                  onChange={(e) => onGlobalInstructionChange(e.target.value)}
                  placeholder="e.g. Our lab has no internet access — avoid anything needing package installs."
                  rows={2}
                />
              </div>

              <Button
                onClick={onPlanPath}
                disabled={planning || practicals.length === 0}
                className="w-full"
              >
                {planning ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Planning the learning path…
                  </>
                ) : (
                  <>
                    <Wand2 className="size-4" />
                    Plan Learning Path
                  </>
                )}
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
