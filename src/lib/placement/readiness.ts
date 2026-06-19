import {
  ReadinessScores,
  PlacementTarget,
  PlacementCompanyProfile,
  StudentPlacementProfile,
  CompanyFit,
  FitLevel,
  computeOverallReadiness,
  computeFitLevel,
  READINESS_WEIGHTS,
} from '@/types/placement';

/**
 * Compute company fit for a student.
 * Eligibility checked first — ineligible companies show fit_score 0.
 */
export function computeCompanyFit(
  profile: StudentPlacementProfile,
  company: PlacementCompanyProfile
): CompanyFit {
  // Eligibility checks
  const cgpaOk = !company.min_cgpa || (profile.cgpa ?? 0) >= company.min_cgpa;
  const backlogOk = company.backlogs_allowed || profile.active_backlogs === 0;
  const is_eligible = cgpaOk && backlogOk;

  let ineligibility_reason: string | null = null;
  if (!cgpaOk) ineligibility_reason = `CGPA below ${company.min_cgpa} required`;
  else if (!backlogOk) ineligibility_reason = 'Active backlogs not permitted';

  if (!is_eligible) {
    return {
      company,
      fit_level: 'needs_work',
      fit_score: 0,
      top_gaps: [ineligibility_reason!],
      is_eligible: false,
      ineligibility_reason,
    };
  }

  // Score against company type weights
  const scores: Omit<ReadinessScores, 'overall'> = {
    aptitude:      profile.readiness_aptitude,
    verbal:        profile.readiness_verbal,
    domain:        profile.readiness_domain,
    coding:        profile.readiness_coding,
    communication: profile.readiness_communication,
  };

  const fit_score = computeOverallReadiness(scores, company.company_type as PlacementTarget);
  const fit_level: FitLevel = computeFitLevel(fit_score);

  // Top 2 gaps: lowest scoring dimensions weighted for this company type
  const w = READINESS_WEIGHTS[company.company_type as PlacementTarget];
  const dims = (Object.keys(scores) as Array<keyof typeof scores>)
    .filter(k => w[k] >= 0.10)  // only dimensions that matter for this company type
    .sort((a, b) => scores[a] - scores[b]);

  const GAP_LABELS: Record<keyof typeof scores, string> = {
    aptitude:      'Aptitude',
    verbal:        'Verbal Ability',
    domain:        'Core Domain',
    coding:        'Coding',
    communication: 'Communication',
  };

  const top_gaps = dims
    .slice(0, 2)
    .filter(d => scores[d] < 70)
    .map(d => `${GAP_LABELS[d]}: ${scores[d]}/100`);

  return { company, fit_level, fit_score, top_gaps, is_eligible, ineligibility_reason: null };
}

/**
 * Compute overall readiness from raw scores + target.
 * Call this whenever test scores update, persist result to DB.
 */
export function recomputeOverall(
  profile: Pick<StudentPlacementProfile,
    'readiness_aptitude' | 'readiness_verbal' | 'readiness_domain' |
    'readiness_coding' | 'readiness_communication' | 'primary_target'>
): number {
  return computeOverallReadiness(
    {
      aptitude:      profile.readiness_aptitude,
      verbal:        profile.readiness_verbal,
      domain:        profile.readiness_domain,
      coding:        profile.readiness_coding,
      communication: profile.readiness_communication,
    },
    profile.primary_target
  );
}

/**
 * Check if a student is eligible for a drive.
 */
export function isDriveEligible(
  profile: StudentPlacementProfile,
  drive: { eligible_min_cgpa: number | null; eligible_branches: string[] | null },
  studentBranch: string
): { eligible: boolean; reason: string | null } {
  if (drive.eligible_min_cgpa && (profile.cgpa ?? 0) < drive.eligible_min_cgpa) {
    return { eligible: false, reason: `CGPA below ${drive.eligible_min_cgpa}` };
  }
  if (drive.eligible_branches && !drive.eligible_branches.includes(studentBranch)) {
    return { eligible: false, reason: 'Branch not eligible for this drive' };
  }
  return { eligible: true, reason: null };
}

/**
 * Readiness label for UI display. Never use predictive language.
 */
export function readinessLabel(score: number): string {
  if (score >= 80) return 'Highly Prepared';
  if (score >= 65) return 'Well Prepared';
  if (score >= 50) return 'Moderately Prepared';
  if (score >= 30) return 'Early Stage';
  return 'Just Getting Started';
}

/**
 * Readiness color class (Tailwind) — uses your semantic color system.
 */
export function readinessColorClass(score: number): string {
  if (score >= 75) return 'text-emerald-400';
  if (score >= 50) return 'text-amber-400';
  return 'text-slate-400';
}

export function readinessBgClass(score: number): string {
  if (score >= 75) return 'bg-emerald-500/10 border-emerald-500/20';
  if (score >= 50) return 'bg-amber-500/10 border-amber-500/20';
  return 'bg-slate-500/10 border-slate-500/20';
}
