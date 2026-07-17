"use client";

/**
 * Faculty "Add Subject" flow — a dedicated page (not a modal) because it's a genuine
 * multi-step flow with a real, seconds-long processing state (extraction + CO
 * classification) that needs room to breathe.
 *
 *   1. Search the catalog, or type a new subject code.
 *   2a. Pick an existing one  → no file needed, you're just added to it.
 *   2b. Type a new one        → enter a name + upload the syllabus PDF.
 *   3. Submit → land in /faculty/syllabus?subject={id} (the existing confirm view).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { ChevronLeft, Loader2, Plus, Search, Upload } from "lucide-react";

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
import { BRANCHES, MAX_SEMESTER, MIN_SEMESTER } from "@/lib/constants/branches";

const SEMESTERS = Array.from(
  { length: MAX_SEMESTER - MIN_SEMESTER + 1 },
  (_, i) => MIN_SEMESTER + i
);

interface CatalogSubject {
  id: string;
  code: string;
  name: string;
}

export default function AddSubjectPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [catalog, setCatalog] = useState<CatalogSubject[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);

  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<CatalogSubject | null>(null);
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [branch, setBranch] = useState("");
  const [semester, setSemester] = useState("");

  // "idle" | "adding" — a single honest processing state. We can't see the server's
  // extract→classify phase boundary from one request, so we don't fake granular steps.
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/faculty/subjects/catalog")
      .then((r) => (r.ok ? r.json() : { subjects: [] }))
      .then((j) => {
        if (cancelled) return;
        setCatalog((j.subjects ?? []) as CatalogSubject[]);
        setCatalogLoading(false);
      })
      .catch(() => {
        if (!cancelled) setCatalogLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const trimmedQuery = query.trim();

  const suggestions = useMemo(() => {
    if (selected || !trimmedQuery) return [];
    const q = trimmedQuery.toLowerCase();
    return catalog
      .filter(
        (s) =>
          s.code.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)
      )
      .slice(0, 8);
  }, [catalog, trimmedQuery, selected]);

  // An exact code match (case-insensitive) means "existing subject" even if the
  // faculty free-typed it rather than clicking a suggestion.
  const exactMatch = useMemo(() => {
    if (!trimmedQuery) return null;
    const q = trimmedQuery.toLowerCase();
    return catalog.find((s) => s.code.toLowerCase() === q) ?? null;
  }, [catalog, trimmedQuery]);

  const activeExisting = selected ?? exactMatch;
  const showNewSubjectPanel = !activeExisting && trimmedQuery.length > 0;

  const pickExisting = (s: CatalogSubject) => {
    setSelected(s);
    setQuery(s.code);
  };

  const handleQueryChange = (value: string) => {
    setQuery(value);
    if (selected) setSelected(null);
  };

  const submit = useCallback(
    async (formData: FormData) => {
      setSubmitting(true);
      try {
        const res = await fetch("/api/faculty/subjects/upload", {
          method: "POST",
          body: formData,
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast.error(json.error ?? "Couldn't add this subject");
          setSubmitting(false);
          return;
        }
        if (json.status === "assigned_existing") {
          if (json.alreadyInList && !json.newOffering) {
            toast.success("That subject was already in your list");
          } else if (json.alreadyInList && json.newOffering) {
            toast.success("Added this branch/semester to a subject already in your list");
          } else {
            toast.success("You've been added to this subject");
          }
        } else {
          toast.success("Subject added");
        }
        // Land directly in the existing confirm/edit view for this subject.
        router.push(
          `/faculty/syllabus?subject=${encodeURIComponent(json.subject_id)}`
        );
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Couldn't add this subject");
        setSubmitting(false);
      }
    },
    [router]
  );

  const handleAddExisting = useCallback(() => {
    if (!activeExisting) return;
    if (!branch) {
      toast.error("Select a branch");
      return;
    }
    if (!semester) {
      toast.error("Select a semester");
      return;
    }
    const form = new FormData();
    form.append("code", activeExisting.code);
    form.append("name", activeExisting.name);
    form.append("branch", branch);
    form.append("semester", semester);
    submit(form);
  }, [activeExisting, branch, semester, submit]);

  const handleAddNew = useCallback(() => {
    if (!trimmedQuery) {
      toast.error("Enter a subject code");
      return;
    }
    if (!name.trim()) {
      toast.error("Enter a subject name");
      return;
    }
    if (!branch) {
      toast.error("Select a branch");
      return;
    }
    if (!semester) {
      toast.error("Select a semester");
      return;
    }
    if (!file) {
      toast.error("Choose a syllabus PDF");
      return;
    }
    if (file.type !== "application/pdf") {
      toast.error("Only PDF files are accepted");
      return;
    }
    const form = new FormData();
    form.append("code", trimmedQuery);
    form.append("name", name.trim());
    form.append("branch", branch);
    form.append("semester", semester);
    form.append("file", file);
    submit(form);
  }, [trimmedQuery, name, branch, semester, file, submit]);

  // ── Processing state — full-page, honest, single message ──────────────────────
  if (submitting) {
    const isNew = showNewSubjectPanel;
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <Card>
          <CardContent className="py-16 flex flex-col items-center gap-4 text-center">
            <Loader2 className="size-10 animate-spin text-primary" />
            <div className="space-y-1">
              <p className="font-medium">
                {isNew
                  ? "Reading your syllabus and mapping modules to course outcomes…"
                  : "Adding this subject to your list…"}
              </p>
              {isNew && (
                <p className="text-sm text-muted-foreground">
                  This can take up to a minute. Please keep this page open.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-4">
      <Link
        href="/faculty/syllabus"
        className="text-sm text-muted-foreground inline-flex items-center gap-1 hover:underline"
      >
        <ChevronLeft className="size-4" /> Back to my subjects
      </Link>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Add a subject</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Search for your subject, or type a new code to upload its syllabus.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Which subject?</CardTitle>
          <CardDescription>
            Search your subject, or type a new one.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="subject-search">Subject code</Label>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                id="subject-search"
                value={query}
                onChange={(e) => handleQueryChange(e.target.value)}
                placeholder={
                  catalogLoading ? "Loading catalog…" : "e.g. SECE2291"
                }
                disabled={catalogLoading}
                className="pl-8"
                autoComplete="off"
              />
            </div>

            {suggestions.length > 0 && (
              <div className="rounded-md border divide-y">
                {suggestions.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => pickExisting(s)}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-muted flex flex-col"
                  >
                    <span className="font-medium">{s.code}</span>
                    <span className="text-muted-foreground text-xs">
                      {s.name}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* ── Branch + semester: which offering is this? Required for both the
              existing-subject and new-subject paths, since the same syllabus
              content can be taught across multiple branches/semesters. ── */}
          {(activeExisting || showNewSubjectPanel) && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="subject-branch">Branch</Label>
                <Select value={branch} onValueChange={setBranch}>
                  <SelectTrigger id="subject-branch" className="w-full">
                    <SelectValue placeholder="Select branch" />
                  </SelectTrigger>
                  <SelectContent>
                    {BRANCHES.map((b) => (
                      <SelectItem key={b} value={b}>
                        {b}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="subject-semester">Semester</Label>
                <Select value={semester} onValueChange={setSemester}>
                  <SelectTrigger id="subject-semester" className="w-full">
                    <SelectValue placeholder="Select semester" />
                  </SelectTrigger>
                  <SelectContent>
                    {SEMESTERS.map((s) => (
                      <SelectItem key={s} value={String(s)}>
                        Semester {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {/* ── Existing-subject path: no file needed ── */}
          {activeExisting && (
            <div className="space-y-3 rounded-md border border-primary/20 bg-primary/5 p-4">
              <div>
                <p className="text-sm font-medium">
                  This subject already exists — you&apos;ll be added to it.
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  {activeExisting.code} — {activeExisting.name}
                </p>
                <p className="text-xs text-muted-foreground mt-2">
                  No upload needed. You&apos;ll be able to review its syllabus and
                  course-outcome mapping right after.
                </p>
              </div>
              <Button
                onClick={handleAddExisting}
                disabled={!branch || !semester}
                className="gap-2"
              >
                <Plus className="size-4" />
                Add this subject
              </Button>
            </div>
          )}

          {/* ── New-subject path: name + PDF upload ── */}
          {showNewSubjectPanel && (
            <div className="space-y-4 rounded-md border p-4">
              <p className="text-sm text-muted-foreground">
                Adding{" "}
                <span className="font-medium text-foreground">
                  {trimmedQuery.toUpperCase()}
                </span>{" "}
                as a new subject.
              </p>
              <div className="space-y-2">
                <Label htmlFor="subject-name">Subject name</Label>
                <Input
                  id="subject-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Data Structures and Algorithms"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="syllabus-pdf">Syllabus PDF</Label>
                <Input
                  id="syllabus-pdf"
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
                <p className="text-xs text-muted-foreground">
                  We&apos;ll read the modules and course outcomes from this file
                  automatically.
                </p>
              </div>
              <Button
                onClick={handleAddNew}
                disabled={!name.trim() || !file || !branch || !semester}
                className="gap-2"
              >
                <Upload className="size-4" />
                Add Subject
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
