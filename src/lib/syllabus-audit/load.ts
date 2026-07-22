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
  // outcomes and practicals. CO-PO is the only thing it does not know about,
  // because no generator needs it — the audit is its first consumer.
  const [ctx, coPoResult] = await Promise.all([
    loadSubjectContext(subjectId),
    admin
      .from("co_po_mapping")
      .select("co_code, po_code, strength")
      .eq("subject_id", subjectId),
  ]);

  return {
    ctx,
    coPoMappings: (coPoResult.data ?? []) as CoPoMappingRow[],
  };
}
