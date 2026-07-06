"use client";

/**
 * Setup panel — the sticky left-column sidebar (full-width, non-sticky on
 * mobile) holding every input the faculty sets before generating: subject +
 * marks/duration (Section A), module selection (Section B), the BTL/CO/
 * difficulty distribution collapsibles (Section C), sourcing mix (Section D,
 * verbatim from SourcingStage), and the template browser (Section E).
 *
 * Weightage from the syllabus stays the PRIMARY criterion for module
 * assignment; BTL/CO/difficulty only bias generation within that constraint —
 * see ScopeAndDifficultyStage's original header note (retired; folded in here).
 */

import { useEffect, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SubjectRow } from "@/hooks/useSupabaseData";
import type { PaperTemplateRow } from "@/lib/qpaper/templates";
import { NumericField } from "./NumericField";
import { SourcingStage } from "./SourcingStage";
import { TemplateBrowserDialog } from "./TemplateBrowserDialog";
import type {
  BuilderSection,
  CourseOutcomeRef,
  ModuleRow,
  PaperMetadata,
  SourcingMixState,
} from "./shared";

/** Green/amber/red running-total chip, shared by the CO% and difficulty% editors. */
function runningTotalStatus(total: number) {
  const diff = total - 100;
  if (diff === 0) {
    return { label: "On target", tone: "text-emerald-600 bg-emerald-50 border-emerald-200", bar: "bg-emerald-500" };
  }
  if (diff < 0) {
    return { label: `${Math.abs(diff)}% left`, tone: "text-amber-700 bg-amber-50 border-amber-200", bar: "bg-amber-500" };
  }
  return { label: `${diff}% over`, tone: "text-rose-700 bg-rose-50 border-rose-200", bar: "bg-rose-500" };
}

function RunningTotal({ total }: { total: number }) {
  const status = runningTotalStatus(total);
  const pct = Math.min(100, total);
  return (
    <div className="rounded-lg border bg-background/95 p-3">
      <div className="flex items-center justify-between gap-3 mb-1.5">
        <div className="flex items-baseline gap-2">
          <span className="text-xl font-bold tabular-nums">{total}</span>
          <span className="text-xs text-muted-foreground">of 100%</span>
        </div>
        <span className={cn("text-[11px] font-medium px-2 py-0.5 rounded-full border", status.tone)}>
          {status.label}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div className={cn("h-full transition-all", status.bar)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

const ROMAN = ["I", "II", "III", "IV", "V"];

/** "ESE • Section I → Syllabus Section I" — only when the section names follow
 *  the "Section I / II / …" convention the syllabus module groups also use. */
function eseHint(sections: BuilderSection[]): string | null {
  if (sections.length < 2) return null;
  const isEse = sections.every((s) => /^section\s+[ivx]+$/i.test(s.name.trim()));
  if (!isEse) return null;
  const first = sections[0].name.trim();
  return `ESE • ${first} → Syllabus ${first}`;
}

interface SetupPanelProps {
  lastSavedAt: string | null;

  // Section A — Paper Identity
  subjects: SubjectRow[];
  isLoadingSubjects: boolean;
  selectedSubjectId: string;
  onSelectSubject: (id: string) => void;
  targetMarks: number;
  onTargetMarksChange: (marks: number) => void;
  meta: PaperMetadata;
  setMeta: React.Dispatch<React.SetStateAction<PaperMetadata>>;
  sections: BuilderSection[];

  // Section B — Modules
  modules: ModuleRow[];
  selectedModuleIds: string[];
  setSelectedModuleIds: React.Dispatch<React.SetStateAction<string[]>>;

  // Section C — Distribution
  btlRange: [number, number];
  onBtlRangeChange: (r: [number, number]) => void;
  coTargetsPct: Record<string, number>;
  onCoTargetsPctChange: (t: Record<string, number>) => void;
  difficultyTargets: { easy: number; medium: number; hard: number };
  onDifficultyTargetsChange: (t: { easy: number; medium: number; hard: number }) => void;
  courseOutcomes: CourseOutcomeRef[];
  moduleCoMap?: Map<number, string[]>;

  // Section D — Sourcing (passthrough to SourcingStage, verbatim)
  sourcingMix: SourcingMixState;
  setSourcingMix: (m: SourcingMixState) => void;
  verifiedBankCount: number | null;
  preferredBankQuestionIds: string[];

  // Section E — Template
  templateRefreshKey: number;
  onLoadTemplate: (tpl: PaperTemplateRow) => void;
}

export function SetupPanel({
  lastSavedAt,
  subjects,
  isLoadingSubjects,
  selectedSubjectId,
  onSelectSubject,
  targetMarks,
  onTargetMarksChange,
  meta,
  setMeta,
  sections,
  modules,
  selectedModuleIds,
  setSelectedModuleIds,
  btlRange,
  onBtlRangeChange,
  coTargetsPct,
  onCoTargetsPctChange,
  difficultyTargets,
  onDifficultyTargetsChange,
  courseOutcomes,
  moduleCoMap,
  sourcingMix,
  setSourcingMix,
  verifiedBankCount,
  preferredBankQuestionIds,
  templateRefreshKey,
  onLoadTemplate,
}: SetupPanelProps) {
  // ─── Modules grouped by section_number ──────────────────────────────────
  const moduleGroups = useMemo(() => {
    const groups = new Map<number, ModuleRow[]>();
    for (const m of modules) {
      const k = m.section_number ?? 0;
      const arr = groups.get(k) ?? [];
      arr.push(m);
      groups.set(k, arr);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => a - b);
  }, [modules]);

  const allModulesSelected =
    modules.length > 0 && selectedModuleIds.length === modules.length;

  // ─── CO-coverage preview — is each targeted CO actually reachable from the
  // selected modules? ────────────────────────────────────────────────────────
  const coAchievability = useMemo(() => {
    if (!moduleCoMap || selectedModuleIds.length === 0) return null;
    const selectedModules = modules.filter((m) =>
      selectedModuleIds.includes(m.id)
    );
    return courseOutcomes
      .map((co) => {
        const supporting = selectedModules.filter((m) =>
          (moduleCoMap.get(m.module_number) ?? []).includes(co.co_code)
        );
        return {
          co_code: co.co_code,
          supporting: supporting.length,
          total: selectedModules.length,
        };
      })
      .filter((r) => coTargetsPct[r.co_code] > 0);
  }, [moduleCoMap, selectedModuleIds, modules, courseOutcomes, coTargetsPct]);

  // ─── BTL range handlers — keep min ≤ max regardless of which end moved ───
  const setBtlMin = (raw: number) => {
    const min = Math.max(1, Math.min(6, Math.round(raw) || 1));
    const max = Math.max(min, btlRange[1]);
    onBtlRangeChange([min, max]);
  };
  const setBtlMax = (raw: number) => {
    const max = Math.max(1, Math.min(6, Math.round(raw) || 1));
    const min = Math.min(btlRange[0], max);
    onBtlRangeChange([min, max]);
  };

  // ─── CO% distribution ────────────────────────────────────────────────────
  const coTotal = Object.values(coTargetsPct).reduce((s, v) => s + (v || 0), 0);

  // ─── Visible COs — restrict to those actually covered by the selected
  // modules, so faculty can't set a target for a CO that isn't in scope ────
  const visibleCourseOutcomes = useMemo(() => {
    if (!moduleCoMap || selectedModuleIds.length === 0) return courseOutcomes;
    const selectedNums = new Set(
      modules
        .filter((m) => selectedModuleIds.includes(m.id))
        .map((m) => m.module_number)
    );
    const coveredCos = new Set(
      [...selectedNums].flatMap((n) => moduleCoMap.get(n) ?? [])
    );
    // If moduleCoMap has data but nothing covered (e.g. mapping not yet run),
    // fall back to full list so the UI doesn't go blank unexpectedly.
    if (coveredCos.size === 0) return courseOutcomes;
    return courseOutcomes.filter((co) => coveredCos.has(co.co_code));
  }, [moduleCoMap, selectedModuleIds, modules, courseOutcomes]);

  // ─── Clear stale CO targets when the visible set shrinks ────────────────
  useEffect(() => {
    const visibleCodes = new Set(visibleCourseOutcomes.map((c) => c.co_code));
    const staleKeys = Object.keys(coTargetsPct).filter(
      (k) => !visibleCodes.has(k)
    );
    if (staleKeys.length === 0) return;
    const cleaned = { ...coTargetsPct };
    staleKeys.forEach((k) => delete cleaned[k]);
    onCoTargetsPctChange(cleaned);
    // Intentionally omitting coTargetsPct and onCoTargetsPctChange —
    // running on visibleCourseOutcomes change only to avoid a loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleCourseOutcomes]);

  const setCoPct = (co_code: string, raw: number) => {
    const n = Math.max(0, Math.min(100, Math.round(raw) || 0));
    onCoTargetsPctChange({ ...coTargetsPct, [co_code]: n });
  };
  const coEntries = Object.entries(coTargetsPct).filter(([, v]) => v > 0);
  const coSummary =
    coEntries.length === 0
      ? "—"
      : coEntries
          .slice(0, 2)
          .map(([code, pct]) => `${code} ${pct}%`)
          .join(" · ") + (coEntries.length > 2 ? ` +${coEntries.length - 2} more` : "");

  // ─── Difficulty% distribution ────────────────────────────────────────────
  const diffTotal = difficultyTargets.easy + difficultyTargets.medium + difficultyTargets.hard;
  const setDiffPct = (key: keyof typeof difficultyTargets, raw: number) => {
    const n = Math.max(0, Math.min(100, Math.round(raw) || 0));
    onDifficultyTargetsChange({ ...difficultyTargets, [key]: n });
  };

  // ─── Duration — a NumericField view over meta.time ("150 Minutes") ──────
  const durationMinutes = Number(meta.time.replace(/\D+/g, "")) || 0;
  const setDurationMinutes = (n: number) => {
    setMeta((m) => ({ ...m, time: `${n} Minutes` }));
  };

  const hint = eseHint(sections);

  return (
    <div className="rounded-lg border bg-card p-4 space-y-4">
      <div>
        <h2 className="text-sm font-semibold">Setup</h2>
        {lastSavedAt && (
          <p className="text-muted-foreground text-xs mt-0.5">
            Draft autosaved · {new Date(lastSavedAt).toLocaleTimeString()}
          </p>
        )}
      </div>

      {/* ── Section A — Paper Identity ──────────────────────────────── */}
      <div className="space-y-2">
        <Label className="text-xs mb-1 block">Subject</Label>
        <Select
          value={selectedSubjectId}
          onValueChange={onSelectSubject}
          disabled={isLoadingSubjects || subjects.length === 0}
        >
          <SelectTrigger className="h-9 w-full">
            <SelectValue
              placeholder={
                isLoadingSubjects
                  ? "Loading subjects..."
                  : subjects.length === 0
                    ? "No subjects assigned"
                    : "Select subject"
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

        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-xs mb-1 block">Target Marks</Label>
            <NumericField
              min={1}
              max={500}
              value={targetMarks}
              onChange={onTargetMarksChange}
              className="h-9 text-sm font-semibold"
            />
          </div>
          <div>
            <Label className="text-xs mb-1 block">Duration (min)</Label>
            <NumericField
              min={1}
              max={600}
              value={durationMinutes}
              onChange={setDurationMinutes}
              className="h-9 text-sm font-semibold"
            />
          </div>
        </div>

        {hint && (
          <p className="text-[11px] text-muted-foreground">{hint}</p>
        )}
      </div>

      <Separator />

      {/* ── Section B — Modules ─────────────────────────────────────── */}
      {modules.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Label className="text-xs">Modules</Label>
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
              {selectedModuleIds.length} selected
            </Badge>
          </div>
          <div className="space-y-2">
            {moduleGroups.map(([sectionNum, mods]) => {
              const allGroupSelected = mods.every((m) =>
                selectedModuleIds.includes(m.id)
              );
              const groupLabel =
                sectionNum > 0
                  ? `Section ${ROMAN[sectionNum - 1] ?? sectionNum}`
                  : "All";
              return (
                <div
                  key={sectionNum}
                  className="flex flex-wrap items-center gap-1.5"
                >
                  <span className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground mr-1 w-full">
                    {groupLabel}
                  </span>
                  {mods.map((mod) => {
                    const selected = selectedModuleIds.includes(mod.id);
                    return (
                      <button
                        key={mod.id}
                        type="button"
                        onClick={() =>
                          setSelectedModuleIds((prev) =>
                            selected
                              ? prev.filter((id) => id !== mod.id)
                              : [...prev, mod.id]
                          )
                        }
                        className={cn(
                          "px-2.5 py-0.5 rounded-full text-[11px] font-medium border transition-colors",
                          selected
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-background text-muted-foreground border-border hover:border-primary/50"
                        )}
                      >
                        M{mod.module_number}: {mod.name}
                        {selected && mod.weightage_percent != null && (
                          <> · {mod.weightage_percent}%</>
                        )}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => {
                      const ids = mods.map((m) => m.id);
                      setSelectedModuleIds((prev) => {
                        if (allGroupSelected) {
                          return prev.filter((id) => !ids.includes(id));
                        }
                        const set = new Set(prev);
                        ids.forEach((id) => set.add(id));
                        return Array.from(set);
                      });
                    }}
                    className="text-[10px] text-primary hover:underline ml-1"
                  >
                    {allGroupSelected ? "Clear" : "All"}
                  </button>
                </div>
              );
            })}
          </div>
          {allModulesSelected && (
            <p className="text-[10px] text-muted-foreground">
              Click a module to exclude it from this paper.
            </p>
          )}
        </div>
      )}

      <Separator />

      {/* ── Section C — Distribution ─────────────────────────────────── */}
      <div className="space-y-2">
        <Label className="text-xs">Distribution</Label>

        {/* C1 — BTL Range */}
        <Collapsible>
          <CollapsibleTrigger className="group flex w-full items-center justify-between rounded-md border px-3 py-2 text-left">
            <span className="text-xs font-medium">
              Cognitive Level{" "}
              <span className="text-muted-foreground font-normal">
                BTL {btlRange[0]} – {btlRange[1]}
              </span>
            </span>
            <ChevronDown className="size-3.5 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-1.5 pt-2 px-1">
            <div className="flex items-center gap-2">
              <NumericField
                min={1}
                max={6}
                value={btlRange[0]}
                onChange={setBtlMin}
                className="h-8 w-16 text-sm text-right"
              />
              <span className="text-xs text-muted-foreground">to</span>
              <NumericField
                min={1}
                max={6}
                value={btlRange[1]}
                onChange={setBtlMax}
                className="h-8 w-16 text-sm text-right"
              />
            </div>
            <p className="text-[10px] text-muted-foreground">
              Questions will draw from BTL {btlRange[0]} to {btlRange[1]}{" "}
              (Bloom&apos;s Taxonomy: 1 Remember … 6 Create), wherever a
              module&apos;s allowed levels permit it.
            </p>
          </CollapsibleContent>
        </Collapsible>

        {/* C2 — CO Targets */}
        <Collapsible>
          <CollapsibleTrigger className="group flex w-full items-center justify-between rounded-md border px-3 py-2 text-left">
            <span className="text-xs font-medium">
              Course Outcomes{" "}
              <span className="text-muted-foreground font-normal">
                {coSummary}
              </span>
            </span>
            <ChevronDown className="size-3.5 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-1.5 pt-2 px-1">
            {courseOutcomes.length === 0 ? (
              <p className="text-[11px] text-muted-foreground bg-muted/40 border rounded-md px-3 py-2">
                CO targets will be applied after subject selection.
              </p>
            ) : (
              <div className="space-y-1.5">
                {visibleCourseOutcomes.length < courseOutcomes.length && (
                  <p className="text-[10px] text-muted-foreground">
                    Showing {visibleCourseOutcomes.length} of{" "}
                    {courseOutcomes.length} COs covered by your selected
                    modules.
                  </p>
                )}
                <div className="space-y-1.5">
                  {visibleCourseOutcomes.map((co) => (
                    <div
                      key={co.co_code}
                      className="flex items-center gap-3 rounded-md border px-3 py-2"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium">{co.co_code}</div>
                        <div className="text-[11px] text-muted-foreground truncate">
                          {co.description.length > 60
                            ? `${co.description.slice(0, 60)}…`
                            : co.description}
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <NumericField
                          min={0}
                          max={100}
                          value={coTargetsPct[co.co_code] ?? 0}
                          onChange={(n) => setCoPct(co.co_code, n)}
                          className="h-8 w-16 text-sm text-right"
                        />
                        <span className="text-xs text-muted-foreground">%</span>
                      </div>
                    </div>
                  ))}
                </div>
                <RunningTotal total={coTotal} />
                {coAchievability && coAchievability.length > 0 && (
                  <div className="space-y-1">
                    {coAchievability.map((r) => (
                      <p
                        key={r.co_code}
                        className={cn(
                          "text-[11px]",
                          r.supporting > 0 ? "text-emerald-600" : "text-amber-700"
                        )}
                      >
                        {r.co_code} — {r.supporting} of {r.total} selected
                        modules supply it
                        {r.supporting === 0 &&
                          " — your target may not be achievable"}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )}
          </CollapsibleContent>
        </Collapsible>

        {/* C3 — Difficulty */}
        <Collapsible>
          <CollapsibleTrigger className="group flex w-full items-center justify-between rounded-md border px-3 py-2 text-left">
            <span className="text-xs font-medium">
              Difficulty{" "}
              <span className="text-muted-foreground font-normal">
                Easy {difficultyTargets.easy}% · Med {difficultyTargets.medium}% · Hard{" "}
                {difficultyTargets.hard}%
              </span>
            </span>
            <ChevronDown className="size-3.5 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-1.5 pt-2 px-1">
            <div className="grid grid-cols-3 gap-2">
              <div>
                <Label className="text-[10px] text-muted-foreground mb-1 block">Easy %</Label>
                <NumericField
                  min={0}
                  max={100}
                  value={difficultyTargets.easy}
                  onChange={(n) => setDiffPct("easy", n)}
                  className="h-8 text-sm text-right"
                />
              </div>
              <div>
                <Label className="text-[10px] text-muted-foreground mb-1 block">Medium %</Label>
                <NumericField
                  min={0}
                  max={100}
                  value={difficultyTargets.medium}
                  onChange={(n) => setDiffPct("medium", n)}
                  className="h-8 text-sm text-right"
                />
              </div>
              <div>
                <Label className="text-[10px] text-muted-foreground mb-1 block">Hard %</Label>
                <NumericField
                  min={0}
                  max={100}
                  value={difficultyTargets.hard}
                  onChange={(n) => setDiffPct("hard", n)}
                  className="h-8 text-sm text-right"
                />
              </div>
            </div>
            <RunningTotal total={diffTotal} />
          </CollapsibleContent>
        </Collapsible>
      </div>

      <Separator />

      {/* ── Section D — Sourcing (verbatim) ─────────────────────────── */}
      <div>
        <SourcingStage
          mix={sourcingMix}
          setMix={setSourcingMix}
          verifiedBankCount={verifiedBankCount}
          preferredBankQuestionIds={preferredBankQuestionIds}
        />
      </div>

      <Separator />

      {/* ── Section E — Template ─────────────────────────────────────── */}
      <div className="space-y-1.5">
        <Label className="text-xs">Template</Label>
        <TemplateBrowserDialog
          refreshKey={templateRefreshKey}
          onLoadTemplate={onLoadTemplate}
        />
      </div>
    </div>
  );
}
