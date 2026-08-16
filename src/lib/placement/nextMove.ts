import {
  PlacementTarget,
  StudentPlacementProfile,
  READINESS_WEIGHTS,
  TARGET_LABELS,
} from "@/types/placement";
import { Track } from "@/lib/placement/tracks";
import { isDriveEligible } from "@/lib/placement/readiness";

// ─── Public contract ───────────────────────────────────────────────────────
// The six-position stage line (SPEC §2). Phase-2 stages are first-class here
// even though this build only ever emits 'active_prep' / 'drive_sprint' /
// 'interview' moves — CP-A2's stage strip needs the full enum to render the
// locked Phase-2 positions.
export type StageId =
  | "foundation"
  | "active_prep"
  | "drive_sprint"
  | "interview"
  | "post_outcome"
  | "competitive_exam";

export type MoveKind =
  | "setup"
  | "drive_sprint"
  | "drift_return"
  | "weak_dimension"
  | "resume"
  | "maintenance"
  | "mock_interview";

export type Urgency = "high" | "medium" | "low";

/**
 * `tags` are pre-formatted mono-tag display strings (DESIGN.md's signature
 * element, e.g. "Domain 41/100", "Wipro · 11 days") — the caller renders each
 * entry as a <MonoTag>, this module makes no styling/variant decision.
 */
export interface RankedMove {
  stage: StageId;
  kind: MoveKind;
  title: string;
  reason: string;
  href: string;
  urgency: Urgency;
  tags: string[];
}

export interface NextMoveDrive {
  id: string;
  company_name: string;
  company_type: PlacementTarget;
  drive_date: string; // ISO date string
  eligible_min_cgpa: number | null;
  eligible_branches: string[] | null;
}

export interface NextMoveTopicMastery {
  track: Track;
  topic: string;
  recent_accuracy: number;
  attempts_count: number;
  last_practiced_at: string | null; // ISO timestamp
}

export type NextMoveProfile = Pick<
  StudentPlacementProfile,
  | "setup_complete"
  | "primary_target"
  | "readiness_aptitude"
  | "readiness_verbal"
  | "readiness_domain"
  | "readiness_coding"
  | "readiness_communication"
  | "readiness_overall"
  | "resume_completeness"
  | "cgpa"
  | "active_backlogs"
>;

export interface NextMoveState {
  profile: NextMoveProfile;
  studentBranch: string;
  drives: NextMoveDrive[];
  topicMastery: NextMoveTopicMastery[];
}

// ─── Constants ──────────────────────────────────────────────────────────────

const DRIVE_SPRINT_WINDOW_DAYS = 14;
const DRIVE_SPRINT_SCORE_THRESHOLD = 60;
const DRIFT_DAYS = 14;
const STANDARD_GAP_SCORE_THRESHOLD = 70;
const RESUME_COMPLETENESS_THRESHOLD = 70;
const ALL_READY_THRESHOLD = 70;
const RELEVANT_WEIGHT_FLOOR = 0.1;

export const DIMENSIONS = ["aptitude", "verbal", "domain", "coding", "communication"] as const;
export type Dimension = (typeof DIMENSIONS)[number];

export const DIMENSION_LABELS: Record<Dimension, string> = {
  aptitude: "Aptitude",
  verbal: "Verbal Ability",
  domain: "Core Domain",
  coding: "Coding",
  communication: "Communication",
};

// readiness_coding has no backing `placement_topic_mastery` track yet (see
// prep/submit/route.ts — "coding has no track yet, keep existing score"), so
// it cannot drift and its practice CTA routes into the domain track, where
// fill_code technical questions actually live.
const DIMENSION_TRACK: Record<Dimension, Track | null> = {
  aptitude: "aptitude",
  verbal: "verbal",
  domain: "domain",
  coding: null,
  communication: "communication",
};

// Exported so other read-only surfaces (e.g. the skill-gap map, CP-E1) that
// need to route a weak readiness dimension into its prep track reuse this
// exact mapping instead of re-deriving the coding→domain routing quirk above.
export const DIMENSION_HREF: Record<Dimension, string> = {
  aptitude: "/student/placement/prep/aptitude",
  verbal: "/student/placement/prep/verbal",
  domain: "/student/placement/prep/domain",
  coding: "/student/placement/prep/domain",
  communication: "/student/placement/prep/communication",
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function daysBetween(earlier: Date, later: Date): number {
  return Math.floor((later.getTime() - earlier.getTime()) / MS_PER_DAY);
}

// Only the 5 readiness scores are read by dimensionScore/weightedWeakestDimensions
// — narrowed (rather than requiring the full NextMoveProfile) so callers outside
// this module (e.g. the CP-G2 cohort-analytics layer, which has its own
// CohortStudent shape) can reuse this logic without constructing an unrelated
// setup_complete/resume_completeness/cgpa/active_backlogs shape they don't have.
export type ReadinessOnlyProfile = Pick<
  StudentPlacementProfile,
  | "readiness_aptitude"
  | "readiness_verbal"
  | "readiness_domain"
  | "readiness_coding"
  | "readiness_communication"
>;

function dimensionScore(profile: ReadinessOnlyProfile, dim: Dimension): number {
  const scores: Record<Dimension, number> = {
    aptitude: profile.readiness_aptitude,
    verbal: profile.readiness_verbal,
    domain: profile.readiness_domain,
    coding: profile.readiness_coding,
    communication: profile.readiness_communication,
  };
  return scores[dim];
}

/**
 * Dimensions that matter for a company type (weight >= floor), sorted
 * weakest-score-first — the same "weighted-weakest" selection
 * `computeCompanyFit`'s top_gaps uses in readiness.ts, kept independent here
 * since this module must stay a dependency-free pure function. Exported so
 * CP-G2's cohort-analytics module (at-risk-student detection: "weighted-
 * weakest dimension for a drive's company_type below 60") reuses this exact
 * selection instead of re-deriving it a third time (readiness.ts's
 * `computeCompanyFit.top_gaps` is the second).
 */
export function weightedWeakestDimensions(profile: ReadinessOnlyProfile, target: PlacementTarget): Dimension[] {
  const weights = READINESS_WEIGHTS[target];
  return DIMENSIONS.filter((d) => weights[d] >= RELEVANT_WEIGHT_FLOOR).sort(
    (a, b) => dimensionScore(profile, a) - dimensionScore(profile, b)
  );
}

/**
 * Turn already-persisted platform state into a ranked queue of next actions.
 * Pure and deterministic: no I/O, no AI calls, no wall-clock reads unless
 * `now` is omitted (defaults to real time for callers, fixed for tests).
 *
 * Returns the FULL ranked list, highest priority first. §3's "top N=3 for a
 * primary+secondary layout, rest collapse under 'more'" is a UI slicing
 * decision (CP-A2), not part of this function's contract.
 */
export function computeNextMoves(state: NextMoveState, now: Date = new Date()): RankedMove[] {
  const { profile, studentBranch, drives, topicMastery } = state;

  // Rule 1 — setup incomplete overrides everything else.
  if (!profile.setup_complete) {
    return [
      {
        stage: "active_prep",
        kind: "setup",
        title: "Finish your placement setup",
        reason: "We need your target, CGPA, and a few basics before we can find your next move.",
        href: "/student/placement/setup",
        urgency: "high",
        tags: ["Setup incomplete"],
      },
    ];
  }

  const moves: RankedMove[] = [];
  const coveredDimensions = new Set<Dimension>();

  // Rule 2 — eligible drive within the sprint window, weighted-weakest
  // dimension for that drive's company type below the sprint threshold.
  const eligibleDrives = drives
    .filter((d) => isDriveEligible(profile, d, studentBranch).eligible)
    .map((d) => ({ drive: d, daysRemaining: daysBetween(now, new Date(d.drive_date)) }))
    .filter((d) => d.daysRemaining >= 0)
    .sort((a, b) => a.daysRemaining - b.daysRemaining);

  for (const { drive, daysRemaining } of eligibleDrives) {
    if (daysRemaining > DRIVE_SPRINT_WINDOW_DAYS) continue;
    const weakest = weightedWeakestDimensions(profile, drive.company_type).find(
      (d) => !coveredDimensions.has(d)
    );
    if (!weakest) continue;
    const score = dimensionScore(profile, weakest);
    if (score >= DRIVE_SPRINT_SCORE_THRESHOLD) continue;

    coveredDimensions.add(weakest);
    moves.push({
      stage: "drive_sprint",
      kind: "drive_sprint",
      title: `Sprint ${DIMENSION_LABELS[weakest]} for ${drive.company_name}`,
      reason: `${drive.company_name} is ${daysRemaining} day${daysRemaining === 1 ? "" : "s"} away and ${DIMENSION_LABELS[weakest]} is your weakest weighted skill for this drive.`,
      href: DIMENSION_HREF[weakest],
      urgency: "high",
      tags: [`${drive.company_name} · ${daysRemaining}d`, `${DIMENSION_LABELS[weakest]} ${score}/100`],
    });
  }

  // Rule 3 — drift: a tracked dimension practiced before but idle > 14 days.
  const driftCandidates: { dim: Dimension; daysIdle: number }[] = [];
  for (const dim of DIMENSIONS) {
    if (coveredDimensions.has(dim)) continue;
    const track = DIMENSION_TRACK[dim];
    if (!track) continue; // coding has no mastery track — cannot drift

    const rows = topicMastery.filter((m) => m.track === track && m.attempts_count > 0);
    if (rows.length === 0) continue; // never practiced — not drift, just unstarted

    const lastPracticed = rows.reduce<Date | null>((latest, row) => {
      if (!row.last_practiced_at) return latest;
      const d = new Date(row.last_practiced_at);
      return !latest || d > latest ? d : latest;
    }, null);
    if (!lastPracticed) continue;

    const daysIdle = daysBetween(lastPracticed, now);
    if (daysIdle > DRIFT_DAYS) driftCandidates.push({ dim, daysIdle });
  }
  driftCandidates
    .sort((a, b) => b.daysIdle - a.daysIdle)
    .forEach(({ dim, daysIdle }) => {
      coveredDimensions.add(dim);
      moves.push({
        stage: "active_prep",
        kind: "drift_return",
        title: `Return to ${DIMENSION_LABELS[dim]}`,
        reason: `You haven't practiced ${DIMENSION_LABELS[dim]} in ${daysIdle} days — momentum fades fast.`,
        href: DIMENSION_HREF[dim],
        urgency: "medium",
        tags: [`${DIMENSION_LABELS[dim]} · ${daysIdle}d idle`],
      });
    });

  // Rule 4 — lowest weighted gap for the student's primary target.
  const standardGap = weightedWeakestDimensions(profile, profile.primary_target).find(
    (d) => !coveredDimensions.has(d) && dimensionScore(profile, d) < STANDARD_GAP_SCORE_THRESHOLD
  );
  if (standardGap) {
    coveredDimensions.add(standardGap);
    const score = dimensionScore(profile, standardGap);
    moves.push({
      stage: "active_prep",
      kind: "weak_dimension",
      title: `Practice ${DIMENSION_LABELS[standardGap]}`,
      reason: `${DIMENSION_LABELS[standardGap]} is your lowest-weighted gap for ${TARGET_LABELS[profile.primary_target]} roles.`,
      href: DIMENSION_HREF[standardGap],
      urgency: "medium",
      tags: [`${DIMENSION_LABELS[standardGap]} ${score}/100`],
    });
  }

  // Rule 5 — resume incompleteness.
  if (profile.resume_completeness < RESUME_COMPLETENESS_THRESHOLD) {
    moves.push({
      stage: "active_prep",
      kind: "resume",
      title: "Complete your resume",
      reason: `Your resume is ${profile.resume_completeness}% complete — finish it before drives open.`,
      href: "/student/placement/resume",
      urgency: "medium",
      tags: [`Resume ${profile.resume_completeness}%`],
    });
  }

  // Rule 6 — fallback: everything is strong and nothing is coming up.
  const hasAnyEligibleDrive = eligibleDrives.length > 0;
  const allReady = DIMENSIONS.every((d) => dimensionScore(profile, d) >= ALL_READY_THRESHOLD);
  if (allReady && !hasAnyEligibleDrive) {
    moves.push({
      stage: "active_prep",
      kind: "maintenance",
      title: "Keep your edge sharp",
      reason: "Every readiness dimension is strong. Stay consistent with a quick refresh.",
      href: "/student/placement/prep",
      urgency: "low",
      tags: [`Overall ${profile.readiness_overall}/100`],
    });
    moves.push({
      stage: "interview",
      kind: "mock_interview",
      title: "Try a mock interview",
      reason: "You're ready to simulate the real thing.",
      href: "/student/placement/interview/mock",
      urgency: "low",
      tags: ["Stage 3"],
    });
  }

  return moves;
}
