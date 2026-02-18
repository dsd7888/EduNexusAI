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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { CheckCircle, Loader2, XCircle } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

interface ChangeRequest {
  id: string;
  subject_id: string;
  module_id: string;
  requested_by: string;
  current_doc_id: string | null;
  new_file_path: string;
  reason: string;
  status: "pending" | "approved" | "rejected";
  admin_comment: string | null;
  created_at: string;
  faculty_name: string | null;
  subject_name: string;
  subject_code: string;
  module_name: string;
  current_file_path: string | null;
}

export default function ApprovalsPage() {
  const [requests, setRequests] = useState<ChangeRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [filterTab, setFilterTab] = useState("all");
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectRequest, setRejectRequest] = useState<ChangeRequest | null>(null);
  const [rejectComment, setRejectComment] = useState("");

  const fetchRequests = useCallback(async () => {
    const supabase = createBrowserClient();
    const { data, error } = await supabase
      .from("note_change_requests")
      .select(
        `
        id,
        subject_id,
        module_id,
        requested_by,
        current_doc_id,
        new_file_path,
        reason,
        status,
        admin_comment,
        created_at,
        profile:profiles!requested_by(full_name),
        subject:subjects(name, code),
        module:modules(name),
        current_document:documents!current_doc_id(file_path)
      `
      )
      .order("created_at", { ascending: false });

    if (error) {
      toast.error("Failed to load requests");
      setRequests([]);
      return;
    }

    const rows: ChangeRequest[] = (data ?? []).map((r: Record<string, unknown>) => {
      const profile = r.profile as { full_name: string | null } | null;
      const subject = r.subject as { name: string; code: string } | null;
      const module = r.module as { name: string } | null;
      const currentDoc = r.current_document as { file_path: string } | null;
      return {
        id: r.id as string,
        subject_id: r.subject_id as string,
        module_id: r.module_id as string,
        requested_by: r.requested_by as string,
        current_doc_id: r.current_doc_id as string | null,
        new_file_path: r.new_file_path as string,
        reason: r.reason as string,
        status: r.status as "pending" | "approved" | "rejected",
        admin_comment: r.admin_comment as string | null,
        created_at: r.created_at as string,
        faculty_name: profile?.full_name ?? null,
        subject_name: subject?.name ?? "",
        subject_code: subject?.code ?? "",
        module_name: module?.name ?? "",
        current_file_path: currentDoc?.file_path ?? null,
      };
    });
    setRequests(rows);
  }, []);

  useEffect(() => {
    setLoading(true);
    fetchRequests().finally(() => setLoading(false));
  }, [fetchRequests]);

  const getFiltered = (tab: string) =>
    requests.filter((r) => {
      if (tab === "all") return true;
      return r.status === tab;
    });

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return iso;
    }
  };

  const downloadUrl = (path: string) =>
    `/api/approvals/download?path=${encodeURIComponent(path)}`;

  const handleApprove = async (req: ChangeRequest) => {
    setActionLoading(req.id);
    try {
      const res = await fetch("/api/approvals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: req.id, action: "approve" }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json.error ?? "Failed to approve");
        return;
      }
      toast.success("Request approved");
      fetchRequests();
    } catch {
      toast.error("Failed to approve");
    } finally {
      setActionLoading(null);
    }
  };

  const openRejectDialog = (req: ChangeRequest) => {
    setRejectRequest(req);
    setRejectComment("");
    setRejectDialogOpen(true);
  };

  const handleRejectSubmit = async () => {
    if (!rejectRequest || !rejectComment.trim()) {
      toast.error("Comment is required");
      return;
    }
    setActionLoading(rejectRequest.id);
    try {
      const res = await fetch("/api/approvals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId: rejectRequest.id,
          action: "reject",
          comment: rejectComment.trim(),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json.error ?? "Failed to reject");
        return;
      }
      toast.success("Request rejected");
      setRejectDialogOpen(false);
      setRejectRequest(null);
      setRejectComment("");
      fetchRequests();
    } catch {
      toast.error("Failed to reject");
    } finally {
      setActionLoading(null);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "pending":
        return (
          <Badge className="bg-amber-500/20 text-amber-700 border-amber-500/50">
            Pending
          </Badge>
        );
      case "approved":
        return (
          <Badge className="bg-green-500/20 text-green-700 border-green-500/50">
            Approved
          </Badge>
        );
      case "rejected":
        return (
          <Badge className="bg-red-500/20 text-red-700 border-red-500/50">
            Rejected
          </Badge>
        );
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Note Change Requests
          </h1>
          <p className="text-muted-foreground text-sm">
            Review and approve or reject faculty note change requests.
          </p>
        </div>
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-5 w-48" />
                <Skeleton className="h-4 w-64" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-20 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Note Change Requests
        </h1>
        <p className="text-muted-foreground text-sm">
          Review and approve or reject faculty note change requests.
        </p>
      </div>

      <Tabs value={filterTab} onValueChange={setFilterTab}>
        <TabsList>
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="pending">Pending</TabsTrigger>
          <TabsTrigger value="approved">Approved</TabsTrigger>
          <TabsTrigger value="rejected">Rejected</TabsTrigger>
        </TabsList>

        <TabsContent value="all" className="mt-6 space-y-4">
          {getFiltered("all").length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                No requests found.
              </CardContent>
            </Card>
          ) : (
            getFiltered("all").map((req) => (
              <Card key={req.id}>
                <CardHeader className="flex flex-row items-start justify-between gap-4">
                  <div>
                    <CardTitle className="text-base">
                      {req.faculty_name ?? "Unknown"} — {req.subject_name} ({req.subject_code})
                    </CardTitle>
                    <CardDescription>
                      Module: {req.module_name} · Submitted {formatDate(req.created_at)}
                    </CardDescription>
                  </div>
                  {getStatusBadge(req.status)}
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">
                      Reason for change
                    </p>
                    <p className="mt-1 text-sm">{req.reason}</p>
                  </div>
                  <div className="flex flex-wrap gap-4">
                    {req.current_file_path ? (
                      <Link
                        href={downloadUrl(req.current_file_path)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-primary hover:underline"
                      >
                        Download current file
                      </Link>
                    ) : (
                      <span className="text-sm text-muted-foreground">
                        No current file
                      </span>
                    )}
                    <Link
                      href={downloadUrl(req.new_file_path)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-primary hover:underline"
                    >
                      Download new file
                    </Link>
                  </div>
                  {req.admin_comment && (
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">
                        Admin comment
                      </p>
                      <p className="mt-1 text-sm">{req.admin_comment}</p>
                    </div>
                  )}
                  {req.status === "pending" && (
                    <div className="flex items-center gap-2 pt-2">
                      <Button
                        size="sm"
                        className="bg-green-600 hover:bg-green-700"
                        onClick={() => handleApprove(req)}
                        disabled={actionLoading === req.id}
                      >
                        {actionLoading === req.id ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <CheckCircle className="size-4" />
                        )}
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => openRejectDialog(req)}
                        disabled={actionLoading === req.id}
                      >
                        <XCircle className="size-4" />
                        Reject
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>
        <TabsContent value="pending" className="mt-6 space-y-4">
          {getFiltered("pending").length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                No pending requests.
              </CardContent>
            </Card>
          ) : (
            getFiltered("pending").map((req) => (
              <Card key={req.id}>
                <CardHeader className="flex flex-row items-start justify-between gap-4">
                  <div>
                    <CardTitle className="text-base">
                      {req.faculty_name ?? "Unknown"} — {req.subject_name} ({req.subject_code})
                    </CardTitle>
                    <CardDescription>
                      Module: {req.module_name} · Submitted {formatDate(req.created_at)}
                    </CardDescription>
                  </div>
                  {getStatusBadge(req.status)}
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Reason for change</p>
                    <p className="mt-1 text-sm">{req.reason}</p>
                  </div>
                  <div className="flex flex-wrap gap-4">
                    {req.current_file_path ? (
                      <Link href={downloadUrl(req.current_file_path)} target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline">
                        Download current file
                      </Link>
                    ) : (
                      <span className="text-sm text-muted-foreground">No current file</span>
                    )}
                    <Link href={downloadUrl(req.new_file_path)} target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline">
                      Download new file
                    </Link>
                  </div>
                  {req.status === "pending" && (
                    <div className="flex items-center gap-2 pt-2">
                      <Button size="sm" className="bg-green-600 hover:bg-green-700" onClick={() => handleApprove(req)} disabled={actionLoading === req.id}>
                        {actionLoading === req.id ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle className="size-4" />}
                        Approve
                      </Button>
                      <Button size="sm" variant="destructive" onClick={() => openRejectDialog(req)} disabled={actionLoading === req.id}>
                        <XCircle className="size-4" />
                        Reject
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>
        <TabsContent value="approved" className="mt-6 space-y-4">
          {getFiltered("approved").length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                No approved requests.
              </CardContent>
            </Card>
          ) : (
            getFiltered("approved").map((req) => (
              <Card key={req.id}>
                <CardHeader className="flex flex-row items-start justify-between gap-4">
                  <div>
                    <CardTitle className="text-base">
                      {req.faculty_name ?? "Unknown"} — {req.subject_name} ({req.subject_code})
                    </CardTitle>
                    <CardDescription>
                      Module: {req.module_name} · Submitted {formatDate(req.created_at)}
                    </CardDescription>
                  </div>
                  {getStatusBadge(req.status)}
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Reason for change</p>
                    <p className="mt-1 text-sm">{req.reason}</p>
                  </div>
                  <div className="flex flex-wrap gap-4">
                    {req.current_file_path ? (
                      <Link href={downloadUrl(req.current_file_path)} target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline">
                        Download current file
                      </Link>
                    ) : (
                      <span className="text-sm text-muted-foreground">No current file</span>
                    )}
                    <Link href={downloadUrl(req.new_file_path)} target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline">
                      Download new file
                    </Link>
                  </div>
                  {req.admin_comment && (
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">Admin comment</p>
                      <p className="mt-1 text-sm">{req.admin_comment}</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>
        <TabsContent value="rejected" className="mt-6 space-y-4">
          {getFiltered("rejected").length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                No rejected requests.
              </CardContent>
            </Card>
          ) : (
            getFiltered("rejected").map((req) => (
              <Card key={req.id}>
                <CardHeader className="flex flex-row items-start justify-between gap-4">
                  <div>
                    <CardTitle className="text-base">
                      {req.faculty_name ?? "Unknown"} — {req.subject_name} ({req.subject_code})
                    </CardTitle>
                    <CardDescription>
                      Module: {req.module_name} · Submitted {formatDate(req.created_at)}
                    </CardDescription>
                  </div>
                  {getStatusBadge(req.status)}
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Reason for change</p>
                    <p className="mt-1 text-sm">{req.reason}</p>
                  </div>
                  <div className="flex flex-wrap gap-4">
                    {req.current_file_path ? (
                      <Link href={downloadUrl(req.current_file_path)} target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline">
                        Download current file
                      </Link>
                    ) : (
                      <span className="text-sm text-muted-foreground">No current file</span>
                    )}
                    <Link href={downloadUrl(req.new_file_path)} target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline">
                      Download new file
                    </Link>
                  </div>
                  {req.admin_comment && (
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">Admin comment</p>
                      <p className="mt-1 text-sm">{req.admin_comment}</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>
      </Tabs>

      <AlertDialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reject request</AlertDialogTitle>
            <AlertDialogDescription>
              Please provide a reason for rejection (required). This will be
              visible to the faculty member.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-2">
            <Textarea
              placeholder="Enter rejection reason..."
              value={rejectComment}
              onChange={(e) => setRejectComment(e.target.value)}
              rows={4}
              className="resize-none"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                setRejectRequest(null);
                setRejectComment("");
              }}
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRejectSubmit}
              disabled={!rejectComment.trim()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {rejectRequest && actionLoading === rejectRequest.id ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                "Reject"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
