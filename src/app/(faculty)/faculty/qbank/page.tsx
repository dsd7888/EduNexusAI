"use client";

/**
 * Faculty Q Bank management page. Owns the shared subject selection, reference
 * data (modules / course outcomes), bank stats (for the stats row + the
 * "needs review" tab badge), and the manual staging set, then hosts the three
 * tabs: My Bank, Generate Questions, Import Questions.
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Library } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { createBrowserClient } from "@/lib/db/supabase-browser";
import { useFacultySubjects } from "@/hooks/useSupabaseData";
import { toast } from "sonner";
import type { BankQuestion, QuestionType } from "@/lib/qbank/types";
import { MyBankTab } from "./_components/MyBankTab";
import { GenerateTab } from "./_components/GenerateTab";
import { ImportTab } from "./_components/ImportTab";
import {
  STAGING_KEY,
  type BankStats,
  type CourseOutcomeRef,
  type ModuleRef,
  type StagedQuestion,
} from "./_components/shared";

const EMPTY_BY_TYPE: Record<QuestionType, number> = {
  mcq: 0,
  short_answer: 0,
  long_answer: 0,
  numerical: 0,
  fill_blank: 0,
};

export default function QBankPage() {
  const { subjects, isLoading: subjectsLoading } = useFacultySubjects();
  const [subjectId, setSubjectId] = useState("");
  const [tab, setTab] = useState("bank");

  const [modules, setModules] = useState<ModuleRef[]>([]);
  const [courseOutcomes, setCourseOutcomes] = useState<CourseOutcomeRef[]>([]);
  // Stats are tagged with the subject they belong to, so switching subjects
  // derives back to "loading" with no synchronous reset in an effect.
  const [statsState, setStatsState] = useState<{
    subjectId: string;
    data: BankStats;
  } | null>(null);
  const [staged, setStaged] = useState<StagedQuestion[]>([]);

  const router = useRouter();

  // Effective subject: explicit selection, else the first assigned one.
  const activeSubjectId = subjectId || subjects[0]?.id || "";
  const stats =
    statsState && statsState.subjectId === activeSubjectId
      ? statsState.data
      : null;
  const statsLoading = stats === null && !!activeSubjectId;

  const selectSubject = (id: string) => {
    setSubjectId(id);
    setStaged([]); // a staged paper is per-subject
  };

  // Reference data (modules + course outcomes). setState only inside the async
  // query callbacks, never synchronously in the effect body.
  useEffect(() => {
    if (!activeSubjectId) return;
    const supabase = createBrowserClient();
    console.log("[qbank] fetching for", activeSubjectId);
    supabase
      .from("modules")
      .select("id, name, module_number")
      .eq("subject_id", activeSubjectId)
      .order("module_number")
      .then(({ data, error }) => {
        if (error) console.error("[qbank modules]", error);
        setModules((data ?? []) as ModuleRef[]);
      });
    supabase
      .from("course_outcomes")
      .select("co_code, description")
      .eq("subject_id", activeSubjectId)
      .then(({ data, error }) => {
        console.log("[qbank co] data:", data, "error:", error);
        setCourseOutcomes((data ?? []) as CourseOutcomeRef[]);
      });
  }, [activeSubjectId]);

  // Bank stats — read directly via the RLS-scoped browser client. setState
  // lives inside the query's `.then` callback so the effect that triggers a
  // refresh never updates state synchronously.
  const refreshStats = useCallback(() => {
    if (!activeSubjectId) return;
    const supabase = createBrowserClient();
    supabase
      .from("faculty_question_bank")
      .select("question_type, is_verified, marks")
      .eq("subject_id", activeSubjectId)
      .then(({ data }) => {
        const rows = (data ?? []) as Array<{
          question_type: QuestionType;
          is_verified: boolean;
          marks: number;
        }>;
        const byType = { ...EMPTY_BY_TYPE };
        const marksSet = new Set<number>();
        let verified = 0;
        for (const r of rows) {
          byType[r.question_type] = (byType[r.question_type] ?? 0) + 1;
          if (r.is_verified) verified++;
          if (r.marks != null) marksSet.add(Number(r.marks));
        }
        setStatsState({
          subjectId: activeSubjectId,
          data: {
            total: rows.length,
            verified,
            needsReview: rows.length - verified,
            byType,
            marks: Array.from(marksSet).sort((a, b) => a - b),
          },
        });
      });
  }, [activeSubjectId]);

  useEffect(() => {
    refreshStats();
  }, [refreshStats]);

  // ── Staging handlers ─────────────────────────────────────────────────
  const onStage = useCallback((q: BankQuestion) => {
    setStaged((prev) =>
      prev.some((s) => s.id === q.id)
        ? prev
        : [
            ...prev,
            {
              id: q.id,
              question_text: q.question_text,
              question_type: q.question_type,
              marks: q.marks,
            },
          ]
    );
  }, []);
  const onUnstage = useCallback(
    (id: string) => setStaged((prev) => prev.filter((s) => s.id !== id)),
    []
  );
  const onReorder = useCallback(
    (ids: string[]) =>
      setStaged((prev) => {
        const map = new Map(prev.map((s) => [s.id, s]));
        return ids.map((id) => map.get(id)!).filter(Boolean);
      }),
    []
  );

  const onExportPaper = useCallback(() => {
    if (staged.length === 0) return;
    // Hand the staged set to the Q-paper builder via sessionStorage. (The
    // builder reading this is a follow-up; for now we persist + navigate.)
    try {
      sessionStorage.setItem(
        STAGING_KEY,
        JSON.stringify({ subjectId: activeSubjectId, questions: staged })
      );
    } catch {
      // sessionStorage may be unavailable; navigation still proceeds.
    }
    toast.success(`${staged.length} question(s) sent to the Q-paper builder`);
    router.push("/faculty/qpaper");
  }, [staged, activeSubjectId, router]);

  const needsReview = stats?.needsReview ?? 0;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Library className="size-6" />
          Question Bank
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Build a reusable pool of questions — generate, import, review, and pull
          them into papers.
        </p>
      </div>

      {/* Shared subject selector */}
      <div className="max-w-md">
        <Label className="text-xs mb-1 block">Subject</Label>
        <Select
          value={activeSubjectId}
          onValueChange={selectSubject}
          disabled={subjectsLoading || subjects.length === 0}
        >
          <SelectTrigger className="h-9">
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
            {subjects.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.code} — {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {activeSubjectId ? (
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="w-full max-w-xl">
            <TabsTrigger value="bank" className="gap-1.5">
              My Bank
              {needsReview > 0 && (
                <Badge
                  variant="outline"
                  className="text-[10px] border-amber-400/40 bg-amber-500/10 text-amber-400"
                >
                  {needsReview} ⚠
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="generate">Generate Questions</TabsTrigger>
            <TabsTrigger value="import">Add Questions</TabsTrigger>
          </TabsList>

          <TabsContent value="bank" className="mt-4">
            <MyBankTab
              subjectId={activeSubjectId}
              modules={modules}
              courseOutcomes={courseOutcomes}
              stats={stats}
              statsLoading={statsLoading}
              refreshStats={refreshStats}
              staged={staged}
              onStage={onStage}
              onUnstage={onUnstage}
              onReorder={onReorder}
              onExportPaper={onExportPaper}
              onGoGenerate={() => setTab("generate")}
              onGoImport={() => setTab("import")}
            />
          </TabsContent>

          <TabsContent value="generate" className="mt-4">
            <GenerateTab
              subjectId={activeSubjectId}
              modules={modules}
              courseOutcomes={courseOutcomes}
              onAdded={refreshStats}
            />
          </TabsContent>

          <TabsContent value="import" className="mt-4">
            <ImportTab
              subjectId={activeSubjectId}
              modules={modules}
              courseOutcomes={courseOutcomes}
              onImported={refreshStats}
            />
          </TabsContent>
        </Tabs>
      ) : (
        !subjectsLoading && (
          <p className="text-sm text-muted-foreground">
            Select a subject to manage its question bank.
          </p>
        )
      )}
    </div>
  );
}
