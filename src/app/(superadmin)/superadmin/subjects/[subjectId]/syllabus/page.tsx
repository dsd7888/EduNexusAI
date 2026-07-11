"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import {
  ArrowLeft,
  CheckCircle2,
  ChevronLeft,
  Loader2,
  Upload,
} from "lucide-react";

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
import { Badge } from "@/components/ui/badge";

import {
  StructuredSyllabusEditor,
  emptyExtracted,
} from "@/components/syllabus/StructuredSyllabusEditor";
import type { ExtractedSyllabus } from "@/lib/syllabus/types";

type ViewState = "empty" | "uploading" | "reviewing" | "saving" | "saved" | "error";

export default function SyllabusPage() {
  const params = useParams<{ subjectId: string }>();
  const subjectId = params.subjectId;
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [view, setView] = useState<ViewState>("empty");
  const [subject, setSubject] = useState<{
    id: string;
    code: string;
    name: string;
  } | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [extracted, setExtracted] = useState<ExtractedSyllabus>(emptyExtracted());
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  // Initial load
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(
          `/api/syllabus/load?subject_id=${encodeURIComponent(subjectId)}`
        );
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          toast.error(j.error ?? "Failed to load subject");
          return;
        }
        const json = await res.json();
        if (cancelled) return;
        setSubject(json.subject);
        if (json.extracted) {
          setExtracted(json.extracted);
          setUpdatedAt(json.updated_at ?? null);
          setView("saved");
        } else {
          setView("empty");
        }
      } catch {
        if (!cancelled) toast.error("Failed to load subject");
      }
    }
    if (subjectId) load();
    return () => {
      cancelled = true;
    };
  }, [subjectId]);

  const handleExtract = useCallback(async () => {
    if (!file) {
      toast.error("Please choose a PDF first");
      return;
    }
    setView("uploading");
    setErrorMessage("");
    try {
      const form = new FormData();
      form.append("pdf", file);
      form.append("subject_id", subjectId);
      const res = await fetch("/api/syllabus/extract", {
        method: "POST",
        body: form,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorMessage(json.error ?? "Extraction failed");
        setView("error");
        toast.error(json.error ?? "Extraction failed");
        return;
      }
      setExtracted(json.extracted as ExtractedSyllabus);
      setDirty(true);
      setView("reviewing");
      toast.success("Extracted — review and save");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Extraction failed";
      setErrorMessage(message);
      setView("error");
      toast.error(message);
    }
  }, [file, subjectId]);

  const handleSave = useCallback(async () => {
    setView("saving");
    try {
      const res = await fetch("/api/syllabus/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject_id: subjectId, extracted }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json.error ?? "Save failed");
        setView(dirty ? "reviewing" : "saved");
        return;
      }
      const warnings: string[] = Array.isArray(json.warnings)
        ? json.warnings
        : [];
      if (warnings.length > 0) {
        toast.warning(`Saved with ${warnings.length} warnings`);
        console.warn("[syllabus/save] warnings:", warnings);
      } else {
        toast.success("Saved");
      }
      setUpdatedAt(new Date().toISOString());
      setDirty(false);
      setView("saved");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Save failed";
      toast.error(message);
      setView(dirty ? "reviewing" : "saved");
    }
  }, [extracted, subjectId, dirty]);

  const resetToEmpty = useCallback(() => {
    setExtracted(emptyExtracted());
    setFile(null);
    setDirty(false);
    setView("empty");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  // Helpers for child sections to mark dirty
  const update = useCallback(
    (mutator: (draft: ExtractedSyllabus) => void) => {
      setExtracted((prev) => {
        const next = structuredClone(prev) as ExtractedSyllabus;
        mutator(next);
        return next;
      });
      setDirty(true);
    },
    []
  );

  const isBusy = view === "uploading" || view === "saving";

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <Link
            href="/superadmin/subjects"
            className="text-sm text-muted-foreground inline-flex items-center gap-1 hover:underline"
          >
            <ChevronLeft className="size-4" /> Back to subjects
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight mt-2">
            {subject ? `${subject.code} — ${subject.name}` : "Loading..."}
          </h1>
          <p className="text-muted-foreground text-sm">
            Single source of truth for this subject&apos;s syllabus.
          </p>
        </div>
        {view === "saved" && !dirty && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            {updatedAt && (
              <span>Last updated: {new Date(updatedAt).toLocaleString()}</span>
            )}
          </div>
        )}
        {dirty && view !== "uploading" && view !== "saving" && (
          <Badge variant="outline" className="text-amber-700 border-amber-400">
            Unsaved changes
          </Badge>
        )}
      </div>

      {view === "empty" && (
        <Card>
          <CardHeader>
            <CardTitle>Upload syllabus PDF</CardTitle>
            <CardDescription>
              We&apos;ll extract course info, modules, COs, CO-PO mapping,
              practicals and reference books — then you review before saving.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="syllabus-pdf">PDF file</Label>
              <Input
                id="syllabus-pdf"
                ref={fileInputRef}
                type="file"
                accept=".pdf"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </div>
            <Button
              onClick={handleExtract}
              disabled={!file || isBusy}
              className="gap-2"
            >
              <Upload className="size-4" />
              Upload &amp; Extract
            </Button>
          </CardContent>
        </Card>
      )}

      {view === "uploading" && (
        <Card>
          <CardContent className="py-12 flex flex-col items-center gap-3">
            <Loader2 className="size-8 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Extracting structured data from PDF...
            </p>
          </CardContent>
        </Card>
      )}

      {view === "error" && (
        <Card>
          <CardHeader>
            <CardTitle>Extraction failed</CardTitle>
            <CardDescription>{errorMessage}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" onClick={resetToEmpty} className="gap-2">
              <ArrowLeft className="size-4" />
              Try again
            </Button>
          </CardContent>
        </Card>
      )}

      {(view === "reviewing" || view === "saving" || view === "saved") && (
        <>
          {view === "saved" && !dirty && (
            <div className="border border-emerald-300 bg-emerald-50 text-emerald-900 rounded-md p-3 flex items-center gap-2 text-sm">
              <CheckCircle2 className="size-4" />
              Syllabus saved.
            </div>
          )}

          <div className="flex items-center gap-2 flex-wrap">
            <Button onClick={handleSave} disabled={isBusy} className="gap-2">
              {view === "saving" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : null}
              Save to database
            </Button>
            <Button
              variant="outline"
              onClick={resetToEmpty}
              disabled={isBusy}
              className="gap-2"
            >
              <Upload className="size-4" />
              Re-upload PDF
            </Button>
          </div>

          <StructuredSyllabusEditor extracted={extracted} update={update} />
        </>
      )}
    </div>
  );
}
