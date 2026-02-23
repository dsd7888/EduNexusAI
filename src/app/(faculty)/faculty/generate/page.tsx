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
import { Progress } from "@/components/ui/progress";
import {
  RadioGroup,
  RadioGroupItem,
} from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createBrowserClient } from "@/lib/db/supabase-browser";
import {
  BookOpen,
  CheckCircle,
  Download,
  Loader2,
  Presentation,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type View = "form" | "generating" | "done";
type InputMode = "module" | "topic";
type Depth = "basic" | "intermediate" | "advanced";

interface SubjectRow {
  id: string;
  name: string;
  code: string;
}

interface ModuleRow {
  id: string;
  name: string;
  module_number: number;
}

const GENERATING_MESSAGES = [
  "📚 Reading syllabus content...",
  "🧠 Planning slide structure...",
  "✍️ Writing concept explanations...",
  "📊 Generating diagrams...",
  "📝 Creating worked examples...",
  "✏️ Adding practice questions...",
  "🎨 Formatting presentation...",
  "⏳ Almost there...",
];

const DEPTH_OPTIONS: { value: Depth; label: string; desc: string }[] = [
  {
    value: "basic",
    label: "Basic",
    desc: "Introductory, simple examples, minimal math",
  },
  {
    value: "intermediate",
    label: "Intermediate",
    desc: "Complete university coverage, full derivations",
  },
  {
    value: "advanced",
    label: "Advanced",
    desc: "Rigorous treatment, complex problems, industry applications",
  },
];

export default function FacultyGeneratePage() {
  const [subjects, setSubjects] = useState<SubjectRow[]>([]);
  const [modules, setModules] = useState<ModuleRow[]>([]);
  const [selectedSubjectId, setSelectedSubjectId] = useState("");
  const [inputMode, setInputMode] = useState<InputMode>("module");
  const [selectedModuleName, setSelectedModuleName] = useState("");
  const [customTopic, setCustomTopic] = useState("");
  const [depth, setDepth] = useState<Depth>("intermediate");
  const [view, setView] = useState<View>("form");
  const [result, setResult] = useState<{
    downloadUrl: string;
    title: string;
    slideCount: number;
  } | null>(null);
  const [generatingMessage, setGeneratingMessage] = useState(
    GENERATING_MESSAGES[0]
  );
  const [progress, setProgress] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const progressRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const selectedSubjectName =
    subjects.find((s) => s.id === selectedSubjectId)?.name ?? "";

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

    const ids = [...new Set((assignments ?? []).map((a) => a.subject_id).filter(Boolean))];
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

  const fetchModules = useCallback(async (subjectId: string) => {
    if (!subjectId) {
      setModules([]);
      return;
    }
    const supabase = createBrowserClient();
    const { data, error } = await supabase
      .from("modules")
      .select("id, name, module_number")
      .eq("subject_id", subjectId)
      .order("module_number");
    if (!error && data) {
      setModules((data ?? []) as ModuleRow[]);
    } else {
      setModules([]);
    }
  }, []);

  useEffect(() => {
    fetchAssignedSubjects();
  }, [fetchAssignedSubjects]);

  useEffect(() => {
    if (selectedSubjectId) {
      fetchModules(selectedSubjectId);
    } else {
      setModules([]);
    }
  }, [selectedSubjectId, fetchModules]);

  useEffect(() => {
    if (view !== "generating") return;
    let idx = 0;
    const t = setInterval(() => {
      idx = (idx + 1) % GENERATING_MESSAGES.length;
      setGeneratingMessage(GENERATING_MESSAGES[idx]);
    }, 6000);
    intervalRef.current = t;
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = null;
    };
  }, [view]);

  useEffect(() => {
    if (view !== "generating") return;
    setProgress(0);
    const start = Date.now();
    const duration = 60000;
    const t = setInterval(() => {
      const elapsed = Date.now() - start;
      const pct = Math.min(95, (elapsed / duration) * 100);
      setProgress(pct);
    }, 500);
    progressRef.current = t;
    return () => {
      if (progressRef.current) clearInterval(progressRef.current);
      progressRef.current = null;
    };
  }, [view]);

  const handleGenerate = async () => {
    if (!selectedSubjectId) return;
    if (inputMode === "module" && !selectedModuleName) return;
    if (inputMode === "topic" && !customTopic.trim()) return;

    setView("generating");
    setResult(null);

    try {
      const res = await fetch("/api/generate/ppt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subjectId: selectedSubjectId,
          moduleName: inputMode === "module" ? selectedModuleName : undefined,
          customTopic:
            inputMode === "topic" ? customTopic.trim() || undefined : undefined,
          depth,
        }),
      });
      const json = await res.json();

      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      if (progressRef.current) {
        clearInterval(progressRef.current);
        progressRef.current = null;
      }

      if (!res.ok) {
        toast.error(json?.error ?? "Failed to generate presentation");
        setView("form");
        return;
      }

      setResult({
        downloadUrl: json.downloadUrl,
        title: json.title,
        slideCount: json.slideCount,
      });
      setView("done");
    } catch (e) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (progressRef.current) clearInterval(progressRef.current);
      toast.error(e instanceof Error ? e.message : "Failed to generate");
      setView("form");
    }
  };

  const handleGenerateAnother = () => {
    setView("form");
    setResult(null);
    setGeneratingMessage(GENERATING_MESSAGES[0]);
    setProgress(0);
    setSelectedModuleName("");
    setCustomTopic("");
  };

  const canGenerate =
    selectedSubjectId &&
    (inputMode === "module" ? selectedModuleName : customTopic.trim());

  // ──── VIEW: form ─────────────────────────────────────────
  if (view === "form") {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-2">
          <Presentation className="size-8 text-primary" />
          <h1 className="text-2xl font-semibold tracking-tight">
            Generate Presentation
          </h1>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Content</CardTitle>
            <CardDescription>
              Choose a subject and either a module or custom topic
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Subject</Label>
              <Select
                value={selectedSubjectId}
                onValueChange={(v) => {
                  setSelectedSubjectId(v);
                  setSelectedModuleName("");
                }}
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
              <Label>Source</Label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setInputMode("module")}
                  className={cn(
                    "flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium transition-colors",
                    inputMode === "module"
                      ? "bg-primary text-primary-foreground border-primary"
                      : "border-input hover:bg-muted"
                  )}
                >
                  <BookOpen className="size-4" />
                  From Module
                </button>
                <button
                  type="button"
                  onClick={() => setInputMode("topic")}
                  className={cn(
                    "flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium transition-colors",
                    inputMode === "topic"
                      ? "bg-primary text-primary-foreground border-primary"
                      : "border-input hover:bg-muted"
                  )}
                >
                  ✏️ Custom Topic
                </button>
              </div>
            </div>

            {inputMode === "module" ? (
              <div className="space-y-2">
                <Label>Module</Label>
                <Select
                  value={selectedModuleName}
                  onValueChange={setSelectedModuleName}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select module..." />
                  </SelectTrigger>
                  <SelectContent>
                    {modules.map((m) => (
                      <SelectItem key={m.id} value={m.name}>
                        Module {m.module_number}: {m.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="custom-topic">Custom Topic</Label>
                <Input
                  id="custom-topic"
                  placeholder="e.g. Rankine Cycle, Organic Reactions..."
                  value={customTopic}
                  onChange={(e) => setCustomTopic(e.target.value)}
                />
                <p className="text-muted-foreground text-xs">
                  AI will use your subject syllabus as the knowledge base
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Depth Level</CardTitle>
            <CardDescription>
              Controls complexity and mathematical rigor
            </CardDescription>
          </CardHeader>
          <CardContent>
            <RadioGroup
              value={depth}
              onValueChange={(v) => setDepth(v as Depth)}
              className="grid gap-3"
            >
              {DEPTH_OPTIONS.map((opt) => (
                <div
                  key={opt.value}
                  className="flex items-start space-x-3 rounded-lg border p-4"
                >
                  <RadioGroupItem value={opt.value} id={`depth-${opt.value}`} />
                  <Label
                    htmlFor={`depth-${opt.value}`}
                    className="cursor-pointer flex-1"
                  >
                    <span className="font-medium">{opt.label}</span>
                    <p className="text-muted-foreground text-sm mt-0.5">
                      {opt.desc}
                    </p>
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </CardContent>
        </Card>

        <Card className="bg-muted/50">
          <CardHeader>
            <CardTitle className="text-base">What gets generated</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="flex items-center gap-2">
                <span className="text-green-600">✓</span> Title & overview
              </div>
              <div className="flex items-center gap-2">
                <span className="text-green-600">✓</span> Concept slides
              </div>
              <div className="flex items-center gap-2">
                <span className="text-green-600">✓</span> SVG diagrams
              </div>
              <div className="flex items-center gap-2">
                <span className="text-green-600">✓</span> Worked examples
              </div>
              <div className="flex items-center gap-2">
                <span className="text-green-600">✓</span> Practice Qs
              </div>
              <div className="flex items-center gap-2">
                <span className="text-green-600">✓</span> Summary slide
              </div>
            </div>
            <p className="text-muted-foreground text-center text-sm mt-4">
              Estimated 35–50 slides for a full module
            </p>
          </CardContent>
        </Card>

        <Button
          className="w-full h-12 text-base"
          size="lg"
          disabled={!canGenerate}
          onClick={handleGenerate}
        >
          Generate Presentation
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
            <Loader2 className="size-16 animate-spin text-primary" />
            <h2 className="text-xl font-semibold">
              Generating your presentation
            </h2>
            <p className="text-muted-foreground text-center text-sm">
              {generatingMessage}
            </p>
            <Progress value={progress} className="w-full" />
            <p className="text-muted-foreground text-xs">
              This takes 30–60 seconds. Please keep this tab open.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ──── VIEW: done ──────────────────────────────────────────
  if (view === "done" && result) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Card className="w-full max-w-lg">
          <CardContent className="flex flex-col items-center gap-6 pt-8 pb-8">
            <CheckCircle className="size-16 text-green-600" />
            <h2 className="text-xl font-bold text-center">{result.title}</h2>
            <Badge variant="secondary">{result.slideCount} slides</Badge>

            <div className="grid grid-cols-3 gap-4 w-full text-center border rounded-lg p-4">
              <div>
                <p className="text-muted-foreground text-xs">Slides</p>
                <p className="font-medium">{result.slideCount}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Subject</p>
                <p className="font-medium truncate" title={selectedSubjectName}>
                  {selectedSubjectName || "—"}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Level</p>
                <p className="font-medium capitalize">{depth}</p>
              </div>
            </div>

            <Button asChild className="w-full h-12 text-base" size="lg">
              <a
                href={result.downloadUrl}
                download
                target="_blank"
                rel="noopener noreferrer"
              >
                <Download className="size-5" />
                Download Presentation (.pptx)
              </a>
            </Button>

            <div className="w-full rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/50">
              <p className="text-amber-800 dark:text-amber-200 text-sm">
                💡 Diagram slides contain SVG visuals rendered directly in
                PowerPoint
              </p>
            </div>

            <div className="flex gap-3 w-full">
              <Button
                variant="outline"
                className="flex-1"
                onClick={handleGenerateAnother}
              >
                Generate Another
              </Button>
              <Button variant="outline" asChild className="flex-1">
                <Link href="/faculty/dashboard">Back to Dashboard</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return null;
}
