"use client";

/**
 * Autosave / draft-resume for the Q-paper builder, backed by `qpaper_drafts`.
 *
 * The hook takes a memoized snapshot of the builder state and:
 *  1. Autosaves it (debounced) into a single row keyed by faculty_id + a draft
 *     id captured on first insert — so repeated saves update the same row.
 *  2. On mount, looks for a recent meaningful draft and, if found, surfaces it
 *     as a `resumeCandidate` for the page to prompt on (never auto-resumes).
 *  3. Tracks the async generation lifecycle via `generation_status` so a draft
 *     left mid-generation can be surfaced honestly on return.
 *  4. Exposes `clearDraft()` to delete the row once a paper is finalized.
 *
 * Writes go through the browser Supabase client directly — RLS on qpaper_drafts
 * scopes every row to `faculty_id = auth.uid()`, so no API route is needed.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createBrowserClient } from "@/lib/db/supabase-browser";
import type { CustomBtlWeights, DifficultyPreset } from "@/lib/qpaper/moduleAssignment";
import {
  defaultCustomBtlWeights,
  defaultMetadata,
  defaultSourcingMix,
  eseStandardSections,
  type AssembledPaper,
  type BuilderSection,
  type PaperMetadata,
  type SourcingMixState,
} from "./shared";

/** The full builder snapshot persisted to `builder_state`. */
export interface BuilderSnapshot {
  // ── Pre-generation configuration ──────────────────────────────────────────
  selectedSubjectId: string;
  selectedModuleIds: string[];
  meta: PaperMetadata;
  sections: BuilderSection[];
  flatLayout: boolean;
  targetMarks: number;
  sourcingMix: SourcingMixState;
  difficultyPreset: DifficultyPreset;
  customBtlWeights: CustomBtlWeights;
  preferredBankQuestionIds: string[];
  // ── Post-generation output (null until the first successful generation) ───
  paper: AssembledPaper | null;
  /** Supabase Storage signed URL for the last PDF export. May expire; treat as
   *  a best-effort restore — the "Update PDF" button regenerates it if stale. */
  downloadUrl: string | null;
  answerKeyUrl: string | null;
}

export type GenerationStatus = "idle" | "generating" | "complete" | "failed";

export interface ResumeCandidate {
  id: string;
  builderState: BuilderSnapshot;
  generationStatus: GenerationStatus;
  lastSavedAt: string;
}

const AUTOSAVE_DEBOUNCE_MS = 1500;
const DRAFT_RECENT_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Stable fingerprint of the *user-controlled* configuration, with volatile
 * section/question ids stripped and auto-populated fields (subject + modules,
 * which the page fills in without user action) excluded. Used to decide whether
 * a draft is worth resuming — i.e. differs from a pristine builder.
 */
function meaningfulFingerprint(s: BuilderSnapshot): string {
  return JSON.stringify({
    sections: s.sections.map((sec) => ({
      name: sec.name,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      questions: sec.questions.map(({ id, ...q }) => q),
    })),
    meta: { ...s.meta, instructions: s.meta.instructions.map((i) => i.text) },
    flatLayout: s.flatLayout,
    targetMarks: s.targetMarks,
    sourcingMix: s.sourcingMix,
    difficultyPreset: s.difficultyPreset,
    customBtlWeights: s.customBtlWeights,
    preferredBankQuestionIds: s.preferredBankQuestionIds,
  });
}

const PRISTINE_FINGERPRINT = meaningfulFingerprint({
  selectedSubjectId: "",
  selectedModuleIds: [],
  meta: defaultMetadata(),
  sections: eseStandardSections(),
  flatLayout: false,
  targetMarks: 60,
  sourcingMix: defaultSourcingMix(),
  difficultyPreset: "balanced",
  customBtlWeights: defaultCustomBtlWeights(),
  preferredBankQuestionIds: [],
  paper: null,
  downloadUrl: null,
  answerKeyUrl: null,
});

function isMeaningful(s: BuilderSnapshot): boolean {
  // A draft with generated content is always worth resuming, regardless of
  // whether the pre-generation config looks pristine.
  if (s.paper !== null) return true;
  return meaningfulFingerprint(s) !== PRISTINE_FINGERPRINT;
}

function isRecent(iso: string): boolean {
  return Date.now() - new Date(iso).getTime() < DRAFT_RECENT_MS;
}

interface UseQpaperDraftOptions {
  /** Skip the resume prompt (e.g. arrived via Q Bank staging with intent). */
  skipResume?: boolean;
}

export function useQpaperDraft(
  snapshot: BuilderSnapshot,
  { skipResume = false }: UseQpaperDraftOptions = {}
) {
  const supabase = useMemo(() => createBrowserClient(), []);

  const [userId, setUserId] = useState<string | null>(null);
  // checking → looking for an existing draft; prompting → awaiting the user's
  // resume/discard choice; active → autosave enabled.
  const [phase, setPhase] = useState<"checking" | "prompting" | "active">(
    "checking"
  );
  const [resumeCandidate, setResumeCandidate] = useState<ResumeCandidate | null>(
    null
  );
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);

  const draftIdRef = useRef<string | null>(null);
  // Fingerprint of the last persisted snapshot, to skip no-op writes.
  const lastWrittenRef = useRef<string | null>(null);
  // Latest snapshot, so imperative callbacks (generate flow) read current state.
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;

  // ─── Resolve the current user ────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!cancelled) setUserId(user?.id ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  // ─── Resume detection (runs once the user is known) ──────────────────────
  useEffect(() => {
    if (!userId) return;
    if (skipResume) {
      setPhase("active");
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("qpaper_drafts")
        .select("id, builder_state, generation_status, last_saved_at")
        .eq("faculty_id", userId)
        .order("last_saved_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (cancelled) return;

      if (data && isRecent(data.last_saved_at)) {
        const builderState = (data.builder_state ?? {}) as BuilderSnapshot;
        if (isMeaningful(builderState)) {
          // Worth resuming — let the page prompt. Don't adopt the id yet:
          // resume() adopts it; discard() deletes it.
          setResumeCandidate({
            id: data.id,
            builderState,
            generationStatus: data.generation_status as GenerationStatus,
            lastSavedAt: data.last_saved_at,
          });
          setPhase("prompting");
          return;
        }
        // Recent but empty scratch row — reuse it so we don't accumulate dupes.
        draftIdRef.current = data.id;
        lastWrittenRef.current = JSON.stringify(builderState);
      }
      setPhase("active");
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, skipResume, supabase]);

  // ─── Core write (insert-or-update the single draft row) ──────────────────
  const persist = useCallback(
    async (snap: BuilderSnapshot, status?: GenerationStatus) => {
      if (!userId) return;
      const row: Record<string, unknown> = {
        faculty_id: userId,
        subject_id: snap.selectedSubjectId || null,
        label: `Draft · ${new Date().toLocaleString()}`,
        builder_state: snap,
        last_saved_at: new Date().toISOString(),
        ...(status ? { generation_status: status } : {}),
      };
      try {
        if (draftIdRef.current) {
          await supabase
            .from("qpaper_drafts")
            .update(row)
            .eq("id", draftIdRef.current);
        } else {
          const { data, error } = await supabase
            .from("qpaper_drafts")
            .insert(row)
            .select("id")
            .single();
          if (error) throw error;
          draftIdRef.current = data.id;
        }
        lastWrittenRef.current = JSON.stringify(snap);
        setLastSavedAt(row.last_saved_at as string);
      } catch (err) {
        // Autosave is best-effort — a failed save shouldn't disrupt the builder.
        console.error("[qpaper draft] save failed", err);
      }
    },
    [supabase, userId]
  );

  // ─── Debounced autosave ──────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== "active" || !userId) return;
    if (!isMeaningful(snapshot)) return; // don't persist a pristine builder
    if (JSON.stringify(snapshot) === lastWrittenRef.current) return; // no change

    const t = setTimeout(() => persist(snapshot), AUTOSAVE_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [snapshot, phase, userId, persist]);

  // ─── Resume: adopt the candidate's row and hand its state to the page ────
  const resume = useCallback((): BuilderSnapshot | null => {
    if (!resumeCandidate) return null;
    draftIdRef.current = resumeCandidate.id;
    lastWrittenRef.current = JSON.stringify(resumeCandidate.builderState);
    setLastSavedAt(resumeCandidate.lastSavedAt);
    const state = resumeCandidate.builderState;
    setResumeCandidate(null);
    setPhase("active");
    return state;
  }, [resumeCandidate]);

  // ─── Discard: delete the candidate and start fresh ───────────────────────
  const discard = useCallback(async () => {
    const candidate = resumeCandidate;
    setResumeCandidate(null);
    setPhase("active");
    if (candidate) {
      draftIdRef.current = null;
      lastWrittenRef.current = null;
      await supabase.from("qpaper_drafts").delete().eq("id", candidate.id);
    }
  }, [resumeCandidate, supabase]);

  // ─── Generation lifecycle ────────────────────────────────────────────────
  // Flush the current state and mark it generating (creates the row if a save
  // hasn't landed yet), so a tab closed mid-request leaves a 'generating' row.
  const markGenerating = useCallback(
    () => persist(snapshotRef.current, "generating"),
    [persist]
  );

  const setStatus = useCallback(
    async (status: GenerationStatus) => {
      if (!draftIdRef.current) return;
      await supabase
        .from("qpaper_drafts")
        .update({ generation_status: status })
        .eq("id", draftIdRef.current);
    },
    [supabase]
  );

  const markComplete = useCallback(() => setStatus("complete"), [setStatus]);
  const markFailed = useCallback(() => setStatus("failed"), [setStatus]);

  // ─── Cleanup: drop the draft once a paper is finalized/downloaded ────────
  const clearDraft = useCallback(async () => {
    const id = draftIdRef.current;
    draftIdRef.current = null;
    lastWrittenRef.current = null;
    setLastSavedAt(null);
    if (id) await supabase.from("qpaper_drafts").delete().eq("id", id);
  }, [supabase]);

  return {
    resumeCandidate,
    lastSavedAt,
    resume,
    discard,
    markGenerating,
    markComplete,
    markFailed,
    clearDraft,
  };
}
