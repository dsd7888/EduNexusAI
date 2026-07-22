// ============================================================================
// Syllabus Health Audit — the single pre-fetch
//
// SERVER-ONLY (admin client, bypasses RLS — every caller does its own
// assertSubjectAccess first).
//
// checks.ts is pure by design: no check function may touch the DB. That rule is
// only keepable if something loads EVERYTHING up front, and this is it. One
// call here → one synchronous audit pass, so the Health tab can re-run the full
// audit after every edit without a second round trip.
// ============================================================================

import { createAdminClient } from "@/lib/db/supabase-server";
import { loadSubjectContext } from "@/lib/subjectContext";
import type { AuditInput, CoPoMappingRow } from "./types";

export async function loadAuditInput(subjectId: string): Promise<AuditInput> {
  const admin = createAdminClient();

  // SubjectContext already carries modules (+ btl_levels + coCodes), course
  // outcomes and practicals. CO-PO and reference books are the two things it
  // does not know about, because no generator needs them — the audit is their
  // first consumer.
  const [ctx, coPoResult, contentResult] = await Promise.all([
    loadSubjectContext(subjectId),
    admin
      .from("co_po_mapping")
      .select("co_code, po_code, strength")
      .eq("subject_id", subjectId),
    admin
      .from("subject_content")
      .select("reference_books")
      .eq("subject_id", subjectId)
      .maybeSingle(),
  ]);

  const referenceBooks =
    (contentResult.data as { reference_books?: string | null } | null)
      ?.reference_books ?? null;

  return {
    ctx,
    coPoMappings: (coPoResult.data ?? []) as CoPoMappingRow[],
    referenceBooks: referenceBooks?.trim() ? referenceBooks.trim() : null,
  };
}
