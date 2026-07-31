/**
 * Shared plumbing for the CP-N3 PYQ-frequency harnesses.
 *
 * Uses `@/lib/testing/httpHarness` throughout (per CP-N3's brief) rather than
 * calling `enrichBlocksWithPyqFrequency` directly — the claims under test are
 * about the ROUTE (auth, the `pyqEnriched` flag, the exact response shape),
 * not just the library function.
 *
 * ── FIXTURE CHOICE ───────────────────────────────────────────────────────────
 * Real seeded data, resolved by CODE at runtime (a reseed changes ids, not
 * codes):
 *
 *   IDME3532 — 4 modules, CSE/sem1 offering, ALL FOUR already have a fresh
 *   module-scope study_notes row (left behind by the CP-N2 harnesses) and ZERO
 *   pyq_questions rows. Module GETs against it are cache hits — no AI spend —
 *   and its subject-scope row has never been assembled, so it doubles as the
 *   no_pyq_graceful fixture.
 *     M1 075426a6-a1c2-4ca2-b94b-2d015eb557ad — CO "CO 5"
 *     M2 58355caf-d9f5-4903-b0f8-0acff51be9a6 — CO "CO 3"
 *
 *   SECE3260 M4 09a6a79b-716f-43cd-93c7-b4866b13bb47 — CSE/sem1 offering, the
 *   only fixture found with exactly two CO codes on one module ("CO 1", "CO 2")
 *   — module_co_multi.ts's whole point. No study_notes row exists yet, so this
 *   one GET pays for one real Flash generation (same cost class CP-N1/N2 accept
 *   elsewhere).
 *
 * pyq_questions.co is free text mirroring what's printed on the paper — these
 * fixtures' module_co_mapping rows use "CO 1"/"CO 5" style codes (with a
 * space), confirmed by direct query before writing this file.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

export {
  loadEnvLocal,
  signInAsStudent,
  waitForServer,
  onSignals,
  makeChecker,
  hr,
  sub,
  sleep,
  type Checker,
  type StudentSession,
} from "@/lib/testing/httpHarness";

export const N3_FIXTURES = {
  MODULE_SCOPE: {
    subjectCode: "IDME3532",
    subjectId: "", // resolved at runtime by code
    m1: { id: "075426a6-a1c2-4ca2-b94b-2d015eb557ad", co: "CO 5" },
    m2: { id: "58355caf-d9f5-4903-b0f8-0acff51be9a6", co: "CO 3" },
    branch: "CSE",
    semester: 1,
  },
  MULTI_CO: {
    subjectCode: "SECE3260",
    moduleId: "09a6a79b-716f-43cd-93c7-b4866b13bb47",
    cos: ["CO 1", "CO 2"],
    branch: "CSE",
    semester: 1,
  },
} as const;

export async function resolveSubjectId(
  admin: SupabaseClient,
  code: string,
): Promise<string> {
  const { data } = await admin
    .from("subjects")
    .select("id")
    .eq("code", code)
    .maybeSingle();
  if (!data) throw new Error(`Fixture subject ${code} not found`);
  return data.id as string;
}

export type SeededDoc = { documentId: string };

/**
 * Seeds one `documents` row (type='pyq') plus N `pyq_questions` rows against
 * it, all tagged with the given CO code. `uploaded_by` is the real seeded
 * superadmin profile — stable, never deleted by a harness's cleanup() — so
 * seeding never risks cascading into an unrelated profile.
 */
export async function seedPyqDocument(
  admin: SupabaseClient,
  opts: {
    subjectId: string;
    co: string;
    questionCount: number;
    year?: number;
    uploadedBy: string;
  },
): Promise<SeededDoc> {
  const { data: doc, error: docErr } = await admin
    .from("documents")
    .insert({
      subject_id: opts.subjectId,
      type: "pyq",
      title: `CP-N3 harness fixture ${randomUUID().slice(0, 8)}`,
      file_path: `harness/cp-n3/${randomUUID()}.pdf`,
      year: opts.year ?? 2025,
      uploaded_by: opts.uploadedBy,
      status: "ready",
    })
    .select("id")
    .single();
  if (docErr || !doc) {
    throw new Error(`[shared] seed documents insert failed: ${docErr?.message}`);
  }

  const rows = Array.from({ length: opts.questionCount }, (_, i) => ({
    document_id: doc.id,
    subject_id: opts.subjectId,
    section_name: "Section I",
    q_number: `Q-${i + 1}`,
    question_text: `CP-N3 harness fixture question ${i + 1}`,
    question_type: "descriptive",
    marks: 5,
    co: opts.co,
    btl: 2,
    year: opts.year ?? 2025,
  }));
  const { error: qErr } = await admin.from("pyq_questions").insert(rows);
  if (qErr) {
    throw new Error(`[shared] seed pyq_questions insert failed: ${qErr.message}`);
  }

  return { documentId: doc.id as string };
}

/** Deletes seeded pyq_questions + documents rows. Returns residual row count for both. */
export async function purgeSeededPyq(
  admin: SupabaseClient,
  documentIds: string[],
): Promise<{ residualQuestions: number; residualDocuments: number }> {
  if (documentIds.length === 0) return { residualQuestions: 0, residualDocuments: 0 };
  await admin.from("pyq_questions").delete().in("document_id", documentIds);
  await admin.from("documents").delete().in("id", documentIds);

  const { count: residualQuestions } = await admin
    .from("pyq_questions")
    .select("*", { count: "exact", head: true })
    .in("document_id", documentIds);
  const { count: residualDocuments } = await admin
    .from("documents")
    .select("*", { count: "exact", head: true })
    .in("id", documentIds);
  return {
    residualQuestions: residualQuestions ?? 0,
    residualDocuments: residualDocuments ?? 0,
  };
}

export async function getSuperadminProfileId(admin: SupabaseClient): Promise<string> {
  const { data } = await admin
    .from("profiles")
    .select("id")
    .eq("role", "superadmin")
    .limit(1)
    .maybeSingle();
  if (!data) throw new Error("[shared] no superadmin profile found to seed documents.uploaded_by");
  return data.id as string;
}

export type SnapshotRow = {
  id: string;
  module_id: string;
  co_code: string;
  confidence: string | null;
  source: string | null;
};

/** Snapshots and deletes a module's module_co_mapping rows. Restore with {@link restoreCoMapping}. */
export async function stripCoMapping(
  admin: SupabaseClient,
  moduleId: string,
): Promise<SnapshotRow[]> {
  const { data } = await admin
    .from("module_co_mapping")
    .select("id, module_id, co_code, confidence, source")
    .eq("module_id", moduleId);
  const snapshot = (data ?? []) as SnapshotRow[];
  if (snapshot.length > 0) {
    await admin
      .from("module_co_mapping")
      .delete()
      .in("id", snapshot.map((r) => r.id));
  }
  return snapshot;
}

/** Restores rows captured by {@link stripCoMapping}, preserving original ids. */
export async function restoreCoMapping(
  admin: SupabaseClient,
  snapshot: SnapshotRow[],
): Promise<void> {
  if (snapshot.length === 0) return;
  const { error } = await admin.from("module_co_mapping").insert(snapshot);
  if (error) {
    throw new Error(`[shared] failed to restore module_co_mapping: ${error.message}`);
  }
}
