/**
 * Notes v2 — PYQ exam-frequency cross-reference (CP-N3).
 *
 * SERVE-TIME ENRICHMENT, NOT STORED IN study_notes. PYQ data changes
 * independently of note content (new papers uploaded, existing ones
 * reprocessed). Storing frequency in the study_notes row would couple two
 * independent lifecycles, requiring notes regeneration whenever PYQs change.
 * Enrichment costs two cheap reads and is never cached.
 *
 * THERE IS NO AI CALL IN THIS FILE. This is a data cross-reference, not a
 * generation task.
 *
 * MODULE-LEVEL SIGNAL, NOT BLOCK-LEVEL. pyq_questions has no module_id — the
 * structural bridge is module → module_co_mapping.co_code → pyq_questions.co.
 * Every block from module M carries the same signal as every other block from
 * module M.
 *
 * `_moduleId` INTERNAL TAGGING (subject-scope only). A subject-scope
 * study_notes row is a flat concatenation of module blocks with no per-block
 * attribution. Because enrichment must run at SERVE time against current PYQ
 * data (not bake a signal into stored jsonb, per the rule above), a cache hit
 * still needs to know which module produced each block. subject-assembler.ts
 * tags each block with `_moduleId` when it concatenates module blocks into the
 * subject row — this is routing metadata, not PYQ data, so storing it does not
 * violate the "not stored" rule; it never goes stale the way a signal would.
 * This module strips `_moduleId` from every block it returns, in both the
 * success and failure paths, so it never reaches an API response.
 */
import type { NoteBlock } from "./types";

export type PyqSignal =
  | { kind: "rich"; coveredPapers: number; totalPapers: number; questionsCount: number }
  | { kind: "weak" };

// 'none' is represented by ABSENCE of the field, not a third union member.
// CP-N4 checks `if (block.pyqSignal)` to decide whether to render a chip at
// all — a `{kind: 'none'}` member would pass that check and try to render one.

export type EnrichedNoteBlock = NoteBlock & { pyqSignal?: PyqSignal };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = { from: (table: string) => any };

type CoCoverage = { documentIds: Set<string>; questions: number };

function stripInternalFields(block: NoteBlock): NoteBlock {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
  const { _moduleId, ...rest } = block as any;
  return rest as NoteBlock;
}

function buildModuleSignal(
  cos: string[],
  coCoverage: Map<string, CoCoverage>,
  totalPapers: number,
): PyqSignal | undefined {
  if (cos.length === 0) return undefined;

  const relevant = cos
    .map((co) => coCoverage.get(co))
    .filter((c): c is CoCoverage => c !== undefined);
  if (relevant.length === 0) return undefined;

  // UNION of document ids for papers (coverage: did this paper examine the
  // module — once), SUM of counts for questions (exposure: how many times did
  // it appear — cumulative). A single paper can carry questions for multiple
  // COs of the same module (e.g. one paper testing both this module's CO1 and
  // CO2) — SUMMING per-CO paper counts would count that paper twice; taking
  // the union of document ids across the module's COs counts it once.
  const coveredDocumentIds = new Set<string>();
  for (const r of relevant) for (const docId of r.documentIds) coveredDocumentIds.add(docId);
  const coveredPapers = coveredDocumentIds.size;
  const questionsCount = relevant.reduce((s, r) => s + r.questions, 0);

  if (coveredPapers === 0) return undefined;
  if (coveredPapers >= 2 && questionsCount >= 5) {
    return { kind: "rich", coveredPapers, totalPapers, questionsCount };
  }
  return { kind: "weak" };
}

/**
 * Enriches notes blocks with a PYQ exam-frequency signal, computed against
 * the CURRENT state of pyq_questions/module_co_mapping (never cached, never
 * stored on the block in the database).
 *
 * Graceful degradation (all silent, never an error): no CO mapping for the
 * module, no PYQ rows for the subject, or a DB error all simply produce no
 * signal on the affected blocks. Notes remain usable — PYQ absence is not a
 * failure mode.
 */
export async function enrichBlocksWithPyqFrequency(
  blocks: NoteBlock[],
  subjectId: string,
  moduleId: string | null,
  adminClient: AdminClient,
): Promise<EnrichedNoteBlock[]> {
  try {
    // ── 1. Modules to look up ────────────────────────────────────────────
    let moduleIds: string[];
    if (moduleId !== null) {
      moduleIds = [moduleId];
    } else {
      const { data: moduleRows } = await adminClient
        .from("modules")
        .select("id")
        .eq("subject_id", subjectId)
        .order("module_number", { ascending: true });
      moduleIds = (moduleRows ?? []).map((m: { id: string }) => m.id);
    }

    if (moduleIds.length === 0) {
      return blocks.map(stripInternalFields);
    }

    // ── 2. CO codes per module ───────────────────────────────────────────
    const { data: coMappingRows } = await adminClient
      .from("module_co_mapping")
      .select("module_id, co_code")
      .in("module_id", moduleIds);

    const moduleCoMap = new Map<string, string[]>();
    for (const id of moduleIds) moduleCoMap.set(id, []);
    for (const row of (coMappingRows ?? []) as Array<{
      module_id: string;
      co_code: string;
    }>) {
      const list = moduleCoMap.get(row.module_id);
      if (list) list.push(row.co_code);
    }

    // ── 3. Unique CO codes across all modules ────────────────────────────
    const allCoCodes = [...new Set([...moduleCoMap.values()].flat())];
    if (allCoCodes.length === 0) {
      return blocks.map(stripInternalFields);
    }

    // ── 4. Two batched reads (no .rpc(), grouping done in JS) ────────────
    const [totalRes, coRes] = await Promise.all([
      adminClient
        .from("pyq_questions")
        .select("document_id")
        .eq("subject_id", subjectId),
      adminClient
        .from("pyq_questions")
        .select("co, document_id")
        .eq("subject_id", subjectId)
        .in("co", allCoCodes),
    ]);

    if (totalRes.error || coRes.error) {
      console.error(
        "[notes] pyq-frequency enrichment query failed:",
        totalRes.error ?? coRes.error,
      );
      return blocks.map(stripInternalFields);
    }

    const totalPapers = new Set(
      ((totalRes.data ?? []) as Array<{ document_id: string }>).map(
        (r) => r.document_id,
      ),
    ).size;

    const coCoverage = new Map<string, CoCoverage>();
    for (const row of (coRes.data ?? []) as Array<{
      co: string;
      document_id: string;
    }>) {
      const entry = coCoverage.get(row.co) ?? { documentIds: new Set<string>(), questions: 0 };
      entry.documentIds.add(row.document_id);
      entry.questions += 1;
      coCoverage.set(row.co, entry);
    }

    // ── 5. Per-module signal ─────────────────────────────────────────────
    const moduleSignal = new Map<string, PyqSignal | undefined>();
    for (const [mId, cos] of moduleCoMap.entries()) {
      moduleSignal.set(mId, buildModuleSignal(cos, coCoverage, totalPapers));
    }

    // ── 6. Attach to blocks ───────────────────────────────────────────────
    if (moduleId !== null) {
      const signal = moduleSignal.get(moduleId);
      return blocks.map((block) => {
        const clean = stripInternalFields(block);
        return signal ? { ...clean, pyqSignal: signal } : clean;
      });
    }

    return blocks.map((block) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sourceModuleId = (block as any)._moduleId as string | undefined;
      const clean = stripInternalFields(block);
      const signal = sourceModuleId ? moduleSignal.get(sourceModuleId) : undefined;
      return signal ? { ...clean, pyqSignal: signal } : clean;
    });
  } catch (err) {
    console.error("[notes] pyq-frequency enrichment failed:", err);
    return blocks.map(stripInternalFields);
  }
}
