"use client";

import ReactMarkdown from "react-markdown";

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
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { createBrowserClient } from "@/lib/db/supabase-browser";
import {
  RefinementType,
  REFINEMENT_LABELS,
} from "@/lib/refine/generator";
import { cn } from "@/lib/utils";
import {
  CheckCircle,
  Copy,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

type View = "form" | "result";

interface SubjectRow {
  id: string;
  name: string;
  code: string;
}

const REFINEMENT_META: Record<
  RefinementType,
  { icon: string; title: string; desc: string }
> = {
  readability: {
    icon: "✨",
    title: "Improve Readability",
    desc: "Clearer structure and simpler language",
  },
  examples: {
    icon: "🌍",
    title: "Real-World Examples",
    desc: "Modern, relatable applications added",
  },
  practice: {
    icon: "📝",
    title: "Practice Problems",
    desc: "Practice questions with hints added",
  },
  expand: {
    icon: "🔍",
    title: "Expand Thin Sections",
    desc: "Add depth to under-explained parts",
  },
  simplify: {
    icon: "🎓",
    title: "Simplify Content",
    desc: "Adapt for lower semester students",
  },
};

const TARGET_SEMESTERS = [1, 2, 3, 4, 5, 6, 7, 8] as const;

export default function FacultyRefinePage() {
  const [subjects, setSubjects] = useState<SubjectRow[]>([]);
  const [selectedSubjectId, setSelectedSubjectId] = useState("");
  const [contentToRefine, setContentToRefine] = useState("");
  const [refinementTypes, setRefinementTypes] = useState<RefinementType[]>([
    "readability",
  ]);
  const [targetSemester, setTargetSemester] = useState<number>(3);
  const [isRefining, setIsRefining] = useState(false);
  const [refinedContent, setRefinedContent] = useState("");
  const [view, setView] = useState<View>("form");
  const [charCount, setCharCount] = useState(0);

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

  const toggleType = (t: RefinementType) => {
    setRefinementTypes((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]
    );
  };

  const onContentChange = (value: string) => {
    setContentToRefine(value);
    setCharCount(value.length);
  };

  const charColor =
    charCount > 13000
      ? "text-red-600"
      : charCount > 10000
      ? "text-amber-600"
      : "text-muted-foreground";

  const canRefine =
    !!selectedSubjectId &&
    !!contentToRefine.trim() &&
    refinementTypes.length > 0 &&
    !isRefining;

  const handleRefine = async () => {
    if (!canRefine) return;
    if (!selectedSubjectId) {
      toast.error("Please select a subject");
      return;
    }

    setIsRefining(true);

    try {
      const res = await fetch("/api/refine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subjectId: selectedSubjectId,
          contentToRefine,
          refinementTypes,
          targetSemester:
            refinementTypes.includes("simplify") ? targetSemester : undefined,
        }),
      });
      const json = await res.json();

      if (!res.ok) {
        toast.error(json?.error ?? "Failed to refine content");
        setIsRefining(false);
        return;
      }

      setRefinedContent(String(json.refinedContent ?? ""));
      setView("result");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to refine content"
      );
    } finally {
      setIsRefining(false);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(refinedContent);
      toast.success("Copied!");
    } catch {
      toast.error("Failed to copy");
    }
  };

  const handleRefineAgain = () => {
    setView("form");
    // keep content and settings as-is
  };

  // ──── VIEW: form ─────────────────────────────────────────
  if (view === "form") {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-2">
          <Sparkles className="size-7 text-primary" />
          <h1 className="text-2xl font-semibold tracking-tight">
            Refine Content
          </h1>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Your Content</CardTitle>
            <CardDescription>
              Paste your existing notes or explanations and let AI polish them.
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

            <div className="space-y-2">
              <Label htmlFor="content">Content to refine</Label>
              <Textarea
                id="content"
                rows={16}
                maxLength={15000}
                value={contentToRefine}
                onChange={(e) => onContentChange(e.target.value)}
                placeholder={
                  "Paste your existing notes, content, or topic explanation here...\n\nTip: Copy-paste from your existing PDFs or documents"
                }
              />
              <div className="flex justify-end">
                <span className={cn("text-xs", charColor)}>
                  {charCount} / 15,000 characters
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Refinement Options</CardTitle>
            <CardDescription>
              Choose what kinds of improvements you want applied.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Label className="text-sm">
              What should be improved?{" "}
              <span className="text-muted-foreground text-xs">
                (you can select multiple)
              </span>
            </Label>

            <div className="grid gap-3 sm:grid-cols-2">
              {(Object.keys(REFINEMENT_META) as RefinementType[]).map(
                (key) => {
                  const meta = REFINEMENT_META[key];
                  const selected = refinementTypes.includes(key);
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => toggleType(key)}
                      className={cn(
                        "flex flex-col items-start rounded-lg border p-3 text-left transition-colors",
                        selected
                          ? "border-primary bg-primary/5"
                          : "border-border hover:border-primary/30"
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <span>{meta.icon}</span>
                        <span className="font-medium text-sm">
                          {meta.title}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        {meta.desc}
                      </p>
                    </button>
                  );
                }
              )}
            </div>

            {refinementTypes.includes("simplify") && (
              <div className="space-y-2">
                <Label>Target Semester</Label>
                <Select
                  value={String(targetSemester)}
                  onValueChange={(v) => setTargetSemester(Number(v))}
                >
                  <SelectTrigger className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TARGET_SEMESTERS.map((sem) => (
                      <SelectItem key={sem} value={String(sem)}>
                        Semester {sem}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </CardContent>
        </Card>

        <Button
          className="w-full h-11 text-base"
          disabled={!canRefine}
          onClick={handleRefine}
        >
          {isRefining ? (
            <>
              <Sparkles className="size-4 animate-spin" />
              Refining your content...
            </>
          ) : (
            <>
              <Sparkles className="size-4" />
              Refine Content
            </>
          )}
        </Button>
      </div>
    );
  }

  // ──── VIEW: result ────────────────────────────────────────
  if (view === "result") {
    const applied = refinementTypes;

    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle className="size-6 text-green-600" />
            <h1 className="text-xl font-semibold">Refined Content</h1>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              type="button"
              onClick={handleCopy}
            >
              <Copy className="size-4" />
              Copy to Clipboard
            </Button>
            <Button
              variant="outline"
              size="sm"
              type="button"
              onClick={handleRefineAgain}
            >
              <RotateCcw className="size-4" />
              Refine Again
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {applied.map((t) => (
            <Badge key={t} variant="secondary" className="text-xs">
              {REFINEMENT_META[t].icon}{" "}
              {REFINEMENT_LABELS[t] ?? REFINEMENT_META[t].title}
            </Badge>
          ))}
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Card className="h-full">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Original Content
              </CardTitle>
            </CardHeader>
            <Separator />
            <CardContent className="pt-4">
              <div className="max-h-[600px] overflow-y-auto rounded border bg-muted/40 p-3 text-sm text-muted-foreground whitespace-pre-wrap">
                {contentToRefine}
              </div>
            </CardContent>
          </Card>

          <Card className="h-full">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold text-primary">
                Refined Content
              </CardTitle>
            </CardHeader>
            <Separator />
            <CardContent className="pt-4">
              <div className="max-h-[600px] overflow-y-auto rounded border-l-4 border-green-500 bg-background p-3 text-sm prose prose-sm dark:prose-invert">
                <ReactMarkdown>{refinedContent}</ReactMarkdown>
              </div>
            </CardContent>
          </Card>
        </div>

        <p className="text-center text-xs text-muted-foreground">
          💡 Copy the refined content and paste it into your preferred editor to
          make further adjustments before sharing with students.
        </p>
      </div>
    );
  }

  return null;
}

