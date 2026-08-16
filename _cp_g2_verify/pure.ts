/**
 * Pure-function assertions for CP-G2's access policy (access.ts) and cohort
 * aggregation (cohortAnalytics.ts). No DB, no network — plain fixtures in,
 * assertions out. Run: npx tsx _cp_g2_verify/pure.ts
 */
import { decidePlacementAccess, effectiveBranchFilter } from "../src/lib/placement/access";
import {
  computeDimensionGaps,
  computeAtRisk,
  computeDriveFunnel,
  computeActivity,
  computeTargetDistribution,
  shapeLiftSeries,
  type CohortStudent,
  type CohortDrive,
} from "../src/lib/placement/cohortAnalytics";
import { computePlacementCohortSnapshotRows } from "../src/lib/analytics/placementCohortSnapshot";

let pass = 0;
let fail = 0;
function assert(cond: boolean, label: string) {
  if (cond) {
    pass += 1;
  } else {
    fail += 1;
    console.error(`FAIL: ${label}`);
  }
}

// ── access.ts ───────────────────────────────────────────────────────────────

{
  const d = decidePlacementAccess("superadmin", null);
  assert(!d.blocked && d.includeNamedRows && d.includeAggregates && d.pinnedBranch === null,
    "superadmin: named rows, all branches, aggregates");
}

{
  const d = decidePlacementAccess("hod", "CSE");
  assert(!d.blocked && d.includeNamedRows && d.includeAggregates && d.pinnedBranch === "CSE",
    "hod with branch: named rows pinned to own branch");
  const effective = effectiveBranchFilter(d, "ECE");
  assert(effective === "CSE", "hod: ?branch=ECE tampering ignored, own branch (CSE) enforced");
  const effectiveNoQuery = effectiveBranchFilter(d, null);
  assert(effectiveNoQuery === "CSE", "hod: no ?branch= query still resolves to own branch");
}

{
  const d = decidePlacementAccess("hod", null);
  assert(d.blocked === true && d.warning.length > 0,
    "hod with no branch set: blocked with a plain-language warning, not a crash");
}

{
  const dean = decidePlacementAccess("dean", null);
  assert(!dean.blocked && dean.includeNamedRows === false && dean.includeAggregates === true && dean.pinnedBranch === null,
    "dean: aggregate-only, no named rows, all branches");
  const deptAdmin = decidePlacementAccess("dept_admin", null);
  assert(!deptAdmin.blocked && deptAdmin.includeNamedRows === false && deptAdmin.includeAggregates === true,
    "dept_admin: treated as management, same as dean");
}

{
  const d = decidePlacementAccess("student", null);
  assert(d.blocked === true, "unrecognized/unauthorized role: fails closed");
}

// ── cohortAnalytics.ts fixtures ─────────────────────────────────────────────

function student(overrides: Partial<CohortStudent>): CohortStudent {
  return {
    id: "s-" + Math.random().toString(36).slice(2),
    full_name: "Test Student",
    branch: "CSE",
    cgpa: 8,
    primary_target: "service_it",
    readiness_aptitude: 50,
    readiness_verbal: 50,
    readiness_domain: 50,
    readiness_coding: 50,
    readiness_communication: 50,
    readiness_overall: 50,
    setup_complete: true,
    last_active_date: new Date().toISOString(),
    prep_streak_days: 3,
    ...overrides,
  };
}

// computeDimensionGaps: below-floor cohort is suppressed
{
  const thin = [student({}), student({}), student({})]; // 3 < MIN_COHORT_FOR_AGGREGATE (5)
  const r = computeDimensionGaps(thin);
  assert(r.suppressed === true && r.ranked === null, "dimension gaps: 3-student cohort suppressed (null, not 0)");
}

// computeDimensionGaps: at-floor cohort renders, weakest correctly identified
{
  const cohort = [
    student({ readiness_aptitude: 20 }),
    student({ readiness_aptitude: 20 }),
    student({ readiness_aptitude: 20 }),
    student({ readiness_aptitude: 20 }),
    student({ readiness_aptitude: 20 }),
  ];
  const r = computeDimensionGaps(cohort);
  assert(r.suppressed === false && r.ranked !== null, "dimension gaps: 5-student cohort (at floor) renders");
  assert(r.ranked![0].dimension === "aptitude", "dimension gaps: weakest dimension correctly identified as aptitude");
}

// computeDimensionGaps: per-branch suppression independent of overall
{
  const bigBranch = Array.from({ length: 5 }, () => student({ branch: "CSE" }));
  const smallBranch = [student({ branch: "ECE" }), student({ branch: "ECE" })];
  const r = computeDimensionGaps([...bigBranch, ...smallBranch]);
  const cse = r.perBranch.find((b) => b.branch === "CSE")!;
  const ece = r.perBranch.find((b) => b.branch === "ECE")!;
  assert(cse.suppressed === false && cse.weakest !== null, "per-branch: CSE (5 students) not suppressed");
  assert(ece.suppressed === true && ece.weakest === null, "per-branch: ECE (2 students) suppressed independently");
}

// computeAtRisk: eligible drive within 14 days + weak weighted dimension
{
  const drive: CohortDrive = {
    id: "d1",
    company_name: "Acme Corp",
    company_type: "product", // weights: coding .35 heaviest
    drive_date: new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10),
    eligible_min_cgpa: null,
    eligible_branches: null,
  };
  const weakStudent = student({ readiness_coding: 30, readiness_domain: 90, readiness_aptitude: 90 });
  const strongStudent = student({ readiness_coding: 90, readiness_domain: 90, readiness_aptitude: 90, readiness_verbal: 90, readiness_communication: 90 });
  const entries = computeAtRisk([weakStudent, strongStudent], [drive]);
  assert(entries.length === 1 && entries[0].student_id === weakStudent.id,
    "at-risk: only the student below threshold on the drive's weighted-weakest dimension is flagged");
  assert(entries[0].dimension === "coding", "at-risk: correct dimension (coding, heaviest weight for 'product')");
}

// computeAtRisk: drive outside the 14-day window is not flagged
{
  const farDrive: CohortDrive = {
    id: "d2",
    company_name: "Far Corp",
    company_type: "product",
    drive_date: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
    eligible_min_cgpa: null,
    eligible_branches: null,
  };
  const weakStudent = student({ readiness_coding: 10 });
  const entries = computeAtRisk([weakStudent], [farDrive]);
  assert(entries.length === 0, "at-risk: drive 30 days out (outside 14-day window) does not flag");
}

// computeAtRisk: ineligible (branch mismatch) does not flag
{
  const branchDrive: CohortDrive = {
    id: "d3",
    company_name: "Branch Corp",
    company_type: "product",
    drive_date: new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10),
    eligible_min_cgpa: null,
    eligible_branches: ["ECE"],
  };
  const cseWeak = student({ branch: "CSE", readiness_coding: 10 });
  const entries = computeAtRisk([cseWeak], [branchDrive]);
  assert(entries.length === 0, "at-risk: branch-ineligible student is not flagged");
}

// computeDriveFunnel: suppressed under floor, correct counts at/above floor
{
  const drive: CohortDrive = {
    id: "d4",
    company_name: "Funnel Corp",
    company_type: "service_it",
    drive_date: new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10),
    eligible_min_cgpa: null,
    eligible_branches: null,
  };
  const thinCohort = [student({}), student({})];
  const thinFunnel = computeDriveFunnel(thinCohort, [drive]);
  assert(thinFunnel[0].suppressed === true && thinFunnel[0].eligible_count === null,
    "drive funnel: 2-eligible cohort suppressed");

  const readyStudent = student({
    readiness_aptitude: 90, readiness_verbal: 90, readiness_domain: 90, readiness_coding: 90, readiness_communication: 90,
  }); // overall ~90 >= 75 ready threshold
  const notReadyStudent = student({
    readiness_aptitude: 10, readiness_verbal: 10, readiness_domain: 10, readiness_coding: 10, readiness_communication: 10,
  });
  const fullCohort = [readyStudent, notReadyStudent, student({}), student({}), student({})];
  const fullFunnel = computeDriveFunnel(fullCohort, [drive]);
  assert(fullFunnel[0].suppressed === false && fullFunnel[0].eligible_count === 5,
    "drive funnel: 5-eligible cohort not suppressed, correct eligible count");
  assert(fullFunnel[0].ready_count! >= 1, "drive funnel: at least the fully-ready student counted as ready");
}

// computeActivity: suppressed below floor; buckets correct at/above floor
{
  const thin = [student({}), student({})];
  const thinActivity = computeActivity(thin);
  assert(thinActivity.suppressed === true && thinActivity.active_7d === null,
    "activity: below-floor cohort suppressed");

  const cohort = [
    student({ last_active_date: new Date().toISOString(), prep_streak_days: 0 }),
    student({ last_active_date: new Date(Date.now() - 20 * 86400000).toISOString(), prep_streak_days: 1 }),
    student({ last_active_date: null, prep_streak_days: 4 }),
    student({ last_active_date: new Date(Date.now() - 25 * 86400000).toISOString(), setup_complete: false, prep_streak_days: 10 }),
    student({ last_active_date: new Date(Date.now() - 25 * 86400000).toISOString(), prep_streak_days: 2 }),
  ];
  const activity = computeActivity(cohort);
  assert(activity.suppressed === false, "activity: 5-student cohort not suppressed");
  assert(activity.active_7d === 1, "activity: exactly 1 active within 7 days");
  assert(activity.setup_incomplete === 1, "activity: exactly 1 setup-incomplete student counted");
  assert(
    activity.streak_distribution!["0"] === 1 &&
      activity.streak_distribution!["7+"] === 1,
    "activity: streak distribution buckets correct"
  );
}

// computeTargetDistribution: suppressed below floor
{
  const thin = [student({}), student({})];
  const r = computeTargetDistribution(thin);
  assert(r.suppressed === true && r.counts === null, "target distribution: below-floor cohort suppressed");

  const cohort = [
    student({ primary_target: "product" }),
    student({ primary_target: "product" }),
    student({ primary_target: "startup" }),
    student({ primary_target: "service_it" }),
    student({ primary_target: "service_it" }),
  ];
  const full = computeTargetDistribution(cohort);
  assert(full.suppressed === false, "target distribution: 5-student cohort not suppressed");
  const productCount = full.counts!.find((c) => c.target === "product")!.count;
  assert(productCount === 2, "target distribution: correct count for 'product'");
}

// shapeLiftSeries: per-point suppression
{
  const rows = [
    { snapshot_date: "2026-08-10", student_count: 2, avg_aptitude: 40, avg_verbal: 40, avg_domain: 40, avg_coding: 40, avg_communication: 40, avg_overall: 40 },
    { snapshot_date: "2026-08-11", student_count: 6, avg_aptitude: 45, avg_verbal: 45, avg_domain: 45, avg_coding: 45, avg_communication: 45, avg_overall: 45 },
  ];
  const shaped = shapeLiftSeries(rows);
  assert(shaped[0].suppressed === true && shaped[0].avg_overall === null,
    "lift series: below-floor day suppressed (null, not the real 40)");
  assert(shaped[1].suppressed === false && shaped[1].avg_overall === 45,
    "lift series: at-floor day renders real value");
}

// computePlacementCohortSnapshotRows: skips non-started students, emits ALL row
{
  const source = [
    { branch: "CSE", readiness_overall: 60, readiness_aptitude: 60, readiness_verbal: 60, readiness_domain: 60, readiness_coding: 60, readiness_communication: 60 },
    { branch: "CSE", readiness_overall: 0, readiness_aptitude: 0, readiness_verbal: 0, readiness_domain: 0, readiness_coding: 0, readiness_communication: 0 }, // not started
    { branch: "ECE", readiness_overall: 40, readiness_aptitude: 40, readiness_verbal: 40, readiness_domain: 40, readiness_coding: 40, readiness_communication: 40 },
  ];
  const rows = computePlacementCohortSnapshotRows(source, "2026-08-16");
  const cse = rows.find((r) => r.branch === "CSE")!;
  const all = rows.find((r) => r.branch === "ALL")!;
  assert(cse.student_count === 1, "snapshot rows: not-started student excluded from CSE cohort count");
  assert(all.student_count === 2, "snapshot rows: ALL row pools every started student across branches");
  assert(rows.length === 3, "snapshot rows: CSE + ECE + ALL, no empty-branch rows");
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
