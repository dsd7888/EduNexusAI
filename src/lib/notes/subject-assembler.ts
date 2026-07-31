/**
 * Notes v2 — subject-scope assembly (CP-N2).
 *
 * THERE IS NO AI CALL IN THIS FILE, AND THERE MUST NEVER BE ONE. A subject-scope
 * row is a STORED JOIN of the module-scope rows beneath it — deterministic
 * concatenation of already-generated, already-validated blocks in module order.
 * It is not a generated artifact. Consequently `tokens_used` / `cost_inr` on the
 * subject row are the AGGREGATE of the constituent module rows, not the output
 * of a new call: they record what that content cost to produce, so subject-level
 * spend analysis does not double-count and does not read zero.
 *
 * FRESHNESS IS A HASH COMPARISON, NOT A FLAG — the same rule as the module
 * generator. The subject hash is derived from the constituent modules' hashes
 * (see {@link computeSubjectHash}), so any module regeneration that changes
 * content necessarily moves the subject hash. `is_stale` propagation from
 * generateModuleNotes is the fast path; the hash comparison here is the
 * authoritative one.
 *
 * PARTIAL COVERAGE IS VALID. A subject with 7 modules of which 5 have fresh
 * notes assembles from those 5 and records the shortfall in source_metadata, so
 * CP-N4 can say "5 of 7 modules covered" rather than showing nothing. The floor
 * is ZERO: with no covered modules there is nothing to join, and no row is
 * written.
 */

import { createHash } from "node:crypto";

import type { AILogContext } from "@/lib/ai/providers/types";
import {
  formatValidationIssues,
  validateNoteBlocks,
  type NoteBlock,
} from "./types";

// Minimal structural type for the service-role client — matches the shape
// generator.ts and access.ts take rather than importing a Supabase generic.
type AdminClient = {
  from: (table: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
};

/** Scope discriminator on study_notes. Named so the string is never re-typed. */
const SUBJECT_SCOPE = "subject";
const MODULE_SCOPE = "module";

export type SubjectSourceMetadata = {
  generatedAt: string;
  /** Module ids that contributed blocks — never the full module list. */
  modulesCovered: string[];
  /** Every module on the subject, covered or not. The denominator CP-N4 shows. */
  modulesTotal: number;
  aggregateTokensUsed: number;
  aggregateCostInr: number;
};

export type AssembleSubjectResult = {
  blocks: NoteBlock[];
  contentHash: string;
  version: number;
  sourceMetadata: SubjectSourceMetadata;
  fromCache: boolean;
};

/**
 * The success shape above is what the checkpoint specifies; the `ok` discriminant
 * carries the two failure surfaces it also requires (the zero-coverage floor, and
 * a failed insert). Mirrors generateModuleNotes' result union so both notes
 * entry points are handled the same way by their routes.
 */
export type AssembleSubjectOutcome =
  | ({ ok: true } & AssembleSubjectResult)
  | {
      ok: false;
      error: "no_module_notes" | "storage_failed";
      message: string;
      /** Present on no_module_notes — lets the caller explain the shortfall. */
      modulesTotal?: number;
    };

/**
 * SHA-256 over the constituent modules' identities and hashes.
 *
 * Sorted by module_number ASC before joining, so the hash is a property of the
 * SET of module notes and not of the order a query happened to return them in.
 * Each pair carries the moduleId as well as the hash so that adding a module
 * whose notes coincidentally hash to an existing value still moves the result,
 * and so that removing a module is distinguishable from replacing it.
 *
 * Pure — no I/O. Node's built-in crypto only.
 */
export function computeSubjectHash(
  moduleRows: Array<{
    moduleId: string;
    contentHash: string;
    moduleNumber: number;
  }>,
): string {
  const canonical = [...moduleRows]
    .sort((a, b) => a.moduleNumber - b.moduleNumber)
    .map((r) => `${r.moduleId}:${r.contentHash}`)
    .join("|");
  return createHash("sha256").update(canonical).digest("hex");
}

type CoveredModule = {
  moduleId: string;
  moduleNumber: number;
  contentHash: string;
  blocks: unknown;
  tokensUsed: number;
  costInr: number;
};

/**
 * Loads the subject's modules and the latest FRESH module-scope note row for
 * each, then derives the current subject hash from them.
 *
 * Shared by {@link assembleSubjectNotes} and {@link probeSubjectNotesCache} so
 * "what the subject hash is right now" has exactly one definition. It reads only
 * — no writes, no AI — which is what makes the cache probe cheap enough to run
 * before the rate-limit check.
 */
async function loadCoverage(
  adminClient: AdminClient,
  subjectId: string,
): Promise<{ covered: CoveredModule[]; modulesTotal: number; contentHash: string }> {
  const { data: moduleRowsRaw } = await adminClient
    .from("modules")
    .select("id, module_number, name")
    .eq("subject_id", subjectId)
    .order("module_number", { ascending: true });

  const modules: Array<{ id: string; module_number: number; name: string }> =
    moduleRowsRaw ?? [];
  const modulesTotal = modules.length;
  const moduleNumberById = new Map(modules.map((m) => [m.id, m.module_number]));

  // One query ordered version DESC, then first-wins per module_id: the latest
  // version is the only one that can contribute, and a per-module query would
  // be N round-trips for the same answer.
  const { data: noteRowsRaw } = await adminClient
    .from("study_notes")
    .select("id, module_id, version, blocks, content_hash, tokens_used, cost_inr")
    .eq("subject_id", subjectId)
    .eq("scope", MODULE_SCOPE)
    .eq("is_stale", false)
    .order("version", { ascending: false });

  const noteRows: Array<{
    id: string;
    module_id: string | null;
    version: number;
    blocks: unknown;
    content_hash: string;
    tokens_used: number | null;
    cost_inr: number | null;
  }> = noteRowsRaw ?? [];

  const latestByModule = new Map<string, (typeof noteRows)[number]>();
  for (const row of noteRows) {
    if (!row.module_id) continue;
    // Only modules that still exist on the subject may contribute — a note row
    // orphaned by a deleted module must not leak into the assembly.
    if (!moduleNumberById.has(row.module_id)) continue;
    if (!latestByModule.has(row.module_id)) latestByModule.set(row.module_id, row);
  }

  const covered: CoveredModule[] = [...latestByModule.entries()]
    .map(([moduleId, row]) => ({
      moduleId,
      moduleNumber: moduleNumberById.get(moduleId) as number,
      contentHash: row.content_hash,
      blocks: row.blocks,
      tokensUsed: row.tokens_used ?? 0,
      costInr: row.cost_inr ?? 0,
    }))
    .sort((a, b) => a.moduleNumber - b.moduleNumber);

  const contentHash = computeSubjectHash(
    covered.map((c) => ({
      moduleId: c.moduleId,
      contentHash: c.contentHash,
      moduleNumber: c.moduleNumber,
    })),
  );

  return { covered, modulesTotal, contentHash };
}

/**
 * Read-only cache probe for the subject GET route.
 *
 * WHY THIS VERIFIES THE HASH AND NOT JUST `is_stale`. The route must answer
 * "can I serve this without spending anything?" BEFORE the rate-limit check, so
 * a cache hit costs a student no quota (the same ordering as chat's
 * rate-check-after-cache). But `is_stale = false` alone is explicitly not a
 * freshness test anywhere in Notes v2 — a row can be unflagged and still
 * describe modules that have since changed. Part 1's inline propagation makes
 * the flag reliable in the designed flow; this comparison is what makes it
 * correct even when it is not (a direct DB edit, a failed propagation write, a
 * module row deleted rather than regenerated).
 *
 * Returns null on a miss — the caller then rate-limits and assembles.
 */
export async function probeSubjectNotesCache(input: {
  subjectId: string;
  adminClient: AdminClient;
}): Promise<
  | (AssembleSubjectResult & { fromCache: true; generatedAt: string })
  | null
> {
  const { subjectId, adminClient } = input;

  const { covered, modulesTotal, contentHash } = await loadCoverage(
    adminClient,
    subjectId,
  );
  if (covered.length === 0) return null;

  const { data: rows } = await adminClient
    .from("study_notes")
    .select("id, version, blocks, content_hash, is_stale, created_at, source_metadata")
    .eq("subject_id", subjectId)
    .eq("scope", SUBJECT_SCOPE)
    .eq("is_stale", false)
    .order("version", { ascending: false })
    .limit(1);

  const fresh = (rows ?? [])[0];
  if (!fresh || fresh.content_hash !== contentHash) return null;

  const cached = validateNoteBlocks(fresh.blocks, { expectCount: false });
  if (!cached.ok) return null;

  const storedMeta = (fresh.source_metadata ?? {}) as Partial<SubjectSourceMetadata>;
  return {
    blocks: cached.blocks,
    contentHash,
    version: fresh.version,
    fromCache: true,
    generatedAt: fresh.created_at,
    sourceMetadata: {
      generatedAt: storedMeta.generatedAt ?? fresh.created_at,
      modulesCovered: storedMeta.modulesCovered ?? covered.map((c) => c.moduleId),
      modulesTotal: storedMeta.modulesTotal ?? modulesTotal,
      aggregateTokensUsed: storedMeta.aggregateTokensUsed ?? 0,
      aggregateCostInr: storedMeta.aggregateCostInr ?? 0,
    },
  };
}

export async function assembleSubjectNotes(input: {
  subjectId: string;
  adminClient: AdminClient;
  logContext: Omit<AILogContext, "feature"> & { feature?: string };
}): Promise<AssembleSubjectOutcome> {
  const { subjectId, adminClient, logContext } = input;

  // ── 1/2/4. Coverage + current hash ────────────────────────────────────────
  const { covered, modulesTotal, contentHash } = await loadCoverage(
    adminClient,
    subjectId,
  );

  // ── 3. Coverage floor ─────────────────────────────────────────────────────
  // Partial is valid; zero is not. There is nothing to join, so nothing is
  // written — an empty subject row would otherwise cache "this subject has no
  // notes" behind a fresh-looking is_stale=false.
  if (covered.length === 0) {
    return {
      ok: false,
      error: "no_module_notes",
      message:
        modulesTotal === 0
          ? "This subject has no modules."
          : `No module notes are available for this subject yet (0 of ${modulesTotal} modules covered).`,
      modulesTotal,
    };
  }

  // ── 5. Existing subject-scope rows ────────────────────────────────────────
  // Fetched WITHOUT an is_stale filter: the cache candidate is the latest fresh
  // row, but the next version number must clear every row that ever existed,
  // stale ones included, or a regeneration collides with a retired version.
  const { data: subjectRowsRaw } = await adminClient
    .from("study_notes")
    .select("id, version, blocks, content_hash, is_stale, created_at, source_metadata")
    .eq("subject_id", subjectId)
    .eq("scope", SUBJECT_SCOPE)
    .order("version", { ascending: false });

  const subjectRows: Array<{
    id: string;
    version: number;
    blocks: unknown;
    content_hash: string;
    is_stale: boolean;
    created_at: string;
    source_metadata: unknown;
  }> = subjectRowsRaw ?? [];

  const maxVersion = subjectRows.reduce((m, r) => Math.max(m, r.version ?? 0), 0);
  const fresh = subjectRows.find((r) => !r.is_stale);

  if (fresh) {
    if (fresh.content_hash === contentHash) {
      // expectCount:false — the 4–12 block floor/ceiling is a per-MODULE
      // coverage rule. A subject row is a concatenation across modules and is
      // expected to exceed it; applying that bound here would reject every
      // multi-module subject.
      const cached = validateNoteBlocks(fresh.blocks, { expectCount: false });
      if (cached.ok) {
        const storedMeta = (fresh.source_metadata ?? {}) as Partial<SubjectSourceMetadata>;
        return {
          ok: true,
          blocks: cached.blocks,
          contentHash,
          version: fresh.version,
          fromCache: true,
          sourceMetadata: {
            generatedAt: storedMeta.generatedAt ?? fresh.created_at,
            modulesCovered: storedMeta.modulesCovered ?? covered.map((c) => c.moduleId),
            modulesTotal: storedMeta.modulesTotal ?? modulesTotal,
            aggregateTokensUsed: storedMeta.aggregateTokensUsed ?? 0,
            aggregateCostInr: storedMeta.aggregateCostInr ?? 0,
          },
        };
      }
      // Stored blocks that no longer validate mean the block model moved on.
      // Reassemble rather than serve something CP-N4 cannot render — but say so
      // loudly, it should not happen in normal operation.
      console.error(
        `[notes] stored subject blocks for study_notes ${fresh.id} failed validation; reassembling: ${formatValidationIssues(
          cached.issues,
        )}`,
      );
    }
    // Hash drift (or unrenderable stored blocks): retire the row and rebuild.
    // Flagged BEFORE the insert so a failed insert still leaves the outdated row
    // marked, never servable as if current.
    await adminClient
      .from("study_notes")
      .update({ is_stale: true })
      .eq("id", fresh.id);
  }

  // ── 6. Assemble ───────────────────────────────────────────────────────────
  // Concatenation in module_number order; each module's blocks keep their own
  // internal order. Blocks were validated when their module row was written, so
  // this re-validates shape only (expectCount:false, as above) rather than
  // trusting jsonb round-tripping blindly.
  const assembled: NoteBlock[] = [];
  for (const c of covered) {
    const v = validateNoteBlocks(c.blocks, { expectCount: false });
    if (!v.ok) {
      console.error(
        `[notes] module ${c.moduleId} blocks failed validation during subject assembly; skipped: ${formatValidationIssues(
          v.issues,
        )}`,
      );
      continue;
    }
    assembled.push(...v.blocks);
  }

  if (assembled.length === 0) {
    return {
      ok: false,
      error: "no_module_notes",
      message: `No renderable module notes for this subject (${covered.length} row(s) present but none validated).`,
      modulesTotal,
    };
  }

  // ── 7. Aggregate spend ────────────────────────────────────────────────────
  // The sum across contributing module rows. NOT a new AI call's cost — there is
  // no AI call. See the file header.
  const aggregateTokensUsed = covered.reduce((s, c) => s + (c.tokensUsed ?? 0), 0);
  const aggregateCostInr = covered.reduce((s, c) => s + (c.costInr ?? 0), 0);

  const sourceMetadata: SubjectSourceMetadata = {
    generatedAt: new Date().toISOString(),
    modulesCovered: covered.map((c) => c.moduleId),
    modulesTotal,
    aggregateTokensUsed,
    aggregateCostInr,
  };

  // ── 8/9. Version and insert ───────────────────────────────────────────────
  const version = maxVersion + 1;

  const { data: inserted, error: insertError } = await adminClient
    .from("study_notes")
    .insert({
      subject_id: subjectId,
      module_id: null,
      scope: SUBJECT_SCOPE,
      version,
      content_hash: contentHash,
      blocks: assembled,
      source_metadata: sourceMetadata,
      is_stale: false,
      generated_by: logContext.userId ?? null,
      tokens_used: aggregateTokensUsed,
      cost_inr: aggregateCostInr,
    })
    .select("id, version, created_at")
    .single();

  if (insertError || !inserted) {
    return {
      ok: false,
      error: "storage_failed",
      message: insertError?.message ?? "Failed to store assembled subject notes.",
    };
  }

  return {
    ok: true,
    blocks: assembled,
    contentHash,
    version: inserted.version,
    fromCache: false,
    sourceMetadata,
  };
}
