"use client";

/**
 * Superadmin observability: a plain, newest-first table of faculty subject changes
 * (added_new / assigned_existing / removed) read from subject_change_log. RLS already
 * restricts the table to superadmin/dept_admin, so the browser client reads it directly.
 * This is a functional detail for admins, deliberately not a design showcase.
 */

import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { createBrowserClient } from "@/lib/db/supabase-browser";

interface ChangeRow {
  id: string;
  created_at: string;
  faculty_email_snapshot: string;
  subject_code_snapshot: string;
  subject_name_snapshot: string;
  action: "added_new" | "assigned_existing" | "removed";
}

const ACTION_LABEL: Record<ChangeRow["action"], string> = {
  added_new: "Added new",
  assigned_existing: "Joined existing",
  removed: "Removed",
};

const ACTION_CLASS: Record<ChangeRow["action"], string> = {
  added_new: "bg-emerald-100 text-emerald-800 border-emerald-200",
  assigned_existing: "bg-blue-100 text-blue-800 border-blue-200",
  removed: "bg-amber-100 text-amber-800 border-amber-200",
};

export function SubjectChangeLog() {
  const [rows, setRows] = useState<ChangeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    const supabase = createBrowserClient();
    supabase
      .from("subject_change_log")
      .select(
        "id, created_at, faculty_email_snapshot, subject_code_snapshot, subject_name_snapshot, action"
      )
      .order("created_at", { ascending: false })
      .limit(500)
      .then(({ data }) => {
        if (cancelled) return;
        setRows((data ?? []) as ChangeRow[]);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.faculty_email_snapshot.toLowerCase().includes(q) ||
        r.subject_code_snapshot.toLowerCase().includes(q) ||
        r.subject_name_snapshot.toLowerCase().includes(q)
    );
  }, [rows, search]);

  return (
    <div className="space-y-4">
      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by faculty, code, or subject…"
        className="max-w-sm"
      />
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Faculty</TableHead>
              <TableHead>Code</TableHead>
              <TableHead>Subject</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>When</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                  Loading…
                </TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                  {rows.length === 0
                    ? "No faculty subject changes yet."
                    : "No matches."}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">
                    {r.faculty_email_snapshot}
                  </TableCell>
                  <TableCell>{r.subject_code_snapshot}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {r.subject_name_snapshot}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={ACTION_CLASS[r.action]}>
                      {ACTION_LABEL[r.action]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground whitespace-nowrap">
                    {new Date(r.created_at).toLocaleString()}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
