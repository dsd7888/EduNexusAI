/**
 * Privacy floors for faculty analytics (CP-Q4).
 *
 * The counterpart to `src/lib/assessment/peerStat.ts`, which states the same
 * class of rule for the student-facing surface. Constants live here with their
 * reasoning attached so the rule is enforceable by reading one file, and so a
 * future "faculty need to see everything" revision has to argue against a
 * stated principle rather than fill a silence.
 *
 * WHAT IS PERMANENTLY REJECTED
 *   · No student names in ANY aggregate visualization — not in the module
 *     heatmap, not in the CO table, not in the engagement chart, not in a
 *     tooltip. Aggregates describe a cohort; the moment a name appears in one
 *     it is a roster with extra steps.
 *   · No aggregate over a cohort below MIN_COHORT_FOR_AGGREGATE.
 *   · No item statistic below MIN_ATTEMPTS_FOR_DISCRIMINATION.
 *
 * WHAT IS DELIBERATELY ALLOWED, and why it is not a contradiction
 *   The students table on the subject dashboard shows names, per-student
 *   accuracy, streak and last-active. That is BY DESIGN and is the point of
 *   the surface: faculty cannot intervene with a student they cannot identify.
 *   The distinction this file draws is between an AGGREGATE (which describes
 *   the group and must never resolve to an individual) and a ROSTER (which
 *   names individuals openly, to a faculty member already entitled to teach
 *   them). Blurring the two — a "top performers" callout, a name on a heatmap
 *   cell — creates the worst version of both: a leaderboard.
 */

/**
 * Minimum number of students with data before cohort aggregates are shown.
 *
 * FIVE, not the student-facing ten (PEER_STAT_MIN_ATTEMPTS). The floors differ
 * because the readers and the risks differ:
 *
 *   · The student-facing floor is about re-identification BY A PEER and about
 *     noise presented to someone with no context to discount it. Ten is right
 *     there.
 *   · Faculty legitimately need to see thin cohorts — an elective with eight
 *     students is a real class, and telling its teacher "not enough data" for
 *     the whole semester makes analytics useless exactly where attention is
 *     most affordable. Faculty also already know who is in the room, so an
 *     aggregate over their own eight students reveals nothing they could not
 *     observe directly.
 *
 * Five is where "a cohort" starts meaning something. Below it, an aggregate is
 * one or two students' work wearing the authority of a statistic — and at
 * n=1 or 2 it is simply a named student's score with the name removed.
 */
export const MIN_COHORT_FOR_AGGREGATE = 5;

/**
 * Minimum attempts on a bank question before its discrimination is computed.
 *
 * Below five, point-biserial is noise with a decimal point. The same principle
 * as PEER_STAT_MIN_ATTEMPTS = 10, at the lower floor an item statistic can
 * tolerate: this number is read by a faculty member deciding whether to review
 * a question, not by a student deciding how to feel.
 *
 * Below the floor the value is null — never 0, which would sort a
 * never-answered question into the "broken question" bucket at the top of the
 * question-quality panel and send faculty to rewrite something nobody has
 * tried yet.
 */
export const MIN_ATTEMPTS_FOR_DISCRIMINATION = 5;

/**
 * Discrimination interpretation bands, and the plain-language reading each
 * gets. Centralized because the same sentence must appear on the question
 * detail page and in the dashboard's expandable row — the CP-Q3
 * "engagement-mechanic copy centralized" rule applied to a statistic.
 */
export function discriminationReading(d: number | null): {
  band: "unmeasured" | "broken" | "weak" | "acceptable" | "good";
  sentence: string;
} {
  if (d == null) {
    return {
      band: "unmeasured",
      sentence: `Not enough attempts yet — discrimination needs at least ${MIN_ATTEMPTS_FOR_DISCRIMINATION}.`,
    };
  }
  if (d < 0) {
    return {
      band: "broken",
      sentence:
        "Negative — stronger students are getting this WRONG more often than weaker ones. That usually means a miskeyed answer or an ambiguous stem. Worth reviewing before reuse.",
    };
  }
  if (d < 0.2) {
    return {
      band: "weak",
      sentence:
        "Near zero — this question does not separate stronger from weaker students. It may be too easy, too hard, or unclear.",
    };
  }
  if (d < 0.3) {
    return {
      band: "acceptable",
      sentence:
        "Modest — this question separates students somewhat, but not sharply.",
    };
  }
  return {
    band: "good",
    sentence:
      "This question effectively distinguishes stronger from weaker students.",
  };
}
