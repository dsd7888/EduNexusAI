/**
 * Peer-stat computation — SERVER-ONLY (takes an admin client).
 *
 * Split from `peerStat.ts` (which holds the constants and the one label
 * string) so the rules can be imported by client components without dragging
 * a query and a cache into the browser bundle — the same client/server
 * segregation the rest of this codebase enforces.
 *
 * It also makes the rules testable in process: `_cp_q3_verify/peer_stat_privacy.ts`
 * calls this directly rather than driving the HTTP route, so the attempt floor
 * and the 20–80% window are verified against real seeded rows without needing a
 * running server or a student JWT.
 */

import type { createAdminClient } from "@/lib/db/supabase-server";
import {
  PEER_STAT_MAX_PCT,
  PEER_STAT_MIN_ATTEMPTS,
  PEER_STAT_MIN_PCT,
} from "./peerStat";

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * In-memory cache, module scope — lives as long as the serverless instance.
 *
 * Why cache: a class of 60 taking the same quiz simultaneously would otherwise
 * fire 60 identical aggregate queries per question. Why in-memory rather than a
 * table or an external cache: this stat is not real-time-critical (a
 * 5-minute-old "62% got this right" is indistinguishable from a fresh one), and
 * a cold instance simply recomputes. Bounded, so a long-lived instance cannot
 * grow it without limit.
 */
const TTL_MS = 5 * 60 * 1000;
const MAX_ENTRIES = 2000;

interface CacheEntry {
  n: number;
  correct: number;
  ts: number;
}

const cache = new Map<string, CacheEntry>();

/** Cache key: the stat is scoped to (question, subject), so the key must be too. */
function keyFor(questionId: string, subjectId: string): string {
  return `${questionId}:${subjectId}`;
}

function cacheGet(k: string): CacheEntry | null {
  const hit = cache.get(k);
  if (!hit) return null;
  if (Date.now() - hit.ts > TTL_MS) {
    cache.delete(k);
    return null;
  }
  return hit;
}

function cacheSet(k: string, n: number, correct: number): void {
  if (cache.size >= MAX_ENTRIES) {
    // FIFO eviction (Map preserves insertion order). Not true LRU, which is
    // fine: the worst case of a wrong eviction is one extra query.
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(k, { n, correct, ts: Date.now() });
}

/** Test seam — the harness clears the cache between scenarios. */
export function __clearPeerStatCache(): void {
  cache.clear();
}

export interface PeerStatDebug {
  n: number;
  correct: number;
  rawPct: number | null;
  /** Why it was withheld, when it was. */
  suppressed: "no_bank_question" | "below_floor" | "outside_window" | null;
  fromCache: boolean;
}

/**
 * "N% of students got this right", or null when it must not be shown.
 *
 * THE RULES ARE PRIVACY AND HONESTY RULES, NOT TUNING KNOBS — each is stated
 * with its reason in `peerStat.ts` and restated in CP_Q3_STUDENT_UX.md.
 *
 *  · No bankQuestionId → null BY CONSTRUCTION. A freshly generated question has
 *    been served to exactly one student (this one), so there is no peer to
 *    compare against. Not a gap; correct.
 *  · Below the attempt floor → null. Noise, and re-identifiable in a class of 60.
 *  · Outside the 20–80% window → null, in BOTH directions.
 *  · No names, no ranks, no leaderboards. This returns one integer; there is
 *    nowhere in the payload to put an identity.
 */
export async function computePeerStat(
  admin: AdminClient,
  bankQuestionId: string | null,
  subjectId: string
): Promise<{ pct: number | null; debug: PeerStatDebug }> {
  if (!bankQuestionId) {
    return {
      pct: null,
      debug: { n: 0, correct: 0, rawPct: null, suppressed: "no_bank_question", fromCache: false },
    };
  }

  const k = keyFor(bankQuestionId, subjectId);
  const cached = cacheGet(k);
  let n: number;
  let correct: number;
  let fromCache = false;

  if (cached) {
    n = cached.n;
    correct = cached.correct;
    fromCache = true;
  } else {
    // Scoped to the same subject: the same bank question is reachable from
    // another subject's offering, and mixing cohorts would misreport the stat.
    const { data, error } = await admin
      .from("student_question_attempts")
      .select("is_correct")
      .eq("question_id", bankQuestionId)
      .eq("subject_id", subjectId);
    if (error) {
      console.warn(`[peerStat] query failed: ${error.message}`);
      return {
        pct: null,
        debug: { n: 0, correct: 0, rawPct: null, suppressed: "below_floor", fromCache: false },
      };
    }
    const rows = (data ?? []) as Array<{ is_correct: boolean | null }>;
    n = rows.length;
    correct = rows.filter((r) => r.is_correct === true).length;
    cacheSet(k, n, correct);
  }

  const rawPct = n > 0 ? Math.round((correct / n) * 100) : null;

  if (n < PEER_STAT_MIN_ATTEMPTS) {
    return { pct: null, debug: { n, correct, rawPct, suppressed: "below_floor", fromCache } };
  }
  if (rawPct == null || rawPct < PEER_STAT_MIN_PCT || rawPct > PEER_STAT_MAX_PCT) {
    return { pct: null, debug: { n, correct, rawPct, suppressed: "outside_window", fromCache } };
  }
  return { pct: rawPct, debug: { n, correct, rawPct, suppressed: null, fromCache } };
}
