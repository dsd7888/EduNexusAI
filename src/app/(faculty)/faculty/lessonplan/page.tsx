"use client";

/**
 * Faculty Lesson-Plan / Course-File builder. Three-view state machine
 * (setup → generating → review), mirroring the Q-paper builder. Owns the
 * LessonPlanDoc, subject/module/CO fetching, per-section generation, per-session
 * regeneration, and debounced autosave (PUT) of the whole document.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { createBrowserClient } from "@/lib/db/supabase-browser";
import { useFacultySubjects, type SubjectRow } from "@/hooks/useSupabaseData";
import { SetupStage, type CacheFlag } from "./_components/SetupStage";
import { GeneratingStage } from "./_components/GeneratingStage";
import { ReviewStage } from "./_components/ReviewStage";
import {
  emptyDoc,
  parseBtlLevels,
  renumberTheory,
  theoryModuleStateKey,
  PRACTICALS_STATE_KEY,
  type SectionTab,
  type UiModule,
  type UiCourseOutcome,
  type UiPractical,
  type LessonPlanDoc,
  type LessonPlanWarning,
  type TheorySession,
  type PracticalSession,
} from "./_components/shared";

type View = "setup" | "generating" | "review";

const LAST_SUBJECT_KEY = "lessonplan:lastSubjectId";

export default function LessonPlanPage() {
  const { subjects, isLoading: isLoadingSubjects } = useFacultySubjects();

  const [view, setView] = useState<View>("setup");
  const [selectedSubjectId, setSelectedSubjectId] = useState("");
  const [loadingData, setLoadingData] = useState(false);

  const [modules, setModules] = useState<UiModule[]>([]);
  const [practicals, setPracticals] = useState<UiPractical[]>([]);
  const [courseOutcomes, setCourseOutcomes] = useState<UiCourseOutcome[]>([]);

  const [doc, setDoc] = useState<LessonPlanDoc>(emptyDoc());
  const [hoursOverride, setHoursOverride] = useState<Record<number, number>>({});
  const [moduleInstructions, setModuleInstructions] = useState<
    Record<number, string>
  >({});
  const [tab, setTab] = useState<SectionTab>("theory");
  const [cache, setCache] = useState<{
    theory: CacheFlag | null;
    practical: CacheFlag | null;
  }>({ theory: null, practical: null });

  const [warnings, setWarnings] = useState<LessonPlanWarning[]>([]);
  const [generating, setGenerating] = useState(false);
  const [genItems, setGenItems] = useState<string[]>([]);
  const [genDone, setGenDone] = useState(false);
  const [regenSet, setRegenSet] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  const [saving, setSaving] = useState(false);

  const lastSavedRef = useRef<string>("");

  const selectedSubject: SubjectRow | undefined = useMemo(
    () => subjects.find((s) => s.id === selectedSubjectId),
    [subjects, selectedSubjectId],
  );
  const subjectLabel = selectedSubject
    ? `${selectedSubject.code} — ${selectedSubject.name}`
    : "Lesson Plan";

  // Restore last subject on mount.
  useEffect(() => {
    const saved =
      typeof window !== "undefined"
        ? localStorage.getItem(LAST_SUBJECT_KEY)
        : null;
    if (saved) setSelectedSubjectId(saved);
  }, []);

  // ── Fetch subject data + existing plan/cache when subject changes ──
  useEffect(() => {
    if (!selectedSubjectId) return;
    let cancelled = false;
    setLoadingData(true);
    setView("setup");
    setDoc(emptyDoc());
    setWarnings([]);
    setHoursOverride({});
    setModuleInstructions({});
    setCache({ theory: null, practical: null });
    lastSavedRef.current = "";
    if (typeof window !== "undefined")
      localStorage.setItem(LAST_SUBJECT_KEY, selectedSubjectId);

    (async () => {
      try {
        const supabase = createBrowserClient();

        const [modRes, coRes, contentRes] = await Promise.all([
          supabase
            .from("modules")
            .select("id, module_number, name, description, hours, weightage_percent, btl_levels")
            .eq("subject_id", selectedSubjectId)
            .order("module_number"),
          supabase
            .from("course_outcomes")
            .select("co_code, description")
            .eq("subject_id", selectedSubjectId),
          supabase
            .from("subject_content")
            .select("practicals")
            .eq("subject_id", selectedSubjectId)
            .maybeSingle(),
        ]);
        if (cancelled) return;

        const modRows = (modRes.data ?? []) as Array<{
          id: string;
          module_number: number;
          name: string;
          description: string | null;
          hours: number | null;
          weightage_percent: number | null;
          btl_levels: string[] | null;
        }>;

        const moduleIds = modRows.map((m) => m.id);
        const { data: mcoRows } = moduleIds.length
          ? await supabase
              .from("module_co_mapping")
              .select("module_id, co_code")
              .in("module_id", moduleIds)
          : { data: [] as { module_id: string; co_code: string }[] };
        if (cancelled) return;

        const coByModule = new Map<string, string[]>();
        for (const r of (mcoRows ?? []) as {
          module_id: string;
          co_code: string;
        }[]) {
          const list = coByModule.get(r.module_id) ?? [];
          list.push(r.co_code);
          coByModule.set(r.module_id, list);
        }

        const uiModules: UiModule[] = modRows.map((m) => ({
          id: m.id,
          module_number: m.module_number,
          name: m.name,
          description: m.description ?? "",
          hours: m.hours,
          weightage_percent: m.weightage_percent,
          btl_levels: parseBtlLevels(m.btl_levels),
          coCodes: coByModule.get(m.id) ?? [],
        }));
        setModules(uiModules);

        setCourseOutcomes(
          (coRes.data ?? []) as UiCourseOutcome[],
        );

        const pracRaw = (contentRes.data as { practicals?: unknown } | null)
          ?.practicals;
        const uiPracticals: UiPractical[] = Array.isArray(pracRaw)
          ? (pracRaw as Array<{ sr_no?: number; name?: string; hours?: number }>)
              .filter((p) => p && typeof p.name === "string")
              .map((p, i) => ({
                sr_no: typeof p.sr_no === "number" ? p.sr_no : i + 1,
                name: String(p.name).trim(),
                hours: typeof p.hours === "number" ? p.hours : null,
              }))
          : [];
        setPracticals(uiPracticals);

        // Existing plan + cache flags
        const res = await fetch(
          `/api/lessonplan?subjectId=${encodeURIComponent(selectedSubjectId)}`,
        );
        if (cancelled) return;
        if (res.ok) {
          const j = (await res.json()) as {
            plan: { plan: LessonPlanDoc } | null;
            cache: { theory: CacheFlag | null; practical: CacheFlag | null };
          };
          setCache(j.cache ?? { theory: null, practical: null });
          if (j.plan?.plan && typeof j.plan.plan === "object") {
            const loaded = normalizeDoc(j.plan.plan);
            setDoc(loaded);
            lastSavedRef.current = JSON.stringify(loaded);
            if (loaded.theory.length > 0 || loaded.practicals.length > 0) {
              setTab(loaded.theory.length > 0 ? "theory" : "practical");
              setView("review");
            }
          }
        }
      } catch (err) {
        if (!cancelled)
          toast.error(
            err instanceof Error ? err.message : "Failed to load subject data",
          );
      } finally {
        if (!cancelled) setLoadingData(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedSubjectId]);

  // ── Debounced autosave (review only, on genuine user changes) ──
  useEffect(() => {
    if (view !== "review" || !selectedSubjectId) return;
    const serial = JSON.stringify(doc);
    if (serial === lastSavedRef.current) return;
    setSaving(true);
    const id = setTimeout(async () => {
      try {
        const res = await fetch("/api/lessonplan", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ subjectId: selectedSubjectId, plan: doc }),
        });
        if (res.ok) lastSavedRef.current = serial;
        else toast.error("Autosave failed");
      } catch {
        toast.error("Autosave failed");
      } finally {
        setSaving(false);
      }
    }, 1500);
    return () => clearTimeout(id);
  }, [doc, view, selectedSubjectId]);

  const saveNow = useCallback(async () => {
    if (!selectedSubjectId) return;
    const serial = JSON.stringify(doc);
    if (serial === lastSavedRef.current) return;
    setSaving(true);
    try {
      const res = await fetch("/api/lessonplan", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ subjectId: selectedSubjectId, plan: doc }),
      });
      if (res.ok) lastSavedRef.current = serial;
    } finally {
      setSaving(false);
    }
  }, [doc, selectedSubjectId]);

  // ── Generation ──
  const handleGenerate = useCallback(
    async (fresh: boolean) => {
      if (!selectedSubjectId || generating) return;
      const section = tab;
      const items =
        section === "theory"
          ? modules.map((m) => `Module ${m.module_number}: ${m.name}`)
          : ["Practicals"];
      setGenItems(items);
      setGenDone(false);
      setGenerating(true);
      setView("generating");

      try {
        const res = await fetch("/api/lessonplan/generate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            subjectId: selectedSubjectId,
            section,
            force: fresh,
            ...(section === "theory"
              ? { hoursOverride, moduleInstructions }
              : {}),
          }),
        });
        const j = (await res.json()) as {
          fromCache?: boolean;
          payload?: {
            sessions?: TheorySession[];
            practicals?: PracticalSession[];
            warnings?: LessonPlanWarning[];
          };
          error?: string;
          generatedAt?: string;
        };
        if (!res.ok || !j.payload) {
          throw new Error(j.error ?? "Generation failed");
        }
        setGenDone(true);

        const payloadWarnings = j.payload.warnings ?? [];

        setDoc((prev) => {
          const next: LessonPlanDoc = { ...prev, moduleStates: { ...prev.moduleStates } };
          if (section === "theory") {
            next.theory = j.payload!.sessions ?? [];
            next.hoursOverride =
              Object.keys(hoursOverride).length > 0 ? { ...hoursOverride } : null;
            // (re)initialise review flags for the generated modules
            const moduleNumbers = [
              ...new Set((j.payload!.sessions ?? []).map((s) => s.moduleNumber)),
            ];
            for (const mn of moduleNumbers) {
              next.moduleStates[theoryModuleStateKey(mn)] = { reviewed: false };
            }
          } else {
            next.practicals = j.payload!.practicals ?? [];
            if ((j.payload!.practicals ?? []).length > 0) {
              next.moduleStates[PRACTICALS_STATE_KEY] = { reviewed: false };
            }
          }
          return next;
        });

        // reset just this section's warnings, keep the other section's
        setWarnings((prev) =>
          section === "theory"
            ? [...prev.filter((w) => w.moduleNumber === null), ...payloadWarnings]
            : [...prev.filter((w) => w.moduleNumber !== null), ...payloadWarnings],
        );

        if (j.fromCache) {
          toast.success("Loaded a previously generated plan.");
        }

        // brief pause so the checklist's completion is visible
        setTimeout(() => {
          setTab(section);
          setView("review");
          setGenerating(false);
        }, 400);
      } catch (err) {
        setGenerating(false);
        setView("setup");
        toast.error(err instanceof Error ? err.message : "Generation failed");
      }
    },
    [selectedSubjectId, generating, tab, modules, hoursOverride, moduleInstructions],
  );

  // ── Review edit handlers ──
  const moduleOrder = useMemo(
    () => [...modules].sort((a, b) => a.module_number - b.module_number).map((m) => m.module_number),
    [modules],
  );

  const handleSessionChange = useCallback((s: TheorySession) => {
    setDoc((prev) => ({
      ...prev,
      theory: prev.theory.map((x) => (x.sessionNo === s.sessionNo ? s : x)),
    }));
  }, []);

  const handleSessionsReorder = useCallback(
    (moduleNumber: number, orderedSessionNos: number[]) => {
      setDoc((prev) => {
        // rebuild this module's sessions in the new order, keep others as-is
        const order = new Map(orderedSessionNos.map((no, i) => [no, i]));
        const moduleSessions = prev.theory
          .filter((s) => s.moduleNumber === moduleNumber)
          .sort((a, b) => (order.get(a.sessionNo) ?? 0) - (order.get(b.sessionNo) ?? 0));
        const others = prev.theory.filter((s) => s.moduleNumber !== moduleNumber);
        const merged = [...others, ...moduleSessions];
        return { ...prev, theory: renumberTheory(merged, moduleOrder) };
      });
    },
    [moduleOrder],
  );

  const handlePracticalChange = useCallback((p: PracticalSession) => {
    setDoc((prev) => ({
      ...prev,
      practicals: prev.practicals.map((x) =>
        x.practicalNo === p.practicalNo ? p : x,
      ),
    }));
  }, []);

  const handleToggleReviewed = useCallback((key: string, reviewed: boolean) => {
    setDoc((prev) => ({
      ...prev,
      moduleStates: {
        ...prev.moduleStates,
        [key]: { ...prev.moduleStates[key], reviewed },
      },
    }));
  }, []);

  const handleInsertUncoveredTopic = useCallback(
    (w: LessonPlanWarning) => {
      if (w.moduleNumber == null || !w.fragment) return;
      const fragment = w.fragment;
      let inserted = false;
      setDoc((prev) => {
        const theory = prev.theory.map((s) => {
          if (
            !inserted &&
            s.moduleNumber === w.moduleNumber &&
            s.topics.length < 3 &&
            !s.topics.includes(fragment)
          ) {
            inserted = true;
            return { ...s, topics: [...s.topics, fragment] };
          }
          return s;
        });
        return { ...prev, theory };
      });
      // dismiss (or warn) after the state update settles
      setTimeout(() => {
        if (inserted) {
          setWarnings((prev) => prev.filter((x) => x !== w));
          toast.success(`Added "${fragment}"`);
        } else {
          toast.error(
            "No session in this module has room (max 3 topics) — remove one first.",
          );
        }
      }, 0);
    },
    [],
  );

  // ── Regeneration ──
  const withRegenLock = useCallback(
    async (key: string, fn: () => Promise<void>) => {
      setRegenSet((prev) => new Set(prev).add(key));
      try {
        await fn();
      } finally {
        setRegenSet((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }
    },
    [],
  );

  const handleRegenerateSession = useCallback(
    (session: TheorySession, instruction: string) => {
      const key = `s-${session.sessionNo}`;
      void withRegenLock(key, async () => {
        try {
          const siblingTopics = doc.theory
            .filter(
              (s) =>
                s.moduleNumber === session.moduleNumber &&
                s.sessionNo !== session.sessionNo,
            )
            .flatMap((s) => s.topics);
          const res = await fetch("/api/lessonplan/regenerate", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              subjectId: selectedSubjectId,
              section: "theory",
              moduleNumber: session.moduleNumber,
              sessionNo: session.sessionNo,
              siblingTopics,
              current: {
                topics: session.topics,
                objective: session.objective,
                method: session.method,
              },
              instruction: instruction || undefined,
            }),
          });
          const j = (await res.json()) as {
            session?: TheorySession;
            error?: string;
          };
          if (!res.ok || !j.session) throw new Error(j.error ?? "Regeneration failed");
          const regenerated = { ...j.session, sessionNo: session.sessionNo, moduleNumber: session.moduleNumber };
          setDoc((prev) => ({
            ...prev,
            theory: prev.theory.map((x) =>
              x.sessionNo === session.sessionNo ? regenerated : x,
            ),
          }));
          toast.success(`Session ${session.sessionNo} regenerated`);
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Regeneration failed");
        }
      });
    },
    [doc.theory, selectedSubjectId, withRegenLock],
  );

  const handleRegeneratePractical = useCallback(
    (practical: PracticalSession, instruction: string) => {
      const key = `p-${practical.practicalNo}`;
      void withRegenLock(key, async () => {
        try {
          const res = await fetch("/api/lessonplan/regenerate", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              subjectId: selectedSubjectId,
              section: "practical",
              practicalNo: practical.practicalNo,
              title: practical.title,
              hours: practical.hours,
              instruction: instruction || undefined,
            }),
          });
          const j = (await res.json()) as {
            practical?: PracticalSession;
            error?: string;
          };
          if (!res.ok || !j.practical)
            throw new Error(j.error ?? "Regeneration failed");
          const regenerated = {
            ...j.practical,
            practicalNo: practical.practicalNo,
            title: practical.title,
            hours: practical.hours,
          };
          setDoc((prev) => ({
            ...prev,
            practicals: prev.practicals.map((x) =>
              x.practicalNo === practical.practicalNo ? regenerated : x,
            ),
          }));
          toast.success(`Practical ${practical.practicalNo} regenerated`);
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Regeneration failed");
        }
      });
    },
    [selectedSubjectId, withRegenLock],
  );

  // ── Export ──
  const handleExport = useCallback(
    async (format: "docx" | "pdf") => {
      if (!selectedSubjectId || exporting) return;
      setExporting(true);
      try {
        await saveNow(); // persist latest edits before the server builds
        const res = await fetch("/api/lessonplan/export", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ subjectId: selectedSubjectId, format }),
        });
        if (res.status === 422) {
          const j = (await res.json()) as { unreviewed?: string[] };
          toast.error(
            `Review all sections first: ${(j.unreviewed ?? []).join(", ")}`,
          );
          return;
        }
        if (res.status === 501) {
          toast.info("Export builder ships in the next step.");
          return;
        }
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(j.error ?? "Export failed");
        }
        const j = (await res.json()) as { url?: string };
        if (j.url) window.open(j.url, "_blank");
        else toast.success("Exported.");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Export failed");
      } finally {
        setExporting(false);
      }
    },
    [selectedSubjectId, exporting, saveNow],
  );

  const hasTheory = doc.theory.length > 0;
  const hasPractical = doc.practicals.length > 0;

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-4">
        <h1 className="text-lg font-semibold">Lesson Plans</h1>
        <p className="text-sm text-muted-foreground">
          Generate the session-wise course-file lesson plan, review every session,
          and export Word / PDF.
        </p>
      </div>

      {view === "generating" ? (
        <GeneratingStage
          subjectLabel={subjectLabel}
          sectionLabel={tab === "theory" ? "Theory" : "Practical"}
          items={genItems}
          done={genDone}
        />
      ) : view === "review" ? (
        <ReviewStage
          subjectLabel={subjectLabel}
          tab={tab}
          onTabChange={setTab}
          hasTheory={hasTheory}
          hasPractical={hasPractical}
          doc={doc}
          modules={modules}
          courseOutcomes={courseOutcomes}
          warnings={warnings}
          regenSet={regenSet}
          onSessionChange={handleSessionChange}
          onSessionsReorder={handleSessionsReorder}
          onRegenerateSession={handleRegenerateSession}
          onInsertUncoveredTopic={handleInsertUncoveredTopic}
          onPracticalChange={handlePracticalChange}
          onRegeneratePractical={handleRegeneratePractical}
          onToggleReviewed={handleToggleReviewed}
          onExport={handleExport}
          exporting={exporting}
          saving={saving}
          onBackToSetup={() => setView("setup")}
        />
      ) : (
        <SetupStage
          subjects={subjects}
          isLoadingSubjects={isLoadingSubjects}
          selectedSubjectId={selectedSubjectId}
          onSelectSubject={setSelectedSubjectId}
          loadingData={loadingData}
          modules={modules}
          practicals={practicals}
          tab={tab}
          onTabChange={setTab}
          hoursOverride={hoursOverride}
          onHoursChange={(mn, h) =>
            setHoursOverride((prev) => ({ ...prev, [mn]: h }))
          }
          moduleInstructions={moduleInstructions}
          onInstructionChange={(mn, text) =>
            setModuleInstructions((prev) => ({ ...prev, [mn]: text }))
          }
          cache={cache}
          onGenerate={handleGenerate}
          generating={generating}
        />
      )}

      {/* When a plan already exists, still allow jumping into review from setup */}
      {view === "setup" && (hasTheory || hasPractical) && !loadingData && (
        <div className="mt-4 max-w-5xl">
          <button
            type="button"
            onClick={() => setView("review")}
            className="text-sm text-primary hover:underline"
          >
            ← Back to your saved plan
          </button>
        </div>
      )}
    </div>
  );
}

/** Coerce a persisted plan jsonb into a well-formed LessonPlanDoc. */
function normalizeDoc(raw: unknown): LessonPlanDoc {
  const base = emptyDoc();
  if (!raw || typeof raw !== "object") return base;
  const r = raw as Partial<LessonPlanDoc>;
  return {
    theory: Array.isArray(r.theory) ? r.theory : [],
    practicals: Array.isArray(r.practicals) ? r.practicals : [],
    moduleStates:
      r.moduleStates && typeof r.moduleStates === "object" ? r.moduleStates : {},
    hoursOverride:
      r.hoursOverride && typeof r.hoursOverride === "object"
        ? r.hoursOverride
        : null,
  };
}
