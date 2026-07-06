"use client";

/**
 * Faculty Q-paper builder. Owns the shared builder state (subject, modules,
 * paper metadata, section/question structure, sourcing options, and the
 * generated paper + its download URLs) and the generate flow, then composes
 * the stage components under ./_components.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, FileText, History } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { createBrowserClient } from "@/lib/db/supabase-browser";
import { useFacultySubjects } from "@/hooks/useSupabaseData";
import { toast } from "sonner";
import {
  STAGING_KEY,
  type StagedQuestion,
} from "../qbank/_components/shared";
import {
  buildTemplatePayload,
  defaultBtlRange,
  defaultDifficultyTargets,
  defaultMetadata,
  defaultSourcingMix,
  eseMetadata,
  eseStandardSections,
  fromTemplateStructure,
  newQuestion,
  paperTotal,
  quizMetadata,
  quizSection,
  sourcingMixToApi,
  sourcingMixTotal,
  uid,
  type AssembledPaper,
  type BuilderSection,
  type CourseOutcomeRef,
  type ModuleRow,
  type PaperMetadata,
  type SourcingMixState,
} from "./_components/shared";
import type { PaperTemplateRow } from "@/lib/qpaper/templates";
import { useQpaperDraft, type BuilderSnapshot } from "./_components/useQpaperDraft";
import { SetupPanel } from "./_components/SetupPanel";
import { BuilderView } from "./_components/BuilderView";
import { GeneratingView } from "./_components/GeneratingView";
import { DoneView } from "./_components/DoneView";

/**
 * Recover the Storage object path from a public `generated-content` URL, so a
 * paper resumed from a draft (which restores only the public PDF URL, not the
 * path) can still be recorded in history with a re-signable path.
 */
function pathFromPublicUrl(url: string | null): string | null {
  if (!url) return null;
  const marker = "/generated-content/";
  const i = url.indexOf(marker);
  if (i === -1) return null;
  return url.slice(i + marker.length).split("?")[0];
}

// Single source of truth for which phase the page is in. Mirrors the PPT
// generator's view machine (src/app/(faculty)/faculty/generate/page.tsx):
//   form       → two-column setup + builder
//   generating → full-page takeover, no sidebar
//   done       → full-width review + export, no sidebar
type View = "form" | "generating" | "done";

// Remembers the faculty's last-picked subject across refreshes. The
// autosave/resume draft flow deliberately excludes subject from its
// "meaningful" check (subject is auto-populated), so a plain refresh with a
// pristine builder never surfaces a resume prompt — the subject choice needs
// its own persistence independent of that.
const LAST_SUBJECT_KEY = "qpaper:lastSubjectId";

export default function QpaperPage() {
  const { subjects, isLoading: isLoadingSubjects } = useFacultySubjects();
  const [selectedSubjectId, setSelectedSubjectId] = useState("");

  const [modules, setModules] = useState<ModuleRow[]>([]);
  const [selectedModuleIds, setSelectedModuleIds] = useState<string[]>([]);

  const [meta, setMeta] = useState<PaperMetadata>(defaultMetadata());
  const [metaOpen, setMetaOpen] = useState(false);

  const [sections, setSections] = useState<BuilderSection[]>(
    eseStandardSections()
  );
  const [flatLayout, setFlatLayout] = useState(false);
  const [targetMarks, setTargetMarks] = useState<number>(60);
  const [sourcingMix, setSourcingMix] = useState<SourcingMixState>(
    defaultSourcingMix()
  );
  const [btlRange, setBtlRange] = useState<[number, number]>(defaultBtlRange());
  // CO targets: CO code → percentage of total marks (0-100 each, should sum to 100).
  const [coTargetsPct, setCoTargetsPct] = useState<Record<string, number>>({});
  // Difficulty: easy/medium/hard as % of total marks (should sum to 100).
  const [difficultyTargets, setDifficultyTargets] = useState<{
    easy: number;
    medium: number;
    hard: number;
  }>(defaultDifficultyTargets());
  // Course outcomes for the selected subject — feeds the CO% picker.
  const [courseOutcomes, setCourseOutcomes] = useState<CourseOutcomeRef[]>([]);
  // module_number → CO codes it supports — feeds the CO-coverage preview.
  const [moduleCoMap, setModuleCoMap] = useState<Map<number, string[]>>(
    new Map()
  );
  // IDs guaranteed-included from the Q Bank (set when arriving via staging).
  const [preferredBankQuestionIds, setPreferredBankQuestionIds] = useState<
    string[]
  >([]);
  // null = unknown/checking; number = verified bank questions for the subject.
  const [verifiedBankCount, setVerifiedBankCount] = useState<number | null>(
    null
  );
  // From the last generation response — drives the non-blocking fallback note.
  const [bankFallbackCount, setBankFallbackCount] = useState(0);
  const [unplaceablePreferred, setUnplaceablePreferred] = useState<
    Array<{ id: string; question_text: string }>
  >([]);
  // Section-generation warnings from the last generation (e.g. a pool block
  // where the AI returned fewer items than the template requested).
  const [generationWarnings, setGenerationWarnings] = useState<string[]>([]);

  const [paper, setPaper] = useState<AssembledPaper | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [answerKeyUrl, setAnswerKeyUrl] = useState<string | null>(null);
  // Per-section answer-key warnings from the last key generation (e.g. a block
  // that failed to parse). Drives the non-blocking note below, alongside the
  // bank-fallback / unplaceable-preferred notes.
  const [answerKeyWarnings, setAnswerKeyWarnings] = useState<string[]>([]);
  // Set on every post-generation mutation; drives the Done view's Regenerate
  // confirm-before-discard prompt. Reset to false at the start of each generation.
  const [paperEditedSinceGeneration, setPaperEditedSinceGeneration] = useState(false);
  // Wraps setPaper for ReviewAndValidateStage: any post-generation mutation
  // (inline edit, tag relabel, per-question regen) invalidates the answer key.
  const setPaperAndClearKey = useCallback(
    (value: React.SetStateAction<AssembledPaper | null>) => {
      setPaper(value);
      setAnswerKeyUrl(null);
      setAnswerKeyWarnings([]);
      setPaperEditedSinceGeneration(true);
    },
    []
  );
  // Storage paths for the artifacts (stable; URLs above expire). Captured as
  // each artifact is produced so the finalize event can persist them to
  // qpaper_history for later re-downloads.
  const [pdfPath, setPdfPath] = useState<string | null>(null);
  const [docxPath, setDocxPath] = useState<string | null>(null);
  const [answerKeyPath, setAnswerKeyPath] = useState<string | null>(null);
  // View state machine. `isGenerating` stays as a derived alias so the existing
  // effects and child-component props (which think in terms of a generating
  // boolean) don't have to change.
  const [view, setView] = useState<View>("form");
  const isGenerating = view === "generating";
  const [progressMsg, setProgressMsg] = useState("");

  // Whether this page load came from a Q Bank staging hand-off. Read once on
  // first render (before the staging effect clears the key) so the draft hook
  // can skip the "resume?" prompt when the user arrived with explicit intent.
  const [cameFromStaging] = useState(
    () =>
      typeof window !== "undefined" &&
      !!sessionStorage.getItem(STAGING_KEY)
  );

  // A `?resumeHistory=<rowId>` deep-link (from the Past Papers page) reopens a
  // finalized paper into the full review/edit UI. Captured on first render for
  // the common client-nav case (Link click) so the draft hook is disabled from
  // the very first render, before it can prompt.
  const [historyResumeId, setHistoryResumeId] = useState<string | null>(() =>
    typeof window === "undefined"
      ? null
      : new URLSearchParams(window.location.search).get("resumeHistory")
  );
  // SSR/refresh safety net: on a hard refresh the initializer runs server-side
  // (no window → null) and React reuses that on hydration, dropping the param.
  // Re-read it on the client right after mount — this runs before the async
  // auth lookup resolves, so the draft hook is still disabled before its resume
  // detection can fire.
  useEffect(() => {
    if (historyResumeId) return;
    const id = new URLSearchParams(window.location.search).get("resumeHistory");
    if (id) setHistoryResumeId(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Hydration gate: @dnd-kit assigns aria IDs from a global counter
  // (DndDescribedBy-N) that drifts between SSR and client hydration. Also,
  // our builder state uses uid() (Math.random) for section/question IDs which
  // differ across server/client. Rendering nothing until mount eliminates
  // both mismatches in one go. Faculty page — no SEO concern.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  // ─── Q Bank staged-question hydration (runs once on mount) ──────────────
  // The Q Bank page stages a set of questions; instead of dumping them into a
  // flat section, we extract just their IDs as "guaranteed-included" preferred
  // questions and bias the mix toward the bank. Faculty still picks
  // modules/marks and hits Generate on the normal Scope/Sourcing flow.
  useEffect(() => {
    const raw = sessionStorage.getItem(STAGING_KEY);
    if (!raw) return;
    sessionStorage.removeItem(STAGING_KEY);
    try {
      const { subjectId, questions } = JSON.parse(raw) as {
        subjectId: string;
        questions: StagedQuestion[];
      };
      setSelectedSubjectId(subjectId);
      const ids = questions.map((q) => q.id).filter(Boolean);
      setPreferredBankQuestionIds(ids);
      setSourcingMix({ fresh: 60, pyq_style: 10, bank: 30 });
      toast.success(
        `${ids.length} question(s) from your Q Bank will be included`
      );
    } catch {
      // malformed sessionStorage data — ignore
    }
  }, []);

  const selectedSubject = subjects.find((s) => s.id === selectedSubjectId);

  // ─── Subject autoselect ─────────────────────────────────────────────────
  // Prefer the last subject the faculty explicitly picked (survives a
  // refresh); fall back to the first assigned subject only if there's no
  // remembered choice (or it's no longer in their assigned list).
  useEffect(() => {
    if (selectedSubjectId || subjects.length === 0) return;
    const remembered =
      typeof window !== "undefined"
        ? localStorage.getItem(LAST_SUBJECT_KEY)
        : null;
    if (remembered && subjects.some((s) => s.id === remembered)) {
      setSelectedSubjectId(remembered);
    } else {
      setSelectedSubjectId(subjects[0].id);
    }
  }, [subjects, selectedSubjectId]);

  // Persist every subject change (explicit pick, staging hand-off, or draft
  // resume) so the next refresh restores it.
  useEffect(() => {
    if (!selectedSubjectId) return;
    try {
      localStorage.setItem(LAST_SUBJECT_KEY, selectedSubjectId);
    } catch {
      // localStorage may be unavailable; selection still works this session.
    }
  }, [selectedSubjectId]);

  // Ref for the generated-paper review section — used to scroll to it on resume
  // when the snapshot already has content.
  const reviewRef = useRef<HTMLDivElement>(null);
  // Set to true by handleResume when the restored snapshot has a paper; cleared
  // once the scroll fires.
  const scrollToPaperRef = useRef(false);

  // Tracks the qpaper_history row id for the current paper session. Null = no
  // row written yet (first finalize will insert); non-null = row exists and
  // subsequent finalizes will update it with newly-available artifact paths.
  const historyRowIdRef = useRef<string | null>(null);
  // Fingerprint of the last snapshot written to the history row (history-resume
  // mode only), so the debounced autosave skips redundant writes.
  const lastHistorySaveRef = useRef<string | null>(null);

  // Module ids to honor on the next modules load instead of "select all" —
  // set by a draft restore so a resumed module subset survives the reload that
  // a subject change triggers. Consumed once, then cleared.
  const restoredModuleIdsRef = useRef<string[] | null>(null);

  // ─── Modules load (need section_number + weightage_percent) ─────────────
  useEffect(() => {
    if (!selectedSubjectId) {
      setModules([]);
      setSelectedModuleIds([]);
      return;
    }
    const supabase = createBrowserClient();
    supabase
      .from("modules")
      .select(
        "id, name, module_number, section_number, weightage_percent, btl_levels"
      )
      .eq("subject_id", selectedSubjectId)
      .order("module_number")
      .then(({ data }) => {
        const rows = (data ?? []) as ModuleRow[];
        setModules(rows);
        const restored = restoredModuleIdsRef.current;
        restoredModuleIdsRef.current = null;
        if (restored) {
          const valid = new Set(rows.map((m) => m.id));
          setSelectedModuleIds(restored.filter((id) => valid.has(id)));
        } else {
          setSelectedModuleIds(rows.map((m) => m.id));
        }
      });
  }, [selectedSubjectId]);

  // ─── Course outcomes load (feeds the CO% distribution picker) ───────────
  useEffect(() => {
    if (!selectedSubjectId) {
      setCourseOutcomes([]);
      return;
    }
    const supabase = createBrowserClient();
    supabase
      .from("course_outcomes")
      .select("co_code, description")
      .eq("subject_id", selectedSubjectId)
      .then(({ data, error }) => {
        if (error) console.error("[qpaper course_outcomes]", error);
        setCourseOutcomes((data ?? []) as CourseOutcomeRef[]);
      });
  }, [selectedSubjectId]);

  // ─── Module→CO mapping load (feeds the CO-coverage preview) ─────────────
  useEffect(() => {
    setModuleCoMap(new Map());
    if (!selectedSubjectId) return;
    let cancelled = false;
    const supabase = createBrowserClient();
    supabase
      .from("modules")
      .select("id, module_number")
      .eq("subject_id", selectedSubjectId)
      .then(async ({ data: subjectModules, error: modulesError }) => {
        if (cancelled) return;
        if (modulesError) {
          console.error("[qpaper module_co_mapping] modules", modulesError);
          return;
        }
        const rows = subjectModules ?? [];
        if (rows.length === 0) return;
        const idToNumber = new Map(rows.map((m) => [m.id, m.module_number]));
        const { data: mappings, error: mappingError } = await supabase
          .from("module_co_mapping")
          .select("module_id, co_code")
          .in("module_id", rows.map((m) => m.id));
        if (cancelled) return;
        if (mappingError) {
          console.error("[qpaper module_co_mapping]", mappingError);
          return;
        }
        const map = new Map<number, string[]>();
        for (const row of mappings ?? []) {
          const moduleNumber = idToNumber.get(row.module_id);
          if (moduleNumber == null) continue;
          const codes = map.get(moduleNumber) ?? [];
          codes.push(row.co_code);
          map.set(moduleNumber, codes);
        }
        setModuleCoMap(map);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedSubjectId]);

  // ─── Verified Q Bank availability for the selected subject ──────────────
  useEffect(() => {
    if (!selectedSubjectId) {
      setVerifiedBankCount(null);
      return;
    }
    let cancelled = false;
    setVerifiedBankCount(null);
    fetch(
      `/api/qbank/list?subject_id=${selectedSubjectId}&is_verified=true&per_page=1`
    )
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((data: { total?: number }) => {
        if (!cancelled) setVerifiedBankCount(data.total ?? 0);
      })
      .catch(() => {
        if (!cancelled) setVerifiedBankCount(0);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedSubjectId]);

  // If the chosen subject has no verified bank, move any bank% back to fresh so
  // the disabled Bank row can't leave an unsatisfiable allocation.
  useEffect(() => {
    if (verifiedBankCount === 0 && sourcingMix.bank > 0) {
      setSourcingMix((m) => ({ ...m, fresh: m.fresh + m.bank, bank: 0 }));
    }
  }, [verifiedBankCount, sourcingMix.bank]);

  // ─── Block navigation during generation ─────────────────────────────────
  // Copied from the PPT generator: a back-button press is swallowed (the
  // history entry is re-pushed) and a tab close/reload warns. Generation can't
  // be aborted mid-flight, so leaving would strand a half-finished request.
  useEffect(() => {
    if (!isGenerating) return;
    const handlePopState = (e: PopStateEvent) => {
      e.preventDefault();
      window.history.pushState(null, "", window.location.href);
    };
    window.history.pushState(null, "", window.location.href);
    window.addEventListener("popstate", handlePopState);
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "Question paper is being generated. Please wait.";
      return e.returnValue;
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("popstate", handlePopState);
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [isGenerating]);

  // ─── Live total ─────────────────────────────────────────────────────────
  const totalMarksLive = useMemo(() => paperTotal(sections), [sections]);

  // ─── Autosave / draft resume ─────────────────────────────────────────────
  // Memoized so the hook's autosave only fires on real value changes, not on
  // every render.
  const snapshot = useMemo<BuilderSnapshot>(
    () => ({
      selectedSubjectId,
      selectedModuleIds,
      meta,
      sections,
      flatLayout,
      targetMarks,
      sourcingMix,
      btlRange,
      coTargetsPct,
      difficultyTargets,
      preferredBankQuestionIds,
      paper,
      downloadUrl,
      answerKeyUrl,
    }),
    [
      selectedSubjectId,
      selectedModuleIds,
      meta,
      sections,
      flatLayout,
      targetMarks,
      sourcingMix,
      btlRange,
      coTargetsPct,
      difficultyTargets,
      preferredBankQuestionIds,
      paper,
      downloadUrl,
      answerKeyUrl,
    ]
  );

  const {
    resumeCandidate,
    lastSavedAt,
    resume,
    discard,
    markGenerating,
    markComplete,
    markFailed,
    clearDraft,
  } = useQpaperDraft(snapshot, {
    skipResume: cameFromStaging,
    // In history-resume mode the builder persists straight back to the
    // qpaper_history row (see the autosave effect below), so the draft system
    // must stay completely out of the way — no prompt, no phantom draft row.
    disabled: !!historyResumeId,
  });

  // Hydrate the whole builder from a resumed draft, defaulting any field a
  // stored snapshot might predate (including snapshots written before the paper
  // fields were added).
  const applySnapshot = useCallback((s: BuilderSnapshot) => {
    // Queue the restored module subset so the subject-change reload honors it
    // rather than reselecting every module.
    restoredModuleIdsRef.current = s.selectedModuleIds ?? [];
    setSelectedSubjectId(s.selectedSubjectId ?? "");
    setSelectedModuleIds(s.selectedModuleIds ?? []);
    setMeta(s.meta ?? defaultMetadata());
    setSections(s.sections ?? eseStandardSections());
    setFlatLayout(s.flatLayout ?? false);
    setTargetMarks(s.targetMarks ?? 60);
    setSourcingMix(s.sourcingMix ?? defaultSourcingMix());
    setBtlRange(s.btlRange ?? defaultBtlRange());
    setCoTargetsPct(s.coTargetsPct ?? {});
    setDifficultyTargets(s.difficultyTargets ?? defaultDifficultyTargets());
    setPreferredBankQuestionIds(s.preferredBankQuestionIds ?? []);
    // Restore generated output — null is fine; it just means builder view.
    setPaper(s.paper ?? null);
    setDownloadUrl(s.downloadUrl ?? null);
    setAnswerKeyUrl(s.answerKeyUrl ?? null);
  }, []);

  const handleResume = () => {
    const s = resume();
    if (s) {
      if (s.paper) scrollToPaperRef.current = true;
      // A resumed paper is a fresh working session — let it be recorded again
      // if finalized (its prior history row, if any, was written before).
      historyRowIdRef.current = null;
      applySnapshot(s);
      // A restored paper lands straight in the done view; otherwise back to the
      // builder to keep editing the setup.
      setView(s.paper ? "done" : "form");
      toast.success(s.paper ? "Draft restored — review your paper" : "Draft restored");
    }
  };

  // ─── Finalize: record a history row, then clear the autosave draft ───────
  // Wired into DoneView's onFinalized; fires on every download
  // (PDF button, Word export, and — via the answer-key setter — after key gen).
  //
  // First call in a session: inserts a new qpaper_history row with whatever
  // artifact paths are already available, captures the returned id.
  // Subsequent calls: updates that same row, patching in newly-available paths
  // without touching any path columns already set. clearDraft() is called every
  // time — deleting an already-deleted draft is a safe no-op.
  const handleFinalized = useCallback(
    async (patch?: { docxPath?: string | null }) => {
      if (paper) {
        const effectivePdfPath = pdfPath ?? pathFromPublicUrl(downloadUrl);
        // patch.docxPath carries the fresh path from the just-completed export
        // API call; docxPath state hasn't flushed yet in the same React tick.
        const effectiveDocxPath = patch?.docxPath ?? docxPath;

        try {
          const supabase = createBrowserClient();
          const {
            data: { user },
          } = await supabase.auth.getUser();
          if (user) {
            if (!historyRowIdRef.current) {
              // ── Insert ───────────────────────────────────────────────────
              const { data, error } = await supabase
                .from("qpaper_history")
                .insert({
                  faculty_id: user.id,
                  subject_id: selectedSubjectId || null,
                  label:
                    paper.paperTitle ||
                    meta.examTitle ||
                    selectedSubject?.name ||
                    "Question Paper",
                  total_marks: paper.totalMarks ?? totalMarksLive,
                  structure_summary: snapshot,
                  pdf_path: effectivePdfPath,
                  docx_path: effectiveDocxPath,
                  answer_key_path: answerKeyPath,
                })
                .select("id")
                .single();
              if (error) throw error;
              historyRowIdRef.current = data.id;
            } else {
              // ── Update: add newly-available paths, leave existing ones ──
              const updatePatch: Record<string, string> = {};
              if (effectivePdfPath) updatePatch.pdf_path = effectivePdfPath;
              if (effectiveDocxPath) updatePatch.docx_path = effectiveDocxPath;
              if (answerKeyPath) updatePatch.answer_key_path = answerKeyPath;
              if (Object.keys(updatePatch).length > 0) {
                const { error } = await supabase
                  .from("qpaper_history")
                  .update(updatePatch)
                  .eq("id", historyRowIdRef.current);
                if (error) throw error;
              }
            }
          }
        } catch (err) {
          // Non-fatal — history must never block a download. On insert failure
          // historyRowIdRef stays null so the next finalize retries the insert.
          console.error("[qpaper history] save failed", err);
        }
      }
      clearDraft();
    },
    [
      paper,
      pdfPath,
      downloadUrl,
      docxPath,
      answerKeyPath,
      selectedSubjectId,
      meta,
      selectedSubject,
      totalMarksLive,
      snapshot,
      clearDraft,
    ]
  );

  // ─── Resume a finalized paper from history (?resumeHistory=<rowId>) ───────
  // The full paper JSON already lives in qpaper_history.structure_summary (the
  // same BuilderSnapshot shape applySnapshot consumes), so reopening is pure
  // hydration — no separate fetch/rebuild path. We point historyRowIdRef at
  // this row so edits/answer-key writes UPDATE it in place instead of inserting
  // a duplicate, and we mint fresh artifact links from the stored paths (the
  // snapshot's own downloadUrl/answerKeyUrl may be expired signed URLs).
  useEffect(() => {
    if (!historyResumeId) return;
    let cancelled = false;
    const supabase = createBrowserClient();
    (async () => {
      const { data, error } = await supabase
        .from("qpaper_history")
        .select("id, structure_summary, pdf_path, docx_path, answer_key_path")
        .eq("id", historyResumeId)
        .maybeSingle();
      if (cancelled) return;
      if (error || !data) {
        toast.error("Couldn't open that paper");
        return;
      }
      const snap = (data.structure_summary ?? {}) as Partial<BuilderSnapshot>;
      if (!snap.paper) {
        // Papers finalized before the full snapshot was stored can only be
        // re-downloaded — surface that instead of a broken/empty editor.
        toast.info(
          "This paper was saved before in-place editing was available — re-download it from the history page."
        );
        return;
      }
      historyRowIdRef.current = data.id;
      scrollToPaperRef.current = true;
      applySnapshot(snap as BuilderSnapshot);
      // Restore the "edited since the PDF was built" flag so a paper edited in a
      // previous session (without re-exporting) still shows the stale-PDF
      // warning on reopen. Absent on originally-generated rows → false.
      const wasPdfDirty = Boolean(
        (snap as { pdfDirty?: boolean }).pdfDirty
      );
      setPaperEditedSinceGeneration(wasPdfDirty);
      // Seed the autosave guard so the freshly-loaded snapshot isn't immediately
      // written straight back.
      lastHistorySaveRef.current = null;

      // Prefer links minted from the durable Storage paths over the snapshot's
      // possibly-stale URLs.
      setPdfPath(data.pdf_path ?? null);
      setDocxPath(data.docx_path ?? null);
      setAnswerKeyPath(data.answer_key_path ?? null);
      if (data.pdf_path) {
        const { data: pub } = supabase.storage
          .from("generated-content")
          .getPublicUrl(data.pdf_path);
        setDownloadUrl(pub.publicUrl);
      }
      if (data.answer_key_path) {
        // Re-sign the confidential key on demand (same route history uses) so
        // the existing key stays downloadable without regenerating it.
        try {
          const res = await fetch(
            `/api/qpaper/history/answer-key-link?id=${data.id}`
          );
          if (res.ok) {
            const { downloadUrl: keyUrl } = (await res.json()) as {
              downloadUrl: string;
            };
            if (!cancelled) setAnswerKeyUrl(keyUrl);
          }
        } catch {
          // Non-fatal — faculty can regenerate the key in place.
        }
      } else {
        setAnswerKeyUrl(null);
      }

      setView("done");
      toast.success("Paper opened — edit, regenerate, or export");
      // Drop the query param so a refresh doesn't re-trigger the resume.
      window.history.replaceState(null, "", "/faculty/qpaper");
    })();
    return () => {
      cancelled = true;
    };
  }, [historyResumeId, applySnapshot]);

  // ─── History-mode autosave ───────────────────────────────────────────────
  // While a paper resumed from history is open, persist every edit straight
  // back to its qpaper_history row (debounced) so reopening it later — even in
  // a new session — always shows the latest version. The draft system is
  // disabled in this mode, so this is the single source of persistence.
  // `pdfDirty` rides alongside the snapshot so the stale-PDF warning survives a
  // reload when edits were made without re-exporting.
  useEffect(() => {
    const rowId = historyRowIdRef.current;
    if (!rowId || view !== "done" || !paper) return;
    const payload = { ...snapshot, pdfDirty: paperEditedSinceGeneration };
    // Newly-produced artifacts (a re-exported PDF, a just-generated answer key)
    // are persisted too, so they survive a reopen even without a download.
    const fp = JSON.stringify({ payload, pdfPath, docxPath, answerKeyPath });
    if (fp === lastHistorySaveRef.current) return;
    const t = setTimeout(async () => {
      const supabase = createBrowserClient();
      const update: Record<string, unknown> = {
        structure_summary: payload,
        total_marks: paper.totalMarks ?? totalMarksLive,
      };
      if (pdfPath) update.pdf_path = pdfPath;
      if (docxPath) update.docx_path = docxPath;
      if (answerKeyPath) update.answer_key_path = answerKeyPath;
      const { error } = await supabase
        .from("qpaper_history")
        .update(update)
        .eq("id", rowId);
      if (error) {
        console.error("[qpaper history autosave] save failed", error);
      } else {
        lastHistorySaveRef.current = fp;
      }
    }, 1500);
    return () => clearTimeout(t);
  }, [
    snapshot,
    view,
    paper,
    paperEditedSinceGeneration,
    totalMarksLive,
    pdfPath,
    docxPath,
    answerKeyPath,
  ]);

  // Scroll to the review section after a resume that includes generated content.
  // Runs whenever `paper` changes; only fires when the one-shot flag is set.
  useEffect(() => {
    if (!scrollToPaperRef.current || !paper || !reviewRef.current) return;
    scrollToPaperRef.current = false;
    reviewRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [paper]);

  // ─── Template prefill actions ──────────────────────────────────────────
  const applyEse = () => {
    setSections(eseStandardSections());
    setFlatLayout(false);
    setMeta(eseMetadata());
    setTargetMarks(60);
    setPaper(null);
    setDownloadUrl(null);
    setAnswerKeyUrl(null);
    toast.success("ESE Standard template loaded");
  };

  const applyQuiz = () => {
    setSections(quizSection());
    setFlatLayout(true);
    setMeta(quizMetadata());
    setTargetMarks(10);
    setPaper(null);
    setDownloadUrl(null);
    setAnswerKeyUrl(null);
    toast.success("Quiz template loaded");
  };

  const clearBuilder = () => {
    setSections([
      {
        id: uid(),
        name: "Section I",
        questions: [newQuestion("long", { displayLabel: "Q - 1" })],
      },
    ]);
    setFlatLayout(false);
    setMeta(defaultMetadata());
    setTargetMarks(60);
    setPaper(null);
    setDownloadUrl(null);
    setAnswerKeyUrl(null);
    toast.message("Builder cleared");
  };

  // ─── Template list refresh + load ──────────────────────────────────────
  const [templateRefreshKey, setTemplateRefreshKey] = useState(0);

  const handleTemplateSaved = useCallback(() => {
    setTemplateRefreshKey((k) => k + 1);
  }, []);

  const handleLoadTemplate = useCallback(
    (tpl: PaperTemplateRow) => {
      const {
        sections: tplSections,
        meta: tplMeta,
        flatLayout: tplFlat,
        targetMarks: tplMarks,
        btlRange: tplBtlRange,
        coTargetsPct: tplCoTargetsPct,
        difficultyTargets: tplDifficultyTargets,
      } = fromTemplateStructure(tpl.structure as unknown as Record<string, unknown>, {
        university_name: tpl.university_name,
        exam_title: tpl.exam_title,
        duration_minutes: tpl.duration_minutes,
        total_marks: tpl.total_marks,
        instructions: tpl.instructions,
      });
      setSections(tplSections);
      setMeta(tplMeta);
      setFlatLayout(tplFlat);
      setTargetMarks(tplMarks);
      setBtlRange(tplBtlRange);
      setCoTargetsPct(tplCoTargetsPct);
      setDifficultyTargets(tplDifficultyTargets);
      setPaper(null);
      setDownloadUrl(null);
      setAnswerKeyUrl(null);
      toast.success(`Template "${tpl.name}" loaded`);
    },
    []
  );

  // ─── Generate ──────────────────────────────────────────────────────────
  const handleGenerate = async () => {
    if (!selectedSubjectId) {
      toast.error("Select a subject first");
      return;
    }
    if (sections.length === 0 || sections.every((s) => s.questions.length === 0)) {
      toast.error("Add at least one question first");
      return;
    }
    if (selectedModuleIds.length === 0) {
      toast.error("Select at least one module");
      return;
    }
    if (sourcingMixTotal(sourcingMix) !== 100) {
      toast.error("Sourcing mix must total 100%");
      return;
    }
    setView("generating");
    setPaper(null);
    setDownloadUrl(null);
    setAnswerKeyUrl(null);
    setPdfPath(null);
    setDocxPath(null);
    setAnswerKeyPath(null);
    setPaperEditedSinceGeneration(false);
    historyRowIdRef.current = null;
    setBankFallbackCount(0);
    setUnplaceablePreferred([]);
    setGenerationWarnings([]);
    // Flush the draft and mark it generating so a tab closed mid-request leaves
    // an honest 'generating' status to surface on return.
    void markGenerating();
    try {
      setProgressMsg("Saving paper structure...");
      const draftName = `Draft ${new Date().toLocaleString()}`;
      const tplRes = await fetch("/api/qpaper/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...buildTemplatePayload(draftName, {
            sections,
            modules,
            selectedModuleIds,
            meta,
            totalMarksLive,
            selectedSubjectId,
            flatLayout,
            btlRange,
            coTargetsPct,
            difficultyTargets,
          }),
          is_snapshot: true,
        }),
      });
      if (!tplRes.ok) throw new Error(await tplRes.text());
      const tplData = (await tplRes.json()) as {
        template?: { id: string };
      };
      const templateId = tplData.template?.id;
      if (!templateId) throw new Error("Template save returned no ID");

      setProgressMsg(
        sections.length > 1
          ? "Generating Section I..."
          : "Generating questions..."
      );
      const res = await fetch("/api/generate/qpaper", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subjectId: selectedSubjectId,
          templateId,
          sourcingMix: sourcingMixToApi(sourcingMix),
          preferredQuestionIds: preferredBankQuestionIds,
          btlRange,
          coTargets: Object.entries(coTargetsPct).map(([co_code, pct]) => ({
            co_code,
            pct,
          })),
          difficultyTargets,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as {
        paper: AssembledPaper;
        downloadUrl?: string;
        filePath?: string;
        bankFallbackCount?: number;
        unplaceablePreferred?: Array<{ id: string; question_text: string }>;
        warnings?: string[];
      };
      setPaper(data.paper);
      setDownloadUrl(data.downloadUrl ?? null);
      setPdfPath(data.filePath ?? null);
      setBankFallbackCount(data.bankFallbackCount ?? 0);
      setUnplaceablePreferred(data.unplaceablePreferred ?? []);
      setGenerationWarnings(data.warnings ?? []);
      setView("done");
      void markComplete();
      toast.success("Question paper generated!");
    } catch (err) {
      console.error(err);
      // Failed run drops back to the builder so the setup can be retried.
      setView("form");
      void markFailed();
      toast.error("Failed to generate. Please try again.");
    } finally {
      setProgressMsg("");
    }
  };

  // ─── Render ────────────────────────────────────────────────────────────
  // Pre-mount: render the header only so the page reserves layout space and
  // doesn't flash blank. DnD-bearing children stay out until hydration done.
  if (!mounted) {
    return (
      <div className="px-6 pt-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FileText className="size-6" />
            Question Paper Generator
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Build your paper structure — AI generates the questions
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col -m-6 h-screen overflow-hidden">
      {/* ── Header — contextual per view. In "done" it becomes a sticky-style
          bar (it lives in the non-scrolling shrink-0 region, so it stays put
          while the review below scrolls) with a Back-to-Setup affordance. ── */}
      <div className="px-6 pt-6 pb-4 shrink-0 border-b bg-background">
        <div className="flex items-start justify-between gap-4">
          {view === "done" ? (
            <div className="flex items-center gap-3 min-w-0">
              <Button
                variant="ghost"
                size="sm"
                className="-ml-2 shrink-0"
                onClick={() => setView("form")}
              >
                <ArrowLeft className="mr-1.5 size-4" />
                Back to Setup
              </Button>
              <div className="min-w-0">
                <p className="text-sm font-semibold truncate">
                  {selectedSubject
                    ? `${selectedSubject.code} — ${selectedSubject.name}`
                    : "Question Paper"}
                </p>
                <p className="text-xs text-muted-foreground">Question Paper</p>
              </div>
            </div>
          ) : (
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2">
                <FileText className="size-6" />
                Question Paper Generator
              </h1>
              <p className="text-muted-foreground text-sm mt-1">
                Build your paper structure — AI generates the questions
              </p>
            </div>
          )}
          {/* Hidden during the generating takeover so nothing invites navigation
              away from an in-flight request. */}
          {view !== "generating" && (
            <Button variant="outline" size="sm" asChild>
              <Link href="/faculty/qpaper/history">
                <History className="mr-2 size-4" />
                Past papers
              </Link>
            </Button>
          )}
        </div>
      </div>

      {/* ── Resume an in-progress draft ──────────────────────────────── */}
      <AlertDialog open={!!resumeCandidate}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {resumeCandidate?.generationStatus === "generating"
                ? "Your last generation may not have completed"
                : "Resume your draft?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {resumeCandidate?.generationStatus === "generating"
                ? `You left a paper generating on ${
                    resumeCandidate
                      ? new Date(resumeCandidate.lastSavedAt).toLocaleString()
                      : ""
                  }. It may have finished or failed after you navigated away — restore the setup and retry?`
                : `We found an in-progress paper from ${
                    resumeCandidate
                      ? new Date(resumeCandidate.lastSavedAt).toLocaleString()
                      : ""
                  }. Pick up where you left off, or discard it and start fresh.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={discard}>
              Discard
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleResume}>
              {resumeCandidate?.generationStatus === "generating"
                ? "Restore & retry"
                : "Resume draft"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── VIEW: form — two-column setup sidebar + builder ──────────────── */}
      {view === "form" && (
        <div className="flex md:flex-row flex-col gap-6 flex-1 min-h-0 overflow-hidden">
          <aside className="md:w-96 w-full md:h-full shrink-0 overflow-y-auto h-full md:border-r md:border-b-0 border-b bg-card pl-6 pr-6 pb-6">
            <SetupPanel
              lastSavedAt={lastSavedAt}
              subjects={subjects}
              isLoadingSubjects={isLoadingSubjects}
              selectedSubjectId={selectedSubjectId}
              onSelectSubject={setSelectedSubjectId}
              targetMarks={targetMarks}
              onTargetMarksChange={setTargetMarks}
              meta={meta}
              setMeta={setMeta}
              sections={sections}
              modules={modules}
              selectedModuleIds={selectedModuleIds}
              setSelectedModuleIds={setSelectedModuleIds}
              btlRange={btlRange}
              onBtlRangeChange={setBtlRange}
              coTargetsPct={coTargetsPct}
              onCoTargetsPctChange={setCoTargetsPct}
              difficultyTargets={difficultyTargets}
              onDifficultyTargetsChange={setDifficultyTargets}
              courseOutcomes={courseOutcomes}
              moduleCoMap={moduleCoMap}
              sourcingMix={sourcingMix}
              setSourcingMix={setSourcingMix}
              verifiedBankCount={verifiedBankCount}
              preferredBankQuestionIds={preferredBankQuestionIds}
              templateRefreshKey={templateRefreshKey}
              onLoadTemplate={handleLoadTemplate}
            />
          </aside>

          <div className="flex-1 min-w-0 overflow-y-auto h-full p-6">
            <BuilderView
              selectedSubject={selectedSubject}
              meta={meta}
              setMeta={setMeta}
              metaOpen={metaOpen}
              setMetaOpen={setMetaOpen}
              totalMarksLive={totalMarksLive}
              onApplyEse={applyEse}
              onApplyQuiz={applyQuiz}
              onClearBuilder={clearBuilder}
              sections={sections}
              setSections={setSections}
              targetMarks={targetMarks}
              flatLayout={flatLayout}
              modules={modules}
              selectedModuleIds={selectedModuleIds}
              selectedSubjectId={selectedSubjectId}
              onTemplateSaved={handleTemplateSaved}
              isGenerating={isGenerating}
              onGenerate={handleGenerate}
            />
          </div>
        </div>
      )}

      {/* ── VIEW: generating — full-page takeover, centered, no sidebar ──── */}
      {view === "generating" && (
        <div className="flex-1 min-h-0 overflow-y-auto flex items-start justify-center">
          <div className="w-full max-w-lg px-6 py-10">
            <GeneratingView
              selectedSubject={selectedSubject}
              meta={meta}
              targetMarks={targetMarks}
              progressMsg={progressMsg}
            />
          </div>
        </div>
      )}

      {/* ── VIEW: done — full-width review + export, no sidebar ──────────── */}
      {view === "done" && paper !== null && (
        <div className="flex-1 min-w-0 overflow-y-auto h-full">
          <div className="p-6 max-w-5xl mx-auto">
            <DoneView
              paper={paper}
              setPaper={setPaperAndClearKey}
              downloadUrl={downloadUrl}
              setDownloadUrl={setDownloadUrl}
              answerKeyUrl={answerKeyUrl}
              setAnswerKeyUrl={setAnswerKeyUrl}
              setAnswerKeyWarnings={setAnswerKeyWarnings}
              setPdfPath={setPdfPath}
              setDocxPath={setDocxPath}
              setAnswerKeyPath={setAnswerKeyPath}
              selectedSubjectId={selectedSubjectId}
              onFinalized={handleFinalized}
              onTemplateSaved={handleTemplateSaved}
              sections={sections}
              modules={modules}
              selectedModuleIds={selectedModuleIds}
              meta={meta}
              totalMarksLive={totalMarksLive}
              onSavedToBank={() =>
                setVerifiedBankCount((c) => (c == null ? 1 : c + 1))
              }
              onGenerate={handleGenerate}
              paperEditedSinceGeneration={paperEditedSinceGeneration}
              onPdfUpdated={() => setPaperEditedSinceGeneration(false)}
              reviewRef={reviewRef}
              bankFallbackCount={bankFallbackCount}
              answerKeyWarnings={answerKeyWarnings}
              unplaceablePreferred={unplaceablePreferred}
              generationWarnings={generationWarnings}
            />
          </div>
        </div>
      )}
    </div>
  );
}
