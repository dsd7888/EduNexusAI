/**
 * "Ask AI why" handoff — assessment → chat (CP-Q3 Part 4).
 *
 * WHY A TOKEN AND NOT THE PAYLOAD IN THE URL
 * The prefill carries a question stem, the student's wrong answer, the correct
 * answer and an explanation. Encoded, that is routinely 1–3 KB and can exceed
 * it on a table-bearing stem with LaTeX. Browsers and proxies cap URLs (~2 KB
 * is the safe practical floor, IE-era limits still live in corporate proxies),
 * and the failure mode is not a clean error — it is a silently truncated
 * question arriving at the tutor, which then answers a mangled version of what
 * the student asked. The prefill also lands in browser history and server
 * access logs, which is the wrong place for a student's wrong answers.
 *
 * So: the payload goes in sessionStorage under a short random token, and only
 * the token travels in the query string. Same pattern as CP4's Visualize
 * handoff passing a `messageId` rather than the message.
 *
 * sessionStorage, not localStorage: this is single-navigation state. It should
 * not outlive the tab, and it should not be readable by another tab.
 *
 * Read is DESTRUCTIVE (read-and-delete). A prefill must fire exactly once — a
 * surviving token would re-submit the same question on every later visit to the
 * chat page, which reads as the tutor being stuck.
 */

const PREFIX = "edunexus:quiz_prefill:";
/** Tokens older than this are ignored and swept — a stale tab, a bookmark. */
const MAX_AGE_MS = 10 * 60 * 1000;

export interface QuizChatPrefill {
  sessionId: string;
  slotId: string;
  subjectId: string;
  question: string;
  studentAnswer: string | null;
  correctAnswer: string;
  explanation: string | null;
}

interface StoredPrefill extends QuizChatPrefill {
  ts: number;
}

function token(): string {
  // crypto.randomUUID is available in every browser this app supports; the
  // fallback keeps SSR and older embedded webviews from throwing.
  try {
    return crypto.randomUUID().slice(0, 12);
  } catch {
    return Math.random().toString(36).slice(2, 14);
  }
}

/** Store a prefill and return the token to put in the URL. */
export function writeQuizPrefill(payload: QuizChatPrefill): string | null {
  if (typeof window === "undefined") return null;
  const t = token();
  const stored: StoredPrefill = { ...payload, ts: Date.now() };
  try {
    window.sessionStorage.setItem(PREFIX + t, JSON.stringify(stored));
  } catch {
    // Quota or a privacy mode that blocks storage. Returning null lets the
    // caller navigate to plain chat rather than to a link that does nothing.
    return null;
  }
  return t;
}

/**
 * Read and REMOVE a prefill. Returns null for a missing, expired, or malformed
 * token — all three are the same thing to the caller: no prefill, open a normal
 * chat.
 */
export function takeQuizPrefill(t: string | null): QuizChatPrefill | null {
  if (!t || typeof window === "undefined") return null;
  const storageKey = PREFIX + t;
  let raw: string | null = null;
  try {
    raw = window.sessionStorage.getItem(storageKey);
    window.sessionStorage.removeItem(storageKey);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredPrefill;
    if (!parsed?.question || Date.now() - (parsed.ts ?? 0) > MAX_AGE_MS) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/** Drop every stale token. Cheap; called on chat mount. */
export function sweepQuizPrefills(): void {
  if (typeof window === "undefined") return;
  try {
    const doomed: string[] = [];
    for (let i = 0; i < window.sessionStorage.length; i += 1) {
      const k = window.sessionStorage.key(i);
      if (!k?.startsWith(PREFIX)) continue;
      try {
        const parsed = JSON.parse(
          window.sessionStorage.getItem(k) ?? "{}"
        ) as StoredPrefill;
        if (Date.now() - (parsed.ts ?? 0) > MAX_AGE_MS) doomed.push(k);
      } catch {
        doomed.push(k);
      }
    }
    for (const k of doomed) window.sessionStorage.removeItem(k);
  } catch {
    // Storage unavailable — nothing to sweep.
  }
}

/**
 * The question the tutor is asked. Phrased as the student asking about their
 * own mistake, because the tutor's persona responds to a question, not to a
 * data dump — and because "explain why I was wrong" is what the student
 * actually wants, not "here is a quiz item".
 */
export function buildPrefillMessage(p: QuizChatPrefill): string {
  const lines = [
    `I got this question wrong in a quiz and I want to understand why.`,
    ``,
    `Question: ${p.question}`,
  ];
  if (p.studentAnswer) lines.push(`My answer: ${p.studentAnswer}`);
  lines.push(`Correct answer: ${p.correctAnswer}`);
  if (p.explanation) {
    lines.push(
      ``,
      `The explanation I was given was: "${p.explanation}"`,
      `Can you break down the reasoning further, and tell me what I likely misunderstood?`
    );
  } else {
    lines.push(``, `Can you walk me through the reasoning?`);
  }
  return lines.join("\n");
}
