/**
 * Peer-stat rules (CP-Q3 Part 4). Client-safe constants, so the session UI and
 * the results page describe the same rule the route enforces.
 *
 * These are PRIVACY AND HONESTY rules, not tuning knobs. Every one of them has
 * a reason, and the reasons are restated in CP_Q3_STUDENT_UX.md's
 * explicit-rejections list so a future "let's make this more engaging" revision
 * has to argue against a stated principle rather than fill a silence.
 *
 * WHAT IS PERMANENTLY REJECTED HERE
 *   · No names. Ever. There is nowhere in the peer-stat payload to put an
 *     identity, by construction — it is one integer.
 *   · No ranks, no percentile-of-you, no "you're in the top N".
 *   · No leaderboards, class or cohort.
 *   · No stat below the attempt floor, however tempting the empty space looks.
 *   · No stat outside the informative window, in EITHER direction.
 */

/**
 * Minimum prior attempts on a question before its stat may be shown.
 *
 * BECAUSE: below ~10 the number is statistical noise dressed as information
 * (3 of 4 students is "75%", and means nothing), AND in a class of 60 a stat
 * over 2–3 attempts starts being re-identifiable — a student who knows two
 * classmates tried it can infer how they did.
 */
export const PEER_STAT_MIN_ATTEMPTS = 10;

/**
 * The informative window. Outside it, no stat.
 *
 * BECAUSE: extremes demotivate in both directions, and neither tail carries
 * usable information for the student reading it.
 *   · Above 80%: "everyone got this but me" — the most discouraging possible
 *     framing of a single wrong answer, delivered at the moment of the mistake.
 *   · Below 20%: "even I got this and it means nothing" on a correct answer,
 *     and on a wrong one it excuses the gap instead of prompting the student to
 *     close it.
 * The middle is where "62% got this right" actually tells you something: this
 * was genuinely hard, you are not uniquely lost, and it is worth another look.
 */
export const PEER_STAT_MIN_PCT = 20;
export const PEER_STAT_MAX_PCT = 80;

/** The one sentence this stat is ever phrased as. */
export function peerStatLabel(pct: number): string {
  return `${pct}% of students got this right`;
}
