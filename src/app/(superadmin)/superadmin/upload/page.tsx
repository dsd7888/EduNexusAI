"use client";

import { createBrowserClient } from "@/lib/db/supabase-browser";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

type DocumentType = "syllabus" | "notes" | "pyq";

interface Subject {
  id: string;
  name: string;
  code: string;
}

interface Module {
  id: string;
  name: string;
  module_number: number;
}

function clearFileInput(input: HTMLInputElement | null) {
  if (input) {
    input.value = "";
  }
}

export default function UploadPage() {
  const fileInputRefSyllabus = useRef<HTMLInputElement>(null);
  const fileInputRefNotes = useRef<HTMLInputElement>(null);
  const fileInputRefPyq = useRef<HTMLInputElement>(null);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [modules, setModules] = useState<Module[]>([]);
  const [subjectId, setSubjectId] = useState("");
  const [moduleId, setModuleId] = useState("");
  const [year, setYear] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<DocumentType>("syllabus");

  const fetchSubjects = useCallback(async () => {
    const supabase = createBrowserClient();
    const { data, error } = await supabase
      .from("subjects")
      .select("id, name, code")
      .order("name");
    if (error) {
      toast.error("Failed to load subjects");
      return;
    }
    setSubjects(data ?? []);
  }, []);

  const fetchModules = useCallback(async (sid: string) => {
    if (!sid) {
      setModules([]);
      setModuleId("");
      return;
    }
    const supabase = createBrowserClient();
    const { data, error } = await supabase
      .from("modules")
      .select("id, name, module_number")
      .eq("subject_id", sid)
      .order("module_number");
    if (error) {
      toast.error("Failed to load modules");
      setModules([]);
      return;
    }
    setModules(data ?? []);
    setModuleId("");
  }, []);

  useEffect(() => {
    fetchSubjects();
  }, [fetchSubjects]);

  useEffect(() => {
    if (subjectId) {
      fetchModules(subjectId);
    } else {
      setModules([]);
      setModuleId("");
    }
  }, [subjectId, fetchModules]);

  const validate = useCallback(
    (type: DocumentType): string | null => {
      if (!subjectId) return "Please select a subject.";
      if (!file) return "Please select a PDF file.";
      if (file.type !== "application/pdf") return "Only PDF files are allowed.";
      if (type === "notes" && !moduleId) return "Please select a module.";
      if (type === "pyq") {
        const y = Number(year);
        if (!year || isNaN(y) || y < 2020 || y > 2026)
          return "Please enter a valid year (2020–2026).";
      }
      return null;
    },
    [subjectId, moduleId, year, file]
  );

  const clearForm = useCallback(() => {
    setSubjectId("");
    setModuleId("");
    setYear("");
    setFile(null);
    clearFileInput(fileInputRefSyllabus.current);
    clearFileInput(fileInputRefNotes.current);
    clearFileInput(fileInputRefPyq.current);
  }, []);

  const handleSubmit = useCallback(
    async (type: DocumentType) => {
      const err = validate(type);
      if (err) {
        toast.error(err);
        return;
      }

      setLoading(true);
      try {
        const formData = new FormData();
        formData.append("type", type);
        formData.append("subjectId", subjectId);
        if (type === "notes" && moduleId) formData.append("moduleId", moduleId);
        if (type === "pyq" && year) formData.append("year", year);
        formData.append("file", file!);

        const res = await fetch("/api/upload", {
          method: "POST",
          body: formData,
        });

        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast.error(json.error ?? "Upload failed");
          return;
        }
        toast.success("Upload successful");
        clearForm();
      } catch {
        toast.error("Upload failed");
      } finally {
        setLoading(false);
      }
    },
    [subjectId, moduleId, year, file, validate, clearForm]
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Upload Content</h1>
        <p className="text-muted-foreground text-sm">
          Upload syllabus, notes, or previous year questions as PDF.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Upload Document</CardTitle>
          <CardDescription>
            Select the type, subject, and file. Module and year are required for
            Notes and PYQs.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs
            value={activeTab}
            onValueChange={(v) => setActiveTab(v as DocumentType)}
          >
            <TabsList>
              <TabsTrigger value="syllabus">Syllabus</TabsTrigger>
              <TabsTrigger value="notes">Notes</TabsTrigger>
              <TabsTrigger value="pyq">Previous Year Questions</TabsTrigger>
            </TabsList>

            <TabsContent value="syllabus" className="mt-6 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="subject-syllabus">Subject</Label>
                <Select
                  value={subjectId}
                  onValueChange={setSubjectId}
                  disabled={loading}
                >
                  <SelectTrigger id="subject-syllabus" className="w-full">
                    <SelectValue placeholder="Select subject" />
                  </SelectTrigger>
                  <SelectContent>
                    {subjects.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name} ({s.code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="file-syllabus">PDF File</Label>
                <Input
                  id="file-syllabus"
                  ref={fileInputRefSyllabus}
                  type="file"
                  accept=".pdf"
                  disabled={loading}
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
              </div>
              <Button
                onClick={() => handleSubmit("syllabus")}
                disabled={loading}
                className="gap-2"
              >
                {loading ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Upload className="size-4" />
                )}
                Upload
              </Button>
            </TabsContent>

            <TabsContent value="notes" className="mt-6 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="subject-notes">Subject</Label>
                <Select
                  value={subjectId}
                  onValueChange={setSubjectId}
                  disabled={loading}
                >
                  <SelectTrigger id="subject-notes" className="w-full">
                    <SelectValue placeholder="Select subject" />
                  </SelectTrigger>
                  <SelectContent>
                    {subjects.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name} ({s.code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="module-notes">Module</Label>
                <Select
                  value={moduleId}
                  onValueChange={setModuleId}
                  disabled={loading || !subjectId}
                >
                  <SelectTrigger id="module-notes" className="w-full">
                    <SelectValue placeholder="Select module" />
                  </SelectTrigger>
                  <SelectContent>
                    {modules.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        Module {m.module_number}: {m.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="file-notes">PDF File</Label>
                <Input
                  id="file-notes"
                  ref={fileInputRefNotes}
                  type="file"
                  accept=".pdf"
                  disabled={loading}
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
              </div>
              <Button
                onClick={() => handleSubmit("notes")}
                disabled={loading}
                className="gap-2"
              >
                {loading ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Upload className="size-4" />
                )}
                Upload
              </Button>
            </TabsContent>

            <TabsContent value="pyq" className="mt-6 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="subject-pyq">Subject</Label>
                <Select
                  value={subjectId}
                  onValueChange={setSubjectId}
                  disabled={loading}
                >
                  <SelectTrigger id="subject-pyq" className="w-full">
                    <SelectValue placeholder="Select subject" />
                  </SelectTrigger>
                  <SelectContent>
                    {subjects.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name} ({s.code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="year-pyq">Year</Label>
                <Input
                  id="year-pyq"
                  type="number"
                  min={2020}
                  max={2026}
                  placeholder="e.g. 2024"
                  value={year}
                  onChange={(e) => setYear(e.target.value)}
                  disabled={loading}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="file-pyq">PDF File</Label>
                <Input
                  id="file-pyq"
                  ref={fileInputRefPyq}
                  type="file"
                  accept=".pdf"
                  disabled={loading}
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
              </div>
              <Button
                onClick={() => handleSubmit("pyq")}
                disabled={loading}
                className="gap-2"
              >
                {loading ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Upload className="size-4" />
                )}
                Upload
              </Button>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
