/**
 * CP-Q3 Part 6 verification — streak math, pure unit tests.
 *
 * No DB, no network, no cleanup needed: computeStreak() takes an injectable
 * `now`, which is the whole reason it was written as a pure function. Runs in
 * milliseconds, so it can be re-run on every edit rather than batched with the
 * expensive harnesses.
 *
 *   npx tsx _cp_q3_verify/streak_math.ts
 */
import {
  computeStreak,
  weekStart,
  weeksBetween,
  GRACE_WINDOW_WEEKS,
  STREAK_THRESHOLD,
} from "@/lib/assessment/streak";

let passed = 0;
let failed = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${label}\n      expected ${JSON.stringify(expected)}\n      actual   ${JSON.stringify(actual)}`);
  }
}

function section(title: string): void {
  console.log(`\n${"─".repeat(70)}\n${title}\n${"─".repeat(70)}`);
}

/** A local-time date, so the tests exercise the same clock the lib uses. */
function d(y: number, m: number, day: number, h = 12): Date {
  return new Date(y, m - 1, day, h, 0, 0, 0);
}

/** n sessions inside the week that is `weeksAgo` before `now`. */
function sessionsInWeek(now: Date, weeksAgo: number, n: number): Date[] {
  const start = weekStart(now);
  start.setDate(start.getDate() - weeksAgo * 7);
  return Array.from({ length: n }, (_, i) => {
    const dt = new Date(start);
    // Spread across Mon..Wed so nothing lands outside the week even at n=3.
    dt.setDate(dt.getDate() + (i % 7));
    dt.setHours(10, 0, 0, 0);
    return dt;
  });
}

function main() {
  console.log("═".repeat(70));
  console.log("CP-Q3 Part 6 — streak math");
  console.log("═".repeat(70));

  // Reference "now": Thursday 2026-07-23, mid-week, so the current week is
  // genuinely in progress.
  const now = d(2026, 7, 23);

  // ── week boundaries ─────────────────────────────────────────────────────
  section("(1) Monday–Sunday week boundaries");
  // 2026-07-20 is a Monday; 2026-07-26 the Sunday that closes the same week.
  check("Monday is its own week start", weekStart(d(2026, 7, 20)).getDate(), 20);
  check("Thursday maps back to Monday", weekStart(d(2026, 7, 23)).getDate(), 20);
  check("Sunday maps back to the SAME Monday", weekStart(d(2026, 7, 26)).getDate(), 20);
  check(
    "the next Monday starts a NEW week",
    weekStart(d(2026, 7, 27)).getDate(),
    27
  );
  check(
    "Sunday 23:59 and Monday 00:00 are different weeks",
    weeksBetween(d(2026, 7, 26, 23), d(2026, 7, 27, 0)),
    1
  );
  check(
    "Sunday 23:59 and the Monday BEFORE it are the same week",
    weeksBetween(d(2026, 7, 20, 0), d(2026, 7, 26, 23)),
    0
  );

  // ── the exactly-3 threshold ─────────────────────────────────────────────
  section("(2) the exactly-3 threshold");
  check(
    "2 sessions this week is not yet a streak",
    computeStreak(sessionsInWeek(now, 0, 2), now).weeks,
    0
  );
  check(
    "exactly 3 this week IS a streak of 1",
    computeStreak(sessionsInWeek(now, 0, STREAK_THRESHOLD), now).weeks,
    1
  );
  check(
    "4 this week is still a streak of 1 (weeks, not sessions)",
    computeStreak(sessionsInWeek(now, 0, 4), now).weeks,
    1
  );
  check(
    "3 this week + 3 last week = 2",
    computeStreak(
      [...sessionsInWeek(now, 0, 3), ...sessionsInWeek(now, 1, 3)],
      now
    ).weeks,
    2
  );
  check(
    "a zero week breaks the run",
    computeStreak(
      [
        ...sessionsInWeek(now, 0, 3),
        ...sessionsInWeek(now, 1, 3),
        // week 2 empty
        ...sessionsInWeek(now, 3, 3),
      ],
      now
    ).weeks,
    2
  );
  check(
    "1 session in a past week breaks it (grace does not stretch to 1)",
    computeStreak(
      [...sessionsInWeek(now, 0, 3), ...sessionsInWeek(now, 1, 1), ...sessionsInWeek(now, 2, 3)],
      now
    ).weeks,
    1
  );

  // ── the current week is pending, not failing ────────────────────────────
  section("(3) the current week is PENDING, never failing");
  const mondayMorning = d(2026, 7, 27, 9); // a fresh week, 0 sessions so far
  const priorThree = [
    ...sessionsInWeek(mondayMorning, 1, 3),
    ...sessionsInWeek(mondayMorning, 2, 3),
  ];
  const mondayResult = computeStreak(priorThree, mondayMorning);
  check(
    "Monday 09:00 with 0 sessions keeps the 2-week streak visible",
    mondayResult.weeks,
    2
  );
  check("…and reports the week as pending", mondayResult.currentWeekPending, true);
  check("…and says how many are still needed", mondayResult.sessionsToQualify, 3);
  check(
    "a qualifying current week is not pending",
    computeStreak(sessionsInWeek(now, 0, 3), now).currentWeekPending,
    false
  );
  check(
    "…and needs nothing further",
    computeStreak(sessionsInWeek(now, 0, 3), now).sessionsToQualify,
    0
  );

  // ── half-week grace ─────────────────────────────────────────────────────
  section("(4) half-week grace (exactly 2 sessions)");
  check(
    "one half-week is absorbed mid-run",
    computeStreak(
      [
        ...sessionsInWeek(now, 0, 3),
        ...sessionsInWeek(now, 1, 2), // half
        ...sessionsInWeek(now, 2, 3),
        ...sessionsInWeek(now, 3, 3),
      ],
      now
    ).weeks,
    4
  );
  check(
    "…and the grace consumption is reported",
    computeStreak(
      [
        ...sessionsInWeek(now, 0, 3),
        ...sessionsInWeek(now, 1, 2),
        ...sessionsInWeek(now, 2, 3),
      ],
      now
    ).graceUsedWeeksAgo,
    1
  );
  check(
    "grace alone cannot manufacture a streak from nothing",
    computeStreak(sessionsInWeek(now, 1, 2), now).weeks,
    0
  );

  // ── grace exhaustion inside the 4-week window ───────────────────────────
  section(`(5) grace exhaustion — one half-week per ${GRACE_WINDOW_WEEKS}-week window`);
  // Half weeks at 1 and 3 → 3-1 = 2 < 4, so the second one BREAKS the run.
  check(
    "two half-weeks 2 apart: the second breaks it",
    computeStreak(
      [
        ...sessionsInWeek(now, 0, 3),
        ...sessionsInWeek(now, 1, 2), // half — forgiven
        ...sessionsInWeek(now, 2, 3),
        ...sessionsInWeek(now, 3, 2), // half — inside the window, breaks
        ...sessionsInWeek(now, 4, 3),
      ],
      now
    ).weeks,
    3
  );
  // Half weeks at 1 and 5 → 5-1 = 4, NOT < 4, so the window has rolled past.
  check(
    "two half-weeks 4 apart: the window has rolled, both forgiven",
    computeStreak(
      [
        ...sessionsInWeek(now, 0, 3),
        ...sessionsInWeek(now, 1, 2), // half
        ...sessionsInWeek(now, 2, 3),
        ...sessionsInWeek(now, 3, 3),
        ...sessionsInWeek(now, 4, 3),
        ...sessionsInWeek(now, 5, 2), // half, 4 weeks later
        ...sessionsInWeek(now, 6, 3),
      ],
      now
    ).weeks,
    7
  );
  check(
    "back-to-back half-weeks break immediately",
    computeStreak(
      [
        ...sessionsInWeek(now, 0, 3),
        ...sessionsInWeek(now, 1, 2),
        ...sessionsInWeek(now, 2, 2),
        ...sessionsInWeek(now, 3, 3),
      ],
      now
    ).weeks,
    2
  );

  // ── robustness ──────────────────────────────────────────────────────────
  section("(6) robustness");
  check("no sessions at all", computeStreak([], now).weeks, 0);
  check(
    "…reports the empty-state prompt correctly",
    computeStreak([], now).sessionsToQualify,
    3
  );
  check(
    "unparseable timestamps are ignored, not counted",
    computeStreak(
      [...sessionsInWeek(now, 0, 3).map((x) => x.toISOString()), "not-a-date"],
      now
    ).weeks,
    1
  );
  check(
    "future timestamps (clock skew) do not inflate the current week",
    computeStreak(
      [...sessionsInWeek(now, 0, 2), d(2026, 8, 15)],
      now
    ).currentWeekSessions,
    2
  );
  check(
    "ISO strings and Dates are interchangeable",
    computeStreak(
      sessionsInWeek(now, 0, 3).map((x) => x.toISOString()),
      now
    ).weeks,
    1
  );

  console.log("\n" + "═".repeat(70));
  console.log(`RESULT  ${passed} passed, ${failed} failed`);
  console.log("═".repeat(70));
  process.exit(failed === 0 ? 0 : 1);
}

main();
