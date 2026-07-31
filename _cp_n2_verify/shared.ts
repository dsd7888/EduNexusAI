/**
 * Shared plumbing for the CP-N2 subject-scope harnesses.
 *
 * Re-exports CP-N1's shim and reporting helpers rather than forking them — the
 * `workAsyncStorage` shim in particular EXECUTES the after() callback instead of
 * discarding it, which is what makes any "which AI calls ran?" assertion mean
 * something (CLAUDE.md harness rules). Copying it here would be a second copy to
 * keep correct.
 *
 * ── FIXTURE CHOICE ───────────────────────────────────────────────────────────
 * CP-N1 used IDSH2020 (8 modules) and SOEEC1010 (6). Subject-scope assembly
 * needs EVERY module of a subject generated, and POST /regenerate regenerates
 * them SEQUENTIALLY, so an 8-module fixture is 8 serial Flash calls per run.
 * These harnesses therefore use the two smallest seeded subjects that have real
 * syllabus content and a student-visible offering:
 *
 *   IDME3532  4 modules  — assembly, hash propagation, rate-limit/logging
 *   IDCH3051  3 modules  — partial coverage, regenerate auth (3 serial calls)
 *
 * Nothing about assembly is module-count sensitive; the count only drives cost.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export {
  loadEnvLocal,
  adminClient,
  makeChecker,
  hr,
  sub,
  onSignals,
  makeRunInScope,
  type Checker,
} from "../_cp_n1_verify/shared";

export const N2_FIXTURES = {
  /** Automobile Engineering — 4 modules, CSE/sem 1 offering. */
  ASSEMBLY: "IDME3532",
  /** Pharmaceutical Technology — 3 modules. Smallest real regenerate target. */
  SMALL: "IDCH3051",
} as const;

export type ResolvedSubject = {
  subjectId: string;
  code: string;
  name: string;
  modules: Array<{ id: string; moduleNumber: number; name: string }>;
  offering: { branch: string; semester: number };
};

export async function resolveSubject(
  admin: SupabaseClient,
  code: string
): Promise<ResolvedSubject> {
  const { data: subject } = await admin
    .from("subjects")
    .select("id, code, name")
    .eq("code", code)
    .maybeSingle();
  if (!subject) throw new Error(`Fixture subject ${code} not found`);

  const { data: mods } = await admin
    .from("modules")
    .select("id, module_number, name")
    .eq("subject_id", subject.id)
    .order("module_number", { ascending: true });
  if (!mods || mods.length === 0) throw new Error(`${code} has no modules`);

  // The student read path resolves through subject_offerings on BRANCH, so a
  // harness student minted on an arbitrary branch would 403 for the wrong
  // reason and prove nothing.
  const { data: off } = await admin
    .from("subject_offerings")
    .select("branch, semester")
    .eq("subject_id", subject.id)
    .limit(1)
    .maybeSingle();
  if (!off) throw new Error(`${code} has no offering`);

  return {
    subjectId: subject.id,
    code: subject.code,
    name: subject.name,
    modules: mods.map((m) => ({
      id: m.id,
      moduleNumber: m.module_number,
      name: m.name,
    })),
    offering: { branch: off.branch, semester: off.semester },
  };
}

export type StoredNote = {
  id: string;
  moduleId: string | null;
  scope: string;
  version: number;
  contentHash: string;
  isStale: boolean;
  blocks: Array<{ id: string; kind: string }>;
  sourceMetadata: Record<string, unknown> | null;
  tokensUsed: number | null;
  costInr: number | null;
  createdAt: string;
};

export async function loadNotes(
  admin: SupabaseClient,
  subjectId: string,
  scope?: "module" | "subject"
): Promise<StoredNote[]> {
  let q = admin
    .from("study_notes")
    .select(
      "id, module_id, scope, version, content_hash, is_stale, blocks, source_metadata, tokens_used, cost_inr, created_at"
    )
    .eq("subject_id", subjectId);
  if (scope) q = q.eq("scope", scope);
  const { data } = await q.order("version", { ascending: true });
  return (data ?? []).map((r) => ({
    id: r.id,
    moduleId: r.module_id,
    scope: r.scope,
    version: r.version,
    contentHash: r.content_hash,
    isStale: r.is_stale,
    blocks: (r.blocks ?? []) as Array<{ id: string; kind: string }>,
    sourceMetadata: r.source_metadata,
    tokensUsed: r.tokens_used,
    costInr: r.cost_inr,
    createdAt: r.created_at,
  }));
}

/**
 * Ensures every module of the subject has a FRESH module-scope note row,
 * generating only the ones missing.
 *
 * Reuses existing fresh rows deliberately: a re-run of these harnesses would
 * otherwise pay for a full subject's generation every time, and the assembler
 * is indifferent to whether a module row was produced a minute or a week ago.
 * Returns the module ids it actually generated, so a harness can report cost.
 *
 * ── WHY THIS RETRIES AND generateModuleNotes DOES NOT ────────────────────────
 * CP-N1's rule is that `invalid_blocks` is NEVER retried in the product, because
 * re-rolling until something validates is silent quality degradation. That rule
 * is about SERVING notes. This is fixture SETUP: a subject with a missing module
 * cannot establish the precondition ("N modules covered") that the assembly and
 * coverage assertions are measured against, and a harness that silently tested
 * 1-of-3 instead of 3-of-3 would be the weaker check, not the honest one.
 *
 * Observed in real runs: Flash overshoots the CP-N1 length ceilings by 1–2%
 * (610 chars against a 600 limit; an 81-char value against 80) on roughly one
 * module in four. Each retry is LOGGED with its reason so the rate stays visible
 * rather than being smoothed away — see the CP-N2 report.
 */
export async function ensureModuleNotes(
  admin: SupabaseClient,
  subject: ResolvedSubject,
  runInScope: <T>(fn: () => Promise<T>) => Promise<T>,
  onlyModuleIds?: string[]
): Promise<{ generated: string[]; failed: string[] }> {
  const { generateModuleNotes } = await import("@/lib/notes/generator");
  const targets = onlyModuleIds
    ? subject.modules.filter((m) => onlyModuleIds.includes(m.id))
    : subject.modules;

  const generated: string[] = [];
  const failed: string[] = [];
  const SETUP_ATTEMPTS = 2;

  for (const mod of targets) {
    const existing = await loadNotes(admin, subject.subjectId, "module");
    const fresh = existing.find((r) => r.moduleId === mod.id && !r.isStale);
    if (fresh) continue;

    let ok = false;
    for (let attempt = 1; attempt <= SETUP_ATTEMPTS && !ok; attempt += 1) {
      const res = await runInScope(() =>
        generateModuleNotes({
          subjectId: subject.subjectId,
          moduleId: mod.id,
          adminClient: admin as never,
          logContext: {
            userId: null,
            userEmail: null,
            userRole: "harness",
            subjectId: subject.subjectId,
            subjectCode: subject.code,
            jobId: crypto.randomUUID(),
            relatedContentId: null,
          },
        })
      );
      if (res.ok) {
        ok = true;
        generated.push(mod.id);
        console.log(
          `    generated M${mod.moduleNumber} (${res.blocks.length} blocks)${attempt > 1 ? ` [setup attempt ${attempt}]` : ""}`
        );
      } else {
        console.log(
          `    setup attempt ${attempt}/${SETUP_ATTEMPTS} failed for M${mod.moduleNumber}: ${res.error} — ${res.message}`
        );
      }
    }
    if (!ok) failed.push(mod.id);
  }
  return { generated, failed };
}

/** Deletes study_notes rows for a subject, optionally one scope. Returns residual count. */
export async function purgeSubjectNotes(
  admin: SupabaseClient,
  subjectId: string,
  scope?: "module" | "subject"
): Promise<number> {
  let del = admin.from("study_notes").delete().eq("subject_id", subjectId);
  if (scope) del = del.eq("scope", scope);
  await del;

  let q = admin
    .from("study_notes")
    .select("*", { count: "exact", head: true })
    .eq("subject_id", subjectId);
  if (scope) q = q.eq("scope", scope);
  const { count } = await q;
  return count ?? 0;
}

/** 64-char lowercase hex — the shape createHash('sha256').digest('hex') produces. */
export function isSha256Hex(v: unknown): boolean {
  return typeof v === "string" && /^[0-9a-f]{64}$/.test(v);
}
