"use client";

/**
 * ReviewStage — the core: per-module accordion of editable session cards
 * (drag-reorder within a module), uncovered-topic chips, per-module review
 * gating, the practical review section, and a sticky export footer that unlocks
 * only when every present module + practicals is marked reviewed.
 */

import { useMemo } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  Check,
  CircleDashed,
  Download,
  FileText,
  Loader2,
  Plus,
  Save,
} from "lucide-react";
import { SessionCard } from "./SessionCard";
import { PracticalCard } from "./PracticalCard";
import {
  groupByModule,
  groupWarnings,
  theoryModuleStateKey,
  PRACTICALS_STATE_KEY,
  stateKeyLabel,
  type SectionTab,
  type UiModule,
  type UiCourseOutcome,
  type LessonPlanDoc,
  type LessonPlanWarning,
  type TheorySession,
  type PracticalSession,
} from "./shared";

interface ReviewStageProps {
  subjectLabel: string;
  tab: SectionTab;
  onTabChange: (t: SectionTab) => void;
  hasTheory: boolean;
  hasPractical: boolean;
  doc: LessonPlanDoc;
  modules: UiModule[];
  courseOutcomes: UiCourseOutcome[];
  warnings: LessonPlanWarning[];
  regenSet: Set<string>;
  onSessionChange: (s: TheorySession) => void;
  onSessionsReorder: (moduleNumber: number, orderedSessionNos: number[]) => void;
  onRegenerateSession: (session: TheorySession, instruction: string) => void;
  onInsertUncoveredTopic: (w: LessonPlanWarning) => void;
  onPracticalChange: (p: PracticalSession) => void;
  onRegeneratePractical: (p: PracticalSession, instruction: string) => void;
  onToggleReviewed: (key: string, reviewed: boolean) => void;
  onExport: (format: "docx" | "pdf") => void;
  exporting: boolean;
  saving: boolean;
  onBackToSetup: () => void;
}

export function ReviewStage(props: ReviewStageProps) {
  const {
    subjectLabel,
    tab,
    onTabChange,
    hasTheory,
    hasPractical,
    doc,
    modules,
    courseOutcomes,
    warnings,
    regenSet,
    onSessionChange,
    onSessionsReorder,
    onRegenerateSession,
    onInsertUncoveredTopic,
    onPracticalChange,
    onRegeneratePractical,
    onToggleReviewed,
    onExport,
    exporting,
    saving,
    onBackToSetup,
  } = props;

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const subjectCoCodes = useMemo(
    () => courseOutcomes.map((c) => c.co_code),
    [courseOutcomes],
  );
  const moduleByNumber = useMemo(() => {
    const m = new Map<number, UiModule>();
    for (const mod of modules) m.set(mod.module_number, mod);
    return m;
  }, [modules]);

  const sessionsByModule = useMemo(() => groupByModule(doc.theory), [doc.theory]);
  const warningsByModule = useMemo(() => groupWarnings(warnings), [warnings]);

  const theoryModuleNumbers = useMemo(
    () => [...sessionsByModule.keys()].sort((a, b) => a - b),
    [sessionsByModule],
  );

  // ── Reviewed progress across present sections ──
  const presentKeys = useMemo(() => {
    const keys: string[] = theoryModuleNumbers.map((n) => theoryModuleStateKey(n));
    if (doc.practicals.length > 0) keys.push(PRACTICALS_STATE_KEY);
    return keys;
  }, [theoryModuleNumbers, doc.practicals.length]);

  const reviewedKeys = presentKeys.filter(
    (k) => doc.moduleStates[k]?.reviewed === true,
  );
  const allReviewed = presentKeys.length > 0 && reviewedKeys.length === presentKeys.length;
  const pendingLabels = presentKeys
    .filter((k) => doc.moduleStates[k]?.reviewed !== true)
    .map(stateKeyLabel);

  const handleDragEnd = (moduleNumber: number, event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const list = sessionsByModule.get(moduleNumber) ?? [];
    const ids = list.map((s) => `s-${s.sessionNo}`);
    const oldIdx = ids.indexOf(String(active.id));
    const newIdx = ids.indexOf(String(over.id));
    if (oldIdx === -1 || newIdx === -1) return;
    const reordered = arrayMove(list, oldIdx, newIdx);
    onSessionsReorder(moduleNumber, reordered.map((s) => s.sessionNo));
  };

  return (
    <div>
      {/* header */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <Button variant="ghost" size="sm" onClick={onBackToSetup}>
          <ArrowLeft className="size-4" /> Setup
        </Button>
        <div className="flex-1 min-w-40">
          <p className="text-sm font-medium">{subjectLabel}</p>
          <p className="text-xs text-muted-foreground">Review &amp; edit the lesson plan</p>
        </div>
        <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
          {saving ? (
            <>
              <Loader2 className="size-3.5 animate-spin" /> Saving…
            </>
          ) : (
            <>
              <Save className="size-3.5" /> Saved
            </>
          )}
        </span>
      </div>

      {/* section tabs */}
      <div className="flex border-b mb-4">
        <button
          type="button"
          onClick={() => onTabChange("theory")}
          disabled={!hasTheory}
          className={
            "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors disabled:opacity-40 " +
            (tab === "theory"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground")
          }
        >
          Theory ({doc.theory.length})
        </button>
        <button
          type="button"
          onClick={() => onTabChange("practical")}
          disabled={!hasPractical}
          className={
            "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors disabled:opacity-40 " +
            (tab === "practical"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground")
          }
        >
          Practical ({doc.practicals.length})
        </button>
      </div>

      {tab === "theory" ? (
        theoryModuleNumbers.length === 0 ? (
          <EmptySection label="No theory plan yet. Generate one from Setup." />
        ) : (
          <Accordion type="multiple" defaultValue={theoryModuleNumbers.map((n) => `m${n}`)}>
            {theoryModuleNumbers.map((mn) => {
              const key = theoryModuleStateKey(mn);
              const reviewed = doc.moduleStates[key]?.reviewed === true;
              const mod = moduleByNumber.get(mn);
              const sessions = sessionsByModule.get(mn) ?? [];
              const modWarnings = warningsByModule.get(mn) ?? [];
              const uncovered = modWarnings.filter((w) => w.kind === "uncovered_topic");
              const otherWarnings = modWarnings.filter((w) => w.kind !== "uncovered_topic");
              const allowedBtl = mod?.btl_levels ?? [1, 2, 3, 4, 5, 6];

              return (
                <AccordionItem key={mn} value={`m${mn}`}>
                  <AccordionTrigger className="hover:no-underline">
                    <div className="flex flex-1 items-center gap-2 pr-2 text-left">
                      <span className="font-medium">
                        Module {mn}
                        {mod ? `: ${mod.name}` : ""}
                      </span>
                      <Badge variant="outline" className="shrink-0">
                        {sessions.length} sessions
                      </Badge>
                      <div className="flex-1" />
                      {modWarnings.length > 0 && (
                        <Badge
                          variant="secondary"
                          className="shrink-0 bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                        >
                          {modWarnings.length} warning{modWarnings.length > 1 ? "s" : ""}
                        </Badge>
                      )}
                      <span
                        className={
                          "shrink-0 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium " +
                          (reviewed
                            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                            : "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300")
                        }
                      >
                        {reviewed ? (
                          <>
                            <Check className="size-3" /> Reviewed
                          </>
                        ) : (
                          <>
                            <CircleDashed className="size-3" /> Needs review
                          </>
                        )}
                      </span>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="space-y-3">
                      {/* uncovered-topic chips */}
                      {uncovered.length > 0 && (
                        <div className="rounded-md border border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40 p-2 space-y-1.5">
                          <p className="text-xs font-medium text-amber-800 dark:text-amber-300">
                            Not scheduled in any session — click to add:
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {uncovered.map((w, i) => (
                              <button
                                key={i}
                                type="button"
                                onClick={() => onInsertUncoveredTopic(w)}
                                className="inline-flex items-center gap-1 rounded-full bg-amber-100 dark:bg-amber-900 text-amber-800 dark:text-amber-200 text-xs px-2 py-0.5 hover:bg-amber-200"
                              >
                                <Plus className="size-3" />
                                {w.fragment}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* other validation warnings */}
                      {otherWarnings.length > 0 && (
                        <ul className="text-xs text-amber-700 dark:text-amber-400 list-disc pl-5 space-y-0.5">
                          {otherWarnings.map((w, i) => (
                            <li key={i}>{w.message}</li>
                          ))}
                        </ul>
                      )}

                      {/* sessions with drag-reorder */}
                      <DndContext
                        sensors={sensors}
                        collisionDetection={closestCenter}
                        onDragEnd={(e) => handleDragEnd(mn, e)}
                      >
                        <SortableContext
                          items={sessions.map((s) => `s-${s.sessionNo}`)}
                          strategy={verticalListSortingStrategy}
                        >
                          <div className="space-y-2.5">
                            {sessions.map((s) => (
                              <SessionCard
                                key={s.sessionNo}
                                session={s}
                                allowedBtl={allowedBtl}
                                subjectCoCodes={subjectCoCodes}
                                onChange={onSessionChange}
                                onRegenerate={(instr) => onRegenerateSession(s, instr)}
                                regenerating={regenSet.has(`s-${s.sessionNo}`)}
                              />
                            ))}
                          </div>
                        </SortableContext>
                      </DndContext>

                      <div className="flex justify-end">
                        <Button
                          size="sm"
                          variant={reviewed ? "outline" : "default"}
                          onClick={() => onToggleReviewed(key, !reviewed)}
                        >
                          {reviewed ? "Mark as needs review" : "Mark module reviewed"}
                        </Button>
                      </div>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              );
            })}
          </Accordion>
        )
      ) : doc.practicals.length === 0 ? (
        <EmptySection label="No practical plan yet. Generate one from Setup." />
      ) : (
        <div className="space-y-3">
          {(() => {
            const pracWarnings = warningsByModule.get("practicals") ?? [];
            const reviewed = doc.moduleStates[PRACTICALS_STATE_KEY]?.reviewed === true;
            return (
              <>
                {pracWarnings.length > 0 && (
                  <ul className="text-xs text-amber-700 dark:text-amber-400 list-disc pl-5 space-y-0.5">
                    {pracWarnings.map((w, i) => (
                      <li key={i}>{w.message}</li>
                    ))}
                  </ul>
                )}
                {doc.practicals.map((p) => (
                  <PracticalCard
                    key={p.practicalNo}
                    practical={p}
                    subjectCoCodes={subjectCoCodes}
                    onChange={onPracticalChange}
                    onRegenerate={(instr) => onRegeneratePractical(p, instr)}
                    regenerating={regenSet.has(`p-${p.practicalNo}`)}
                  />
                ))}
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    variant={reviewed ? "outline" : "default"}
                    onClick={() => onToggleReviewed(PRACTICALS_STATE_KEY, !reviewed)}
                  >
                    {reviewed ? "Mark as needs review" : "Mark practicals reviewed"}
                  </Button>
                </div>
              </>
            );
          })()}
        </div>
      )}

      {/* sticky export footer — sticks to the bottom of the scrolling <main>,
          so it stays within the content column and never overlaps the sidebar */}
      <div className="sticky bottom-0 z-20 mt-6 -mx-4 sm:-mx-6 border-t bg-background/95 backdrop-blur">
        <div className="px-4 sm:px-6 py-3 flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-40">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-muted-foreground">
                {reviewedKeys.length} of {presentKeys.length} reviewed
              </span>
              {!allReviewed && pendingLabels.length > 0 && (
                <span className="text-xs text-amber-700 dark:text-amber-400 truncate max-w-[16rem]">
                  Pending: {pendingLabels.join(", ")}
                </span>
              )}
            </div>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-emerald-500 transition-all"
                style={{
                  width: `${presentKeys.length ? Math.round((reviewedKeys.length / presentKeys.length) * 100) : 0}%`,
                }}
              />
            </div>
          </div>
          <Button
            variant="outline"
            disabled={!allReviewed || exporting}
            onClick={() => onExport("docx")}
            title={allReviewed ? "" : `Review all sections first: ${pendingLabels.join(", ")}`}
          >
            {exporting ? <Loader2 className="size-4 animate-spin" /> : <FileText className="size-4" />}
            Export Word
          </Button>
          <Button
            disabled={!allReviewed || exporting}
            onClick={() => onExport("pdf")}
            title={allReviewed ? "" : `Review all sections first: ${pendingLabels.join(", ")}`}
          >
            {exporting ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
            Export PDF
          </Button>
        </div>
      </div>
    </div>
  );
}

function EmptySection({ label }: { label: string }) {
  return (
    <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
      {label}
    </div>
  );
}
