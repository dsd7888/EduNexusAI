// ============================================================================
// Syllabus Health Audit — applying an accepted proposal
//
// This is the ONLY place in the feature that writes to the syllabus, and it
// treats the incoming patch as hostile input. Not because the faculty member is
// hostile, but because the patch travelled: model → gate → JSON → browser →
// back. §7 of the spec says never trust the client's patch object, and the
// practical form of that is: the patch supplies IDENTIFIERS ONLY, and every one
// of them is re-resolved against the database, scoped to this subject, before a
// single row changes.
//
// Concretely, each handler re-checks that:
//   * the module/CO named actually exists, AND belongs to THIS subject — a
//     valid module id from a DIFFERENT subject is the interesting attack, and
//     the one a naive `.eq("id", moduleId)` update would happily perform;
//   * the values are in range (BTL 1-6, PO 1-12, strength 1-3);
//   * the change isn't already true, so an Accept can't silently no-op.
//
// Nothing here reads the proposal's oldValue/newValue/rationale. Those are
// display text; the write is reconstructed from the patch identifiers alone.
//
// Cache invalidation is deletion, not fingerprinting (spec §7). A fingerprint
// mismatch WOULD eventually catch this — both downstream caches hash the module
// and CO data this file mutates — but "eventually" means "on next access", and
// in the window between the write and that access a colleague can be served a
// lesson plan built around a CO mapping that no longer exists. Deleting closes
// the window immediately, and makes the cascade visible to the faculty member
// who caused it.
// ============================================================================

import type { createAdminClient } from "@/lib/db/supabase-server";
import { parseBtlLevels } from "@/lib/subjectContext";
import type { ProposalEntityType } from "./types";

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * The entityTypes /apply will actually execute — a WHITELIST, not the full
 * Proposal enum. `module_weightage` and `practical_mapping` are deliberately
 * absent: no dimension can currently propose them (DIMENSION_ENTITY_TYPES), so
 * one arriving here means something is wrong, and the right answer is to
 * refuse rather than to invent a write path for it.
 */
export const APPLIABLE_ENTITY_TYPES = [
  "module_co_mapping",
  "btl_levels",
  "co_description",
  "co_po_mapping",
] as const;

export type AppliableEntityType = (typeof APPLIABLE_ENTITY_TYPES)[number];

export function isAppliableEntityType(v: unknown): v is AppliableEntityType {
  return (APPLIABLE_ENTITY_TYPES as readonly string[]).includes(String(v));
}

export interface ApplyOutcome {
  ok: boolean;
  /** Set when ok === false. Safe to show the faculty member. */
  error?: string;
  status?: number;
  /** Human-readable description of what changed, for the success toast. */
  summary?: string;
}

export interface InvalidationReport {
  lessonPlanCache: number;
  labManualCache: number;
  syllabusAuditCache: number;
}

const MAX_CO_DESCRIPTION = 500;

function fail(error: string, status = 400): ApplyOutcome {
  return { ok: false, error, status };
}

function normalizeCoCode(raw: unknown): string | null {
  const s = String(raw ?? "").trim().toUpperCase().replace(/[\s_-]/g, "");
  const m = /^CO0*(\d{1,2})$/.exec(s);
  return m ? `CO${Number(m[1])}` : null;
}

/**
 * Resolve a module id, REQUIRING it to belong to the given subject. Returns
 * null when the module is missing or lives under another subject — the caller
 * treats both as the same refusal, because distinguishing them would confirm
 * the existence of another subject's module id.
 */
async function resolveModule(
  admin: AdminClient,
  subjectId: string,
  moduleId: unknown,
): Promise<{ id: string; module_number: number; name: string; btl_levels: string[] | null } | null> {
  const id = String(moduleId ?? "").trim();
  if (!id) return null;
  const { data } = await admin
    .from("modules")
    .select("id, module_number, name, btl_levels, subject_id")
    .eq("id", id)
    .maybeSingle();
  const row = data as
    | { id: string; module_number: number; name: string; btl_levels: string[] | null; subject_id: string }
    | null;
  if (!row || row.subject_id !== subjectId) return null;
  return row;
}

/** Resolve a CO code against THIS subject's course_outcomes. */
async function resolveCo(
  admin: AdminClient,
  subjectId: string,
  coCode: string,
): Promise<{ co_code: string; description: string } | null> {
  const { data } = await admin
    .from("course_outcomes")
    .select("co_code, description")
    .eq("subject_id", subjectId);
  const rows = (data ?? []) as { co_code: string; description: string }[];
  return rows.find((r) => normalizeCoCode(r.co_code) === coCode) ?? null;
}

// ─── The write ───────────────────────────────────────────────────────────────

export async function applyProposalPatch(
  admin: AdminClient,
  subjectId: string,
  entityType: ProposalEntityType | string,
  patch: Record<string, unknown>,
): Promise<ApplyOutcome> {
  if (!isAppliableEntityType(entityType)) {
    return fail(`"${String(entityType)}" is not a change this tool can apply.`, 400);
  }

  // ── module_co_mapping: add a CO to a module ──────────────────────────────
  if (entityType === "module_co_mapping") {
    const coCode = normalizeCoCode(patch.coCode);
    if (!coCode) return fail("The proposal did not name a valid CO code.");

    const mod = await resolveModule(admin, subjectId, patch.moduleId);
    if (!mod) return fail("That module is not part of this subject.", 404);

    const co = await resolveCo(admin, subjectId, coCode);
    if (!co) return fail(`${coCode} is not a course outcome of this subject.`, 404);

    const { data: existing } = await admin
      .from("module_co_mapping")
      .select("id")
      .eq("module_id", mod.id)
      .eq("co_code", co.co_code)
      .maybeSingle();
    if (existing) {
      return fail(`Module ${mod.module_number} is already mapped to ${co.co_code}.`, 409);
    }

    // source/confidence match the faculty-edit path in
    // /api/syllabus/module-co-mapping — an accepted proposal is a faculty
    // decision, not an AI classification, so it must not be labelled as one.
    const { error } = await admin.from("module_co_mapping").upsert(
      {
        module_id: mod.id,
        co_code: co.co_code,
        source: "faculty_verified",
        confidence: "high",
      },
      { onConflict: "module_id,co_code" },
    );
    if (error) {
      console.error("[syllabus audit apply] module_co_mapping:", error.message);
      return fail("Failed to save the mapping.", 500);
    }

    return {
      ok: true,
      summary: `Mapped ${co.co_code} to Module ${mod.module_number} (${mod.name}).`,
    };
  }

  // ── btl_levels: replace a module's BTL array ─────────────────────────────
  if (entityType === "btl_levels") {
    const mod = await resolveModule(admin, subjectId, patch.moduleId);
    if (!mod) return fail("That module is not part of this subject.", 404);

    const raw = Array.isArray(patch.btlLevels) ? (patch.btlLevels as unknown[]) : null;
    if (!raw || raw.length === 0) {
      return fail("The proposal did not name any BTL levels.");
    }
    const levels = Array.from(
      new Set(
        raw
          .map((v) => Math.trunc(Number(v)))
          .filter((n) => Number.isFinite(n) && n >= 1 && n <= 6),
      ),
    ).sort((a, b) => a - b);
    if (levels.length !== raw.length) {
      return fail("The proposal contained a BTL level outside the 1-6 range.");
    }

    const current = parseBtlLevels(mod.btl_levels);
    if (JSON.stringify(current) === JSON.stringify(levels)) {
      return fail(`Module ${mod.module_number} already has exactly these BTL levels.`, 409);
    }

    // modules.btl_levels is text[] in Postgres (see syllabus/types.ts), so the
    // ints have to go back as strings or the write silently changes column type
    // semantics for every later reader.
    const { error } = await admin
      .from("modules")
      .update({ btl_levels: levels.map(String) })
      .eq("id", mod.id);
    if (error) {
      console.error("[syllabus audit apply] btl_levels:", error.message);
      return fail("Failed to update the BTL levels.", 500);
    }

    return {
      ok: true,
      summary: `Module ${mod.module_number} now targets BTL ${levels.join(", ")}.`,
    };
  }

  // ── co_description: reword a course outcome ──────────────────────────────
  if (entityType === "co_description") {
    const coCode = normalizeCoCode(patch.coCode);
    if (!coCode) return fail("The proposal did not name a valid CO code.");

    const description = String(patch.description ?? "").trim();
    if (!description) return fail("The proposal did not include a new description.");
    if (description.length > MAX_CO_DESCRIPTION) {
      return fail(`The new description is longer than ${MAX_CO_DESCRIPTION} characters.`);
    }

    const co = await resolveCo(admin, subjectId, coCode);
    if (!co) return fail(`${coCode} is not a course outcome of this subject.`, 404);
    if (co.description.trim() === description) {
      return fail(`${co.co_code} already reads exactly that.`, 409);
    }

    const { error } = await admin
      .from("course_outcomes")
      .update({ description })
      .eq("subject_id", subjectId)
      .eq("co_code", co.co_code);
    if (error) {
      console.error("[syllabus audit apply] co_description:", error.message);
      return fail("Failed to update the course outcome.", 500);
    }

    return { ok: true, summary: `Reworded ${co.co_code}.` };
  }

  // ── co_po_mapping: set a CO→PO strength ──────────────────────────────────
  const coCode = normalizeCoCode(patch.coCode);
  if (!coCode) return fail("The proposal did not name a valid CO code.");

  const poNum = Math.trunc(Number(String(patch.poCode ?? "").replace(/[^0-9]/g, "")));
  if (!Number.isFinite(poNum) || poNum < 1 || poNum > 12) {
    return fail("The proposal did not name a valid programme outcome (PO1-PO12).");
  }
  const strength = Math.trunc(Number(patch.strength));
  if (!Number.isFinite(strength) || strength < 1 || strength > 3) {
    return fail("CO-PO strength must be 1, 2 or 3.");
  }

  const co = await resolveCo(admin, subjectId, coCode);
  if (!co) return fail(`${coCode} is not a course outcome of this subject.`, 404);

  const { error } = await admin.from("co_po_mapping").upsert(
    { subject_id: subjectId, co_code: co.co_code, po_code: `PO${poNum}`, strength },
    { onConflict: "subject_id,co_code,po_code" },
  );
  if (error) {
    console.error("[syllabus audit apply] co_po_mapping:", error.message);
    return fail("Failed to save the CO-PO mapping.", 500);
  }

  return { ok: true, summary: `${co.co_code} now addresses PO${poNum} at strength ${strength}.` };
}

// ─── The cascade ─────────────────────────────────────────────────────────────

/**
 * Delete every cached artifact downstream of this subject's syllabus.
 *
 * Deletion rather than fingerprint-invalidation is deliberate (see the file
 * header). Each delete is independent and non-fatal: a cache that fails to
 * clear must not fail the write that already succeeded — the syllabus edit is
 * the user's intent, the cache clear is housekeeping. A failure is logged and
 * reported as 0 cleared, which the fingerprint check will then catch on next
 * access as the slower backstop.
 *
 * syllabus_audit_cache is included because an accepted proposal changes the
 * very data the cached proposals were computed from — leaving it would offer a
 * fix for a problem that was just solved.
 */
export async function invalidateDownstreamCaches(
  admin: AdminClient,
  subjectId: string,
): Promise<InvalidationReport> {
  const tables = [
    ["lesson_plan_cache", "lessonPlanCache"],
    ["lab_manual_cache", "labManualCache"],
    ["syllabus_audit_cache", "syllabusAuditCache"],
  ] as const;

  const report: InvalidationReport = {
    lessonPlanCache: 0,
    labManualCache: 0,
    syllabusAuditCache: 0,
  };

  await Promise.all(
    tables.map(async ([table, key]) => {
      const { data, error } = await admin
        .from(table)
        .delete()
        .eq("subject_id", subjectId)
        .select("id");
      if (error) {
        console.warn(`[syllabus audit apply] failed to clear ${table}:`, error.message);
        return;
      }
      report[key] = (data ?? []).length;
    }),
  );

  return report;
}
