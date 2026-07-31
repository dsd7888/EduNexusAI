/**
 * "Ask about this" handoff — notes → chat (CP-N4 Part 3/5).
 *
 * DELIBERATELY THE SAME SHAPE AS lib/assessment/chatHandoff.ts, for the same
 * reasons, which are worth restating rather than cross-referencing: the payload
 * carries a whole note block — a worked example's problem and multi-step
 * solution, or a comparison's every cell — which is routinely 1–3 KB encoded.
 * URLs cap out around 2 KB in practice, and the failure is not a clean error but
 * a silently truncated block arriving at the tutor, which then explains a mangled
 * version of what the student pointed at. It would also land in browser history
 * and server access logs. So the payload goes in sessionStorage under a token and
 * only the token travels in the query string.
 *
 * WHY A SECOND MODULE AND NOT A REUSE OF chatHandoff.ts. The two carry different
 * payloads (a quiz item's wrong answer vs. a note block) and they build different
 * messages. Sharing the storage helpers would mean one generic payload type that
 * is a union of both, and a `buildPrefillMessage` that branches on which kind it
 * got — which is more coupling than the ~40 duplicated lines of storage plumbing
 * costs. The key PREFIXES are distinct so the two sweeps never touch each other's
 * tokens.
 *
 * THE KEY FORMAT IS `notes_handoff_<epoch-ms>` and that is load-bearing twice
 * over: CP-N4's harness asserts /^notes_handoff_\d+$/, and the timestamp IS the
 * TTL — no separate `ts` field is needed inside the payload to expire a stale
 * token, unlike the quiz handoff.
 *
 * Read is DESTRUCTIVE. A surviving token would re-prefill the composer on every
 * later visit to that subject's chat, which reads as the page being stuck.
 *
 * The pure half (`serializeBlockForChat`, `buildNotesPrefillMessage`) touches no
 * browser API, so harnesses can import and assert it under plain node.
 */
import type { EnrichedNoteBlock } from "./pyq-frequency";
import type { NoteBlockKind } from "./types";

const PREFIX = "notes_handoff_";
/** Tokens older than this are ignored and swept — a stale tab, a bookmark. */
const MAX_AGE_MS = 10 * 60 * 1000;

export interface NotesChatHandoff {
  blockTitle: string;
  blockKind: NoteBlockKind;
  /** Plain-text serialisation of the block — see serializeBlockForChat. */
  blockContent: string;
  subjectId: string;
  /** Module name, so the tutor can ground the answer in the right unit. */
  moduleContext: string;
}

/** The storage key for a new handoff. Exported so the harness can assert it. */
export function notesHandoffKey(now: number = Date.now()): string {
  return `${PREFIX}${now}`;
}

/**
 * Flatten a block to the plain text the tutor should see.
 *
 * NOT JSON. The tutor is a persona answering a student, and pasting a JSON blob
 * at it produces an answer about the data structure. This reads as the student
 * quoting their own notes, which is what it is.
 *
 * Pure — no browser API, no I/O.
 */
export function serializeBlockForChat(block: EnrichedNoteBlock): string {
  if (block.kind === "concept") {
    const parts = [block.title, "", block.plainExplanation];
    if (block.formalStatement) parts.push("", block.formalStatement);
    return parts.join("\n");
  }

  if (block.kind === "formula") {
    const symbols = block.symbols
      .map((s) => `${s.symbol} = ${s.meaning}`)
      .join(", ");
    const parts = [
      block.name,
      "",
      `Formula: ${block.formula}`,
      "",
      `Symbols: ${symbols}`,
    ];
    if (block.workedExample) {
      parts.push("", `Example: ${block.workedExample.problem}`);
    }
    return parts.join("\n");
  }

  const items = block.items.map((i) => i.name).join(" vs ");
  return [
    block.title,
    "",
    `Comparing: ${items}`,
    `Dimensions: ${block.axes.join(", ")}`,
  ].join("\n");
}

/** The block's own title, whatever the kind calls it. */
export function blockTitleOf(block: EnrichedNoteBlock): string {
  return block.kind === "formula" ? block.name : block.title;
}

/**
 * The message the composer is prefilled with.
 *
 * Prefilled, NOT sent — see the note at the call site in the chat page. Phrased
 * as the student asking about something they are reading, with the block quoted
 * as context, so the tutor answers a question rather than summarising a payload.
 */
export function buildNotesPrefillMessage(p: NotesChatHandoff): string {
  const lines = [
    `I'm studying "${p.blockTitle}" from my notes. Can you explain it further?`,
  ];
  if (p.moduleContext) lines.push(``, `This is from: ${p.moduleContext}`);
  lines.push(``, `Context from my notes:`, p.blockContent);
  return lines.join("\n");
}

/** Store a handoff and return the key to put in the URL. Null if unavailable. */
export function writeNotesHandoff(payload: NotesChatHandoff): string | null {
  if (typeof window === "undefined") return null;
  const key = notesHandoffKey();
  try {
    window.sessionStorage.setItem(key, JSON.stringify(payload));
  } catch {
    // Quota, or a privacy mode that blocks storage. Returning null lets the
    // caller navigate to plain chat rather than to a link that does nothing.
    return null;
  }
  return key;
}

/** Age of a token, derived from the key itself. Infinity if unparseable. */
function ageOf(key: string): number {
  const ts = Number(key.slice(PREFIX.length));
  return Number.isFinite(ts) ? Date.now() - ts : Number.POSITIVE_INFINITY;
}

/**
 * Read and REMOVE a handoff. Null for missing, expired or malformed — all three
 * mean the same thing to the caller: no prefill, open a normal chat.
 */
export function takeNotesHandoff(key: string | null): NotesChatHandoff | null {
  if (!key || typeof window === "undefined") return null;
  if (!key.startsWith(PREFIX)) return null;

  let raw: string | null = null;
  try {
    raw = window.sessionStorage.getItem(key);
    window.sessionStorage.removeItem(key);
  } catch {
    return null;
  }
  if (!raw || ageOf(key) > MAX_AGE_MS) return null;

  try {
    const parsed = JSON.parse(raw) as NotesChatHandoff;
    return parsed?.blockContent ? parsed : null;
  } catch {
    return null;
  }
}

/** Drop every stale token. Cheap; called on chat mount. */
export function sweepNotesHandoffs(): void {
  if (typeof window === "undefined") return;
  try {
    const doomed: string[] = [];
    for (let i = 0; i < window.sessionStorage.length; i += 1) {
      const k = window.sessionStorage.key(i);
      if (!k?.startsWith(PREFIX)) continue;
      if (ageOf(k) > MAX_AGE_MS) doomed.push(k);
    }
    for (const k of doomed) window.sessionStorage.removeItem(k);
  } catch {
    // Storage unavailable — nothing to sweep.
  }
}
