// ============================================================================
// Syllabus Health Audit — Layer 1: the deterministic checks (NO AI)
//
// Every function here is PURE: it takes the pre-loaded AuditInput and returns
// Finding[]. No DB calls, no network, no randomness — the route fetches
// everything once and this file is a synchronous pass over it. That is what
// lets the Health tab render instantly on open and re-run after every edit
// without a spinner or a cost.
//
// The split matters: anything that can be COMPUTED lives here, so it is exact,
// free, and never hallucinated. Only judgements that genuinely require a model
// (is this CO verb measurable? is this topic obsolete?) go to suggestions.ts.
// A deterministic finding is a fact about the syllabus; an AI finding is an
// opinion about it, and the UI is allowed to treat them differently.
// ============================================================================

import { createHash } from "node:crypto";
import type { SubjectModule } from "@/lib/subjectContext";
import {
  AI_DIMENSIONS,
  ALL_DIMENSIONS,
  DETERMINISTIC_DIMENSIONS,
  DIMENSION_WEIGHTS,
  SCORE_CLEAN,
  SCORE_CRITICAL,
  SCORE_INFO,
  SCORE_WARNING,
  SEVERITY_RANK,
  type AuditInput,
  type AuditResult,
  type Dimension,
  type DimensionScore,
  type Finding,
  type Severity,
} from "./types";

// ─── Tunables ────────────────────────────────────────────────────────────────

/** Weightage%:hours% ratio outside [0.5, 2.0] is a real preparation mismatch. */
const HOURS_RATIO_HIGH = 2.0;
const HOURS_RATIO_LOW = 0.5;

/** Above this many distinct topics per teaching hour, a module is over-packed. */
const DENSITY_HIGH = 4;
/** Below this, the module is unusually sparse — advisory only, often deliberate. */
const DENSITY_LOW = 1;
/** A description fragment shorter than this is punctuation noise, not a topic. */
const MIN_TOPIC_WORDS = 4;

/** Fraction of a practical's significant tokens that must land in a module. */
const PRACTICAL_MATCH_THRESHOLD = 0.34;

/** A CO reachable only through modules under this weightage is exam-invisible. */
const LOW_WEIGHTAGE_PCT = 8;

/** NBA expects at least one module at Analyze or above. */
const HIGHER_ORDER_BTL = 4;

/** AICTE programme outcomes are PO1–PO12. */
const PO_COUNT = 12;

// ─── Finding construction ────────────────────────────────────────────────────

/**
 * Stable id for a finding. Same dimension + entity + kind on the same syllabus
 * always yields the same id, so a re-run after an edit can be diffed against
 * the previous run (and a proposal keyed to a findingId survives a re-audit).
 */
function findingId(dimension: Dimension, entity: string, kind: string): string {
  return createHash("sha256")
    .update(`${dimension}|${entity}|${kind}`)
    .digest("hex")
    .slice(0, 16);
}

/**
 * The same id scheme, for findings the AI layer discovers. Exported (rather
 * than duplicated in suggestions.ts) so a Layer 1 and a Layer 2 finding can
 * never collide by using two different hashes, and so an AI finding keeps a
 * stable id across re-audits — which is what lets a cached proposal still
 * resolve to its finding after the page reloads.
 */
export function aiFindingId(
  dimension: Dimension,
  entity: string,
  kind: string,
): string {
  return findingId(dimension, entity, kind);
}

function makeFinding(args: {
  dimension: Dimension;
  kind: string;
  severity: Severity;
  entity: string;
  diagnosis: string;
  suggestion?: string | null;
  fixable?: boolean;
}): Finding {
  return {
    id: findingId(args.dimension, args.entity, args.kind),
    dimension: args.dimension,
    severity: args.severity,
    entity: args.entity,
    diagnosis: args.diagnosis,
    suggestion: args.suggestion ?? null,
    fixable: args.fixable ?? false,
  };
}

// ─── Small helpers ───────────────────────────────────────────────────────────

function moduleLabel(m: SubjectModule): string {
  return `Module ${m.module_number}`;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Split a module description into topic fragments: on commas, semicolons, and
 * periods, but NOT on punctuation inside parentheses — "Trees (binary, AVL,
 * B-tree)" is one topic with a parenthetical, not four topics.
 */
export function splitTopics(description: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let buf = "";
  for (const ch of description) {
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth = Math.max(0, depth - 1);

    if (depth === 0 && (ch === "," || ch === ";" || ch === ".")) {
      out.push(buf);
      buf = "";
      continue;
    }
    buf += ch;
  }
  out.push(buf);

  return out
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.split(" ").filter(Boolean).length >= MIN_TOPIC_WORDS);
}

/**
 * Lab-sheet boilerplate. Every practical in every subject starts "Write a
 * program to implement…", so these words carry zero matching signal — leaving
 * them in makes every practical look like it matches every module.
 */
const PRACTICAL_STOPWORDS = new Set([
  "write", "program", "programme", "implement", "implementation", "using",
  "study", "demonstrate", "perform", "create", "develop", "design", "build",
  "introduction", "basic", "basics", "simple", "given", "various", "different",
  "experiment", "practical", "lab", "exercise", "code", "python", "java",
  "the", "and", "for", "with", "from", "that", "this", "into", "onto", "its",
]);

function significantTokens(text: string): string[] {
  return Array.from(
    new Set(
      text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length >= 4 && !PRACTICAL_STOPWORDS.has(w)),
    ),
  );
}

function wordBigrams(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const out = new Set<string>();
  for (let i = 0; i + 1 < words.length; i++) out.add(`${words[i]} ${words[i + 1]}`);
  return out;
}

/**
 * 0-1 similarity between a practical title and a module's text. Deliberately
 * generous on the token side and strict on the bigram side: a practical that
 * names two of the module's concepts IS about that module, but two modules that
 * merely share the word "analysis" are not the same topic.
 */
export function practicalModuleScore(
  title: string,
  moduleText: string,
  /** Pre-derived module features, so a caller looping over modules x practicals
   *  doesn't re-tokenise the same description once per practical. */
  precomputed?: { haystack: string; bigrams: Set<string> },
): number {
  const haystack = precomputed?.haystack ?? moduleText.toLowerCase();
  const tokens = significantTokens(title);
  if (tokens.length === 0) return 0;

  const hits = tokens.filter((t) => haystack.includes(t)).length;
  const tokenCoverage = hits / tokens.length;

  const titleBigrams = wordBigrams(title);
  const moduleBigrams = precomputed?.bigrams ?? wordBigrams(moduleText);
  let shared = 0;
  for (const b of titleBigrams) if (moduleBigrams.has(b)) shared++;
  const bigramCoverage = titleBigrams.size > 0 ? shared / titleBigrams.size : 0;

  return Math.max(tokenCoverage, bigramCoverage);
}

/** "PO1", "PO 1", "po-1", "1" → 1. Returns null for anything unparseable. */
export function normalizePoCode(raw: string): number | null {
  const digits = String(raw ?? "").replace(/[^0-9]/g, "");
  if (!digits) return null;
  const n = Number(digits);
  return Number.isFinite(n) && n >= 1 && n <= PO_COUNT ? n : null;
}

// ─── co_coverage ─────────────────────────────────────────────────────────────

/**
 * The dimension that actually breaks things downstream: an unmapped CO cannot
 * be targeted by the Q-paper builder's CO% distribution, so it is unassessable
 * no matter what the exam scheme says.
 */
export function checkCoCoverage(input: AuditInput): Finding[] {
  const { ctx } = input;
  const findings: Finding[] = [];

  for (const co of ctx.courseOutcomes) {
    const mapped = ctx.modules.filter((m) => m.coCodes.includes(co.co_code));
    if (mapped.length > 0) continue;
    findings.push(
      makeFinding({
        dimension: "co_coverage",
        kind: "co_unmapped",
        severity: "critical",
        entity: co.co_code,
        diagnosis: `${co.co_code} (${co.description}) has no module mapping — it cannot be assessed in any exam.`,
        suggestion: `Map ${co.co_code} to the module(s) whose topics actually teach it.`,
        fixable: true,
      }),
    );
  }

  for (const m of ctx.modules) {
    if (m.coCodes.length > 0) continue;
    const weightage = m.weightage_percent != null ? `${m.weightage_percent}%` : "its";
    findings.push(
      makeFinding({
        dimension: "co_coverage",
        kind: "module_unmapped",
        severity: "warning",
        entity: moduleLabel(m),
        diagnosis: `Module ${m.module_number} (${m.name}) has no CO mapping — ${weightage} exam weightage contributes to no course outcome.`,
        suggestion: `Assign at least one CO to Module ${m.module_number}.`,
        fixable: true,
      }),
    );
  }

  return findings;
}

// ─── btl_profile ─────────────────────────────────────────────────────────────

export function checkBtlProfile(input: AuditInput): Finding[] {
  const { ctx } = input;
  const findings: Finding[] = [];
  if (ctx.modules.length === 0) return findings;

  const allBtls = new Set<number>();
  for (const m of ctx.modules) for (const b of m.btl_levels) allBtls.add(b);

  const maxOverall = allBtls.size > 0 ? Math.max(...allBtls) : 0;
  if (maxOverall < HIGHER_ORDER_BTL) {
    findings.push(
      makeFinding({
        dimension: "btl_profile",
        kind: "no_higher_order",
        severity: "warning",
        entity: "Subject",
        diagnosis: `No module targets Analyze/Evaluate/Create (BTL ${HIGHER_ORDER_BTL}+) — NBA expects higher-order thinking in at least one module.`,
        suggestion:
          "Raise the BTL ceiling on the module whose topics already demand analysis or design.",
        fixable: true,
      }),
    );
  }

  if (!allBtls.has(1)) {
    findings.push(
      makeFinding({
        dimension: "btl_profile",
        kind: "no_btl_1",
        severity: "info",
        entity: "Subject",
        diagnosis:
          "No module includes BTL 1 (Remember) — unusual for a syllabus, though not wrong if every module genuinely starts above recall.",
        fixable: false,
      }),
    );
  }

  // Progression: compare each module against the one immediately before it.
  const ordered = [...ctx.modules].sort((a, b) => a.module_number - b.module_number);
  for (let i = 1; i < ordered.length; i++) {
    const prev = ordered[i - 1];
    const cur = ordered[i];
    if (cur.btl_levels.length === 0 || prev.btl_levels.length === 0) continue;
    const curMax = Math.max(...cur.btl_levels);
    const prevMax = Math.max(...prev.btl_levels);
    if (curMax >= prevMax) continue;
    findings.push(
      makeFinding({
        dimension: "btl_profile",
        kind: "regression",
        severity: "warning",
        entity: moduleLabel(cur),
        diagnosis: `Module ${cur.module_number} regresses to BTL ${curMax} after Module ${prev.module_number} reached BTL ${prevMax}.`,
        suggestion: `Add BTL ${prevMax} to Module ${cur.module_number} if its topics support it, so cognitive demand does not fall mid-course.`,
        fixable: true,
      }),
    );
  }

  return findings;
}

// ─── hours_balance ───────────────────────────────────────────────────────────

export function checkHoursBalance(input: AuditInput): Finding[] {
  const { ctx } = input;
  const findings: Finding[] = [];

  const totalHours = ctx.modules.reduce((sum, m) => sum + (m.hours ?? 0), 0);
  if (totalHours <= 0) return findings; // dimension is unassessable — see computeScores

  for (const m of ctx.modules) {
    const hours = m.hours ?? 0;
    const weightage = m.weightage_percent;
    if (hours <= 0 || weightage == null || weightage <= 0) continue;

    const hoursPct = (hours / totalHours) * 100;
    const ratio = weightage / hoursPct;
    if (ratio <= HOURS_RATIO_HIGH && ratio >= HOURS_RATIO_LOW) continue;

    const tooLittleTime = ratio > HOURS_RATIO_HIGH;
    const diagnosis = tooLittleTime
      ? `Module ${m.module_number} has ${round1(weightage)}% exam weightage but only ${round1(hoursPct)}% of teaching hours (${hours}/${totalHours}hrs) — students have disproportionately little time to prepare for its exam contribution.`
      : `Module ${m.module_number} takes ${round1(hoursPct)}% of teaching hours (${hours}/${totalHours}hrs) but carries only ${round1(weightage)}% exam weightage — students spend disproportionately much time on content that barely appears in the exam.`;

    findings.push(
      makeFinding({
        dimension: "hours_balance",
        kind: tooLittleTime ? "under_taught" : "over_taught",
        severity: "warning",
        entity: moduleLabel(m),
        diagnosis,
        // Hours and weightage are institutional constraints set by the
        // university, not something a faculty member fixes from this screen.
        fixable: false,
      }),
    );
  }

  return findings;
}

// ─── topic_density ───────────────────────────────────────────────────────────

export function checkTopicDensity(input: AuditInput): Finding[] {
  const { ctx } = input;
  const findings: Finding[] = [];

  for (const m of ctx.modules) {
    const hours = m.hours ?? 0;
    if (hours <= 0) continue;
    const topics = splitTopics(m.description);
    if (topics.length === 0) continue;

    const density = topics.length / hours;
    if (density > DENSITY_HIGH) {
      findings.push(
        makeFinding({
          dimension: "topic_density",
          kind: "over_packed",
          severity: "warning",
          entity: moduleLabel(m),
          diagnosis: `Module ${m.module_number} packs ${topics.length} topics into ${hours} hours (~${round1(density)}/hr) — consider splitting or reducing depth.`,
          fixable: false,
        }),
      );
    } else if (density < DENSITY_LOW) {
      findings.push(
        makeFinding({
          dimension: "topic_density",
          kind: "sparse",
          severity: "info",
          entity: moduleLabel(m),
          diagnosis: `Module ${m.module_number} lists ${topics.length} topics across ${hours} hours (~${round1(density)}/hr) — sparse, which may be deliberate for a depth-first module.`,
          fixable: false,
        }),
      );
    }
  }

  return findings;
}

// ─── practical_alignment ─────────────────────────────────────────────────────

export function checkPracticalAlignment(input: AuditInput): Finding[] {
  const { ctx } = input;
  const findings: Finding[] = [];
  if (ctx.practicals.length === 0 || ctx.modules.length === 0) return findings;

  // Derive each module's matching features ONCE. Doing it inside the practical
  // loop re-tokenised every description once per practical — O(P x M) string
  // work where O(M) suffices, and the descriptions are the long side.
  const moduleFeatures = new Map<string, { haystack: string; bigrams: Set<string> }>();
  for (const m of ctx.modules) {
    const combined = `${m.name} ${m.description}`;
    moduleFeatures.set(m.id, {
      haystack: combined.toLowerCase(),
      bigrams: wordBigrams(combined),
    });
  }

  const matchedModuleIds = new Set<string>();

  for (const p of ctx.practicals) {
    let best = 0;
    let bestModuleId: string | null = null;
    for (const m of ctx.modules) {
      const score = practicalModuleScore(p.name, "", moduleFeatures.get(m.id));
      if (score > best) {
        best = score;
        bestModuleId = m.id;
      }
    }

    if (best >= PRACTICAL_MATCH_THRESHOLD && bestModuleId) {
      matchedModuleIds.add(bestModuleId);
      continue;
    }

    findings.push(
      makeFinding({
        dimension: "practical_alignment",
        kind: "practical_orphan",
        severity: "warning",
        entity: `Practical ${p.sr_no}`,
        diagnosis: `Practical ${p.sr_no} (${p.name}) doesn't clearly map to any theory module.`,
        // Mapping a practical to a module is a curriculum decision, not a
        // data-entry gap — surfaced for the faculty to judge, not auto-fixed.
        fixable: false,
      }),
    );
  }

  for (const m of ctx.modules) {
    if (matchedModuleIds.has(m.id)) continue;
    findings.push(
      makeFinding({
        dimension: "practical_alignment",
        kind: "module_no_practical",
        severity: "info",
        entity: moduleLabel(m),
        diagnosis: `Module ${m.module_number} (${m.name}) has no corresponding practical.`,
        fixable: false,
      }),
    );
  }

  return findings;
}

// ─── co_po_mapping ───────────────────────────────────────────────────────────

export function checkCoPoMapping(input: AuditInput): Finding[] {
  const { coPoMappings } = input;
  const findings: Finding[] = [];
  if (coPoMappings.length === 0) return findings; // unassessable — no CO-PO data

  const covered = new Set<number>();
  for (const row of coPoMappings) {
    const po = normalizePoCode(row.po_code);
    if (po == null) continue;
    if ((row.strength ?? 0) >= 1) covered.add(po);
  }

  for (let po = 1; po <= PO_COUNT; po++) {
    if (covered.has(po)) continue;
    findings.push(
      makeFinding({
        dimension: "co_po_mapping",
        kind: "po_uncovered",
        severity: "info",
        entity: `PO${po}`,
        diagnosis: `PO${po} is not addressed by any CO — this program outcome has no coverage in this course.`,
        // PO coverage is a programme-level concern spread across many courses;
        // one subject legitimately covers only some POs.
        fixable: false,
      }),
    );
  }

  return findings;
}

// ─── assessment_coverage ─────────────────────────────────────────────────────

export function checkAssessmentCoverage(input: AuditInput): Finding[] {
  const { ctx } = input;
  const findings: Finding[] = [];
  if (ctx.modules.length === 0 || ctx.courseOutcomes.length === 0) return findings;

  const half = ctx.modules.length / 2;

  for (const co of ctx.courseOutcomes) {
    const mapped = ctx.modules.filter((m) => m.coCodes.includes(co.co_code));
    // A CO with NO modules is already a co_coverage critical — don't say it twice.
    if (mapped.length === 0) continue;

    if (mapped.every((m) => m.module_number > half)) {
      findings.push(
        makeFinding({
          dimension: "assessment_coverage",
          kind: "section_two_only",
          severity: "info",
          entity: co.co_code,
          diagnosis: `${co.co_code} is mapped only to Section II modules — it cannot appear in a CE Test 1 (which typically covers Section I).`,
          fixable: false,
        }),
      );
    }

    const weightages = mapped.map((m) => m.weightage_percent ?? 0);
    if (weightages.every((w) => w > 0 && w < LOW_WEIGHTAGE_PCT)) {
      findings.push(
        makeFinding({
          dimension: "assessment_coverage",
          kind: "low_weightage_only",
          severity: "warning",
          entity: co.co_code,
          diagnosis: `${co.co_code} maps only to low-weightage modules (under ${LOW_WEIGHTAGE_PCT}% each) — it may be underrepresented in exams.`,
          fixable: false,
        }),
      );
    }
  }

  return findings;
}

// ─── Orchestration + scoring ─────────────────────────────────────────────────

const CHECKS: Array<(input: AuditInput) => Finding[]> = [
  checkCoCoverage,
  checkBtlProfile,
  checkHoursBalance,
  checkTopicDensity,
  checkPracticalAlignment,
  checkCoPoMapping,
  checkAssessmentCoverage,
];

/**
 * Which deterministic dimensions had enough data to produce a real verdict.
 * A dimension with no inputs is NOT "clean" — it is unknown, and scoring it as
 * clean would reward an empty syllabus (see DimensionScore.assessed).
 */
function assessDeterministicDimensions(
  input: AuditInput,
): Record<Dimension, { assessed: boolean; note?: string }> {
  const { ctx, coPoMappings } = input;
  const hasModules = ctx.modules.length > 0;
  const hasCos = ctx.courseOutcomes.length > 0;
  const totalHours = ctx.modules.reduce((sum, m) => sum + (m.hours ?? 0), 0);

  const out = {} as Record<Dimension, { assessed: boolean; note?: string }>;
  for (const d of ALL_DIMENSIONS) out[d] = { assessed: false, note: undefined };

  out.co_coverage = hasModules && hasCos
    ? { assessed: true }
    : { assessed: false, note: "Needs both modules and course outcomes." };

  out.btl_profile = hasModules
    ? { assessed: true }
    : { assessed: false, note: "No modules recorded." };

  out.hours_balance = totalHours > 0
    ? { assessed: true }
    : { assessed: false, note: "No teaching hours recorded on any module." };

  out.topic_density = totalHours > 0
    ? { assessed: true }
    : { assessed: false, note: "No teaching hours recorded on any module." };

  out.practical_alignment = ctx.practicals.length > 0 && hasModules
    ? { assessed: true }
    : { assessed: false, note: "This subject has no practicals." };

  out.co_po_mapping = coPoMappings.length > 0
    ? { assessed: true }
    : { assessed: false, note: "No CO-PO mapping recorded for this subject." };

  out.assessment_coverage = hasModules && hasCos
    ? { assessed: true }
    : { assessed: false, note: "Needs both modules and course outcomes." };

  // The three AI dimensions stay unassessed until suggestions.ts has run.
  for (const d of AI_DIMENSIONS) {
    out[d] = { assessed: false, note: "Run AI suggestions to assess this." };
  }

  return out;
}

function scoreFor(severity: Severity | null): number {
  if (severity === null) return SCORE_CLEAN;
  if (severity === "critical") return SCORE_CRITICAL;
  if (severity === "warning") return SCORE_WARNING;
  return SCORE_INFO;
}

/**
 * Per-dimension scores + the weighted overall. Exported so the suggest route
 * can recompute once AI findings land, merging them into the same shape.
 */
export function computeScores(
  findings: Finding[],
  assessment: Record<Dimension, { assessed: boolean; note?: string }>,
): { scores: Record<Dimension, DimensionScore>; overallHealth: number } {
  const scores = {} as Record<Dimension, DimensionScore>;

  for (const dimension of ALL_DIMENSIONS) {
    const own = findings.filter((f) => f.dimension === dimension);
    let worst: Severity | null = null;
    for (const f of own) {
      if (worst === null || SEVERITY_RANK[f.severity] > SEVERITY_RANK[worst]) {
        worst = f.severity;
      }
    }
    // A dimension that produced findings was, by definition, assessable —
    // whatever the data-presence heuristic guessed.
    const assessed = assessment[dimension]?.assessed || own.length > 0;
    scores[dimension] = {
      score: scoreFor(worst),
      total: own.length,
      severity: worst ?? "info",
      assessed,
      note: assessed ? undefined : assessment[dimension]?.note,
    };
  }

  let weightedSum = 0;
  let weightTotal = 0;
  for (const dimension of ALL_DIMENSIONS) {
    if (!scores[dimension].assessed) continue;
    const w = DIMENSION_WEIGHTS[dimension];
    weightedSum += scores[dimension].score * w;
    weightTotal += w;
  }

  const overallHealth =
    weightTotal > 0 ? Math.round(weightedSum / weightTotal) : SCORE_CLEAN;

  return { scores, overallHealth };
}

/**
 * The whole Layer 1 audit. Synchronous, pure, sub-millisecond on real subjects.
 * `proposals` is always empty here — proposals are Layer 2 and never come from
 * a deterministic check.
 */
export function runDeterministicAudit(input: AuditInput): AuditResult {
  const findings = CHECKS.flatMap((check) => check(input));

  // Same dimension+entity+kind twice cannot happen from one pass, but dedup by
  // id anyway so a future check added to two lists can't double-report.
  const byId = new Map<string, Finding>();
  for (const f of findings) if (!byId.has(f.id)) byId.set(f.id, f);
  const deduped = Array.from(byId.values());

  // Most severe first, then grouped by dimension order for a stable UI list.
  const dimensionOrder = new Map<Dimension, number>(
    DETERMINISTIC_DIMENSIONS.map((d, i) => [d, i]),
  );
  deduped.sort((a, b) => {
    const bySeverity = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
    if (bySeverity !== 0) return bySeverity;
    const byDimension =
      (dimensionOrder.get(a.dimension) ?? 99) - (dimensionOrder.get(b.dimension) ?? 99);
    if (byDimension !== 0) return byDimension;
    return a.entity.localeCompare(b.entity, undefined, { numeric: true });
  });

  const assessment = assessDeterministicDimensions(input);
  const { scores, overallHealth } = computeScores(deduped, assessment);

  return { findings: deduped, proposals: [], scores, overallHealth };
}

/** Re-exported so the suggest route scores AI findings through the same path. */
export { assessDeterministicDimensions };
