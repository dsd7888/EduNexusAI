"use client";

/**
 * Tab 3 — "Import Questions". Drag-drop a CSV/TXT (≤2MB), see a client-side
 * preview (parsed in the browser purely for review — the server re-parses on
 * import and is authoritative), then import via /api/qbank/import. CO/BTL that
 * faculty didn't supply are AI-inferred server-side, so freshly imported rows
 * land as "needs review" and can be corrected inline in the result list.
 */

import { useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileWarning,
  Loader2,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type { BankQuestion } from "@/lib/qbank/types";
import { BankQuestionCard } from "./BankQuestionCard";
import { importFile, type ImportResponse } from "./shared";

const MAX_BYTES = 2 * 1024 * 1024;

type RowStatus = "ready" | "review" | "error";

interface PreviewRow {
  status: RowStatus;
  question: string;
  type: string;
  marks: string;
  co: string;
  btl: string;
  module: string;
  note: string;
}

// ─── lightweight client-side parsers (preview only) ─────────────────────────

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let q = false;
  const src = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else q = false;
      } else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

const HEADERS: Record<string, string> = {
  question: "question_text",
  question_text: "question_text",
  text: "question_text",
  type: "question_type",
  question_type: "question_type",
  marks: "marks",
  co: "co_code",
  co_code: "co_code",
  btl: "btl_level",
  btl_level: "btl_level",
  module: "module_name",
  module_name: "module_name",
};

function previewCsv(text: string): PreviewRow[] {
  const rows = parseCsvRows(text);
  if (rows.length < 1) return [];
  const header = rows[0].map((h) => HEADERS[h.toLowerCase().trim()] ?? "");
  const col = (name: string) => header.indexOf(name);
  const ci = {
    q: col("question_text"),
    t: col("question_type"),
    m: col("marks"),
    co: col("co_code"),
    btl: col("btl_level"),
    mod: col("module_name"),
  };
  const cell = (r: string[], i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");
  return rows.slice(1).map((r) => {
    const question = cell(r, ci.q);
    const marksRaw = cell(r, ci.m);
    const marks = marksRaw.match(/\d+(\.\d+)?/)?.[0] ?? "";
    const co = cell(r, ci.co);
    const btl = cell(r, ci.btl);
    let status: RowStatus = "ready";
    let note = "";
    if (!question || !(Number(marks) > 0)) {
      status = "error";
      note = !question ? "Missing question" : "Invalid marks";
    } else if (!co || !btl) {
      status = "review";
      note = "CO/BTL will be inferred";
    }
    return {
      status,
      question,
      type: cell(r, ci.t) || "short_answer",
      marks: marks ? `${marks}M` : "—",
      co: co || "(infer)",
      btl: btl || "(infer)",
      module: cell(r, ci.mod) || "—",
      note,
    };
  });
}

function previewTxt(text: string): PreviewRow[] {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const marks = line.match(/\[(\d+(?:\.\d+)?)\s*m\]/i)?.[1] ?? "1";
      const co = line.match(/\[(CO\s*\d+)\]/i)?.[1]?.replace(/\s+/g, "") ?? "";
      const question = line
        .replace(/\[[^\]]*\]/g, "")
        .replace(/^\s*\d+[.)]\s*/, "")
        .trim();
      return {
        status: question ? ("review" as RowStatus) : ("error" as RowStatus),
        question,
        type: "short_answer",
        marks: `${marks}M`,
        co: co || "(infer)",
        btl: "(infer)",
        module: "—",
        note: question ? "CO/BTL will be inferred" : "Empty line",
      };
    });
}

const STATUS_META: Record<RowStatus, { label: string; cls: string; icon: typeof CheckCircle2 }> = {
  ready: { label: "Ready", cls: "text-emerald-500", icon: CheckCircle2 },
  review: { label: "Review", cls: "text-amber-500", icon: AlertTriangle },
  error: { label: "Error", cls: "text-rose-500", icon: FileWarning },
};

// ─── component ──────────────────────────────────────────────────────────────

export function ImportTab({
  subjectId,
  onImported,
}: {
  subjectId: string;
  onImported: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewRow[] | null>(null);
  const [filter, setFilter] = useState<"all" | RowStatus>("all");
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResponse | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const accept = (f: File | undefined | null) => {
    if (!f) return;
    const name = f.name.toLowerCase();
    if (!name.endsWith(".csv") && !name.endsWith(".txt")) {
      toast.error("Only .csv or .txt files are accepted");
      return;
    }
    if (f.size > MAX_BYTES) {
      toast.error("File exceeds 2MB");
      return;
    }
    setResult(null);
    setFile(f);
    f.text().then((text) => {
      setPreview(name.endsWith(".csv") ? previewCsv(text) : previewTxt(text));
    });
  };

  const doImport = async () => {
    if (!subjectId) {
      toast.error("Select a subject first");
      return;
    }
    if (!file) return;
    setImporting(true);
    try {
      const res = await importFile(subjectId, file);
      setResult(res);
      onImported();
      toast.success(
        `Added ${res.added} question${res.added === 1 ? "" : "s"}. ${res.needs_review} need review.`
      );
    } catch (err) {
      console.error(err);
      toast.error("Import failed. Check the file format.");
    } finally {
      setImporting(false);
    }
  };

  const reset = () => {
    setFile(null);
    setPreview(null);
    setResult(null);
    setFilter("all");
  };

  // ── Post-import review ─────────────────────────────────────────────────
  if (result) {
    return (
      <div className="space-y-3">
        <Card className="p-3 flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm">
            Added <span className="font-semibold">{result.added}</span> ·{" "}
            <span className="text-amber-500">{result.needs_review} need review</span>
            {result.skipped > 0 && (
              <span className="text-muted-foreground"> · {result.skipped} skipped</span>
            )}
          </div>
          <Button size="sm" onClick={reset}>
            <Upload className="size-4 mr-2" />
            Import Another File
          </Button>
        </Card>

        {result.errors.length > 0 && (
          <Card className="p-3 border-rose-400/40">
            <div className="text-xs font-semibold text-rose-500 mb-1">
              {result.errors.length} row(s) skipped
            </div>
            <ul className="text-[11px] text-muted-foreground list-disc pl-4 space-y-0.5 max-h-32 overflow-auto">
              {result.errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          </Card>
        )}

        <div className="space-y-2">
          {result.questions.map((q: BankQuestion) => (
            <BankQuestionCard
              key={q.id}
              question={q}
              onUpdated={() => onImported()}
              onDeleted={() => onImported()}
            />
          ))}
        </div>
      </div>
    );
  }

  const counts = {
    all: preview?.length ?? 0,
    ready: preview?.filter((r) => r.status === "ready").length ?? 0,
    review: preview?.filter((r) => r.status === "review").length ?? 0,
    error: preview?.filter((r) => r.status === "error").length ?? 0,
  };
  const visible = (preview ?? []).filter((r) => filter === "all" || r.status === filter);
  const importable = counts.all - counts.error;

  return (
    <div className="space-y-4">
      {/* Two panels */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* LEFT: upload */}
        <Card
          className={cn(
            "p-6 flex flex-col items-center justify-center text-center gap-3 border-2 border-dashed transition-colors",
            dragOver ? "border-primary bg-primary/5" : "border-border"
          )}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            accept(e.dataTransfer.files?.[0]);
          }}
        >
          <Upload className="size-8 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium">
              {file ? file.name : "Drag & drop a CSV or TXT file"}
            </p>
            <p className="text-xs text-muted-foreground">CSV or TXT · max 2MB</p>
          </div>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,.txt"
            className="hidden"
            onChange={(e) => accept(e.target.files?.[0])}
          />
          <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
            Choose file
          </Button>
          <button
            type="button"
            onClick={() => window.open("/api/qbank/sample-csv", "_blank")}
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            <Download className="size-3" />
            Download Sample CSV Template
          </button>
          <p className="text-[11px] text-muted-foreground max-w-xs">
            Not sure about the format? Download our template, fill it in, and
            upload. CO and BTL are optional — we&apos;ll infer them automatically.
          </p>
        </Card>

        {/* RIGHT: instructions */}
        <Card className="p-4 space-y-3 text-xs">
          <div>
            <p className="font-semibold mb-1">What we accept:</p>
            <ul className="list-disc pl-4 text-muted-foreground space-y-0.5">
              <li>CSV files with our template format</li>
              <li>Plain text files with one question per line</li>
            </ul>
          </div>
          <div>
            <p className="font-semibold mb-1">What happens after upload:</p>
            <ul className="list-disc pl-4 text-muted-foreground space-y-0.5">
              <li>We parse your questions</li>
              <li>Missing CO/BTL tags are automatically inferred by AI</li>
              <li>You can review and correct all tags before finalizing</li>
            </ul>
          </div>
          <div>
            <p className="font-semibold mb-1">Tips:</p>
            <ul className="list-disc pl-4 text-muted-foreground space-y-0.5">
              <li>For MCQ: fill all 4 options and mark the correct one</li>
              <li>Module name doesn&apos;t need to be exact — we fuzzy match</li>
            </ul>
          </div>
        </Card>
      </div>

      {/* Preview */}
      {preview && (
        <Card className="p-3 space-y-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {(["all", "ready", "review", "error"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setFilter(k)}
                className={cn(
                  "px-2.5 py-1 rounded-md border text-xs font-medium capitalize transition-colors",
                  filter === k
                    ? "bg-primary text-primary-foreground border-primary"
                    : "text-muted-foreground hover:bg-muted"
                )}
              >
                {k === "review" ? "Needs Review" : k === "error" ? "Errors" : k} (
                {counts[k]})
              </button>
            ))}
            <div className="flex-1" />
            <span className="text-[11px] text-muted-foreground">
              Preview only — final tags are inferred on import
            </span>
          </div>

          <div className="max-h-80 overflow-auto rounded border">
            <table className="w-full text-xs">
              <thead className="bg-muted/50 sticky top-0">
                <tr className="text-left">
                  <th className="p-2 font-medium">Status</th>
                  <th className="p-2 font-medium">Question</th>
                  <th className="p-2 font-medium">Type</th>
                  <th className="p-2 font-medium">Marks</th>
                  <th className="p-2 font-medium">CO</th>
                  <th className="p-2 font-medium">BTL</th>
                  <th className="p-2 font-medium">Module</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r, i) => {
                  const meta = STATUS_META[r.status];
                  const Icon = meta.icon;
                  return (
                    <tr key={i} className="border-t">
                      <td className="p-2">
                        <span className={cn("flex items-center gap-1", meta.cls)}>
                          <Icon className="size-3" />
                          {meta.label}
                        </span>
                      </td>
                      <td className="p-2 max-w-xs truncate" title={r.question}>
                        {r.question || <span className="italic">{r.note}</span>}
                      </td>
                      <td className="p-2">{r.type}</td>
                      <td className="p-2">{r.marks}</td>
                      <td className="p-2 text-muted-foreground">{r.co}</td>
                      <td className="p-2 text-muted-foreground">{r.btl}</td>
                      <td className="p-2 text-muted-foreground">{r.module}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">
              {importable} importable
              {counts.error > 0 && ` · ${counts.error} will be skipped`}
            </span>
            <Button onClick={doImport} disabled={importing || importable === 0}>
              {importing ? (
                <Loader2 className="size-4 mr-2 animate-spin" />
              ) : (
                <Upload className="size-4 mr-2" />
              )}
              Import {importable} Question{importable === 1 ? "" : "s"}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
