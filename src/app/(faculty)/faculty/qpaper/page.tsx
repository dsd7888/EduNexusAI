"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { createBrowserClient } from "@/lib/db/supabase-browser";
import type { GeneratedQPaper } from "@/lib/qpaper/generator";
import { cn } from "@/lib/utils";
import {
  CheckCircle,
  Download,
  FileText,
  Loader2,
  Plus,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

type View = "form" | "generating" | "preview";
type UniquenessMode = "all_new" | "mixed";

interface SubjectRow {
  id: string;
  name: string;
  code: string;
}

interface SectionConfig {
  id: string;
  sectionLabel: string;
  questionType: string;
  customTypeName: string;
  numberOfQuestions: number;
  marksPerQuestion: number;
  hasSubQuestions: boolean;
  subQuestionsCount: number;
  subQuestionsMarks: number;
  instructions: string;
}

const GENERATING_MESSAGES = [
  "📚 Analyzing previous year questions...",
  "🧠 Understanding exam patterns...",
  "✍️ Generating new questions...",
  "🔍 Checking for PYQ similarities...",
  "📋 Formatting question paper...",
  "⏳ Almost ready...",
];

function defaultSection(): SectionConfig {
  return {
    id: crypto.randomUUID(),
    sectionLabel: "Section A",
    questionType: "short",
    customTypeName: "",
    numberOfQuestions: 5,
    marksPerQuestion: 2,
    hasSubQuestions: false,
    subQuestionsCount: 2,
    subQuestionsMarks: 5,
    instructions: "",
  };
}

function computeSectionMarks(section: SectionConfig): number {
  if (
    section.hasSubQuestions &&
    section.subQuestionsCount > 0 &&
    section.subQuestionsMarks > 0
  ) {
    return (
      section.numberOfQuestions *
      section.subQuestionsCount *
      section.subQuestionsMarks
    );
  }
  return section.numberOfQuestions * section.marksPerQuestion;
}

export default function FacultyQPaperPage() {
  const [subjects, setSubjects] = useState<SubjectRow[]>([]);
  const [selectedSubjectId, setSelectedSubjectId] = useState("");
  const [totalMarks, setTotalMarks] = useState<number>(100);
  const [duration, setDuration] = useState<number>(180);
  const [uniquenessMode, setUniquenessMode] =
    useState<UniquenessMode>("all_new");
  const [generalInstructions, setGeneralInstructions] = useState("");
  const [sections, setSections] = useState<SectionConfig[]>([
    defaultSection(),
  ]);
  const [view, setView] = useState<View>("form");
  const [result, setResult] = useState<{
    paper: GeneratedQPaper;
    downloadUrl: string;
  } | null>(null);
  const [generatingMsg, setGeneratingMsg] = useState(GENERATING_MESSAGES[0]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const selectedSubject = subjects.find((s) => s.id === selectedSubjectId);

  const fetchAssignedSubjects = useCallback(async () => {
    const supabase = createBrowserClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      setSubjects([]);
      return;
    }

    const { data: assignments, error: assignError } = await supabase
      .from("faculty_assignments")
      .select("subject_id")
      .eq("faculty_id", user.id);

    if (assignError) {
      toast.error("Failed to load assigned subjects");
      setSubjects([]);
      return;
    }

    const ids = [
      ...new Set(
        (assignments ?? [])
          .map((a: any) => a.subject_id as string | null)
          .filter(Boolean)
      ),
    ] as string[];

    if (ids.length === 0) {
      setSubjects([]);
      return;
    }

    const { data: subs, error: subError } = await supabase
      .from("subjects")
      .select("id, name, code")
      .in("id", ids)
      .order("code");

    if (subError) {
      toast.error("Failed to load subjects");
      setSubjects([]);
      return;
    }

    setSubjects((subs ?? []) as SubjectRow[]);
  }, []);

  useEffect(() => {
    fetchAssignedSubjects();
  }, [fetchAssignedSubjects]);

  useEffect(() => {
    if (view !== "generating") return;
    let idx = 0;
    const t = setInterval(() => {
      idx = (idx + 1) % GENERATING_MESSAGES.length;
      setGeneratingMsg(GENERATING_MESSAGES[idx]);
    }, 5000);
    intervalRef.current = t;
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = null;
    };
  }, [view]);

  const totalCalculated = sections.reduce(
    (acc, s) => acc + computeSectionMarks(s),
    0
  );
  const mismatchPercent =
    totalMarks > 0
      ? Math.abs(totalCalculated - totalMarks) / totalMarks
      : 0;

  const totalColor =
    totalCalculated === totalMarks
      ? "text-green-600"
      : totalCalculated > totalMarks
      ? "text-red-600"
      : "text-amber-600";

  const marksOk = mismatchPercent <= 0.05;

  const canGenerate =
    !!selectedSubjectId && sections.length > 0 && marksOk;

  const updateSection = (id: string, patch: Partial<SectionConfig>) => {
    setSections((prev) =>
      prev.map((s) => (s.id === id ? { ...s, ...patch } : s))
    );
  };

  const handleAddSection = () => {
    setSections((prev) => [...prev, defaultSection()]);
  };

  const handleRemoveSection = (id: string) => {
    setSections((prev) => prev.filter((s) => s.id !== id));
  };

  const handleGenerate = async () => {
    if (!canGenerate || !selectedSubject || !selectedSubjectId) return;

    setView("generating");
    setResult(null);

    try {
      const config = {
        subjectName: selectedSubject.name,
        subjectCode: selectedSubject.code,
        totalMarks,
        duration,
        uniquenessMode,
        sections: sections.map((s) => ({
          sectionLabel: s.sectionLabel,
          questionType: s.questionType,
          customTypeName: s.customTypeName || undefined,
          numberOfQuestions: s.numberOfQuestions,
          marksPerQuestion: s.marksPerQuestion,
          hasSubQuestions: s.hasSubQuestions,
          subQuestionsCount: s.hasSubQuestions
            ? s.subQuestionsCount
            : undefined,
          subQuestionsMarks: s.hasSubQuestions
            ? s.subQuestionsMarks
            : undefined,
          instructions: s.instructions || undefined,
        })),
        generalInstructions:
          generalInstructions ||
          "1. Answer all questions in the answer booklet provided.\n2. Figures to the right indicate full marks.\n3. Assume reasonable data wherever necessary and state assumptions clearly.\n4. Use neat diagrams wherever necessary.",
      };

      const res = await fetch("/api/generate/qpaper", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subjectId: selectedSubjectId,
          config,
        }),
      });
      const json = await res.json();

      if (!res.ok) {
        toast.error(json?.error ?? "Failed to generate question paper");
        setView("form");
        return;
      }

      setResult({
        paper: json.paper as GeneratedQPaper,
        downloadUrl: json.downloadUrl as string,
      });
      setView("preview");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to generate question paper"
      );
      setView("form");
    } finally {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }
  };

  const handleReset = () => {
    setView("form");
    setResult(null);
    setSections([defaultSection()]);
    setGeneratingMsg(GENERATING_MESSAGES[0]);
  };

  // ──── VIEW: form ─────────────────────────────────────────
  if (view === "form") {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-2">
          <FileText className="size-8 text-primary" />
          <h1 className="text-2xl font-semibold tracking-tight">
            Generate Question Paper
          </h1>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Paper Details</CardTitle>
            <CardDescription>
              Choose subject and configure marks, duration, and instructions.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Subject</Label>
              <Select
                value={selectedSubjectId}
                onValueChange={setSelectedSubjectId}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select subject..." />
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

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="total-marks">Total Marks</Label>
                <Input
                  id="total-marks"
                  type="number"
                  min={1}
                  value={totalMarks}
                  onChange={(e) =>
                    setTotalMarks(Number(e.target.value) || 0)
                  }
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="duration">Duration (minutes)</Label>
                <Input
                  id="duration"
                  type="number"
                  min={30}
                  value={duration}
                  onChange={(e) =>
                    setDuration(Number(e.target.value) || 0)
                  }
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="general-instructions">
                General Instructions
              </Label>
              <Textarea
                id="general-instructions"
                rows={4}
                placeholder="Any special instructions for students (optional)"
                value={generalInstructions}
                onChange={(e) => setGeneralInstructions(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>Uniqueness Mode</Label>
              <RadioGroup
                value={uniquenessMode}
                onValueChange={(v) => setUniquenessMode(v as UniquenessMode)}
                className="grid gap-3 sm:grid-cols-2"
              >
                <div className="flex items-start space-x-3 rounded-lg border p-3">
                  <RadioGroupItem value="all_new" id="mode-all-new" />
                  <Label
                    htmlFor="mode-all-new"
                    className="cursor-pointer flex-1"
                  >
                    <span className="font-medium">All New Questions</span>
                    <p className="text-muted-foreground text-sm mt-0.5">
                      Every question is freshly generated.
                    </p>
                  </Label>
                </div>
                <div className="flex items-start space-x-3 rounded-lg border p-3">
                  <RadioGroupItem value="mixed" id="mode-mixed" />
                  <Label
                    htmlFor="mode-mixed"
                    className="cursor-pointer flex-1"
                  >
                    <span className="font-medium">
                      Mixed (New + PYQ-inspired)
                    </span>
                    <p className="text-muted-foreground text-sm mt-0.5">
                      ~60% new, ~40% inspired by past papers.
                    </p>
                  </Label>
                </div>
              </RadioGroup>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle>Question Sections</CardTitle>
              <CardDescription>
                Define how many questions, marks, and types per section.
              </CardDescription>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleAddSection}
            >
              <Plus className="size-4" />
              Add Section
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            {sections.map((section, idx) => (
              <Card
                key={section.id}
                className="relative border-dashed border-muted-foreground/30"
              >
                <div className="absolute right-3 top-3">
                  <Badge variant="secondary">#{idx + 1}</Badge>
                </div>
                <CardContent className="pt-6 space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="flex-1 space-y-1">
                      <Label>Section Label</Label>
                      <Input
                        value={section.sectionLabel}
                        onChange={(e) =>
                          updateSection(section.id, {
                            sectionLabel: e.target.value,
                          })
                        }
                      />
                    </div>
                    {sections.length > 1 && (
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={() => handleRemoveSection(section.id)}
                        className="mt-6"
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    )}
                  </div>

                  <div className="space-y-1">
                    <Label>Question Type</Label>
                    <Select
                      value={section.questionType}
                      onValueChange={(v) =>
                        updateSection(section.id, {
                          questionType: v,
                          customTypeName:
                            v === "custom" ? section.customTypeName : "",
                        })
                      }
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select type..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="mcq">
                          Multiple Choice (MCQ)
                        </SelectItem>
                        <SelectItem value="short">
                          Short Answer (2-5M)
                        </SelectItem>
                        <SelectItem value="long">
                          Long Answer (10M+)
                        </SelectItem>
                        <SelectItem value="numerical">
                          Numerical Problem
                        </SelectItem>
                        <SelectItem value="true_false">
                          True or False
                        </SelectItem>
                        <SelectItem value="fill_blank">
                          Fill in the Blanks
                        </SelectItem>
                        <SelectItem value="custom">
                          Other (specify)
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {section.questionType === "custom" && (
                    <div className="space-y-1">
                      <Label>Custom Type Name</Label>
                      <Input
                        value={section.customTypeName}
                        onChange={(e) =>
                          updateSection(section.id, {
                            customTypeName: e.target.value,
                          })
                        }
                        placeholder="e.g. Case Study, Matching, Diagram-based"
                      />
                    </div>
                  )}

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="space-y-1">
                      <Label>No. of Questions</Label>
                      <Input
                        type="number"
                        min={1}
                        value={section.numberOfQuestions}
                        onChange={(e) =>
                          updateSection(section.id, {
                            numberOfQuestions:
                              Number(e.target.value) || 0,
                          })
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>Marks per Question</Label>
                      <Input
                        type="number"
                        min={1}
                        value={section.marksPerQuestion}
                        onChange={(e) =>
                          updateSection(section.id, {
                            marksPerQuestion: Number(e.target.value) || 0,
                          })
                        }
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-3">
                    <div className="space-y-1">
                      <Label>Has Sub-questions?</Label>
                      <p className="text-muted-foreground text-xs">
                        Use this for Q2(a), Q2(b) style questions.
                      </p>
                    </div>
                    <Switch
                      checked={section.hasSubQuestions}
                      onCheckedChange={(checked) =>
                        updateSection(section.id, {
                          hasSubQuestions: checked,
                        })
                      }
                    />
                  </div>

                  {section.hasSubQuestions && (
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div className="space-y-1">
                        <Label>Sub-questions count</Label>
                        <Input
                          type="number"
                          min={1}
                          value={section.subQuestionsCount}
                          onChange={(e) =>
                            updateSection(section.id, {
                              subQuestionsCount:
                                Number(e.target.value) || 0,
                            })
                          }
                        />
                      </div>
                      <div className="space-y-1">
                        <Label>Marks each</Label>
                        <Input
                          type="number"
                          min={1}
                          value={section.subQuestionsMarks}
                          onChange={(e) =>
                            updateSection(section.id, {
                              subQuestionsMarks:
                                Number(e.target.value) || 0,
                            })
                          }
                        />
                      </div>
                    </div>
                  )}

                  <div className="space-y-1">
                    <Label>Section Instructions</Label>
                    <Input
                      value={section.instructions}
                      onChange={(e) =>
                        updateSection(section.id, {
                          instructions: e.target.value,
                        })
                      }
                      placeholder='e.g. "Attempt any 3 out of 5" (optional)'
                    />
                  </div>
                </CardContent>
              </Card>
            ))}

            <div className="flex items-center justify-between">
              <p
                className={cn(
                  "text-sm font-medium",
                  totalColor
                )}
              >
                Current Total: {totalCalculated} / {totalMarks} marks
              </p>
              <p className="text-muted-foreground text-xs">
                Calculated = Σ (questions × marks per question), including
                sub-questions where enabled.
              </p>
            </div>
          </CardContent>
        </Card>

        <Button
          className="w-full h-11 text-base"
          disabled={!canGenerate}
          onClick={handleGenerate}
        >
          Generate Question Paper
        </Button>
      </div>
    );
  }

  // ──── VIEW: generating ────────────────────────────────────
  if (view === "generating") {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Card className="w-full max-w-md">
          <CardContent className="flex flex-col items-center gap-6 pt-8 pb-8">
            <Loader2 className="size-14 animate-spin text-primary" />
            <h2 className="text-xl font-semibold">
              Generating your question paper
            </h2>
            <p className="text-muted-foreground text-center text-sm">
              {generatingMsg}
            </p>
            <p className="text-muted-foreground text-xs">
              This may take 20–60 seconds. Please keep this tab open.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ──── VIEW: preview ───────────────────────────────────────
  if (view === "preview" && result) {
    const { paper, downloadUrl } = result;
    const headerSubject = `${paper.subjectName} (${paper.subjectCode})`;

    return (
      <div className="space-y-4">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-background/80 px-1 py-3 backdrop-blur">
          <div className="flex items-center gap-2">
            <FileText className="size-6 text-primary" />
            <div>
              <h2 className="text-lg font-semibold truncate max-w-[260px] sm:max-w-md">
                {paper.title}
              </h2>
              <p className="text-muted-foreground text-xs">
                {headerSubject} • {paper.totalMarks} marks •{" "}
                {paper.duration} minutes
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button asChild size="sm">
              <a
                href={downloadUrl}
                download
                target="_blank"
                rel="noopener noreferrer"
              >
                <Download className="size-4" />
                Download PDF
              </a>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleReset}
            >
              Generate Another
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href="/faculty/dashboard">Back to Dashboard</Link>
            </Button>
          </div>
        </div>

        <Card className="max-w-4xl mx-auto">
          <CardContent className="pt-8 pb-6 space-y-4">
            {/* HEADER */}
            <div className="text-center space-y-1">
              <p className="text-sm font-semibold tracking-wide">
                UNIVERSITY EXAMINATION
              </p>
              <hr className="my-2" />
              <p className="text-base font-semibold">{headerSubject}</p>
              <p className="text-sm">
                Total Marks: {paper.totalMarks} | Duration:{" "}
                {paper.duration} Minutes
              </p>
              <hr className="my-2" />
            </div>

            {/* INSTRUCTIONS */}
            {paper.generalInstructions?.trim() && (
              <div className="space-y-1">
                <p className="font-semibold text-sm">
                  General Instructions:
                </p>
                <p className="text-muted-foreground text-sm italic whitespace-pre-line">
                  {paper.generalInstructions}
                </p>
              </div>
            )}

            {/* SECTIONS */}
            <div className="space-y-6 mt-2">
              {paper.sections.map((section) => (
                <div key={section.label} className="space-y-3">
                  <div className="text-center space-y-1">
                    <p className="text-sm font-semibold">
                      --- {section.label} ---
                    </p>
                    {section.instructions && (
                      <p className="text-xs text-muted-foreground italic">
                        {section.instructions}
                      </p>
                    )}
                  </div>

                  <div className="space-y-3">
                    {section.questions.map((q) => (
                      <div
                        key={q.questionNumber}
                        className="space-y-1 border-b border-dashed border-muted-foreground/30 pb-2 last:border-b-0"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 space-y-1">
                            <p className="text-sm leading-relaxed">
                              <span className="font-semibold">
                                {q.questionNumber}.
                              </span>{" "}
                              {q.text}
                            </p>
                            {q.type === "mcq" &&
                              q.options &&
                              q.options.length === 4 && (
                                <div className="ml-6 text-sm space-y-0.5">
                                  <p>
                                    (a) {q.options[0]} &nbsp;&nbsp; (b){" "}
                                    {q.options[1]}
                                  </p>
                                  <p>
                                    (c) {q.options[2]} &nbsp;&nbsp; (d){" "}
                                    {q.options[3]}
                                  </p>
                                </div>
                              )}
                            {q.isFromPYQ && (
                              <Badge
                                variant="outline"
                                className="text-amber-700 border-amber-300 bg-amber-50 text-xs"
                              >
                                PYQ-inspired
                              </Badge>
                            )}
                          </div>
                          <div className="flex flex-col items-end gap-1">
                            <span className="text-xs text-muted-foreground">
                              [{q.marks}M]
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4 text-center text-xs text-muted-foreground italic">
              --- End of Question Paper ---
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return null;
}
