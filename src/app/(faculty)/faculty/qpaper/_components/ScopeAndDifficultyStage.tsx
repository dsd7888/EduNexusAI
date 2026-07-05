"use client";

/**
 * Stage — "Scope & Difficulty": subject selection, target marks, the
 * per-section module picker, and the three secondary generation directives
 * (BTL range, CO% distribution, difficulty% distribution). Weightage from the
 * syllabus stays the PRIMARY criterion for module assignment throughout —
 * these three only bias BTL/CO/difficulty within that constraint.
 */

import { useMemo } from "react";
import { Label } from "@/components/ui/label";
import { NumericField } from "./NumericField";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { SubjectRow } from "@/hooks/useSupabaseData";
import type { CourseOutcomeRef, ModuleRow } from "./shared";

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

interface ScopeAndDifficultyStageProps {
  subjects: SubjectRow[];
  isLoadingSubjects: boolean;
  selectedSubjectId: string;
  onSelectSubject: (id: string) => void;
  targetMarks: number;
  onTargetMarksChange: (marks: number) => void;
  modules: ModuleRow[];
  selectedModuleIds: string[];
  setSelectedModuleIds: React.Dispatch<React.SetStateAction<string[]>>;
  btlRange: [number, number];
  onBtlRangeChange: (r: [number, number]) => void;
  coTargetsPct: Record<string, number>;
  onCoTargetsPctChange: (t: Record<string, number>) => void;
  difficultyTargets: { easy: number; medium: number; hard: number };
  onDifficultyTargetsChange: (t: { easy: number; medium: number; hard: number }) => void;
  courseOutcomes: CourseOutcomeRef[];
}

export function ScopeAndDifficultyStage({
  subjects,
  isLoadingSubjects,
  selectedSubjectId,
  onSelectSubject,
  targetMarks,
  onTargetMarksChange,
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
}: ScopeAndDifficultyStageProps) {
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
  const setCoPct = (co_code: string, raw: number) => {
    const n = Math.max(0, Math.min(100, Math.round(raw) || 0));
    onCoTargetsPctChange({ ...coTargetsPct, [co_code]: n });
  };

  // ─── Difficulty% distribution ────────────────────────────────────────────
  const diffTotal = difficultyTargets.easy + difficultyTargets.medium + difficultyTargets.hard;
  const setDiffPct = (key: keyof typeof difficultyTargets, raw: number) => {
    const n = Math.max(0, Math.min(100, Math.round(raw) || 0));
    onDifficultyTargetsChange({ ...difficultyTargets, [key]: n });
  };

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr] gap-3">
        <div>
          <Label className="text-xs mb-1 block">Subject</Label>
          <Select
            value={selectedSubjectId}
            onValueChange={onSelectSubject}
            disabled={isLoadingSubjects || subjects.length === 0}
          >
            <SelectTrigger className="h-9">
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
        </div>
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
      </div>

      {modules.length > 0 && (
        <div className="space-y-2">
          <Label className="text-xs">Modules</Label>
          <div className="space-y-2">
            {moduleGroups.map(([sectionNum, mods]) => {
              const allSelected = mods.every((m) =>
                selectedModuleIds.includes(m.id)
              );
              const groupLabel =
                sectionNum > 0
                  ? `Section ${
                      ["I", "II", "III", "IV", "V"][sectionNum - 1] ??
                      sectionNum
                    }`
                  : "All";
              return (
                <div
                  key={sectionNum}
                  className="flex flex-wrap items-center gap-1.5"
                >
                  <span className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground mr-1">
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
                        title={
                          mod.weightage_percent != null
                            ? `${mod.weightage_percent}% weightage`
                            : undefined
                        }
                      >
                        M{mod.module_number}: {mod.name}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => {
                      const ids = mods.map((m) => m.id);
                      setSelectedModuleIds((prev) => {
                        if (allSelected) {
                          return prev.filter((id) => !ids.includes(id));
                        }
                        const set = new Set(prev);
                        ids.forEach((id) => set.add(id));
                        return Array.from(set);
                      });
                    }}
                    className="text-[10px] text-primary hover:underline ml-1"
                  >
                    {allSelected ? "Clear" : "All"}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── BTL Range — paper-wide eligibility filter (secondary to weightage) ── */}
      <div className="space-y-1.5">
        <Label className="text-xs">BTL Range</Label>
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
          Questions will draw from BTL {btlRange[0]} to {btlRange[1]} (Bloom&apos;s Taxonomy: 1 Remember … 6 Create), wherever a module&apos;s allowed levels permit it.
        </p>
      </div>

      {/* ── CO Distribution — secondary bias on top of weightage ─────────── */}
      <div className="space-y-1.5">
        <Label className="text-xs">CO Distribution</Label>
        {courseOutcomes.length === 0 ? (
          <p className="text-[11px] text-muted-foreground bg-muted/40 border rounded-md px-3 py-2">
            CO targets will be applied after subject selection.
          </p>
        ) : (
          <div className="space-y-1.5">
            <div className="space-y-1.5">
              {courseOutcomes.map((co) => (
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
          </div>
        )}
      </div>

      {/* ── Difficulty Distribution — per-slot generation directive ──────── */}
      <div className="space-y-1.5">
        <Label className="text-xs">Difficulty Distribution</Label>
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
        {/* TODO: once moduleCoMap is threaded down to this stage, restore a
            live "COx (y%) — n of m selected modules supply it" summary here. */}
      </div>
    </>
  );
}
