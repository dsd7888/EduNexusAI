import { computeNextMoves, type NextMoveState, type NextMoveProfile } from "../src/lib/placement/nextMove";

const now = new Date("2026-08-16T00:00:00Z");

function baseProfile(overrides: Partial<NextMoveProfile> = {}): NextMoveProfile {
  return {
    setup_complete: true,
    primary_target: "service_it",
    readiness_aptitude: 50,
    readiness_verbal: 50,
    readiness_domain: 50,
    readiness_coding: 50,
    readiness_communication: 50,
    readiness_overall: 50,
    resume_completeness: 80,
    cgpa: 8,
    active_backlogs: 0,
    ...overrides,
  };
}

function run(label: string, state: NextMoveState) {
  console.log(`\n── ${label} ──`);
  const moves = computeNextMoves(state, now);
  if (moves.length === 0) {
    console.log("  (EMPTY — zero moves returned)");
  }
  for (const m of moves) {
    console.log(`  [${m.urgency}] ${m.kind} — ${m.title} -> ${m.href} | tags=${JSON.stringify(m.tags)}`);
  }
}

// 1. setup incomplete overrides everything
run("setup incomplete", {
  profile: baseProfile({ setup_complete: false }),
  studentBranch: "Computer Science",
  drives: [],
  topicMastery: [],
});

// 2. no drives, no mastery, all-ready (every dim >= 70) -> maintenance + mock interview
run("all-ready, zero drives", {
  profile: baseProfile({
    readiness_aptitude: 90,
    readiness_verbal: 90,
    readiness_domain: 90,
    readiness_coding: 90,
    readiness_communication: 90,
    readiness_overall: 90,
    resume_completeness: 100,
  }),
  studentBranch: "Computer Science",
  drives: [],
  topicMastery: [],
});

// 3. ineligible drive (branch mismatch) — should NOT produce a drive_sprint move
run("drive exists but student ineligible (branch mismatch)", {
  profile: baseProfile({ readiness_aptitude: 30 }),
  studentBranch: "Mechanical",
  drives: [
    {
      id: "d1",
      company_name: "TCS",
      company_type: "service_it",
      drive_date: "2026-08-20", // 4 days out
      eligible_min_cgpa: null,
      eligible_branches: ["Computer Science"], // student is Mechanical
    },
  ],
  topicMastery: [],
});

// 4. drive exists, eligible, but ALL weighted dims already >= sprint threshold
//    (60) -- should fall through to no drive_sprint move for it, and since
//    hasAnyEligibleDrive=true, rule 6 (maintenance/mock) should NOT fire even
//    if everything else is strong, because the fallback requires !hasAnyEligibleDrive.
run("eligible drive, all dims strong (>=60) — expect NO drive_sprint AND NO maintenance fallback", {
  profile: baseProfile({
    readiness_aptitude: 95,
    readiness_verbal: 95,
    readiness_domain: 95,
    readiness_coding: 95,
    readiness_communication: 95,
    readiness_overall: 95,
    resume_completeness: 100,
  }),
  studentBranch: "Computer Science",
  drives: [
    {
      id: "d2",
      company_name: "Wipro",
      company_type: "service_it",
      drive_date: "2026-08-22",
      eligible_min_cgpa: null,
      eligible_branches: null,
    },
  ],
  topicMastery: [],
});

// 5. drive already PAST (negative daysRemaining) — must be filtered out
run("drive date already in the past", {
  profile: baseProfile({ readiness_aptitude: 20 }),
  studentBranch: "Computer Science",
  drives: [
    {
      id: "d3",
      company_name: "Cognizant",
      company_type: "service_it",
      drive_date: "2026-08-01", // 15 days AGO relative to `now`
      eligible_min_cgpa: null,
      eligible_branches: null,
    },
  ],
  topicMastery: [],
});

// 6. drive far in the future (outside 14-day sprint window) — no drive_sprint,
//    but standard weakest-gap rule (rule 4) should still fire.
run("drive 30 days out — outside sprint window", {
  profile: baseProfile({ readiness_aptitude: 20 }),
  studentBranch: "Computer Science",
  drives: [
    {
      id: "d4",
      company_name: "Accenture",
      company_type: "service_it",
      drive_date: "2026-09-15",
      eligible_min_cgpa: null,
      eligible_branches: null,
    },
  ],
  topicMastery: [],
});

// 7. drift: practiced 20 days ago, idle > 14 days -> drift_return
run("dimension idle 20 days (drift)", {
  profile: baseProfile({ readiness_aptitude: 75 }), // strong so rule 4 doesn't also grab it
  studentBranch: "Computer Science",
  drives: [],
  topicMastery: [
    {
      track: "aptitude",
      topic: "Time & Work",
      recent_accuracy: 80,
      attempts_count: 10,
      last_practiced_at: "2026-07-27T00:00:00Z", // 20 days before `now`
    },
  ],
});

// 8. drift candidate for `coding` — should NEVER drift (no track exists)
run("coding dimension weak+idle — must not attempt drift (no track)", {
  profile: baseProfile({ readiness_coding: 10 }),
  studentBranch: "Computer Science",
  drives: [],
  topicMastery: [], // nothing to look up for coding anyway
});

// 9. multiple drives same window, multiple weak dims -> covered-dimension dedup
run("two eligible drives in-window, overlapping weakest dims — dedup via coveredDimensions", {
  profile: baseProfile({
    readiness_aptitude: 20,
    readiness_verbal: 25,
    readiness_domain: 90,
    readiness_coding: 90,
    readiness_communication: 90,
  }),
  studentBranch: "Computer Science",
  drives: [
    {
      id: "d5",
      company_name: "TCS",
      company_type: "service_it",
      drive_date: "2026-08-18", // 2 days
      eligible_min_cgpa: null,
      eligible_branches: null,
    },
    {
      id: "d6",
      company_name: "Infosys",
      company_type: "service_it",
      drive_date: "2026-08-19", // 3 days
      eligible_min_cgpa: null,
      eligible_branches: null,
    },
  ],
  topicMastery: [],
});

// 10. cgpa null (never set despite setup_complete=true, since profile POST
//     allows setup_complete:true without cgpa present) -> isDriveEligible reads
//     (profile.cgpa ?? 0) — drive with a min_cgpa requirement should read as
//     INELIGIBLE for a null-cgpa profile, not crash.
run("cgpa null (setup flipped true without filling cgpa) + drive requires min_cgpa", {
  profile: baseProfile({ cgpa: null as unknown as number, readiness_aptitude: 20 }),
  studentBranch: "Computer Science",
  drives: [
    {
      id: "d7",
      company_name: "TCS",
      company_type: "service_it",
      drive_date: "2026-08-18",
      eligible_min_cgpa: 7.5,
      eligible_branches: null,
    },
  ],
  topicMastery: [],
});

// 11. everything exactly AT threshold boundaries (70/60) — off-by-one check
run("boundary: all dims exactly 70 (ALL_READY_THRESHOLD), zero drives", {
  profile: baseProfile({
    readiness_aptitude: 70,
    readiness_verbal: 70,
    readiness_domain: 70,
    readiness_coding: 70,
    readiness_communication: 70,
    resume_completeness: 70, // exactly at RESUME_COMPLETENESS_THRESHOLD too
  }),
  studentBranch: "Computer Science",
  drives: [],
  topicMastery: [],
});

console.log("\n\nDONE — no exceptions thrown across 11 edge-case states.");
