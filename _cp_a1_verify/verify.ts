/**
 * CP-A1 verify harness — pure in-memory unit tests for
 * src/lib/placement/nextMove.ts. No DB, no network, no cleanup needed:
 * `computeNextMoves` is a pure function over fixture data.
 *
 * Run: npx tsx _cp_a1_verify/verify.ts
 */
import { computeNextMoves, NextMoveState, NextMoveProfile, NextMoveDrive, NextMoveTopicMastery } from "../src/lib/placement/nextMove";

const NOW = new Date("2026-08-15T12:00:00.000Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString();
const daysFromNow = (n: number) => new Date(NOW.getTime() + n * 24 * 60 * 60 * 1000).toISOString();

function baseProfile(overrides: Partial<NextMoveProfile> = {}): NextMoveProfile {
  return {
    setup_complete: true,
    primary_target: "service_it",
    readiness_aptitude: 80,
    readiness_verbal: 80,
    readiness_domain: 80,
    readiness_coding: 80,
    readiness_communication: 80,
    readiness_overall: 80,
    resume_completeness: 85,
    cgpa: 8.0,
    active_backlogs: 0,
    ...overrides,
  };
}

const freshMastery = (): NextMoveTopicMastery[] =>
  (["aptitude", "verbal", "domain", "communication"] as const).map((track) => ({
    track,
    topic: `${track}-topic`,
    recent_accuracy: 80,
    attempts_count: 10,
    last_practiced_at: daysAgo(2),
  }));

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string) {
  if (condition) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    console.error(`  FAIL  ${label}`);
  }
}

// ─── 1. Happy path ──────────────────────────────────────────────────────────
{
  console.log("\n[1] happy path — single weighted gap");
  const state: NextMoveState = {
    profile: baseProfile({ readiness_verbal: 55 }), // service_it weight .25, relevant
    studentBranch: "CSE",
    drives: [],
    topicMastery: freshMastery(),
  };
  const moves = computeNextMoves(state, NOW);
  assert(moves.length === 1, `exactly one move (got ${moves.length})`);
  assert(moves[0]?.kind === "weak_dimension", `move kind is weak_dimension (got ${moves[0]?.kind})`);
  assert(moves[0]?.tags.some((t) => t.includes("Verbal Ability 55/100")), "tag names the weak dimension and score");
}

// ─── 2. Setup incomplete ────────────────────────────────────────────────────
{
  console.log("\n[2] setup incomplete — overrides everything");
  const state: NextMoveState = {
    profile: baseProfile({ setup_complete: false, readiness_aptitude: 10, resume_completeness: 5 }),
    studentBranch: "CSE",
    drives: [{ id: "d1", company_name: "Wipro", company_type: "service_it", drive_date: daysFromNow(3), eligible_min_cgpa: null, eligible_branches: null }],
    topicMastery: [],
  };
  const moves = computeNextMoves(state, NOW);
  assert(moves.length === 1, `exactly one move (got ${moves.length})`);
  assert(moves[0]?.kind === "setup", `move kind is setup (got ${moves[0]?.kind})`);
}

// ─── 3. Drive within 14 days ────────────────────────────────────────────────
{
  console.log("\n[3] eligible drive within 14 days — weighted-weakest dimension for that company type");
  const state: NextMoveState = {
    profile: baseProfile({ readiness_coding: 45 }), // product weight .35 (highest), also happens to be service_it's weakest
    studentBranch: "CSE",
    drives: [
      { id: "d1", company_name: "Google", company_type: "product", drive_date: daysFromNow(11), eligible_min_cgpa: null, eligible_branches: null },
    ],
    topicMastery: freshMastery(),
  };
  const moves = computeNextMoves(state, NOW);
  assert(moves.length === 1, `exactly one move (got ${moves.length}, expected coding covered so rule 4 has nothing left <70)`);
  assert(moves[0]?.kind === "drive_sprint", `first move is drive_sprint (got ${moves[0]?.kind})`);
  assert(moves[0]?.urgency === "high", "drive_sprint move is high urgency");
  assert(moves[0]?.tags.some((t) => t.includes("Google")) ?? false, "tag names the company");
  assert(moves[0]?.tags.some((t) => t.includes("11d")) ?? false, "tag names days remaining");
  assert(moves[0]?.href === "/student/placement/prep/domain", "coding dimension routes into the domain track");
}

// ─── 4. Drift ───────────────────────────────────────────────────────────────
{
  console.log("\n[4] drift — practiced before, idle > 14 days");
  const mastery = freshMastery().map((m) =>
    m.track === "domain" ? { ...m, last_practiced_at: daysAgo(20) } : m
  );
  const state: NextMoveState = {
    profile: baseProfile({ readiness_aptitude: 75, readiness_verbal: 75, readiness_domain: 75, readiness_coding: 75, readiness_communication: 75 }),
    studentBranch: "CSE",
    drives: [],
    topicMastery: mastery,
  };
  const moves = computeNextMoves(state, NOW);
  assert(moves.length === 3, `drift + all-ready fallback both fire (got ${moves.length})`);
  assert(moves[0]?.kind === "drift_return", `first move is drift_return (got ${moves[0]?.kind})`);
  assert(moves[0]?.tags.some((t) => t.includes("20d idle")) ?? false, "tag names days idle");
  assert(moves[1]?.kind === "maintenance" && moves[2]?.kind === "mock_interview", "fallback moves follow drift, in order");
}

// ─── 5. All-ready fallback ──────────────────────────────────────────────────
{
  console.log("\n[5] all-ready fallback — no drive, every dimension >= 70");
  const state: NextMoveState = {
    profile: baseProfile({ readiness_aptitude: 75, readiness_verbal: 75, readiness_domain: 75, readiness_coding: 75, readiness_communication: 75 }),
    studentBranch: "CSE",
    drives: [],
    topicMastery: freshMastery(),
  };
  const moves = computeNextMoves(state, NOW);
  assert(moves.length === 2, `maintenance + mock_interview only (got ${moves.length})`);
  assert(moves[0]?.kind === "maintenance", `first move is maintenance (got ${moves[0]?.kind})`);
  assert(moves[1]?.kind === "mock_interview", `second move is mock_interview (got ${moves[1]?.kind})`);
  assert(moves[1]?.stage === "interview", "mock_interview move is tagged with the interview stage");
}

// ─── 6. Ineligible drive ignored ────────────────────────────────────────────
{
  console.log("\n[6] ineligible drive — ignored for both drive-sprint and the fallback's 'no drive' check");
  const drive: NextMoveDrive = {
    id: "d1",
    company_name: "Deloitte",
    company_type: "bfsi",
    drive_date: daysFromNow(5),
    eligible_min_cgpa: 9.0, // profile cgpa is 8.0 — ineligible
    eligible_branches: null,
  };
  const state: NextMoveState = {
    profile: baseProfile({ readiness_aptitude: 75, readiness_verbal: 75, readiness_domain: 75, readiness_coding: 75, readiness_communication: 75, cgpa: 8.0 }),
    studentBranch: "CSE",
    drives: [drive],
    topicMastery: freshMastery(),
  };
  const moves = computeNextMoves(state, NOW);
  assert(!moves.some((m) => m.kind === "drive_sprint"), "no drive_sprint move for an ineligible drive");
  assert(moves.length === 2 && moves[0]?.kind === "maintenance" && moves[1]?.kind === "mock_interview", "fallback still fires — ineligible drive does not count as 'a drive'");
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
