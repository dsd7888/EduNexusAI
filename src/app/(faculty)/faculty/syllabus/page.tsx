"use client";

/**
 * Faculty syllabus view: browse a subject's full module content alongside
 * the AI-inferred CO mappings, and correct any mapping via the inline
 * add/remove controls on each module card.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BookOpen, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { useFacultySubjects, type SubjectRow } from "@/hooks/useSupabaseData";
import {
  StructuredSyllabusEditor,
  emptyExtracted,
} from "@/components/syllabus/StructuredSyllabusEditor";
import type { ExtractedSyllabus } from "@/lib/syllabus/types";
import { ModuleSyllabusCard } from "./_components/ModuleSyllabusCard";
import {
  CONFIDENCE_CLASSES,
  type CourseOutcomeRef,
  type MappingRow,
  type ModuleRow,
} from "./_components/shared";

interface ExamScheme {
  theory_ce: number | null;
  theory_ese: number | null;
  practical_ce: number | null;
  practical_ese: number | null;
  total_marks: number | null;
}

const SUBJECT_CAP = 5;

export default function FacultySyllabusPage() {
  const { subjects, isLoading: subjectsLoading, refetch } = useFacultySubjects();
  const [subjectId, setSubjectId] = useState("");
  const [search, setSearch] = useState("");
  const [pendingRemoval, setPendingRemoval] = useState<SubjectRow | null>(null);
  const [removing, setRemoving] = useState(false);

  // Land directly on a specific subject when arriving from the Add flow
  // (/faculty/syllabus?subject={id}). Read from the URL directly rather than
  // useSearchParams to avoid a Suspense-boundary build bailout.
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("subject");
    if (fromUrl) setSubjectId(fromUrl);
  }, []);

  // Data is tagged with the subject it belongs to, so switching subjects
  // derives back to "loading" with no synchronous reset in an effect.
  const [dataState, setDataState] = useState<{
    subjectId: string;
    modules: ModuleRow[];
    courseOutcomes: CourseOutcomeRef[];
    examScheme: ExamScheme | null;
    mappingsByModule: Map<string, MappingRow[]>;
  } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [editing, setEditing] = useState(false);
  const [editLoading, setEditLoading] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editState, setEditState] = useState<{
    subjectId: string;
    extracted: ExtractedSyllabus;
    dirty: boolean;
  } | null>(null);

  const activeSubjectId = subjectId || subjects[0]?.id || "";
  const activeSubject = subjects.find((s) => s.id === activeSubjectId);

  // Editing a different subject than the one being edited discards the in-progress edit.
  useEffect(() => {
    if (editing && editState && editState.subjectId !== activeSubjectId) {
      setEditing(false);
      setEditState(null);
    }
  }, [activeSubjectId, editing, editState]);

  const data =
    dataState && dataState.subjectId === activeSubjectId ? dataState : null;
  const loading = data === null && !!activeSubjectId;
  const modules = data?.modules ?? [];
  const courseOutcomes = data?.courseOutcomes ?? [];
  const examScheme = data?.examScheme ?? null;
  const mappingsByModule = data?.mappingsByModule ?? new Map<string, MappingRow[]>();

  const filteredSubjects = useMemo(() => {
    if (subjects.length <= 5 || !search.trim()) return subjects;
    const q = search.trim().toLowerCase();
    return subjects.filter(
      (s) => s.code.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)
    );
  }, [subjects, search]);

  useEffect(() => {
    if (!activeSubjectId) return;
    const supabase = createBrowserClient();

    Promise.all([
      supabase
        .from("modules")
        .select(
          "id, module_number, name, description, weightage_percent, btl_levels"
        )
        .eq("subject_id", activeSubjectId)
        .order("module_number"),
      supabase
        .from("course_outcomes")
        .select("co_code, description")
        .eq("subject_id", activeSubjectId)
        .order("co_code"),
      supabase
        .from("exam_scheme")
        .select("theory_ce, theory_ese, practical_ce, practical_ese, total_marks")
        .eq("subject_id", activeSubjectId)
        .maybeSingle(),
      fetch(`/api/syllabus/module-co-mapping?subject_id=${activeSubjectId}`).then(
        (r) => (r.ok ? r.json() : { mappings: [] })
      ),
    ]).then(([modulesRes, coRes, examRes, mappingRes]) => {
      const map = new Map<string, MappingRow[]>();
      for (const row of (mappingRes.mappings ?? []) as MappingRow[]) {
        const list = map.get(row.module_id) ?? [];
        list.push(row);
        map.set(row.module_id, list);
      }
      setDataState({
        subjectId: activeSubjectId,
        modules: (modulesRes.data ?? []) as ModuleRow[],
        courseOutcomes: (coRes.data ?? []) as CourseOutcomeRef[],
        examScheme: (examRes.data ?? null) as ExamScheme | null,
        mappingsByModule: map,
      });
    });
  }, [activeSubjectId, reloadKey]);

  const updateMappings = (moduleId: string, next: MappingRow[]) => {
    setDataState((prev) => {
      if (!prev) return prev;
      const map = new Map(prev.mappingsByModule);
      map.set(moduleId, next);
      return { ...prev, mappingsByModule: map };
    });
  };

  const handleStartEdit = useCallback(async () => {
    if (!activeSubjectId) return;
    setEditLoading(true);
    try {
      const res = await fetch(
        `/api/syllabus/load?subject_id=${encodeURIComponent(activeSubjectId)}`
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json.error ?? "Failed to load syllabus for editing");
        return;
      }
      const base = (json.extracted as ExtractedSyllabus | null) ?? emptyExtracted();
      if (!json.extracted && activeSubject) {
        base.course.code = activeSubject.code;
        base.course.name = activeSubject.name;
      }
      setEditState({ subjectId: activeSubjectId, extracted: base, dirty: false });
      setEditing(true);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to load syllabus for editing"
      );
    } finally {
      setEditLoading(false);
    }
  }, [activeSubjectId, activeSubject]);

  const handleCancelEdit = useCallback(() => {
    setEditing(false);
    setEditState(null);
  }, []);

  const updateEditState = useCallback(
    (mutator: (draft: ExtractedSyllabus) => void) => {
      setEditState((prev) => {
        if (!prev) return prev;
        const next = structuredClone(prev.extracted) as ExtractedSyllabus;
        mutator(next);
        return { ...prev, extracted: next, dirty: true };
      });
    },
    []
  );

  const handleSaveEdit = useCallback(async () => {
    if (!editState) return;
    setEditSaving(true);
    try {
      const res = await fetch("/api/syllabus/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject_id: editState.subjectId,
          extracted: editState.extracted,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json.error ?? "Save failed");
        return;
      }
      const warnings: string[] = Array.isArray(json.warnings) ? json.warnings : [];
      if (warnings.length > 0) {
        toast.warning(`Saved with ${warnings.length} warnings`);
        console.warn("[syllabus/save] warnings:", warnings);
      } else {
        toast.success("Syllabus saved");
      }
      setEditing(false);
      setEditState(null);
      setReloadKey((k) => k + 1);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setEditSaving(false);
    }
  }, [editState]);

  const handleConfirmRemove = useCallback(async () => {
    if (!pendingRemoval) return;
    setRemoving(true);
    try {
      const res = await fetch(
        `/api/faculty/subjects/${encodeURIComponent(pendingRemoval.id)}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        toast.error(j.error ?? "Couldn't remove that subject");
        return;
      }
      toast.success(`Removed ${pendingRemoval.code} from your subjects`);
      if (subjectId === pendingRemoval.id) setSubjectId("");
      setPendingRemoval(null);
      refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't remove that subject");
    } finally {
      setRemoving(false);
    }
  }, [pendingRemoval, subjectId, refetch]);

  const atCap = subjects.length >= SUBJECT_CAP;

  return (
    <div className="p-6 max-w-6xl mx-auto flex gap-6">
      <div className="w-[280px] shrink-0 space-y-3">
        <h1 className="text-xl font-bold flex items-center gap-2">
          <BookOpen className="size-5" />
          Syllabus
        </h1>

        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">
            My Subjects
          </span>
          <span className="text-xs text-muted-foreground">
            {subjects.length} of {SUBJECT_CAP} added
          </span>
        </div>

        {subjects.length > 5 && (
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search subjects…"
            className="h-8 text-sm"
          />
        )}

        {subjectsLoading ? (
          <p className="text-sm text-muted-foreground">Loading subjects…</p>
        ) : subjects.length === 0 ? (
          <div className="rounded-md border border-dashed p-4 text-center space-y-2">
            <p className="text-sm font-medium">Welcome! Let&apos;s get started.</p>
            <p className="text-xs text-muted-foreground">
              You haven&apos;t added any subjects yet. Add your first one to bring
              in its syllabus and course outcomes.
            </p>
            <Button asChild size="sm" className="gap-1 w-full mt-1">
              <Link href="/faculty/syllabus/add">
                <Plus className="size-4" /> Add your first subject
              </Link>
            </Button>
          </div>
        ) : (
          <div className="space-y-1">
            {filteredSubjects.map((s) => {
              const active = s.id === activeSubjectId;
              return (
                <div
                  key={s.id}
                  className={
                    "group flex items-center gap-1 rounded-md border px-2 py-1.5 text-sm transition-colors " +
                    (active
                      ? "border-primary/40 bg-primary/5"
                      : "hover:bg-muted")
                  }
                >
                  <button
                    type="button"
                    onClick={() => setSubjectId(s.id)}
                    disabled={editing}
                    className="flex-1 min-w-0 text-left disabled:cursor-not-allowed disabled:opacity-60"
                    aria-current={active ? "true" : undefined}
                    title={editing ? "Finish or cancel editing first" : undefined}
                  >
                    <span className="font-medium">{s.code}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {s.name}
                    </span>
                    {s.offerings && s.offerings.length > 0 && (
                      <span className="mt-1 flex flex-wrap gap-1">
                        {s.offerings.map((o) => (
                          <Badge
                            key={`${o.branch}-${o.semester}`}
                            variant="secondary"
                            className="px-1.5 py-0 text-[10px] font-normal"
                          >
                            {o.branch} · Sem {o.semester}
                          </Badge>
                        ))}
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => setPendingRemoval(s)}
                    disabled={editing}
                    className="shrink-0 rounded-md p-1.5 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive focus:opacity-100 group-hover:opacity-100 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
                    aria-label={`Remove ${s.code} from your subjects`}
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {subjects.length > 0 && (
          <div className="space-y-1 pt-1">
            <Button
              asChild={!atCap}
              size="sm"
              variant="outline"
              disabled={atCap}
              className="gap-1 w-full"
              title={
                atCap
                  ? `You've reached the ${SUBJECT_CAP}-subject limit for this pilot.`
                  : undefined
              }
            >
              {atCap ? (
                <span>
                  <Plus className="size-4" /> Add Subject
                </span>
              ) : (
                <Link href="/faculty/syllabus/add">
                  <Plus className="size-4" /> Add Subject
                </Link>
              )}
            </Button>
            {atCap && (
              <p className="text-xs text-muted-foreground text-center">
                You&apos;ve reached the {SUBJECT_CAP}-subject limit for this pilot.
              </p>
            )}
          </div>
        )}
      </div>

      <AlertDialog
        open={pendingRemoval !== null}
        onOpenChange={(open) => {
          if (!open && !removing) setPendingRemoval(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Remove {pendingRemoval?.code} from your subjects?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This removes {pendingRemoval?.code} — {pendingRemoval?.name} from your
              list only. The syllabus itself isn&apos;t deleted, and you can add it
              back later from the catalog.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removing}>Keep it</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleConfirmRemove();
              }}
              disabled={removing}
            >
              {removing ? (
                <>
                  <Loader2 className="size-4 animate-spin" /> Removing…
                </>
              ) : (
                "Remove"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="flex-1 min-w-0 space-y-4">
        <div className="rounded-md border border-primary/20 bg-primary/5 px-4 py-2 text-sm text-muted-foreground space-y-1.5">
          <p>
            CO mappings shown here are used by the Question Paper generator to
            distribute questions across outcomes. Changes take effect
            immediately.
          </p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
            <span>Chip color = AI confidence in that mapping:</span>
            <span className="flex items-center gap-1">
              <Badge className={CONFIDENCE_CLASSES.high}>CO#</Badge> high
            </span>
            <span className="flex items-center gap-1">
              <Badge className={CONFIDENCE_CLASSES.medium}>CO#</Badge> medium
            </span>
            <span className="flex items-center gap-1">
              <Badge className={CONFIDENCE_CLASSES.low}>CO#</Badge> low
            </span>
            <span>· Hover a chip to see who verified it.</span>
          </div>
        </div>

        {!activeSubjectId && !subjectsLoading && (
          <p className="text-sm text-muted-foreground">
            Select a subject to view its syllabus.
          </p>
        )}

        {activeSubjectId && (
          <>
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <h2 className="text-lg font-semibold">
                  {activeSubject ? `${activeSubject.code} — ${activeSubject.name}` : ""}
                </h2>
                {examScheme && !editing && (
                  <p className="text-xs text-muted-foreground mt-1">
                    {[
                      examScheme.theory_ce != null && `Theory CE ${examScheme.theory_ce}`,
                      examScheme.theory_ese != null && `Theory ESE ${examScheme.theory_ese}`,
                      examScheme.practical_ce != null &&
                        `Practical CE ${examScheme.practical_ce}`,
                      examScheme.practical_ese != null &&
                        `Practical ESE ${examScheme.practical_ese}`,
                      examScheme.total_marks != null && `Total ${examScheme.total_marks}`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                )}
              </div>

              {!editing ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleStartEdit}
                  disabled={editLoading}
                  className="gap-1"
                >
                  {editLoading ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Pencil className="size-4" />
                  )}
                  Edit Syllabus
                </Button>
              ) : (
                <div className="flex items-center gap-2">
                  {editState?.dirty && (
                    <Badge
                      variant="outline"
                      className="text-amber-700 border-amber-400"
                    >
                      Unsaved changes
                    </Badge>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleCancelEdit}
                    disabled={editSaving}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleSaveEdit}
                    disabled={editSaving}
                    className="gap-1"
                  >
                    {editSaving && <Loader2 className="size-4 animate-spin" />}
                    Save changes
                  </Button>
                </div>
              )}
            </div>

            {editing ? (
              editState ? (
                <StructuredSyllabusEditor
                  extracted={editState.extracted}
                  update={updateEditState}
                />
              ) : (
                <p className="text-sm text-muted-foreground">Loading syllabus…</p>
              )
            ) : loading ? (
              <p className="text-sm text-muted-foreground">Loading syllabus…</p>
            ) : modules.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No modules recorded for this subject yet. Click{" "}
                <span className="font-medium">Edit Syllabus</span> to add course
                info, modules, and outcomes.
              </p>
            ) : (
              <div className="space-y-4">
                {modules.map((m) => (
                  <ModuleSyllabusCard
                    key={m.id}
                    module={m}
                    mappings={mappingsByModule.get(m.id) ?? []}
                    courseOutcomes={courseOutcomes}
                    onMappingsChange={updateMappings}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
