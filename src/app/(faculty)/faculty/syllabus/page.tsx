"use client";

/**
 * Faculty syllabus view: browse a subject's full module content alongside
 * the AI-inferred CO mappings, and correct any mapping via the inline
 * add/remove controls on each module card.
 */

import { useEffect, useMemo, useState } from "react";
import { BookOpen } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createBrowserClient } from "@/lib/db/supabase-browser";
import { useFacultySubjects } from "@/hooks/useSupabaseData";
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

export default function FacultySyllabusPage() {
  const { subjects, isLoading: subjectsLoading } = useFacultySubjects();
  const [subjectId, setSubjectId] = useState("");
  const [search, setSearch] = useState("");

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

  return (
    <div className="p-6 max-w-6xl mx-auto flex gap-6">
      <div className="w-[280px] shrink-0 space-y-3">
        <h1 className="text-xl font-bold flex items-center gap-2">
          <BookOpen className="size-5" />
          Syllabus
        </h1>
        {subjects.length > 5 && (
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search subjects…"
            className="h-8 text-sm"
          />
        )}
        <div>
          <Label className="text-xs mb-1 block">Subject</Label>
          <Select
            value={activeSubjectId}
            onValueChange={setSubjectId}
            disabled={subjectsLoading || subjects.length === 0}
          >
            <SelectTrigger className="h-9 w-full">
              <SelectValue
                placeholder={
                  subjectsLoading
                    ? "Loading subjects…"
                    : subjects.length === 0
                      ? "No subjects assigned"
                      : "Select subject"
                }
              />
            </SelectTrigger>
            <SelectContent>
              {filteredSubjects.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.code} — {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

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
