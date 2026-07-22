// ============================================================================
// Syllabus Health Audit — shared types
//
// CLIENT-SAFE. This module is imported by the faculty Health tab as well as by
// the server checks/suggestions, so it must contain types + plain constants
// ONLY — no node:crypto, no supabase client, no prompt text. The finding-id
// hash lives in checks.ts (server) for exactly that reason (CLAUDE_CONTEXT §19,
// the vizTypes/vizPrompts split-by-runtime rule).
//
// The feature is two layers:
//   Layer 1 (checks.ts)      — deterministic, no AI, runs on every page load.
//   Layer 2 (suggestions.ts) — ONE Flash call that turns fixable Layer 1
//                              findings into Proposals, and adds the three
//                              dimensions that cannot be computed.
//
// Nothing in either layer writes to the syllabus. A Proposal is a PROPOSAL: it
// only reaches the real tables via /api/syllabus/audit/apply, after the faculty
// member has read the diff and pressed Accept.
// ============================================================================

export type Severity = "critical" | "warning" | "info";

export type Dimension =
  | "co_coverage" // CO ↔ Module mapping gaps
  | "btl_profile" // BTL progression + breadth
  | "hours_balance" // Hours vs weightage alignment
  | "topic_density" // Topics-per-hour imbalance
  | "practical_alignment" // Practical ↔ theory orphans
  | "co_po_mapping" // POs with no CO addressing them
  | "co_verb_quality" // Unmeasurable / non-Bloom CO verbs
  | "modern_relevance" // Outdated tech/topic flags
  | "missing_topics" // Standard topics conspicuously absent
  | "assessment_coverage"; // COs that can't be assessed given exam scheme

/** Computed from DB data with no AI. Cheap, instant, re-runs after every edit. */
export const DETERMINISTIC_DIMENSIONS = [
  "co_coverage",
  "btl_profile",
  "hours_balance",
  "topic_density",
  "practical_alignment",
  "co_po_mapping",
  "assessment_coverage",
] as const satisfies readonly Dimension[];

/** Only ever produced by the Flash suggestion call — no deterministic rule exists. */
export const AI_DIMENSIONS = [
  "co_verb_quality",
  "modern_relevance",
  "missing_topics",
] as const satisfies readonly Dimension[];

export const ALL_DIMENSIONS: readonly Dimension[] = [
  ...DETERMINISTIC_DIMENSIONS,
  ...AI_DIMENSIONS,
];

export const DIMENSION_LABELS: Record<Dimension, string> = {
  co_coverage: "CO Coverage",
  btl_profile: "BTL Profile",
  hours_balance: "Hours vs Weightage",
  topic_density: "Topic Density",
  practical_alignment: "Practical Alignment",
  co_po_mapping: "PO Coverage",
  co_verb_quality: "CO Verb Quality",
  modern_relevance: "Modern Relevance",
  missing_topics: "Missing Topics",
  assessment_coverage: "Assessment Coverage",
};

export interface Finding {
  /**
   * Deterministic hash of dimension + entity + the check-local kind. The spec
   * asks for dimension+entity; the kind is folded in because a single dimension
   * can legitimately raise two DIFFERENT findings about the same entity (a
   * module can both regress in BTL and be dense with topics). Without the kind
   * those two would collide and dedup would silently swallow one — while
   * re-running the same check on the same entity still yields the same id,
   * which is the property dedup actually needs.
   */
  id: string;
  dimension: Dimension;
  severity: Severity;
  /** What's affected: "CO 3", "Module 7", "PO 5", "Subject". */
  entity: string;
  /** One sentence, factual, no jargon. */
  diagnosis: string;
  /** null for info-only findings. */
  suggestion: string | null;
  /** Can a Proposal be generated for this? Info-only advisories are false. */
  fixable: boolean;
}

/** The DB entities a proposal is allowed to touch. Whitelist — see /apply. */
export type ProposalEntityType =
  | "module_co_mapping"
  | "btl_levels"
  | "co_description"
  | "module_weightage"
  | "practical_mapping"
  | "co_po_mapping";

export const PROPOSAL_ENTITY_TYPES: readonly ProposalEntityType[] = [
  "module_co_mapping",
  "btl_levels",
  "co_description",
  "module_weightage",
  "practical_mapping",
  "co_po_mapping",
];

/** A proposed change to one DB entity, shown in the diff view. */
export interface Proposal {
  id: string;
  /** Which finding this fixes — validated against a real finding at the gate. */
  findingId: string;
  dimension: Dimension;
  entityType: ProposalEntityType;
  /** e.g. module number, CO code, practical sr_no. */
  entityRef: string;
  /** Human-readable current state (rendered red in the diff). */
  oldValue: string;
  /** Human-readable proposed state (rendered green in the diff). */
  newValue: string;
  /** ≤200 chars: WHY this change helps, not just what it does. */
  rationale: string;
  /** The actual DB write payload — typed per entityType, re-validated server-side. */
  patch: Record<string, unknown>;
  status: "pending" | "accepted" | "dismissed";
}

export interface DimensionScore {
  /** 0-100. 100 = clean, 90 = info only, 60 = warnings, 30 = any critical. */
  score: number;
  /** Number of findings raised in this dimension. */
  total: number;
  /** Worst severity present; "info" when there are no findings. */
  severity: Severity;
  /**
   * False when the dimension could not be evaluated at all — no teaching hours
   * recorded, no practicals, no CO-PO data, or (for the three AI dimensions) the
   * suggestion call hasn't run yet. An unassessed dimension is EXCLUDED from
   * overallHealth: scoring "no data" as 100/100 would quietly inflate the health
   * ring of the least complete syllabi, which is the exact opposite of the point.
   */
  assessed: boolean;
  /** Shown on the dashboard card when assessed === false. */
  note?: string;
}

export interface AuditResult {
  findings: Finding[];
  proposals: Proposal[];
  scores: Record<Dimension, DimensionScore>;
  /** 0-100 weighted average over ASSESSED dimensions only. */
  overallHealth: number;
}

// ─── Extra DB data the checks need beyond SubjectContext ─────────────────────

export interface CoPoMappingRow {
  co_code: string;
  po_code: string;
  strength: number | null;
}

/**
 * Everything the deterministic checks read. The route pre-fetches all of it —
 * no check function performs a DB call, so the whole audit is one synchronous
 * pass over already-loaded data.
 */
export interface AuditInput {
  ctx: import("@/lib/subjectContext").SubjectContext;
  coPoMappings: CoPoMappingRow[];
  /**
   * Titles only, from subject_content.reference_books. Read by the AI layer's
   * missing_topics check (a textbook's coverage is the best available proxy for
   * "what a course like this normally includes"). No deterministic check uses
   * it. Deliberately loaded here rather than added to the shared SubjectContext:
   * the lesson-plan and lab-manual pipelines have no use for it, and §13 already
   * records that reference_books is title-only and weak as a content source.
   */
  referenceBooks: string | null;
}

// ─── AI layer ────────────────────────────────────────────────────────────────

export type AuditWarningKind =
  | "orphan_proposal" // findingId matched no real finding
  | "non_fixable_proposal" // proposal aimed at an advisory-only finding
  | "bad_entity_type" // entityType outside the whitelist for that dimension
  | "unknown_entity" // module number / CO code not in this subject
  | "incomplete_patch" // required field for the entityType was missing
  | "empty_rationale"
  | "duplicate_proposal"
  | "redundant_proposal" // the change is already true in the DB
  | "bad_discovery" // AI-dimension finding failed validation
  | "generation_failed";

export interface AuditWarning {
  kind: AuditWarningKind;
  message: string;
}

/**
 * Which entityType each dimension is allowed to propose against. This is the
 * load-bearing half of the gate: it is what stops a co_coverage finding from
 * arriving with a co_description patch and quietly rewriting a course outcome
 * when the faculty thought they were accepting a module mapping.
 *
 * Only three dimensions are reachable today — the remaining entityTypes exist in
 * the type because hours_balance / practical_alignment / co_po_mapping findings
 * are deliberately advisory (fixable: false), so nothing can currently propose
 * against them. Making one fixable means adding its dimension here, on purpose.
 */
export const DIMENSION_ENTITY_TYPES: Partial<
  Record<Dimension, readonly ProposalEntityType[]>
> = {
  co_coverage: ["module_co_mapping"],
  btl_profile: ["btl_levels"],
  co_verb_quality: ["co_description"],
};

/** Severity is set by policy per dimension, never by the model. */
export const AI_DIMENSION_SEVERITY: Record<
  (typeof AI_DIMENSIONS)[number],
  Severity
> = {
  co_verb_quality: "warning",
  modern_relevance: "info",
  missing_topics: "info",
};

/** What the suggest route returns, and what gets cached. */
export interface SuggestionResult {
  proposals: Proposal[];
  /** Findings for the three AI-only dimensions — merged into the Layer 1 list. */
  aiFindings: Finding[];
  warnings: AuditWarning[];
}

// ─── Scoring policy ──────────────────────────────────────────────────────────

export const SCORE_CLEAN = 100;
export const SCORE_INFO = 90;
export const SCORE_WARNING = 60;
export const SCORE_CRITICAL = 30;

/**
 * CO coverage and BTL profile carry double weight: they are the two dimensions
 * NBA actually audits, and the two that break Q-paper generation downstream (an
 * unmapped CO cannot be targeted by the CO% distribution in the paper builder).
 */
export const DIMENSION_WEIGHTS: Record<Dimension, number> = {
  co_coverage: 2,
  btl_profile: 2,
  hours_balance: 1,
  topic_density: 1,
  practical_alignment: 1,
  co_po_mapping: 1,
  co_verb_quality: 1,
  modern_relevance: 1,
  missing_topics: 1,
  assessment_coverage: 1,
};

export const SEVERITY_RANK: Record<Severity, number> = {
  info: 0,
  warning: 1,
  critical: 2,
};
