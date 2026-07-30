/**
 * Notes v2 — module-scope generation.
 *
 * FRESHNESS IS A HASH COMPARISON, NOT A FLAG. A stored row may be served only
 * when its content_hash equals the hash of the CURRENT syllabus source AND it
 * is not marked stale. `is_stale` alone is never sufficient: a row can be
 * unflagged and still describe a syllabus that has since been edited. When the
 * hash diverges we flag the old rows and generate a new version rather than
 * updating in place, so the previous version stays readable while the new one
 * is produced and a bad regeneration can be rolled back.
 *
 * VALIDATION FAILURES ARE NOT RETRIED. A silently-retried notes generation is a
 * silently-degraded one — the second attempt's quality is unobserved and the
 * cost is invisible. On invalid model output this returns an error surface
 * carrying every issue and the raw blocks, and writes NOTHING to study_notes.
 */

import { createHash } from "node:crypto";

import { routeAI } from "@/lib/ai/router";
import type { AILogContext } from "@/lib/ai/providers/types";
import {
  buildModuleNotesPrompt,
  MODULE_NOTES_RESPONSE_SCHEMA,
  NOTES_SYSTEM_PROMPT,
} from "./prompts";
import {
  formatValidationIssues,
  validateNoteBlocks,
  type BlockValidationIssue,
  type NoteBlock,
} from "./types";

/** The ai_call_logs bucket for every Notes v2 call. Never "chat" (the v1 bug). */
export const NOTES_FEATURE = "notes";
/** routeAI task name. Registered in router.ts and gemini.ts isStructuredTask. */
export const NOTES_MODULE_TASK = "notes_gen_module";

// Minimal structural type for the service-role client, matching the shape the
// other lib/ modules take rather than importing a Supabase generic.
type AdminClient = {
  from: (table: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
};

export type GenerateModuleNotesInput = {
  subjectId: string;
  moduleId: string;
  adminClient: AdminClient;
  logContext: Omit<AILogContext, "feature"> & { feature?: string };
  /** Skip the cache probe and force a new version (the regenerate path). */
  forceRegenerate?: boolean;
  /**
   * TEST SEAM — replaces the routeAI call. Used only by _cp_n1_verify to feed
   * the generator a known-bad payload.
   *
   * It exists because the two claims Part 3 makes about failure are otherwise
   * unfalsifiable from outside: "does not silently retry" and "writes nothing
   * on invalid output". Asserting those against a real model means waiting for
   * it to spontaneously emit invalid JSON, which it will not reliably do. The
   * harness counts invocations through this seam, so "exactly one call" is a
   * measurement rather than a promise. Never set in application code — both
   * routes omit it.
   */
  aiOverride?: () => Promise<{
    content: string;
    tokensUsed: { input: number; output: number; thinking: number };
    costInr: number;
    modelUsed: string;
  }>;
};

export type GenerateModuleNotesResult =
  | {
      ok: true;
      blocks: NoteBlock[];
      version: number;
      generatedAt: string;
      contentHash: string;
      source: "cache" | "fresh";
      tokensUsed: number;
      costInr: number;
      model: string;
    }
  | {
      ok: false;
      error:
        | "module_not_found"
        | "no_syllabus"
        | "generation_failed"
        | "invalid_blocks"
        | "storage_failed";
      message: string;
      /** Present on invalid_blocks — the whole failure surface, for debugging. */
      issues?: BlockValidationIssue[];
      rawBlocks?: unknown[];
    };

/**
 * Stable serialisation of everything the notes are derived from. Any change
 * here changes every stored hash, so treat it as a format version: if the
 * fields ever change, existing rows correctly become stale rather than
 * silently mismatching.
 */
function computeContentHash(parts: {
  moduleNumber: number;
  moduleName: string;
  moduleDescription: string | null;
  syllabusContent: string;
}): string {
  const canonical = JSON.stringify({
    v: 1,
    moduleNumber: parts.moduleNumber,
    moduleName: parts.moduleName.trim(),
    moduleDescription: (parts.moduleDescription ?? "").trim(),
    syllabusContent: parts.syllabusContent.trim(),
  });
  return createHash("sha256").update(canonical).digest("hex");
}

export async function generateModuleNotes(
  input: GenerateModuleNotesInput,
): Promise<GenerateModuleNotesResult> {
  const { subjectId, moduleId, adminClient, forceRegenerate = false } = input;

  // ── 1. Load the source ────────────────────────────────────────────────────
  const [moduleRes, subjectRes, contentRes] = await Promise.all([
    adminClient
      .from("modules")
      .select("id, subject_id, name, module_number, description")
      .eq("id", moduleId)
      .maybeSingle(),
    adminClient
      .from("subjects")
      .select("id, name, code")
      .eq("id", subjectId)
      .maybeSingle(),
    adminClient
      .from("subject_content")
      .select("content")
      .eq("subject_id", subjectId)
      .maybeSingle(),
  ]);

  const moduleRow = moduleRes.data;
  const subjectRow = subjectRes.data;

  if (!moduleRow || !subjectRow) {
    return {
      ok: false,
      error: "module_not_found",
      message: "Module or subject not found.",
    };
  }
  // The module must genuinely belong to the subject — otherwise a caller that
  // passed an access check on `subjectId` could generate notes for any module
  // in the database by supplying a foreign moduleId.
  if (moduleRow.subject_id !== subjectId) {
    return {
      ok: false,
      error: "module_not_found",
      message: "Module does not belong to this subject.",
    };
  }

  const syllabusContent = String(contentRes.data?.content ?? "").trim();
  if (!syllabusContent) {
    return {
      ok: false,
      error: "no_syllabus",
      message: "This subject has no syllabus content yet.",
    };
  }

  const contentHash = computeContentHash({
    moduleNumber: moduleRow.module_number,
    moduleName: moduleRow.name,
    moduleDescription: moduleRow.description ?? null,
    syllabusContent,
  });

  // ── 2. Existing versions ──────────────────────────────────────────────────
  const { data: existingRows } = await adminClient
    .from("study_notes")
    .select(
      "id, version, blocks, content_hash, is_stale, created_at, tokens_used, cost_inr",
    )
    .eq("subject_id", subjectId)
    .eq("module_id", moduleId)
    .eq("scope", "module")
    .order("version", { ascending: false });

  const rows: Array<{
    id: string;
    version: number;
    blocks: unknown;
    content_hash: string;
    is_stale: boolean;
    created_at: string;
  }> = existingRows ?? [];

  const maxVersion = rows.reduce((m, r) => Math.max(m, r.version ?? 0), 0);

  if (!forceRegenerate) {
    // Servable ONLY when both conditions hold. Checking is_stale alone would
    // serve notes written against a syllabus that has since changed.
    const servable = rows.find(
      (r) => !r.is_stale && r.content_hash === contentHash,
    );
    if (servable) {
      const cached = validateNoteBlocks(servable.blocks);
      if (cached.ok) {
        return {
          ok: true,
          blocks: cached.blocks,
          version: servable.version,
          generatedAt: servable.created_at,
          contentHash,
          source: "cache",
          tokensUsed: 0,
          costInr: 0,
          model: "cache",
        };
      }
      // Stored blocks that no longer validate mean the block model moved on.
      // Fall through and regenerate rather than serving something CP-N4 cannot
      // render — but flag it loudly, it should not happen in normal operation.
      console.error(
        `[notes] stored blocks for study_notes ${servable.id} failed validation; regenerating: ${formatValidationIssues(
          cached.issues,
        )}`,
      );
    }
  }

  // Any row describing a different source is now stale. Do this BEFORE
  // generating so a failed generation still leaves the outdated rows flagged.
  const divergent = rows.filter(
    (r) => r.content_hash !== contentHash && !r.is_stale,
  );
  const toFlag = forceRegenerate
    ? rows.filter((r) => !r.is_stale).map((r) => r.id)
    : divergent.map((r) => r.id);
  if (toFlag.length > 0) {
    await adminClient
      .from("study_notes")
      .update({ is_stale: true })
      .in("id", toFlag);
  }

  // ── 3. Generate ───────────────────────────────────────────────────────────
  const prompt = buildModuleNotesPrompt({
    subjectName: subjectRow.name,
    subjectCode: subjectRow.code,
    moduleNumber: moduleRow.module_number,
    moduleName: moduleRow.name,
    moduleDescription: moduleRow.description ?? null,
    syllabusContent,
  });

  /**
   * ── WHAT MAY BE RETRIED, AND WHAT MAY NOT ────────────────────────────────
   *
   * `generation_failed` — the AI call threw, or the response was not parseable
   * JSON — IS retried once. There is no content to degrade: nothing usable came
   * back, so a second attempt cannot quietly lower quality.
   *
   * `invalid_blocks` — parseable JSON that violates the block model — is NEVER
   * retried, per Part 3. That failure means the model produced study material
   * the contract rejects, and retrying until something passes is exactly the
   * silent degradation this checkpoint refuses. It fails loudly with the whole
   * issue list attached.
   *
   * WHY THE RETRY EXISTS AT ALL (measured, not precautionary): five consecutive
   * real generations of SOEEC1010 M1 — the densest seeded module — returned
   * 3 successes, 1 unparseable response and 1 validation failure. The
   * unparseable one is a decoder degeneration: the model fills the entire
   * output budget with escaped newlines inside a string. Raising maxTokens
   * 8192 -> 16384 doubled the newlines rather than fixing it, which is how we
   * know it is degeneration and not truncation. The proximate cause is the
   * missing outer array bound (see MODULE_NOTES_RESPONSE_SCHEMA): Gemini will
   * not serve the bounded schema, and those bounds were also the model's
   * stopping signal.
   */
  const MAX_GENERATION_ATTEMPTS = 2;

  let ai:
    | {
        content: string;
        tokensUsed: { input: number; output: number; thinking: number };
        costInr: number;
        modelUsed: string;
      }
    | undefined;
  let parsed: unknown;
  let lastFailure = "";

  for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS; attempt++) {
    try {
      ai = input.aiOverride
        ? await input.aiOverride()
        : await routeAI(NOTES_MODULE_TASK, {
            messages: [{ role: "user", content: prompt }],
            systemPrompt: NOTES_SYSTEM_PROMPT,
            // Matches the router default for this task; stated here so the
            // budget is visible next to the schema it has to accommodate.
            maxTokens: 16384,
            // §19: structured task. gemini.ts also defaults this for the task;
            // set explicitly so the guarantee is visible at the call site.
            thinkingBudget: 0,
            responseSchema: MODULE_NOTES_RESPONSE_SCHEMA,
            logContext: {
              ...input.logContext,
              subjectId,
              // The cost-attribution fix: v1 logged notes generation as "chat".
              feature: NOTES_FEATURE,
              // Both attempts are logged, so a retry is visible in the spend
              // rather than hidden inside one apparent call.
              attemptNumber: attempt,
            },
          });
    } catch (err) {
      lastFailure = err instanceof Error ? err.message : "AI call failed.";
      ai = undefined;
      continue;
    }

    const rawText = String(ai.content ?? "");
    try {
      parsed = JSON.parse(rawText);
      lastFailure = "";
      break;
    } catch {
      // Distinguish degeneration/truncation from genuine malformation. "Not
      // valid JSON" alone sends you looking for a prompt bug instead of a
      // budget or decoder one.
      const looksTruncated =
        rawText.length > 0 && !rawText.trimEnd().endsWith("}");
      lastFailure = looksTruncated
        ? `Model response was truncated or degenerated at ${rawText.length} chars; tail: ${JSON.stringify(rawText.slice(-160))}`
        : `Model response was not valid JSON (${rawText.length} chars).`;
      parsed = undefined;
    }
  }

  if (!ai || parsed === undefined) {
    return {
      ok: false,
      error: "generation_failed",
      message: `${lastFailure} (after ${MAX_GENERATION_ATTEMPTS} attempts)`,
      rawBlocks: [],
    };
  }

  const blocksRaw = (parsed as { blocks?: unknown })?.blocks;
  const validation = validateNoteBlocks(blocksRaw);
  if (!validation.ok) {
    // No retry, no partial insert. Surface everything.
    return {
      ok: false,
      error: "invalid_blocks",
      message: `Generated blocks failed validation: ${formatValidationIssues(validation.issues)}`,
      issues: validation.issues,
      rawBlocks: validation.rawBlocks,
    };
  }

  // ── 4. Store ──────────────────────────────────────────────────────────────
  const version = maxVersion + 1;
  const tokensUsed =
    (ai.tokensUsed?.input ?? 0) +
    (ai.tokensUsed?.output ?? 0) +
    (ai.tokensUsed?.thinking ?? 0);

  const { data: inserted, error: insertError } = await adminClient
    .from("study_notes")
    .insert({
      subject_id: subjectId,
      module_id: moduleId,
      scope: "module",
      version,
      content_hash: contentHash,
      blocks: validation.blocks,
      source_metadata: {
        generatedAt: new Date().toISOString(),
        model: ai.modelUsed,
        task: NOTES_MODULE_TASK,
        blockCount: validation.blocks.length,
        moduleNumber: moduleRow.module_number,
      },
      is_stale: false,
      generated_by: input.logContext.userId ?? null,
      tokens_used: tokensUsed,
      cost_inr: ai.costInr,
    })
    .select("id, version, created_at")
    .single();

  if (insertError || !inserted) {
    return {
      ok: false,
      error: "storage_failed",
      message: insertError?.message ?? "Failed to store generated notes.",
    };
  }

  return {
    ok: true,
    blocks: validation.blocks,
    version: inserted.version,
    generatedAt: inserted.created_at,
    contentHash,
    source: "fresh",
    tokensUsed,
    costInr: ai.costInr,
    model: ai.modelUsed,
  };
}
