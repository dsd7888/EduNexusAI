"use client";

/**
 * Faculty syllabus view: browse a subject's full module content alongside
 * the AI-inferred CO mappings, and correct any mapping via the inline
 * add/remove controls on each module card.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BookOpen, Loader2, Plus, Trash2 } from "lucide-react";
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

  const activeSubjectId = subjectId || subjects[0]?.id || "";
  const activeSubject = subjects.find((s) => s.id === activeSubjectId);

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
  }, [activeSubjectId]);

  const updateMappings = (moduleId: string, next: MappingRow[]) => {
    setDataState((prev) => {
      if (!prev) return prev;
      const map = new Map(prev.mappingsByModule);
      map.set(moduleId, next);
      return { ...prev, mappingsByModule: map };
    });
  };

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
                    className="flex-1 min-w-0 text-left"
                    aria-current={active ? "true" : undefined}
                  >
                    <span className="font-medium">{s.code}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {s.name}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setPendingRemoval(s)}
                    className="shrink-0 rounded-md p-1.5 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive focus:opacity-100 group-hover:opacity-100"
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
            <div>
              <h2 className="text-lg font-semibold">
                {activeSubject ? `${activeSubject.code} — ${activeSubject.name}` : ""}
              </h2>
              {examScheme && (
                <p className="text-xs text-muted-foreground mt-1">
                  {[
                    examScheme.theory_ce != null && `Theory CE ${examScheme.theory_ce}`,
                    examScheme.theory_ese != null && `Theory ESE ${examScheme.theory_ese}`,
                    examScheme.practical_ce != null && `Practical CE ${examScheme.practical_ce}`,
                    examScheme.practical_ese != null &&
                      `Practical ESE ${examScheme.practical_ese}`,
                    examScheme.total_marks != null && `Total ${examScheme.total_marks}`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              )}
            </div>

            {loading ? (
              <p className="text-sm text-muted-foreground">Loading syllabus…</p>
            ) : modules.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No modules recorded for this subject yet.
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
