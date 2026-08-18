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

/**
 * Where one module's blocks begin and end inside the flat subject-scope array.
 *
 * CP-N4's reading view renders a section header per module, but the blocks it
 * receives carry no per-block module marker: `_moduleId` is internal routing
 * metadata that pyq-frequency.ts strips from every response (see the comment in
 * step 6 below). Rather than leak that field to the client, the assembler
 * publishes the module boundaries as INDEX RANGES over the array it just built.
 * The client needs `moduleName`/`moduleNumber` for the header text anyway, which
 * a bare `_moduleId` would not have supplied.
 *
 * Invariant the CP-N4 harness asserts: entries are ordered by moduleNumber ASC,
 * they tile the array without gaps or overlap, and the counts sum to
 * blocks.length. Only modules that actually CONTRIBUTED blocks appear — a module
 * skipped for failing validation is absent rather than present with count 0, so
 * that the sum invariant holds.
 */
export type ModuleBreakpoint = {
  moduleId: string;
  moduleName: string;
  moduleNumber: number;
  /** Index in the flat blocks array where this module's run begins. */
  startIndex: number;
  /** How many consecutive blocks belong to this module. Always ≥ 1. */
  count: number;
};

export type SubjectSourceMetadata = {
  generatedAt: string;
  /** Module ids that contributed blocks — never the full module list. */
  modulesCovered: string[];
  /** Every module on the subject, covered or not. The denominator CP-N4 shows. */
  modulesTotal: number;
  aggregateTokensUsed: number;
  aggregateCostInr: number;
  /** Module section boundaries over `blocks`. See {@link ModuleBreakpoint}. */
  moduleBreakpoints: ModuleBreakpoint[];
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
  /** Carried purely so moduleBreakpoints can name the section header. */
  moduleName: string;
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
  const moduleMetaById = new Map(
    modules.map((m) => [
      m.id,
      { moduleNumber: m.module_number, moduleName: m.name ?? "" },
    ]),
  );

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
    if (!moduleMetaById.has(row.module_id)) continue;
    if (!latestByModule.has(row.module_id)) latestByModule.set(row.module_id, row);
  }

  const covered: CoveredModule[] = [...latestByModule.entries()]
    .map(([moduleId, row]) => {
      const meta = moduleMetaById.get(moduleId) as {
        moduleNumber: number;
        moduleName: string;
      };
      return {
        moduleId,
        moduleNumber: meta.moduleNumber,
        moduleName: meta.moduleName,
        contentHash: row.content_hash,
        blocks: row.blocks,
        tokensUsed: row.tokens_used ?? 0,
        costInr: row.cost_inr ?? 0,
      };
    })
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
 * Recovers moduleBreakpoints from a STORED block array by reading each block's
 * `_moduleId` tag and grouping the consecutive runs.
 *
 * WHY THIS EXISTS AT ALL. Breakpoints are computed during assembly (step 6) and
 * written into source_metadata, so a row written by this version of the code
 * already carries them. But every subject row written before CP-N4 does not, and
 * those rows are servable indefinitely — freshness is a hash match against the
 * constituent modules, and nothing about adding a metadata field moves that hash.
 * Without this fallback the reading view would silently lose its section headers
 * on exactly the subjects that have been stable longest.
 *
 * Grouping consecutive runs (rather than bucketing by id) is what makes the
 * output tile the array: assembly concatenates whole modules in module_number
 * order, so a module's blocks are contiguous by construction. Should a stored row
 * ever violate that — hand-edited jsonb, a future interleaving assembler — each
 * run is emitted as its own entry, which keeps the "counts sum to blocks.length"
 * invariant true rather than quietly producing overlapping ranges.
 *
 * Returns [] for pre-CP-N3 rows whose blocks carry no `_moduleId` at all. The
 * reading view treats an empty array as "no section headers, all-modules only",
 * which degrades the surface rather than breaking it.
 */
function deriveModuleBreakpoints(
  blocks: unknown[],
  moduleMeta: Map<string, { moduleName: string; moduleNumber: number }>,
): ModuleBreakpoint[] {
  const out: ModuleBreakpoint[] = [];

  for (let i = 0; i < blocks.length; i++) {
    const moduleId = (blocks[i] as { _moduleId?: unknown } | null)?._moduleId;
    if (typeof moduleId !== "string") continue;

    const prev = out[out.length - 1];
    if (prev && prev.moduleId === moduleId && prev.startIndex + prev.count === i) {
      prev.count += 1;
      continue;
    }
    const meta = moduleMeta.get(moduleId);
    out.push({
      moduleId,
      moduleName: meta?.moduleName ?? "",
      moduleNumber: meta?.moduleNumber ?? out.length + 1,
      startIndex: i,
      count: 1,
    });
  }

  return out;
}

/** Meta lookup for {@link deriveModuleBreakpoints}, built from loadCoverage output. */
function moduleMetaFromCovered(
  covered: CoveredModule[],
): Map<string, { moduleName: string; moduleNumber: number }> {
  return new Map(
    covered.map((c) => [
      c.moduleId,
      { moduleName: c.moduleName, moduleNumber: c.moduleNumber },
    ]),
  );
}

/**
 * source_metadata as stored, upgraded to the current shape.
 *
 * Shared by the two cache-hit paths so "what a cached row's metadata means" has
 * one definition. Stored breakpoints win when present; otherwise they are
 * derived from the blocks themselves.
 */
function hydrateStoredMetadata(input: {
  storedMeta: Partial<SubjectSourceMetadata>;
  storedBlocks: unknown[];
  covered: CoveredModule[];
  modulesTotal: number;
  createdAt: string;
}): SubjectSourceMetadata {
  const { storedMeta, storedBlocks, covered, modulesTotal, createdAt } = input;
  return {
    generatedAt: storedMeta.generatedAt ?? createdAt,
    modulesCovered: storedMeta.modulesCovered ?? covered.map((c) => c.moduleId),
    modulesTotal: storedMeta.modulesTotal ?? modulesTotal,
    aggregateTokensUsed: storedMeta.aggregateTokensUsed ?? 0,
    aggregateCostInr: storedMeta.aggregateCostInr ?? 0,
    moduleBreakpoints:
      storedMeta.moduleBreakpoints ??
      deriveModuleBreakpoints(storedBlocks, moduleMetaFromCovered(covered)),
  };
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
    sourceMetadata: hydrateStoredMetadata({
      storedMeta,
      storedBlocks: cached.blocks,
      covered,
      modulesTotal,
      createdAt: fresh.created_at,
    }),
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
          sourceMetadata: hydrateStoredMetadata({
            storedMeta,
            storedBlocks: cached.blocks,
            covered,
            modulesTotal,
            createdAt: fresh.created_at,
          }),
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
  // Recorded as the array is built, so startIndex is the real offset rather than
  // a re-derivation. A module skipped below contributes NO entry (not a zero-count
  // one) — see ModuleBreakpoint for why the sum invariant depends on that.
  const moduleBreakpoints: ModuleBreakpoint[] = [];
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
    if (v.blocks.length === 0) continue;

    moduleBreakpoints.push({
      moduleId: c.moduleId,
      moduleName: c.moduleName,
      moduleNumber: c.moduleNumber,
      startIndex: assembled.length,
      count: v.blocks.length,
    });
    // _moduleId is internal routing metadata for CP-N3's PYQ-frequency
    // enrichment (pyq-frequency.ts) — it lets serve-time enrichment
    // re-attribute a flat, concatenated subject-scope row back to the module
    // each block came from. It is not PYQ data, so storing it does not
    // violate "PYQ signal is never stored" — it never goes stale. Stripped
    // from every response by enrichBlocksWithPyqFrequency.
    assembled.push(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...v.blocks.map((b) => ({ ...b, _moduleId: c.moduleId }) as any),
    );
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
    moduleBreakpoints,
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
