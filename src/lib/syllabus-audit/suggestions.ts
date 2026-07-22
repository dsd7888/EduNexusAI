// ============================================================================
// Syllabus Health Audit — Layer 2: AI suggestions + the validation gate
//
// ONE routeAI("syllabus_audit", …) call per subject. The model does two jobs
// that no deterministic rule can:
//
//   (a) FIXES — for each fixable Layer 1 finding, propose the SPECIFIC change
//       (which CO belongs on which module; which BTL level to add, and why).
//   (b) DISCOVERIES — raise findings in the three dimensions that require
//       judgement: co_verb_quality, modern_relevance, missing_topics.
//
// ── Two rules make this safe ────────────────────────────────────────────────
//
// 1. THE MODEL NEVER EMITS A PATCH. It emits typed, flat, individually
//    validated fields (moduleNumber, coCode, btlLevel, newDescription); the
//    patch object that /apply eventually writes is BUILT HERE from those fields
//    after each one has been checked against the real syllabus. A free-form
//    `patch` in the response schema would be an arbitrary DB write payload
//    authored by a language model — and a wide, shapeless schema field is also
//    the runaway-token failure mode from §17.
//
// 2. THE MODEL NEVER EMITS `oldValue`. The red side of every diff is rendered
//    from the DB, here. If the model misremembers the current CO description,
//    a model-authored oldValue would show the faculty a fabricated "before"
//    and they would accept a diff that never existed. Only `newValue` carries
//    model content, and only where the proposal IS text (co_description).
//
// The gate below drops rather than repairs: a proposal that fails any check is
// discarded with a warning, never coerced into a nearby valid one. That is the
// hard-gate-over-smarter-fallback lesson from §17, and it matters more here
// than anywhere else in the product because the output of this file is a button
// that writes to the syllabus.
// ============================================================================

import { routeAI } from "@/lib/ai/router";
import { buildModuleDigest } from "@/lib/subjectContext";
import type { AILogContext } from "@/lib/ai/providers/types";
import {
  AI_DIMENSION_SEVERITY,
  DIMENSION_ENTITY_TYPES,
  PROPOSAL_ENTITY_TYPES,
  type AuditInput,
  type AuditWarning,
  type Dimension,
  type Finding,
  type Proposal,
  type ProposalEntityType,
  type SuggestionResult,
} from "./types";
import { aiFindingId } from "./checks";

/**
 * These are NOT taste — they are the hard ceiling Gemini will serve.
 *
 * Constrained decoding compiles the responseSchema into a state machine, and an
 * array `maxItems` multiplies the states of everything nested inside it. At
 * fixes=24/discoveries=12 the API rejects the request outright with 400 "The
 * specified schema produces a constraint that has too many states for serving"
 * — BEFORE generating a token, so it fails every single time, not
 * intermittently. Probed empirically (Jul 2026): 12/8 is accepted, 14/8 and
 * 12/10 are both rejected. maxItems is what drives it, NOT maxLength — 24/12 is
 * rejected even with every length bound removed — so the §19 "narrow schema,
 * maxLength everywhere" rule stays fully intact here.
 *
 * Headroom check: the worst real subject in the pilot raises 5 fixable
 * warning/critical findings, so 12 is ~2.4× observed demand. selectFindingsForAi
 * caps the prompt at MAX_FIXES anyway, so the model is never asked for more
 * than the schema can carry.
 */
const MAX_FIXES = 12;
const MAX_DISCOVERIES = 8;
const MAX_RATIONALE = 200;
const MAX_DIAGNOSIS = 200;
const MAX_NEW_VALUE = 300;

const AI_DIMENSION_NAMES = [
  "co_verb_quality",
  "modern_relevance",
  "missing_topics",
] as const;

// ─── Prompt ──────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT =
  "You are a curriculum design expert for Indian technical universities. You " +
  "know the AICTE model curricula, NBA accreditation criteria, and Bloom's " +
  "taxonomy in depth, and you advise faculty on making a syllabus assessable " +
  "and accreditation-ready. You are CONSERVATIVE: a false alarm costs a faculty " +
  "member's trust and they stop using the tool, so you only raise what you are " +
  "confident about. You never propose dropping syllabus content — only adding, " +
  "remapping, or rewording. Output must obey the provided JSON schema exactly.";

function buildPrompt(input: AuditInput, findings: Finding[]): string {
  const { ctx } = input;

  const moduleBlock = ctx.modules
    .map((m) => {
      const btl = m.btl_levels.join(",") || "none recorded";
      const cos = m.coCodes.length ? m.coCodes.join(", ") : "NONE";
      const hours = m.hours != null ? `${m.hours}h` : "hours not recorded";
      const weight =
        m.weightage_percent != null ? `${m.weightage_percent}%` : "weightage not recorded";
      return (
        `  Module ${m.module_number}: ${m.name}\n` +
        `    topics: ${m.description.replace(/\s+/g, " ").trim() || "(none recorded)"}\n` +
        `    ${hours} · ${weight} · BTL [${btl}] · COs: ${cos}`
      );
    })
    .join("\n");

  const coBlock = ctx.courseOutcomes.length
    ? ctx.courseOutcomes
        .map((c) => {
          const modules = ctx.modules
            .filter((m) => m.coCodes.includes(c.co_code))
            .map((m) => m.module_number);
          const where = modules.length ? `modules ${modules.join(", ")}` : "NO MODULES";
          return `  ${c.co_code} (currently on ${where}): ${c.description}`;
        })
        .join("\n")
    : "  (no course outcomes recorded)";

  const practicalBlock = ctx.practicals.length
    ? ctx.practicals.map((p) => `  #${p.sr_no}: ${p.name}`).join("\n")
    : "  (this subject has no practicals)";

  const findingBlock = findings.length
    ? findings
        .map(
          (f) =>
            `  id=${f.id} [${f.severity}] ${f.dimension} · ${f.entity}\n` +
            `    ${f.diagnosis}`,
        )
        .join("\n")
    : "  (no fixable findings — propose no fixes, only discoveries)";

  const validModuleNos = ctx.modules.map((m) => m.module_number).join(", ") || "none";
  const validCoCodes = ctx.courseOutcomes.map((c) => c.co_code).join(", ") || "none";

  return `Subject: ${ctx.subjectName}${ctx.subjectCode ? ` (${ctx.subjectCode})` : ""}

<modules>
${moduleBlock}
</modules>

<all_modules_digest>
${buildModuleDigest(ctx.modules)}
</all_modules_digest>

<course_outcomes>
${coBlock}
</course_outcomes>

<practicals>
${practicalBlock}
</practicals>

<reference_books>
${input.referenceBooks ?? "  (none recorded)"}
</reference_books>

<findings_needing_a_fix>
These were computed from the database. They are FACTS, not guesses — do not
dispute them. For each one, propose the specific change that resolves it:
${findingBlock}
</findings_needing_a_fix>

<valid_identifiers>
Module numbers you may reference: ${validModuleNos}
CO codes you may reference: ${validCoCodes}
Anything outside these lists will be rejected.
</valid_identifiers>

=== PART 1: fixes ===
One entry per finding id above that you can confidently resolve. Skip any you
cannot — an omitted fix is fine, a wrong one is not.

ALWAYS set BOTH moduleNumber AND coCode on a "module_co_mapping" fix, even when
one of them is already named in the finding text. Restating it is not redundant —
a fix missing either field is discarded.

- co_coverage finding about a CO with no modules → entityType "module_co_mapping",
  set coCode to that CO and moduleNumber to the ONE module whose topics genuinely
  teach it. Pick on topic overlap, not on filling a gap.
- co_coverage finding about a module with no COs → entityType "module_co_mapping",
  set moduleNumber to that module and coCode to the CO its topics genuinely serve.
- btl_profile finding → entityType "btl_levels", set moduleNumber and btlLevel to
  the ONE level to ADD to that module. Only propose a level the module's topics
  can actually support. Never propose removing a level.
- rationale (REQUIRED, ≤${MAX_RATIONALE} chars): why this specific change helps.
  Cite the topic overlap or the NBA/Bloom's reason. "Module 7 covers try/catch and
  finally, which is exactly what CO3 asks students to apply" — not "improves
  mapping".

=== PART 2: discoveries ===
Findings in three areas no rule can compute. Be conservative in all three.

- co_verb_quality: a CO whose verb is not measurable at its stated level.
  "Learn", "understand", "study", "know", "appreciate", "be familiar with" are
  NOT measurable. Set dimension "co_verb_quality", coCode, entity to the CO code,
  diagnosis to what is wrong, and newDescription to the full reworded CO. The
  replacement verb MUST match the BTL level of the modules that CO maps to — do
  not raise a CO to "Evaluate" if its modules top out at BTL 3.
- modern_relevance: a topic that is deprecated or obsolete in current industry
  practice (Java Applets, Turbo C, an outdated library or standard). Say in one
  line what replaced it. Do NOT suggest dropping it — suggest adding a
  contemporary note alongside it. Set entity to the module ("Module 4").
- missing_topics: 1-3 topics conspicuously absent versus the AICTE model
  curriculum or standard textbook coverage for a subject of this name. Only
  clear omissions — if you are reaching, return none. Set entity to the topic.

Return an empty array for any of the three where you have nothing confident to
say. Empty is a valid and often correct answer.

Output JSON only, conforming to the schema.`;
}

// Narrow schema (§19): every field is one the gate actually consumes, every
// string is maxLength-bounded, and there is no free-form object anywhere.
const SUGGESTION_SCHEMA = {
  type: "object",
  properties: {
    fixes: {
      type: "array",
      maxItems: MAX_FIXES,
      items: {
        type: "object",
        properties: {
          findingId: { type: "string", maxLength: 32 },
          entityType: { type: "string", enum: [...PROPOSAL_ENTITY_TYPES] },
          moduleNumber: { type: "integer" },
          coCode: { type: "string", maxLength: 12 },
          btlLevel: { type: "integer" },
          rationale: { type: "string", maxLength: MAX_RATIONALE },
        },
        // moduleNumber is required because BOTH entityTypes reachable from the
        // fixes array (module_co_mapping, btl_levels) name a module. Leaving it
        // optional let the model return mapping fixes with no module at all,
        // which the gate then correctly but pointlessly dropped — observed on
        // 2 of 3 CO-mapping proposals in the first live run. coCode stays
        // optional: btl_levels genuinely has no CO.
        required: ["findingId", "entityType", "moduleNumber", "rationale"],
      },
    },
    discoveries: {
      type: "array",
      maxItems: MAX_DISCOVERIES,
      items: {
        type: "object",
        properties: {
          dimension: { type: "string", enum: [...AI_DIMENSION_NAMES] },
          entity: { type: "string", maxLength: 60 },
          diagnosis: { type: "string", maxLength: MAX_DIAGNOSIS },
          suggestion: { type: "string", maxLength: MAX_DIAGNOSIS },
          coCode: { type: "string", maxLength: 12 },
          newDescription: { type: "string", maxLength: MAX_NEW_VALUE },
          rationale: { type: "string", maxLength: MAX_RATIONALE },
        },
        required: ["dimension", "entity", "diagnosis"],
      },
    },
  },
  required: ["fixes", "discoveries"],
};

// ─── Parsing helpers ─────────────────────────────────────────────────────────

function parseJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = String(text ?? "").trim();
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // fall through to brace salvage
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      const parsed = JSON.parse(trimmed.slice(start, end + 1));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      /* give up */
    }
  }
  return null;
}

function str(v: unknown, max: number): string {
  const s = typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
  return s.length > max ? s.slice(0, max) : s;
}

/**
 * Same bound as str(), but for PROSE that a faculty member reads in the diff
 * card. Gemini treats responseSchema maxLength as guidance rather than a hard
 * stop, so overruns do reach us and the gate is what actually enforces the
 * limit — a raw slice() then cuts mid-word ("…supports designing data stru").
 * Clipping back to the last word boundary and marking the elision keeps the
 * rationale readable, which matters because the rationale is the entire basis
 * on which someone decides to accept a change to their syllabus.
 */
function text(v: unknown, max: number): string {
  const s = typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  // Only honour the boundary if it isn't throwing away most of the text.
  const body = lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut;
  return `${body.replace(/[,;:.\s]+$/, "")}…`;
}

function int(v: unknown): number | null {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) ? n : null;
}

/** "CO 3", "co3", "CO-3" all normalise so a cosmetic difference isn't a rejection. */
function normalizeCoCode(raw: unknown): string | null {
  const s = String(raw ?? "").trim().toUpperCase().replace(/[\s_-]/g, "");
  const m = /^CO0*(\d{1,2})$/.exec(s);
  return m ? `CO${Number(m[1])}` : null;
}

/** "Module 7" → 7. Used to recover a module the model left off a fix. */
function moduleNumberFromEntity(entity: string): number | null {
  const m = /^module\s+(\d{1,3})$/i.exec(String(entity ?? "").trim());
  return m ? Number(m[1]) : null;
}

// ─── The gate ────────────────────────────────────────────────────────────────

/**
 * Turns raw model output into Proposals and Findings that are safe to show and,
 * on Accept, safe to write. Exported so the harness can drive it with
 * forced-bad fixtures — proving the gate does NOT require the model to
 * misbehave on demand.
 */
export function validateSuggestions(
  rawFixes: unknown,
  rawDiscoveries: unknown,
  input: AuditInput,
  findings: Finding[],
): SuggestionResult {
  const warnings: AuditWarning[] = [];
  const proposals: Proposal[] = [];
  const aiFindings: Finding[] = [];

  const { ctx } = input;
  const findingById = new Map(findings.map((f) => [f.id, f]));
  const moduleByNumber = new Map(ctx.modules.map((m) => [m.module_number, m]));
  const coByCode = new Map(
    ctx.courseOutcomes.map((c) => [normalizeCoCode(c.co_code) ?? c.co_code, c]),
  );

  // ── PART 1: fixes ─────────────────────────────────────────────────────────
  const seenFindingIds = new Set<string>();

  for (const raw of Array.isArray(rawFixes) ? (rawFixes as unknown[]) : []) {
    const row = (raw ?? {}) as Record<string, unknown>;
    const findingId = str(row.findingId, 32);
    const finding = findingById.get(findingId);

    if (!finding) {
      warnings.push({
        kind: "orphan_proposal",
        message: `Dropped a proposal for finding "${findingId}" — no such finding in this audit.`,
      });
      continue;
    }
    if (!finding.fixable) {
      warnings.push({
        kind: "non_fixable_proposal",
        message: `Dropped a proposal for "${finding.entity}" — that finding is advisory only.`,
      });
      continue;
    }
    if (seenFindingIds.has(findingId)) {
      warnings.push({
        kind: "duplicate_proposal",
        message: `Dropped a second proposal for "${finding.entity}" — kept the first.`,
      });
      continue;
    }

    const rationale = text(row.rationale, MAX_RATIONALE);
    if (!rationale) {
      warnings.push({
        kind: "empty_rationale",
        message: `Dropped a proposal for "${finding.entity}" — no rationale given.`,
      });
      continue;
    }

    const entityType = str(row.entityType, 40) as ProposalEntityType;
    const allowed = DIMENSION_ENTITY_TYPES[finding.dimension] ?? [];
    if (!allowed.includes(entityType)) {
      warnings.push({
        kind: "bad_entity_type",
        message: `Dropped a proposal for "${finding.entity}" — ${finding.dimension} may not propose a "${entityType}" change.`,
      });
      continue;
    }

    const built = buildProposal({
      finding,
      entityType,
      row,
      rationale,
      moduleByNumber,
      coByCode,
      warnings,
    });
    if (!built) continue;

    seenFindingIds.add(findingId);
    proposals.push(built);
  }

  // ── PART 2: discoveries ───────────────────────────────────────────────────
  const seenDiscoveries = new Set<string>();

  for (const raw of Array.isArray(rawDiscoveries) ? (rawDiscoveries as unknown[]) : []) {
    const row = (raw ?? {}) as Record<string, unknown>;
    const dimension = str(row.dimension, 40) as Dimension;
    if (!(AI_DIMENSION_NAMES as readonly string[]).includes(dimension)) {
      warnings.push({
        kind: "bad_discovery",
        message: `Dropped a discovery in unknown dimension "${dimension}".`,
      });
      continue;
    }

    const entity = str(row.entity, 60);
    const diagnosis = text(row.diagnosis, MAX_DIAGNOSIS);
    if (!entity || !diagnosis) {
      warnings.push({
        kind: "bad_discovery",
        message: `Dropped a ${dimension} discovery with no entity or diagnosis.`,
      });
      continue;
    }

    const dedupKey = `${dimension}|${entity}`;
    if (seenDiscoveries.has(dedupKey)) {
      warnings.push({
        kind: "duplicate_proposal",
        message: `Dropped a repeated ${dimension} discovery for "${entity}".`,
      });
      continue;
    }
    seenDiscoveries.add(dedupKey);

    const severity =
      AI_DIMENSION_SEVERITY[dimension as (typeof AI_DIMENSION_NAMES)[number]];
    const suggestion = text(row.suggestion, MAX_DIAGNOSIS) || null;

    // A co_verb_quality discovery can carry a rewrite; the other two are
    // advisory by policy (§3) and never produce a proposal.
    let proposal: Proposal | null = null;
    if (dimension === "co_verb_quality") {
      const coCode = normalizeCoCode(row.coCode) ?? normalizeCoCode(entity);
      const co = coCode ? coByCode.get(coCode) : undefined;
      const newDescription = text(row.newDescription, MAX_NEW_VALUE);
      if (co && coCode && newDescription && newDescription !== co.description) {
        proposal = {
          id: crypto.randomUUID(),
          findingId: aiFindingId(dimension, coCode, "verb"),
          dimension,
          entityType: "co_description",
          entityRef: coCode,
          // Red side straight from the DB — never from the model.
          oldValue: co.description,
          newValue: newDescription,
          rationale: text(row.rationale, MAX_RATIONALE) || diagnosis,
          patch: { coCode, description: newDescription },
          status: "pending",
        };
      } else if (newDescription && !co) {
        warnings.push({
          kind: "unknown_entity",
          message: `Dropped a CO rewrite for "${entity}" — that CO is not in this subject.`,
        });
      }
    }

    const finding: Finding = {
      // Same deterministic scheme as Layer 1, so a proposal keyed to this id
      // still resolves after a re-audit.
      id: aiFindingId(
        dimension,
        proposal?.entityRef ?? entity,
        dimension === "co_verb_quality" ? "verb" : "topic",
      ),
      dimension,
      severity,
      entity,
      diagnosis,
      suggestion: severity === "info" ? null : suggestion,
      fixable: proposal !== null,
    };

    aiFindings.push(finding);
    if (proposal) {
      proposal.findingId = finding.id;
      proposals.push(proposal);
    }
  }

  return { proposals, aiFindings, warnings };
}

/**
 * Builds ONE proposal from validated fields, or returns null with a warning.
 * Every branch checks the referenced entity really exists in this subject and
 * that the change is not already true — a proposal to add a CO the module
 * already has renders as an identical red/green diff and reads as a bug.
 */
function buildProposal(args: {
  finding: Finding;
  entityType: ProposalEntityType;
  row: Record<string, unknown>;
  rationale: string;
  moduleByNumber: Map<number, import("@/lib/subjectContext").SubjectModule>;
  coByCode: Map<string, import("@/lib/subjectContext").SubjectCourseOutcome>;
  warnings: AuditWarning[];
}): Proposal | null {
  const { finding, entityType, row, rationale, moduleByNumber, coByCode, warnings } =
    args;

  if (entityType === "module_co_mapping") {
    // A co_coverage finding's entity IS the affected CO ("CO2") or module
    // ("Module 3"), straight from the DB. When the model omits the matching
    // field — which it does often, treating it as redundant with the finding it
    // was handed — read it back off the finding rather than dropping an
    // otherwise-good proposal. This is NOT the fallback-coercion anti-pattern
    // from §17: nothing is being guessed at, we are reading an authoritative
    // value we already computed. Guessing would be picking a *nearest* CO.
    const moduleNumber = int(row.moduleNumber) ?? moduleNumberFromEntity(finding.entity);
    const coCode = normalizeCoCode(row.coCode) ?? normalizeCoCode(finding.entity);
    const mod = moduleNumber != null ? moduleByNumber.get(moduleNumber) : undefined;
    const co = coCode ? coByCode.get(coCode) : undefined;

    // Two distinct failures, kept distinct: a field neither the model nor the
    // finding supplied (incomplete_patch) vs. one that names something this
    // subject doesn't have (unknown_entity). Collapsing them hides which
    // happened, and only the second means the model invented a syllabus entity.
    if (moduleNumber == null || !coCode) {
      warnings.push({
        kind: "incomplete_patch",
        message: `Dropped a mapping proposal for "${finding.entity}" — no ${moduleNumber == null ? "module" : "CO"} was named.`,
      });
      return null;
    }
    if (!mod || !co) {
      warnings.push({
        kind: "unknown_entity",
        message: `Dropped a mapping proposal for "${finding.entity}" — ${!mod ? `module ${moduleNumber}` : `CO ${coCode}`} is not in this subject.`,
      });
      return null;
    }
    if (mod.coCodes.includes(coCode) || mod.coCodes.includes(co.co_code)) {
      warnings.push({
        kind: "redundant_proposal",
        message: `Dropped a mapping proposal — Module ${mod.module_number} already maps to ${coCode}.`,
      });
      return null;
    }

    const isCoSideFinding = finding.entity.toUpperCase().startsWith("CO");
    const oldValue = isCoSideFinding
      ? `${coCode} → (no modules)`
      : `Module ${mod.module_number} → (no COs)`;
    const newValue = isCoSideFinding
      ? `${coCode} → Module ${mod.module_number} (${mod.name})`
      : `Module ${mod.module_number} → ${coCode} (${co.description})`;

    return {
      id: crypto.randomUUID(),
      findingId: finding.id,
      dimension: finding.dimension,
      entityType,
      entityRef: String(mod.module_number),
      oldValue,
      newValue: text(newValue, MAX_NEW_VALUE),
      rationale,
      patch: { moduleId: mod.id, moduleNumber: mod.module_number, coCode },
      status: "pending",
    };
  }

  if (entityType === "btl_levels") {
    const moduleNumber = int(row.moduleNumber);
    const btlLevel = int(row.btlLevel);
    const mod = moduleNumber != null ? moduleByNumber.get(moduleNumber) : undefined;

    if (!mod) {
      warnings.push({
        kind: "unknown_entity",
        message: `Dropped a BTL proposal for "${finding.entity}" — module ${String(row.moduleNumber)} is not in this subject.`,
      });
      return null;
    }
    if (btlLevel == null || btlLevel < 1 || btlLevel > 6) {
      warnings.push({
        kind: "incomplete_patch",
        message: `Dropped a BTL proposal for Module ${mod.module_number} — "${String(row.btlLevel)}" is not a Bloom's level 1-6.`,
      });
      return null;
    }
    if (mod.btl_levels.includes(btlLevel)) {
      warnings.push({
        kind: "redundant_proposal",
        message: `Dropped a BTL proposal — Module ${mod.module_number} already targets BTL ${btlLevel}.`,
      });
      return null;
    }

    const next = [...mod.btl_levels, btlLevel].sort((a, b) => a - b);
    return {
      id: crypto.randomUUID(),
      findingId: finding.id,
      dimension: finding.dimension,
      entityType,
      entityRef: String(mod.module_number),
      oldValue: `Module ${mod.module_number} BTL: [${mod.btl_levels.join(", ")}]`,
      newValue: `Module ${mod.module_number} BTL: [${next.join(", ")}]`,
      rationale,
      patch: { moduleId: mod.id, moduleNumber: mod.module_number, btlLevels: next },
      status: "pending",
    };
  }

  // co_description arrives via discoveries, not fixes; the remaining three
  // entityTypes have no fixable dimension pointing at them yet (see
  // DIMENSION_ENTITY_TYPES). Reaching here means the whitelist and this switch
  // disagree — fail closed.
  warnings.push({
    kind: "bad_entity_type",
    message: `Dropped a proposal for "${finding.entity}" — "${entityType}" has no builder.`,
  });
  return null;
}

// ─── Entry point ─────────────────────────────────────────────────────────────

/**
 * Which Layer 1 findings are worth spending a Flash call on: fixable, and
 * severe enough to matter. Info-level advisories are deliberately excluded —
 * they are observations the faculty may already have made on purpose.
 *
 * Capped at MAX_FIXES so the prompt can never ask for more entries than the
 * schema is able to return. runDeterministicAudit sorts severity-first, so if
 * the cap ever bites, what survives is the criticals — the right triage rather
 * than an arbitrary prefix.
 */
export function selectFindingsForAi(findings: Finding[]): Finding[] {
  return findings
    .filter((f) => f.fixable && (f.severity === "warning" || f.severity === "critical"))
    .slice(0, MAX_FIXES);
}

export async function generateSuggestions(
  input: AuditInput,
  findings: Finding[],
  logContext: AILogContext,
): Promise<SuggestionResult> {
  const eligible = findings.filter(
    (f) => f.fixable && (f.severity === "warning" || f.severity === "critical"),
  );
  const selected = selectFindingsForAi(findings);
  const truncated = eligible.length - selected.length;

  let raw: Record<string, unknown> | null = null;
  try {
    const res = await routeAI("syllabus_audit", {
      model: "flash",
      messages: [{ role: "user", content: buildPrompt(input, selected) }],
      systemPrompt: SYSTEM_PROMPT,
      // Conservative: this call's output becomes an Accept button on a syllabus.
      temperature: 0.3,
      responseSchema: SUGGESTION_SCHEMA,
      thinkingBudget: 0,
      logContext: {
        ...logContext,
        metadata: {
          ...(logContext.metadata ?? {}),
          fixableFindings: selected.length,
          totalFindings: findings.length,
        },
      },
    });
    raw = parseJsonObject(String(res.content ?? ""));
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    console.warn(`[syllabus-audit suggest] generation failed: ${message}`);
    return {
      proposals: [],
      aiFindings: [],
      warnings: [
        {
          kind: "generation_failed",
          message: "AI suggestions could not be generated. The audit findings above are unaffected.",
        },
      ],
    };
  }

  if (!raw) {
    return {
      proposals: [],
      aiFindings: [],
      warnings: [
        {
          kind: "generation_failed",
          message: "AI returned an unreadable response. The audit findings above are unaffected.",
        },
      ],
    };
  }

  const result = validateSuggestions(raw.fixes, raw.discoveries, input, findings);

  // Never let a cap silently swallow findings — the faculty must know some
  // findings weren't sent, or they'll read "no proposal" as "nothing to fix".
  if (truncated > 0) {
    result.warnings.push({
      kind: "generation_failed",
      message: `${truncated} lower-severity finding(s) were not sent to the AI this run — the most severe ${selected.length} were prioritised. Fix these, then re-run suggestions for the rest.`,
    });
  }

  return result;
}
