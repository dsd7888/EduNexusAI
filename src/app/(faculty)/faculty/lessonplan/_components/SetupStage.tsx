"use client";

/**
 * SetupStage — subject selection + per-section (theory/practical) generation
 * launch. Presentational: page.tsx owns all state, fetching, and generation.
 */

import { Fragment, useState } from "react";
import {
  Loader2,
  Pencil,
  Sparkles,
  RefreshCw,
  Download,
  Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { SubjectRow } from "@/hooks/useSupabaseData";
import { NumericField } from "./NumericField";
import {
  DEFAULT_MODULE_HOURS,
  sessionCountFor,
  totalTheorySessions,
  type SectionTab,
  type UiModule,
  type UiPractical,
} from "./shared";

export interface CacheFlag {
  generatedAt: string;
  generatedBySelf: boolean;
}

interface SetupStageProps {
  subjects: SubjectRow[];
  isLoadingSubjects: boolean;
  selectedSubjectId: string;
  onSelectSubject: (id: string) => void;
  loadingData: boolean;
  modules: UiModule[];
  practicals: UiPractical[];
  tab: SectionTab;
  onTabChange: (t: SectionTab) => void;
  hoursOverride: Record<number, number>;
  onHoursChange: (moduleNumber: number, hours: number) => void;
  moduleInstructions: Record<number, string>;
  onInstructionChange: (moduleNumber: number, text: string) => void;
  cache: { theory: CacheFlag | null; practical: CacheFlag | null };
  onGenerate: (fresh: boolean) => void;
  generating: boolean;
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors " +
        (active
          ? "border-primary text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground")
      }
    >
      {children}
    </button>
  );
}

function CacheBanner({
  flag,
  onLoad,
  onRegen,
  generating,
}: {
  flag: CacheFlag;
  onLoad: () => void;
  onRegen: () => void;
  generating: boolean;
}) {
  return (
    <div className="rounded-lg border border-sky-200 bg-sky-50 dark:border-sky-900 dark:bg-sky-950/40 p-3 flex flex-wrap items-center gap-3">
      <Info className="size-4 text-sky-600 shrink-0" />
      <p className="text-sm text-sky-900 dark:text-sky-200 flex-1 min-w-48">
        {flag.generatedBySelf
          ? "You already generated this section"
          : "A colleague already generated this section"}{" "}
        on {fmtDate(flag.generatedAt)}.
      </p>
      <Button size="sm" onClick={onLoad} disabled={generating}>
        <Download className="size-4" /> Load (instant)
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={onRegen}
        disabled={generating}
      >
        <RefreshCw className="size-4" /> Regenerate fresh
      </Button>
    </div>
  );
}

export function SetupStage(props: SetupStageProps) {
  const {
    subjects,
    isLoadingSubjects,
    selectedSubjectId,
    onSelectSubject,
    loadingData,
    modules,
    practicals,
    tab,
    onTabChange,
    hoursOverride,
    onHoursChange,
    moduleInstructions,
    onInstructionChange,
    cache,
    onGenerate,
    generating,
  } = props;

  const [openInstruction, setOpenInstruction] = useState<number | null>(null);
  const totalSessions = totalTheorySessions(modules, hoursOverride);

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Subject picker */}
      <div className="space-y-2">
        <label className="text-sm font-medium">Subject</label>
        <Select
          value={selectedSubjectId}
          onValueChange={onSelectSubject}
          disabled={isLoadingSubjects}
        >
          <SelectTrigger className="w-full sm:w-96">
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
        {!isLoadingSubjects && subjects.length === 0 && (
          <p className="text-sm text-muted-foreground">
            You have no assigned subjects. Ask an admin to assign one.
          </p>
        )}
      </div>

      {!selectedSubjectId ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          Select a subject to build its session-wise lesson plan.
        </div>
      ) : loadingData ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-10">
          <Loader2 className="size-4 animate-spin" /> Loading syllabus…
        </div>
      ) : (
        <>
          {/* Section tabs */}
          <div className="flex border-b">
            <TabButton active={tab === "theory"} onClick={() => onTabChange("theory")}>
              Theory ({modules.length} modules)
            </TabButton>
            <TabButton
              active={tab === "practical"}
              onClick={() => onTabChange("practical")}
            >
              Practical ({practicals.length})
            </TabButton>
          </div>

          {tab === "theory" ? (
            <div className="space-y-4">
              {cache.theory && (
                <CacheBanner
                  flag={cache.theory}
                  onLoad={() => onGenerate(false)}
                  onRegen={() => onGenerate(true)}
                  generating={generating}
                />
              )}

              {modules.length === 0 ? (
                <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                  This subject has no modules to plan.
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-muted-foreground">
                      Edit each module&rsquo;s teaching hours to change its session
                      count. The AI fills content; you review every session next.
                    </p>
                    <Badge variant="secondary" className="shrink-0">
                      {totalSessions} sessions total
                    </Badge>
                  </div>

                  <div className="rounded-lg border overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50 text-xs text-muted-foreground">
                        <tr>
                          <th className="text-left font-medium px-3 py-2 w-10">#</th>
                          <th className="text-left font-medium px-3 py-2">Module</th>
                          <th className="text-left font-medium px-3 py-2 w-24">Hours</th>
                          <th className="text-left font-medium px-3 py-2 w-20">Wtg</th>
                          <th className="text-left font-medium px-3 py-2 w-24">Sessions</th>
                          <th className="px-3 py-2 w-10" />
                        </tr>
                      </thead>
                      <tbody>
                        {modules.map((m) => {
                          const count = sessionCountFor(m, hoursOverride);
                          const hoursVal =
                            hoursOverride[m.module_number] ??
                            (typeof m.hours === "number" && m.hours >= 1
                              ? Math.floor(m.hours)
                              : DEFAULT_MODULE_HOURS);
                          const hasInstruction = Boolean(
                            moduleInstructions[m.module_number]?.trim(),
                          );
                          const isOpen = openInstruction === m.module_number;
                          return (
                            <Fragment key={m.module_number}>
                              <tr className="border-t align-top">
                                <td className="px-3 py-2 text-muted-foreground">
                                  {m.module_number}
                                </td>
                                <td className="px-3 py-2">
                                  <p className="font-medium">{m.name}</p>
                                  <p className="text-xs text-muted-foreground line-clamp-2 max-w-md">
                                    {m.description || "—"}
                                  </p>
                                </td>
                                <td className="px-3 py-2">
                                  <NumericField
                                    value={hoursVal}
                                    min={1}
                                    max={40}
                                    fallback={DEFAULT_MODULE_HOURS}
                                    onChange={(n) => onHoursChange(m.module_number, n)}
                                    className="h-8 w-16"
                                  />
                                </td>
                                <td className="px-3 py-2 text-muted-foreground">
                                  {m.weightage_percent != null
                                    ? `${m.weightage_percent}%`
                                    : "—"}
                                </td>
                                <td className="px-3 py-2">
                                  <Badge variant="outline">{count}</Badge>
                                </td>
                                <td className="px-3 py-2">
                                  <button
                                    type="button"
                                    title="Add an instruction for this module"
                                    onClick={() =>
                                      setOpenInstruction(isOpen ? null : m.module_number)
                                    }
                                    className={
                                      "hover:text-foreground " +
                                      (hasInstruction
                                        ? "text-primary"
                                        : "text-muted-foreground")
                                    }
                                  >
                                    <Pencil className="size-4" />
                                  </button>
                                </td>
                              </tr>
                              {isOpen && (
                                <tr className="border-t bg-muted/30">
                                  <td />
                                  <td colSpan={5} className="px-3 py-2">
                                    <Textarea
                                      value={moduleInstructions[m.module_number] ?? ""}
                                      onChange={(e) =>
                                        onInstructionChange(
                                          m.module_number,
                                          e.target.value,
                                        )
                                      }
                                      placeholder="Optional instruction the AI must follow for this module (e.g. 'emphasise numerical practice', 'cover NPTEL case study')."
                                      className="min-h-[60px] text-sm"
                                    />
                                  </td>
                                </tr>
                              )}
                            </Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  <div>
                    <Button onClick={() => onGenerate(true)} disabled={generating}>
                      {generating ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Sparkles className="size-4" />
                      )}
                      {cache.theory ? "Regenerate Theory Plan" : "Generate Theory Plan"}
                    </Button>
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {cache.practical && (
                <CacheBanner
                  flag={cache.practical}
                  onLoad={() => onGenerate(false)}
                  onRegen={() => onGenerate(true)}
                  generating={generating}
                />
              )}
              {practicals.length === 0 ? (
                <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                  This subject has no practicals.
                </div>
              ) : (
                <>
                  <div className="rounded-lg border divide-y">
                    {practicals.map((p) => (
                      <div key={p.sr_no} className="px-3 py-2 flex items-center gap-3">
                        <span className="text-xs text-muted-foreground w-6">
                          {p.sr_no}
                        </span>
                        <span className="text-sm flex-1">{p.name}</span>
                        {p.hours != null && (
                          <Badge variant="outline" className="shrink-0">
                            {p.hours}h
                          </Badge>
                        )}
                      </div>
                    ))}
                  </div>
                  <div>
                    <Button onClick={() => onGenerate(true)} disabled={generating}>
                      {generating ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Sparkles className="size-4" />
                      )}
                      {cache.practical
                        ? "Regenerate Practical Plan"
                        : "Generate Practical Plan"}
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
