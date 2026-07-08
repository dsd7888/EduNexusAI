import type { NextRequest } from "next/server";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import ExcelJS from "exceljs";
import { requireRole, apiError } from "@/lib/api/helpers";
import {
  getSectionTable,
  getAllTables,
  type ExportSection,
  type SectionTable,
} from "@/lib/pilot-analysis/export";
import { getOverview } from "@/lib/pilot-analysis/queries";

const VALID_SECTIONS: ExportSection[] = [
  "overview",
  "per-faculty",
  "cost-trend",
  "feature-adoption",
  "system-health",
  "incidents",
  "all",
];

// POST /api/pilot-analysis/export  { section, format: 'csv'|'xlsx'|'pdf' }
// Reuses the exact same aggregation functions the display routes call, so the export
// always matches what's on screen. Superadmin only.
export async function POST(request: NextRequest) {
  const auth = await requireRole(["superadmin"]);
  if (auth instanceof Response) return auth;
  const admin = auth.adminClient;

  try {
    const body = (await request.json().catch(() => ({}))) as {
      section?: string;
      format?: string;
    };
    const section = body.section as ExportSection;
    const format = body.format;

    if (!VALID_SECTIONS.includes(section)) return apiError("Invalid section", 400);
    if (format !== "csv" && format !== "xlsx" && format !== "pdf") {
      return apiError("Invalid format", 400);
    }

    const tables: SectionTable[] =
      section === "all"
        ? await getAllTables(admin)
        : [await getSectionTable(admin, section)];

    const stamp = new Date().toISOString().slice(0, 10);
    const baseName = `pilot-analysis-${section}-${stamp}`;

    if (format === "csv") {
      const csv = tablesToCsv(tables);
      return fileResponse(csv, `${baseName}.csv`, "text/csv; charset=utf-8");
    }

    if (format === "xlsx") {
      const buf = await tablesToXlsx(tables);
      return fileResponse(
        buf,
        `${baseName}.xlsx`,
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
    }

    // pdf — board-ready one-pager (KPI strip + funnel + content tally / time-saved).
    const pdf = await buildOnePagerPdf(admin);
    return fileResponse(pdf, `pilot-analysis-onepager-${stamp}.pdf`, "application/pdf");
  } catch (err) {
    console.error("[pilot-analysis/export]", err);
    return apiError("Export failed", 500);
  }
}

// ── CSV ──────────────────────────────────────────────────────────────────────
function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function tablesToCsv(tables: SectionTable[]): string {
  const blocks = tables.map((t) => {
    const lines = [t.title, t.columns.map(csvCell).join(",")];
    for (const row of t.rows) lines.push(row.map(csvCell).join(","));
    return lines.join("\n");
  });
  return "﻿" + blocks.join("\n\n"); // BOM for Excel UTF-8
}

// ── XLSX ─────────────────────────────────────────────────────────────────────
async function tablesToXlsx(tables: SectionTable[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "EduNexus AI — Pilot Analysis";
  wb.created = new Date();
  for (const t of tables) {
    const sheet = wb.addWorksheet(t.title.slice(0, 31) || "Sheet");
    const header = sheet.addRow(t.columns);
    header.font = { bold: true };
    for (const row of t.rows) sheet.addRow(row);
    // Auto-ish column widths.
    t.columns.forEach((col, i) => {
      let max = col.length;
      for (const row of t.rows) max = Math.max(max, String(row[i] ?? "").length);
      sheet.getColumn(i + 1).width = Math.min(Math.max(max + 2, 10), 50);
    });
  }
  const arrayBuffer = await wb.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

// ── PDF one-pager ─────────────────────────────────────────────────────────────
async function buildOnePagerPdf(
  admin: Parameters<typeof getOverview>[0]
): Promise<Uint8Array> {
  const o = await getOverview(admin);
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]); // A4 portrait
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const black = rgb(0.1, 0.1, 0.12);
  const muted = rgb(0.45, 0.45, 0.5);

  let y = 800;
  const M = 48;
  const text = (
    s: string,
    x: number,
    size: number,
    f = font,
    color = black
  ) => page.drawText(s, { x, y, size, font: f, color });

  text("EduNexus AI — Pilot Analysis", M, 20, bold);
  y -= 18;
  text(`Board summary · generated ${new Date().toISOString().slice(0, 10)}`, M, 10, font, muted);
  y -= 30;

  // KPI strip
  text("Adoption", M, 13, bold);
  y -= 18;
  const kpis: [string, string][] = [
    ["Faculty invited", String(o.funnel.invited)],
    ["Activated", String(o.funnel.activated)],
    ["Adopted", String(o.funnel.adopted)],
    ["Retained (≥2 wks)", String(o.funnel.retained)],
  ];
  for (const [label, value] of kpis) {
    text(label, M, 11, font, muted);
    text(value, M + 190, 11, bold);
    y -= 16;
  }
  y -= 10;

  text("Usage & Cost", M, 13, bold);
  y -= 18;
  const usage: [string, string][] = [
    ["Total faculty hours", o.hours.totalFacultyHours.toFixed(1)],
    ["Artifacts produced (to date)", String(o.artifacts.totalToDate)],
    ["AI spend to date", `₹${o.spend.toDateInr.toFixed(2)}`],
    [
      "Recharge budget",
      o.rechargeBudgetInr != null ? `₹${o.rechargeBudgetInr.toFixed(2)}` : "—",
    ],
  ];
  for (const [label, value] of usage) {
    text(label, M, 11, font, muted);
    text(value, M + 190, 11, bold);
    y -= 16;
  }
  y -= 10;

  // Content tally / time saved (labeled ESTIMATE)
  text("Content output & time saved (ESTIMATE)", M, 13, bold);
  y -= 18;
  text(`Estimated hours saved to date: ${o.hoursSaved.totalHours.toFixed(1)} h`, M, 11, bold);
  y -= 18;
  for (const [feature, v] of Object.entries(o.hoursSaved.byFeature)) {
    if (v.artifacts === 0) continue;
    text(
      `${feature}: ${v.artifacts} produced · ~${v.hoursSaved.toFixed(1)} h saved`,
      M,
      10,
      font,
      muted
    );
    y -= 14;
  }
  y -= 8;
  text(
    "Time-saved figures are estimates from configured per-artifact assumptions, not measured data.",
    M,
    8,
    font,
    muted
  );

  return doc.save();
}

// ── Response helper ───────────────────────────────────────────────────────────
function fileResponse(
  body: string | Buffer | Uint8Array,
  filename: string,
  contentType: string
): Response {
  const payload =
    typeof body === "string" ? body : new Uint8Array(body as Uint8Array);
  return new Response(payload, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
