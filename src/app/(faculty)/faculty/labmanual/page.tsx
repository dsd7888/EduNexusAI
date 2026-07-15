"use client";

/**
 * Faculty Lab-Manual builder. Four-view state machine (setup → path →
 * generating → review), mirroring the lesson-plan page. Owns the LabManualDoc,
 * subject/practical fetching, path proposal, per-unit generation, per-practical
 * regeneration, and debounced autosave (PUT) of the whole document.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useFacultySubjects } from "@/hooks/useSupabaseData";
import { SetupStage } from "./_components/SetupStage";
import { PathStage } from "./_components/PathStage";
import { GeneratingStage, type GenItem } from "./_components/GeneratingStage";
import { ReviewStage } from "./_components/ReviewStage";
import {
  emptyDoc,
  chunkForRequest,
  stateFor,
  type CacheFlag,
  type Difficulty,
  type LabManualDoc,
  type LabManualWarning,
  type LearningPath,
  type PracticalManualSection,
  type PracticalState,
  type UiPractical,
} from "./_components/shared";

type View = "setup" | "path" | "generating" | "review";

const LAST_SUBJECT_KEY = "labmanual:lastSubjectId";
const AUTOSAVE_DEBOUNCE_MS = 1500;

export default function LabManualPage() {
  const { subjects, isLoading: isLoadingSubjects } = useFacultySubjects();

  const [view, setView] = useState<View>("setup");
  const [selectedSubjectId, setSelectedSubjectId] = useState("");
  const [loadingData, setLoadingData] = useState(false);

  const [practicals, setPracticals] = useState<UiPractical[]>([]);
  const [doc, setDoc] = useState<LabManualDoc>(emptyDoc());
  const [warnings, setWarnings] = useState<LabManualWarning[]>([]);
  const [globalInstruction, setGlobalInstruction] = useState("");
  const [, setCacheFreshness] = useState<Record<number, CacheFlag>>({});

  const [planning, setPlanning] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [genItems, setGenItems] = useState<GenItem[]>([]);
  const [regenSet, setRegenSet] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);

  const lastSavedRef = useRef<string>("");
  // The generate handler reads the CURRENT doc without taking it as a dep —
  // otherwise every keystroke in a card would rebuild the callback mid-batch.
  const docRef = useRef(doc);
  docRef.current = doc;

  // Restore the last subject on mount.
  useEffect(() => {
    const saved =
      typeof window !== "undefined"
        ? window.localStorage.getItem(LAST_SUBJECT_KEY)
        : null;
    if (saved) setSelectedSubjectId(saved);
  }, []);

  useEffect(() => {
    if (selectedSubjectId && typeof window !== "undefined") {
      window.localStorage.setItem(LAST_SUBJECT_KEY, selectedSubjectId);
    }
  }, [selectedSubjectId]);

  // ── Load the subject's practicals + any saved manual ─────────────────────
  const loadSubject = useCallback(async (subjectId: string) => {
    if (!subjectId) return;
    setLoadingData(true);
    try {
      const res = await fetch(
        `/api/labmanual?subjectId=${encodeURIComponent(subjectId)}`,
      );
      // apiSuccess() returns the payload directly — there is no {data} wrapper.
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Failed to load");

      setPracticals(data.practicals ?? []);
      setCacheFreshness(data.cacheFreshness ?? {});

      const savedDoc = data.manual?.doc as LabManualDoc | undefined;
      if (savedDoc && Array.isArray(savedDoc.sections)) {
        setDoc(savedDoc);
        lastSavedRef.current = JSON.stringify(savedDoc);
        // A saved manual with content lands straight in review (§7).
        setView(savedDoc.sections.length > 0 ? "review" : savedDoc.path ? "path" : "setup");
      } else {
        const fresh = emptyDoc();
        setDoc(fresh);
        lastSavedRef.current = "";
        setView("setup");
      }
      setWarnings([]);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not load this subject",
      );
    } finally {
      setLoadingData(false);
    }
  }, []);

  useEffect(() => {
    if (selectedSubjectId) void loadSubject(selectedSubjectId);
  }, [selectedSubjectId, loadSubject]);

  // ── Debounced autosave ───────────────────────────────────────────────────
  useEffect(() => {
    if (!selectedSubjectId) return;
    // Nothing worth persisting yet.
    if (!doc.path && doc.sections.length === 0) return;

    const serialized = JSON.stringify(doc);
    if (serialized === lastSavedRef.current) return;

    const t = setTimeout(async () => {
      setSaving(true);
      try {
        const res = await fetch("/api/labmanual", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subjectId: selectedSubjectId, doc }),
        });
        if (!res.ok) {
          const json = await res.json().catch(() => null);
          throw new Error(json?.error ?? "Save failed");
        }
        lastSavedRef.current = serialized;
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not save");
      } finally {
        setSaving(false);
      }
    }, AUTOSAVE_DEBOUNCE_MS);

    return () => clearTimeout(t);
  }, [doc, selectedSubjectId]);

  // ── EDIT-UNREVIEWS ───────────────────────────────────────────────────────
  // The single state transition for it: ANY edit to a practical's content flips
  // it back to unreviewed. "Reviewed" has to mean "a human read THIS text" — if
  // an edit kept the tick, a faculty could review a valid rubric, edit it to 7
  // marks, and export a manual the gate already blessed. Simplest honest
  // semantics, and it closes the hole for every field rather than just the ones
  // we remembered to special-case.
  const updateSection = useCallback(
    (practicalNo: number, patch: Partial<PracticalManualSection>) => {
      setDoc((d) => ({
        ...d,
        sections: d.sections.map((s) =>
          s.practicalNo === practicalNo ? { ...s, ...patch } : s,
        ),
        practicalStates: {
          ...d.practicalStates,
          [practicalNo]: {
            ...stateFor(d, practicalNo),
            reviewed: false,
          },
        },
      }));
    },
    [],
  );

  /** State-only changes (difficulty, instruction, the reviewed tick itself). */
  const updateState = useCallback(
    (practicalNo: number, patch: Partial<PracticalState>) => {
      setDoc((d) => ({
        ...d,
        practicalStates: {
          ...d.practicalStates,
          [practicalNo]: { ...stateFor(d, practicalNo), ...patch },
        },
      }));
    },
    [],
  );

  // ── Path proposal ────────────────────────────────────────────────────────
  async function planPath() {
    if (!selectedSubjectId) return;
    setPlanning(true);
    try {
      const res = await fetch("/api/labmanual/path", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subjectId: selectedSubjectId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Could not plan the path");

      const path = data.path as LearningPath;
      setWarnings(data.warnings ?? []);
      setDoc((d) => ({
        ...d,
        path,
        practicalStates: Object.fromEntries(
          practicals.map((p) => [
            p.practicalNo,
            d.practicalStates[p.practicalNo] ?? {
              reviewed: false,
              difficulty: "standard" as Difficulty,
            },
          ]),
        ),
      }));
      setView("path");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not plan the path");
    } finally {
      setPlanning(false);
    }
  }

  // ── Generation ───────────────────────────────────────────────────────────
  const generate = useCallback(
    async (practicalNos: number[]) => {
      if (!selectedSubjectId || practicalNos.length === 0) return;

      const titleOf = (n: number) =>
        practicals.find((p) => p.practicalNo === n)?.title ?? `Practical #${n}`;

      setGenItems(
        practicalNos.map((n) => ({
          practicalNo: n,
          title: titleOf(n),
          status: "pending",
        })),
      );
      setGenerating(true);
      setView("generating");

      const collected: PracticalManualSection[] = [];
      const collectedWarnings: LabManualWarning[] = [];
      const d = docRef.current;

      // One request per chunk of ≤4 (the route's cap), sequentially — the
      // checklist flips per RESOLVED request, so progress is real.
      for (const chunk of chunkForRequest(practicalNos)) {
        setGenItems((items) =>
          items.map((i) =>
            chunk.includes(i.practicalNo) ? { ...i, status: "running" } : i,
          ),
        );
        try {
          const res = await fetch("/api/labmanual/generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              subjectId: selectedSubjectId,
              practicalNos: chunk,
              language: d.language,
              difficulties: Object.fromEntries(
                chunk.map((n) => [n, stateFor(d, n).difficulty]),
              ),
              instructions: Object.fromEntries(
                chunk
                  .map((n) => {
                    const own = stateFor(d, n).customInstruction?.trim();
                    const combined = [globalInstruction.trim(), own]
                      .filter(Boolean)
                      .join("\n");
                    return [n, combined];
                  })
                  .filter(([, v]) => v),
              ),
            }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data?.error ?? "Generation failed");

          const sections = (data.sections ?? []) as PracticalManualSection[];
          const fromCache = (data.perPracticalFromCache ?? {}) as Record<
            number,
            boolean
          >;
          const failed = (data.failed ?? []) as number[];

          collected.push(...sections);
          collectedWarnings.push(...((data.warnings ?? []) as LabManualWarning[]));

          setGenItems((items) =>
            items.map((i) => {
              if (!chunk.includes(i.practicalNo)) return i;
              if (failed.includes(i.practicalNo)) return { ...i, status: "failed" };
              if (!sections.some((s) => s.practicalNo === i.practicalNo)) {
                return { ...i, status: "failed" };
              }
              return {
                ...i,
                status: fromCache[i.practicalNo] ? "cached" : "done",
              };
            }),
          );
        } catch (err) {
          toast.error(
            err instanceof Error ? err.message : "A batch failed to generate",
          );
          setGenItems((items) =>
            items.map((i) =>
              chunk.includes(i.practicalNo) ? { ...i, status: "failed" } : i,
            ),
          );
        }
      }

      // Merge: newly generated sections replace their previous version.
      setDoc((prev) => {
        const bySection = new Map(prev.sections.map((s) => [s.practicalNo, s]));
        for (const s of collected) bySection.set(s.practicalNo, s);
        return {
          ...prev,
          sections: [...bySection.values()].sort(
            (a, b) => a.practicalNo - b.practicalNo,
          ),
          practicalStates: {
            ...prev.practicalStates,
            // Freshly generated content is by definition unreviewed.
            ...Object.fromEntries(
              collected.map((s) => [
                s.practicalNo,
                { ...stateFor(prev, s.practicalNo), reviewed: false },
              ]),
            ),
          },
        };
      });
      setWarnings((w) => {
        const touched = new Set(collected.map((s) => s.practicalNo));
        return [
          ...w.filter((x) => x.practicalNo === null || !touched.has(x.practicalNo)),
          ...collectedWarnings,
        ];
      });

      setGenerating(false);
      if (collected.length > 0) setView("review");
      else setView("path");
    },
    [selectedSubjectId, practicals, globalInstruction],
  );

  // ── Single-practical regen ───────────────────────────────────────────────
  async function regenerate(
    practicalNo: number,
    difficulty: Difficulty,
    instruction?: string,
  ) {
    if (!selectedSubjectId) return;
    setRegenSet((s) => new Set(s).add(practicalNo));
    try {
      const res = await fetch("/api/labmanual/regenerate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subjectId: selectedSubjectId,
          practicalNo,
          difficulty,
          instruction,
          language: doc.language,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Regeneration failed");

      const section = data.section as PracticalManualSection;
      const newWarnings = (data.warnings ?? []) as LabManualWarning[];

      setDoc((d) => ({
        ...d,
        sections: d.sections.map((s) =>
          s.practicalNo === practicalNo ? section : s,
        ),
        practicalStates: {
          ...d.practicalStates,
          [practicalNo]: {
            ...stateFor(d, practicalNo),
            difficulty,
            reviewed: false,
          },
        },
      }));
      setWarnings((w) => [
        ...w.filter((x) => x.practicalNo !== practicalNo),
        ...newWarnings,
      ]);
      toast.success(`Practical ${practicalNo} regenerated`);
    } catch (err) {
      // The previous version stays put — the route guarantees this.
      toast.error(
        err instanceof Error ? err.message : "Could not regenerate — kept the old version",
      );
    } finally {
      setRegenSet((s) => {
        const next = new Set(s);
        next.delete(practicalNo);
        return next;
      });
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────
  if (view === "generating") {
    return (
      <div className="p-4 md:p-6">
        <GeneratingStage items={genItems} />
      </div>
    );
  }

  if (view === "path" && doc.path) {
    return (
      <div className="p-4 md:p-6">
        <PathStage
          path={doc.path}
          practicals={practicals}
          warnings={warnings}
          practicalStates={doc.practicalStates}
          onPathChange={(path) => setDoc((d) => ({ ...d, path }))}
          onStateChange={updateState}
          onBack={() => setView("setup")}
          onApprove={() => {
            setDoc((d) => ({
              ...d,
              path: d.path
                ? {
                    ...d.path,
                    // Empty units carry no teaching meaning — drop on approve (§7).
                    units: d.path.units
                      .filter((u) => u.practicalNos.length > 0)
                      .map((u, i) => ({ ...u, unitNo: i + 1 })),
                    approved: true,
                  }
                : null,
            }));
            toast.success("Path approved — you can generate now");
          }}
          onGenerateAll={() =>
            void generate((doc.path?.units ?? []).flatMap((u) => u.practicalNos))
          }
          onGenerateUnit={(unitNo) =>
            void generate(
              doc.path?.units.find((u) => u.unitNo === unitNo)?.practicalNos ?? [],
            )
          }
          generating={generating}
        />
      </div>
    );
  }

  if (view === "review") {
    return (
      <div className="p-4 md:p-6">
        <ReviewStage
          doc={doc}
          warnings={warnings}
          regenSet={regenSet}
          onSectionChange={updateSection}
          onStateChange={updateState}
          onRegenerate={regenerate}
          onBackToPath={() => setView("path")}
          saving={saving}
        />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6">
      <SetupStage
        subjects={subjects}
        isLoadingSubjects={isLoadingSubjects}
        selectedSubjectId={selectedSubjectId}
        onSelectSubject={setSelectedSubjectId}
        practicals={practicals}
        loadingData={loadingData}
        language={doc.language}
        onLanguageChange={(language) => setDoc((d) => ({ ...d, language }))}
        globalInstruction={globalInstruction}
        onGlobalInstructionChange={setGlobalInstruction}
        onPlanPath={() => void planPath()}
        planning={planning}
      />
    </div>
  );
}
