"use client";

/**
 * Stage — "Scope & Difficulty": subject selection, target marks, and the
 * per-section module picker. The difficulty controls are a deliberate
 * placeholder for now; the real difficulty UI lands in a later part.
 */

import { useMemo } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { SubjectRow } from "@/hooks/useSupabaseData";
import {
  BTL_TIER,
  previewBtlDistribution,
  resolveTierWeights,
  type CustomBtlWeights,
  type DifficultyPreset,
} from "@/lib/qpaper/moduleAssignment";
import type { ModuleRow } from "./shared";

const PRESET_OPTIONS: { value: DifficultyPreset; label: string; subtitle: string }[] = [
  { value: "foundational",      label: "Foundational",      subtitle: "BTL 1–2 heavy" },
  { value: "balanced",          label: "Balanced",          subtitle: "BTL 3–4 focus" },
  { value: "application_heavy", label: "Application-Heavy", subtitle: "BTL 4–6 heavy" },
  { value: "custom",            label: "Custom",            subtitle: "Set your own tier mix" },
];

/** One editor row per tier, mapping the custom-weight key to its tier index. */
const CUSTOM_TIER_ROWS: { key: keyof CustomBtlWeights; tier: number }[] = [
  { key: "tier1", tier: 0 },
  { key: "tier2", tier: 1 },
  { key: "tier3", tier: 2 },
];

/** "BTL 1–2" style label for a tier index, derived from the shared BTL_TIER. */
function tierLabel(tier: number): string {
  const [lo, hi] = BTL_TIER[tier];
  return `BTL ${lo}–${hi}`;
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
  difficultyPreset: DifficultyPreset;
  onDifficultyPresetChange: (preset: DifficultyPreset) => void;
  customBtlWeights: CustomBtlWeights;
  onCustomBtlWeightsChange: React.Dispatch<React.SetStateAction<CustomBtlWeights>>;
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
  difficultyPreset,
  onDifficultyPresetChange,
  customBtlWeights,
  onCustomBtlWeightsChange,
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

  // ─── Live BTL preview for the currently selected modules + active mix ────
  // Uses the SAME renormalization the real generation path uses (via
  // previewBtlDistribution), so what faculty see here matches what they get.
  const preview = useMemo(() => {
    const selected = modules.filter((m) => selectedModuleIds.includes(m.id));
    if (selected.length === 0) return null;
    const weights = resolveTierWeights(difficultyPreset, customBtlWeights);
    return previewBtlDistribution(
      selected.map((m) => ({
        btl_levels: m.btl_levels,
        weightage_percent: m.weightage_percent,
      })),
      weights
    );
  }, [modules, selectedModuleIds, difficultyPreset, customBtlWeights]);

  // ─── Custom allocator running total (mirrors SourcingStage's pattern) ────
  const customTotal =
    customBtlWeights.tier1 + customBtlWeights.tier2 + customBtlWeights.tier3;
  const customDiff = customTotal - 100;
  const customStatus =
    customDiff === 0
      ? { label: "On target", tone: "text-emerald-600 bg-emerald-50 border-emerald-200" }
      : customDiff < 0
        ? { label: `${Math.abs(customDiff)}% left`, tone: "text-amber-700 bg-amber-50 border-amber-200" }
        : { label: `${customDiff}% over`, tone: "text-rose-700 bg-rose-50 border-rose-200" };
  const customPct = Math.min(100, customTotal);

  const setCustomWeight = (key: keyof CustomBtlWeights, raw: string) => {
    const n = Math.max(0, Math.min(100, Math.round(Number(raw) || 0)));
    onCustomBtlWeightsChange((prev) => ({ ...prev, [key]: n }));
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
          <Input
            type="number"
            min={1}
            max={500}
            value={targetMarks}
            onChange={(e) =>
              onTargetMarksChange(Math.max(1, parseInt(e.target.value, 10) || 1))
            }
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

      <div className="space-y-1.5">
        <Label className="text-xs">Difficulty</Label>
        <div className="flex flex-wrap gap-1.5">
          {PRESET_OPTIONS.map((opt) => {
            const active = difficultyPreset === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => onDifficultyPresetChange(opt.value)}
                className={cn(
                  "px-2.5 py-0.5 rounded-full text-[11px] font-medium border transition-colors",
                  active
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background text-muted-foreground border-border hover:border-primary/50"
                )}
                title={opt.subtitle}
              >
                {opt.label}
              </button>
            );
          })}
        </div>

        {/* ── Custom tier allocator — same running-total pattern as Sourcing ── */}
        {difficultyPreset === "custom" && (
          <div className="space-y-1.5">
            <div className="space-y-1.5">
              {CUSTOM_TIER_ROWS.map(({ key, tier }) => (
                <div
                  key={key}
                  className="flex items-center gap-3 rounded-md border px-3 py-2"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">{tierLabel(tier)}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {tier === 0
                        ? "Remember / Understand"
                        : tier === 1
                          ? "Apply / Analyze"
                          : "Evaluate / Create"}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      value={customBtlWeights[key]}
                      onChange={(e) => setCustomWeight(key, e.target.value)}
                      className="h-8 w-16 text-sm text-right"
                    />
                    <span className="text-xs text-muted-foreground">%</span>
                  </div>
                </div>
              ))}
            </div>

            {/* Running total — same progress-bar pattern as the marks tracker. */}
            <div className="rounded-lg border bg-background/95 p-3">
              <div className="flex items-center justify-between gap-3 mb-1.5">
                <div className="flex items-baseline gap-2">
                  <span className="text-xl font-bold tabular-nums">
                    {customTotal}
                  </span>
                  <span className="text-xs text-muted-foreground">of 100%</span>
                </div>
                <span
                  className={cn(
                    "text-[11px] font-medium px-2 py-0.5 rounded-full border",
                    customStatus.tone
                  )}
                >
                  {customStatus.label}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className={cn(
                    "h-full transition-all",
                    customDiff === 0
                      ? "bg-emerald-500"
                      : customDiff < 0
                        ? "bg-amber-500"
                        : "bg-rose-500"
                  )}
                  style={{ width: `${customPct}%` }}
                />
              </div>
            </div>
          </div>
        )}

        {/* ── Live achievable-breakdown preview for the selected modules ──── */}
        {preview && preview.span && (
          <p className="text-[11px] text-muted-foreground bg-muted/40 border rounded-md px-3 py-2">
            <span className="font-medium text-foreground">
              Selected modules {preview.tiers.length < 3 ? "only support" : "support"}{" "}
              BTL {preview.span[0]}–{preview.span[1]}:
            </span>{" "}
            {preview.tiers
              .map(
                (t, i) => `~${Math.round(preview.percents[i])}% ${tierLabel(t)}`
              )
              .join(", ")}
            .
          </p>
        )}

        <p className="text-[10px] text-muted-foreground">
          Maps to Bloom&apos;s Taxonomy tiers (1: Remember … 6: Create) — biases how BTL levels are spread across questions.
        </p>
      </div>
    </>
  );
}
