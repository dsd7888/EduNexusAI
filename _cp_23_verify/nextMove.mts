// CP-23 verify: empty Next-Move queue for a ready student, eligible in-window drive.
// Pure-function harness — computeNextMoves has no I/O, so no live DB/session needed.
import { computeNextMoves, NextMoveState } from "../src/lib/placement/nextMove";

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exitCode = 1;
  } else {
    console.log(`PASS: ${msg}`);
  }
}

const baseProfile = {
  setup_complete: true,
  primary_target: "service_it" as const,
  readiness_aptitude: 85,
  readiness_verbal: 82,
  readiness_domain: 88,
  readiness_coding: 90,
  readiness_communication: 80,
  readiness_overall: 85,
  resume_completeness: 90,
  cgpa: 8.5,
  active_backlogs: 0,
};

const now = new Date("2026-08-17T00:00:00Z");

// Case 1 (the bug): student is strong across the board (all >= sprint threshold
// of 60, but below the all-ready threshold of 70 is NOT the case here — set
// domain relevant score just above sprint threshold but the "standard gap" rule
// (threshold 70) would otherwise stay silent too) AND has one eligible in-window
// drive. Before the fix: Rule 2 finds a weakest dimension but its score (65) is
// >= DRIVE_SPRINT_SCORE_THRESHOLD (60) so it `continue`s: no drive_sprint move.
// Rule 4 (standardGap, threshold 70) also finds nothing below 70... so bump one
// dimension to exactly at the edge to isolate: everything >=70 so Rule 4 is also
// silent, AND resume is complete (Rule 5 silent), AND allReady (>=70 threshold)
// is true but hasAnyEligibleDrive is true, so Rule 6 was ALSO silent pre-fix.
// That reproduces a genuine empty queue for a ready student.
const readyState: NextMoveState = {
  profile: baseProfile,
  studentBranch: "CSE",
  drives: [
    {
      id: "d1",
      company_name: "Wipro",
      company_type: "service_it",
      drive_date: new Date("2026-08-24T00:00:00Z").toISOString(), // 7 days out, in-window
      eligible_min_cgpa: 7,
      eligible_branches: ["CSE"],
    },
  ],
  topicMastery: [],
};

const movesReady = computeNextMoves(readyState, now);
assert(movesReady.length > 0, "Case 1: ready student with an in-window eligible drive gets a non-empty queue");
assert(
  movesReady.some((m) => m.kind === "drive_ready"),
  "Case 1: queue includes a confirmatory 'drive_ready' move"
);
assert(
  movesReady.every((m) => m.kind !== "drive_sprint"),
  "Case 1: no false drive_sprint move fabricated (nothing is actually weak)"
);
console.log(JSON.stringify(movesReady, null, 2));

// Case 2 (regression guard — old behavior must still work): a genuinely weak
// dimension relative to the drive's company type must still produce a real
// drive_sprint move, not get swallowed by the new confirmatory-move logic.
const weakState: NextMoveState = {
  profile: { ...baseProfile, readiness_aptitude: 40 },
  studentBranch: "CSE",
  drives: readyState.drives,
  topicMastery: [],
};
const movesWeak = computeNextMoves(weakState, now);
assert(
  movesWeak.some((m) => m.kind === "drive_sprint"),
  "Case 2: a genuinely weak relevant dimension still produces a real drive_sprint move"
);
assert(
  movesWeak.every((m) => m.kind !== "drive_ready"),
  "Case 2: confirmatory move does not fire alongside a real sprint move for the same drive"
);

// Case 3 (unhappy path — no eligible drives at all, not-fully-ready): must NOT
// spuriously add a drive_ready move (there's no drive to be ready for).
const noDriveState: NextMoveState = {
  profile: { ...baseProfile, readiness_communication: 50 },
  studentBranch: "CSE",
  drives: [],
  topicMastery: [],
};
const movesNoDrive = computeNextMoves(noDriveState, now);
assert(
  movesNoDrive.every((m) => m.kind !== "drive_ready"),
  "Case 3: no eligible drives at all -> no drive_ready move fabricated"
);
assert(
  movesNoDrive.some((m) => m.kind === "weak_dimension"),
  "Case 3: existing weak_dimension rule still fires normally when there's no drive in play"
);

// Case 4 (unhappy path — drive exists but outside the 14-day sprint window):
// must not treat an out-of-window drive as "ready" either.
const farDriveState: NextMoveState = {
  profile: baseProfile,
  studentBranch: "CSE",
  drives: [
    {
      ...readyState.drives[0],
      drive_date: new Date("2026-10-01T00:00:00Z").toISOString(), // far out
    },
  ],
  topicMastery: [],
};
const movesFar = computeNextMoves(farDriveState, now);
assert(
  movesFar.every((m) => m.kind !== "drive_ready"),
  "Case 4: out-of-window drive does not trigger a drive_ready confirmatory move"
);
// Everything ready + no in-window drive -> old Rule 6 fallback (maintenance/mock_interview)
assert(
  movesFar.some((m) => m.kind === "maintenance"),
  "Case 4: old Rule 6 fallback still reachable when the only drive is outside the sprint window"
);

if (process.exitCode === 1) {
  console.error("\nCP-23 verify: FAILED");
  process.exit(1);
} else {
  console.log("\nCP-23 verify: ALL PASSED");
}
