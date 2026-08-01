/**
 * GET /api/notes/subject/:subjectId/export — Notes v2, PDF export (CP-N5).
 *
 * Renders the subject's already-assembled notes to a PDF via the three typed
 * renderers in `src/lib/notes/pdf/`. Deterministic layout only — no AI call
 * anywhere on this path (§15).
 *
 * DOES NOT ASSEMBLE. Unlike GET /api/notes/subject/:id (the main notes route),
 * this route never calls assembleSubjectNotes — it serves the latest fresh
 * (is_stale=false) subject-scope row as-is, or 404s asking the student to
 * generate notes first. PDF export is explicit: the student has already seen
 * the notes (that's how a fresh row came to exist), so the main GET route
 * already owns freshness/hash checking and cache population; this route only
 * reads what that route already wrote.
 *
 * NO PDF-BYTES CACHE. Notes PDFs are ephemeral by design: the source blocks
 * are already stored, and regenerating a PDF from them is cheap relative to
 * storing/lifecycle-managing the bytes in Supabase Storage. Every request
 * re-runs the math pre-pass — real CPU — which is why notes_export is checked
 * on EVERY request, unlike notes_view's cache-hit waiver.
 */
import type { NextRequest } from "next/server";
import { after } from "next/server";

import { requireAuth, apiError } from "@/lib/api/helpers";
import { createAdminClient } from "@/lib/db/supabase-server";
import { checkRateLimit, RATE_LIMITS } from "@/lib/utils/rate-limit";
import { assertNotesSubjectAccess } from "@/lib/notes/access";
import { validateNoteBlocks, slugifyForBlockId, type NoteBlock } from "@/lib/notes/types";
import type {
  SubjectSourceMetadata,
  ModuleBreakpoint,
} from "@/lib/notes/subject-assembler";
import { enrichBlocksWithPyqFrequency } from "@/lib/notes/pyq-frequency";
import { createPDFBuilder } from "@/lib/pdf/builder";
import { drawBlock, drawModuleSectionHeader, prerenderNotesMath } from "@/lib/notes/pdf";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ subjectId: string }> }
) {
  try {
    const { subjectId } = await context.params;
    if (!subjectId) return apiError("subjectId is required", 400);

    const moduleIdParam = request.nextUrl.searchParams.get("moduleId");

    const authResult = await requireAuth();
    if (authResult instanceof Response) return authResult;
    const { user } = authResult;

    const adminClient = createAdminClient();

    const { data: profile, error: profileError } = await adminClient
      .from("profiles")
      .select("id, role")
      .eq("id", user.id)
      .single();
    if (profileError || !profile) return apiError("Failed to load profile", 500);

    const { data: subject } = await adminClient
      .from("subjects")
      .select("id, name, code, branch, semester")
      .eq("id", subjectId)
      .maybeSingle();
    if (!subject) return apiError("Subject not found", 404);

    const denied = await assertNotesSubjectAccess(
      adminClient,
      profile.role,
      user.id,
      subjectId
    );
    if (denied) return denied;

    // ── Load the existing fresh subject-scope row — never assembles ────────
    const { data: rows } = await adminClient
      .from("study_notes")
      .select("id, version, blocks, source_metadata")
      .eq("subject_id", subjectId)
      .eq("scope", "subject")
      .eq("is_stale", false)
      .order("version", { ascending: false })
      .limit(1);

    const row = (rows ?? [])[0] as
      | { id: string; version: number; blocks: unknown; source_metadata: unknown }
      | undefined;
    if (!row) {
      return Response.json(
        { error: "no_notes", message: "Generate notes first" },
        { status: 404 }
      );
    }

    const validated = validateNoteBlocks(row.blocks, { expectCount: false });
    if (!validated.ok) {
      return apiError("Stored notes failed validation", 500);
    }
    let blocks: NoteBlock[] = validated.blocks;

    const sourceMetadata = (row.source_metadata ?? {}) as Partial<SubjectSourceMetadata>;
    // Empty/absent (pre-CP-N3 rows) degrades to a flat block list with no
    // section headers — same rule CP-N4's reading view follows.
    let moduleBreakpoints: ModuleBreakpoint[] = sourceMetadata.moduleBreakpoints ?? [];

    // ── Optional module scoping ─────────────────────────────────────────────
    let moduleSlug = "full";
    let scopedModuleName: string | null = null;
    if (moduleIdParam) {
      const bp = moduleBreakpoints.find((b) => b.moduleId === moduleIdParam);
      if (!bp) {
        return Response.json({ error: "module_not_found" }, { status: 400 });
      }
      blocks = blocks.slice(bp.startIndex, bp.startIndex + bp.count);
      // Single-module export: one section header at position 0.
      moduleBreakpoints = [{ ...bp, startIndex: 0 }];
      moduleSlug = slugifyForBlockId(bp.moduleName) || "module";
      scopedModuleName = bp.moduleName;
    }

    // ── Rate limit — after the block load, same post-lookup ordering every
    // notes route uses. Unlike notes_view there is no cache-hit waiver: a real
    // PDF (with its own math pre-pass) is produced on every request.
    if (profile.role === "student") {
      const rate = await checkRateLimit({
        userId: user.id,
        eventType: "notes_export",
        limit: RATE_LIMITS.notes_export,
      });
      if (!rate.allowed) {
        return Response.json(
          {
            error: "Daily limit reached",
            message: `You've used all ${RATE_LIMITS.notes_export} PDF downloads for today. ${rate.resetAt}.`,
            limitReached: true,
          },
          { status: 429 }
        );
      }
    }

    // CP-N3 enrichment, computed fresh against current PYQ data — same rule
    // the main GET route follows.
    const enriched = await enrichBlocksWithPyqFrequency(
      blocks,
      subjectId,
      moduleIdParam,
      adminClient
    );

    // ── Math pre-pass — mandatory before any synchronous draw call ─────────
    const mathMap = await prerenderNotesMath(enriched);

    const { builder } = await createPDFBuilder();
    await builder.embedMath(mathMap);

    const dateStr = new Date().toLocaleDateString("en-IN", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
    builder.addPageHeader(
      `Study Notes — ${subject.code ?? ""}`,
      subject.name ?? "",
      [`${subject.branch ?? ""} · Semester ${subject.semester ?? ""}`, scopedModuleName, dateStr]
        .filter((part): part is string => Boolean(part))
        .join(" · ")
    );

    for (let i = 0; i < enriched.length; i++) {
      const bp = moduleBreakpoints.find((b) => b.startIndex === i);
      if (bp) drawModuleSectionHeader(builder, bp.moduleNumber, bp.moduleName);
      drawBlock(builder, enriched[i], mathMap);
    }

    const pdfBytes = await builder.build();
    const filename = `notes-${subject.code ?? subjectId}-${moduleSlug}.pdf`;

    if (profile.role === "student") {
      after(async () => {
        await recordExportUsage(adminClient, user.id, subjectId);
      });
    }

    return new Response(Buffer.from(pdfBytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    console.error("[notes/subject/export] GET error:", err);
    return apiError(
      err instanceof Error ? err.message : "Failed to export notes PDF",
      500
    );
  }
}

/** Fire-and-forget quota tracking, run via after() so it never delays the download. */
async function recordExportUsage(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adminClient: any,
  userId: string,
  subjectId: string
) {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const { data: existing } = await adminClient
      .from("usage_analytics")
      .select("id, event_count")
      .eq("date", today)
      .eq("user_id", userId)
      .eq("event_type", "notes_export")
      .eq("subject_id", subjectId)
      .maybeSingle();

    if (existing) {
      await adminClient
        .from("usage_analytics")
        .update({ event_count: (existing.event_count ?? 0) + 1 })
        .eq("id", existing.id);
    } else {
      await adminClient.from("usage_analytics").insert({
        date: today,
        user_id: userId,
        subject_id: subjectId,
        event_type: "notes_export",
        event_count: 1,
      });
    }
  } catch (err) {
    console.error("[notes/subject/export] usage_analytics error:", err);
  }
}
