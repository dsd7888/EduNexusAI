"use client";

import { createBrowserClient } from "@/lib/db/supabase-browser";
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
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

interface FacultyOption {
  id: string;
  full_name: string | null;
  email: string;
}

interface SubjectOption {
  id: string;
  name: string;
  code: string;
}

interface AssignmentRow {
  id: string;
  faculty_id: string;
  faculty_name: string | null;
  faculty_email: string;
  subject_id: string;
  subject_code: string;
  subject_name: string;
  subject_department: string | null;
  assigned_at: string;
}

export default function FacultyPage() {
  const [faculty, setFaculty] = useState<FacultyOption[]>([]);
  const [subjects, setSubjects] = useState<SubjectOption[]>([]);
  const [assignments, setAssignments] = useState<AssignmentRow[]>([]);
  const [facultyId, setFacultyId] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [assignLoading, setAssignLoading] = useState(false);
  const [removeLoading, setRemoveLoading] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [assignmentToRemove, setAssignmentToRemove] = useState<AssignmentRow | null>(null);

  const fetchFaculty = useCallback(async () => {
    const supabase = createBrowserClient();
    const { data } = await supabase
      .from("profiles")
      .select("id, full_name, email")
      .eq("role", "faculty")
      .order("full_name");
    setFaculty(data ?? []);
  }, []);

  const fetchSubjects = useCallback(async () => {
    const supabase = createBrowserClient();
    const { data } = await supabase
      .from("subjects")
      .select("id, name, code")
      .order("name");
    setSubjects(data ?? []);
  }, []);

  const fetchAssignments = useCallback(async () => {
    const supabase = createBrowserClient();
    const { data, error } = await supabase
      .from("faculty_assignments")
      .select(
        `
        id,
        faculty_id,
        subject_id,
        assigned_at,
        faculty:profiles!faculty_id(full_name, email),
        subject:subjects(code, name, department)
      `
      )
      .order("assigned_at", { ascending: false });

    if (error) {
      toast.error("Failed to load assignments");
      setAssignments([]);
      return;
    }

    const rows: AssignmentRow[] = (data ?? []).map((a: Record<string, unknown>) => {
      const facultyData = a.faculty as { full_name: string | null; email: string } | null;
      const subjectData = a.subject as { code: string; name: string; department: string | null } | null;
      return {
        id: a.id as string,
        faculty_id: a.faculty_id as string,
        faculty_name: facultyData?.full_name ?? null,
        faculty_email: facultyData?.email ?? "",
        subject_id: a.subject_id as string,
        subject_code: subjectData?.code ?? "",
        subject_name: subjectData?.name ?? "",
        subject_department: subjectData?.department ?? null,
        assigned_at: a.assigned_at as string,
      };
    });
    setAssignments(rows);
  }, []);

  useEffect(() => {
    fetchFaculty();
    fetchSubjects();
    fetchAssignments();
  }, [fetchFaculty, fetchSubjects, fetchAssignments]);

  const isAlreadyAssigned = facultyId && subjectId && assignments.some(
    (a) => a.faculty_id === facultyId && a.subject_id === subjectId
  );

  const handleAssign = async () => {
    if (!facultyId || !subjectId) {
      toast.error("Please select faculty and subject");
      return;
    }
    if (isAlreadyAssigned) {
      toast.error("This faculty is already assigned to this subject");
      return;
    }
    setAssignLoading(true);
    try {
      const res = await fetch("/api/faculty/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ facultyId, subjectId }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = json.error ?? "Failed to assign";
        toast.error(
          msg.includes("already assigned")
            ? "This faculty is already assigned to this subject"
            : msg
        );
        return;
      }
      toast.success("Faculty assigned successfully");
      setFacultyId("");
      setSubjectId("");
      fetchAssignments();
    } catch {
      toast.error("Failed to assign");
    } finally {
      setAssignLoading(false);
    }
  };

  const openRemoveConfirm = (a: AssignmentRow) => {
    setAssignmentToRemove(a);
    setConfirmOpen(true);
  };

  const handleRemoveConfirm = async () => {
    if (!assignmentToRemove) return;
    const id = assignmentToRemove.id;
    setConfirmOpen(false);
    setAssignmentToRemove(null);
    setRemoveLoading(id);
    try {
      const res = await fetch("/api/faculty/assign", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignmentId: id }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json.error ?? "Failed to remove assignment");
        return;
      }
      toast.success("Assignment removed");
      fetchAssignments();
    } catch {
      toast.error("Failed to remove assignment");
    } finally {
      setRemoveLoading(null);
    }
  };

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
    } catch {
      return iso;
    }
  };

  const groupedByFaculty = assignments.reduce<Record<string, AssignmentRow[]>>((acc, a) => {
    const key = a.faculty_id;
    if (!acc[key]) acc[key] = [];
    acc[key].push(a);
    return acc;
  }, {});

  Object.keys(groupedByFaculty).forEach((key) => {
    groupedByFaculty[key].sort((x, y) =>
      x.subject_code.localeCompare(y.subject_code)
    );
  });

  const facultyOrder = [...new Set(assignments.map((a) => a.faculty_id))].sort(
    (a, b) => {
      const na = (groupedByFaculty[a]?.[0]?.faculty_name ?? "").toLowerCase();
      const nb = (groupedByFaculty[b]?.[0]?.faculty_name ?? "").toLowerCase();
      return na.localeCompare(nb);
    }
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Faculty Management
        </h1>
        <p className="text-muted-foreground text-sm">
          Assign faculty members to subjects. One faculty can be assigned to multiple subjects.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Assign Faculty to Subject</CardTitle>
          <CardDescription>
            Select a faculty member and subject to create an assignment.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-4">
          <div className="flex-1 min-w-[220px] space-y-2">
            <label className="text-sm font-medium">Faculty</label>
            <Select
              value={facultyId}
              onValueChange={setFacultyId}
              disabled={assignLoading}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select faculty" />
              </SelectTrigger>
              <SelectContent>
                {faculty.map((f) => (
                  <SelectItem key={f.id} value={f.id}>
                    {f.full_name || "—"} ({f.email})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex-1 min-w-[220px] space-y-2">
            <label className="text-sm font-medium">Subject</label>
            <Select
              value={subjectId}
              onValueChange={setSubjectId}
              disabled={assignLoading}
            >
              <SelectTrigger>
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
          <Button
            onClick={handleAssign}
            disabled={assignLoading || !!isAlreadyAssigned}
          >
            {assignLoading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              "Assign"
            )}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Current Assignments</CardTitle>
          <CardDescription>
            View and remove faculty assignments. Grouped by faculty.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {assignments.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">
              No assignments yet. Assign a faculty member to a subject above.
            </p>
          ) : (
            <div className="space-y-6">
              {facultyOrder.map((fid) => {
                const rows = groupedByFaculty[fid] ?? [];
                const first = rows[0];
                const displayName = first?.faculty_name || first?.faculty_email || "Unknown";
                const displayEmail = first?.faculty_email ?? "";
                return (
                  <div key={fid} className="space-y-3">
                    <h3 className="text-sm font-semibold">
                      {displayName}
                      {displayEmail && (
                        <span className="font-normal text-muted-foreground">
                          {" "}({displayEmail}) - {rows.length} subject{rows.length !== 1 ? "s" : ""} assigned
                        </span>
                      )}
                    </h3>
                    <ul className="space-y-2">
                      {rows.map((a) => (
                        <li
                          key={a.id}
                          className="flex items-center justify-between gap-4 rounded-md border px-3 py-2"
                        >
                          <span>
                            {a.subject_code} {a.subject_name}
                          </span>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 gap-1.5 text-destructive hover:text-destructive"
                            onClick={() => openRemoveConfirm(a)}
                            disabled={removeLoading === a.id}
                            aria-label="Remove assignment"
                          >
                            {removeLoading === a.id ? (
                              <Loader2 className="size-4 animate-spin" />
                            ) : (
                              <>
                                <Trash2 className="size-4" />
                                Remove
                              </>
                            )}
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove assignment</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove this assignment?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setAssignmentToRemove(null)}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => handleRemoveConfirm()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
