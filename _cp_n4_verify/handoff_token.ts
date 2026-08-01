/**
 * CP-N4 harness 2 — the notes → chat handoff contract.
 *
 * SCOPE, STATED HONESTLY. sessionStorage is browser-side; no HTTP harness can
 * assert it. What IS assertable, and is asserted here, is the contract the two
 * ends agree on — and because both ends import these same pure functions, a
 * drift on either side breaks these assertions:
 *
 *   - serializeBlockForChat output, per block kind, against REAL blocks pulled
 *     from the dev DB rather than hand-built fixtures (a hand-built formula
 *     block would not have caught the bare-`\Omega` unit issue)
 *   - the storage key format the reading view mints: /^notes_handoff_\d+$/
 *   - every field the chat page reads is present and correctly typed
 *   - the prefill message actually quotes the block
 *
 * The consume-once behaviour is a CODE-INSPECTION note, recorded at the bottom
 * of this file's output rather than claimed as a passing assertion, and it was
 * exercised for real in the browser drive reported with the checkpoint.
 *
 * No server needed for the pure assertions; the DB is read for real blocks.
 * Run: npx tsx _cp_n4_verify/handoff_token.ts > /tmp/cpn4_handoff.log 2>&1
 */
import {
  blockTitleOf,
  buildNotesPrefillMessage,
  notesHandoffKey,
  serializeBlockForChat,
  type NotesChatHandoff,
} from "@/lib/notes/chat-handoff";
import { validateNoteBlocks } from "@/lib/notes/types";
import type { EnrichedNoteBlock } from "@/lib/notes/pyq-frequency";

import { loadEnvLocal, adminClient, makeChecker, hr, sub } from "./shared";

loadEnvLocal();

const REQUIRED_FIELDS = [
  "blockTitle",
  "blockKind",
  "blockContent",
  "subjectId",
  "moduleContext",
] as const;

async function loadRealBlocks(): Promise<EnrichedNoteBlock[]> {
  const admin = adminClient();
  const { data } = await admin
    .from("study_notes")
    .select("blocks")
    .eq("scope", "module")
    .limit(400);

  const out: EnrichedNoteBlock[] = [];
  for (const row of data ?? []) {
    const v = validateNoteBlocks((row as { blocks: unknown }).blocks, {
      expectCount: false,
    });
    if (v.ok) out.push(...(v.blocks as EnrichedNoteBlock[]));
  }
  return out;
}

async function main() {
  const { check, eq, summary } = makeChecker();

  hr("CP-N4 harness 2 — handoff_token");

  const all = await loadRealBlocks();
  console.log(`loaded ${all.length} real blocks from the dev DB`);

  const byKind = {
    concept: all.find((b) => b.kind === "concept"),
    formula: all.find((b) => b.kind === "formula"),
    comparison: all.find((b) => b.kind === "comparison"),
  };

  sub("key format — what the reading view mints");
  const key = notesHandoffKey();
  check("matches /^notes_handoff_\\d+$/", /^notes_handoff_\d+$/.test(key), key);
  check(
    "the numeric half is a recent epoch-ms (it doubles as the TTL)",
    Math.abs(Date.now() - Number(key.slice("notes_handoff_".length))) < 5000,
    key
  );

  sub("serializeBlockForChat — one real block of each kind");
  for (const kind of ["concept", "formula", "comparison"] as const) {
    const block = byKind[kind];
    if (!block) {
      // Not silently skipped — an absent kind is reported as a gap in the
      // fixture data, because a green run over two kinds is not a green run.
      check(`[${kind}] a real block exists in the dev DB`, false, "none seeded");
      continue;
    }

    const text = serializeBlockForChat(block);
    check(`[${kind}] serialises to a non-empty string`, text.length > 0, `${text.length} chars`);
    check(
      `[${kind}] is plain text, not JSON`,
      !text.trimStart().startsWith("{") && !text.includes('":'),
      JSON.stringify(text.slice(0, 60))
    );
    check(
      `[${kind}] leads with the block's own title`,
      text.startsWith(blockTitleOf(block)),
      JSON.stringify(text.split("\n")[0].slice(0, 60))
    );

    if (block.kind === "formula") {
      check("[formula] includes the formula line", text.includes(`Formula: ${block.formula}`));
      check(
        "[formula] includes every symbol as `sym = meaning`",
        block.symbols.every((s) => text.includes(`${s.symbol} = ${s.meaning}`)),
        `${block.symbols.length} symbols`
      );
      if (block.workedExample) {
        check(
          "[formula] includes the worked example's problem",
          text.includes(block.workedExample.problem)
        );
      }
    }
    if (block.kind === "concept") {
      check("[concept] includes plainExplanation", text.includes(block.plainExplanation));
      eq(
        "[concept] includes formalStatement iff present",
        block.formalStatement ? text.includes(block.formalStatement) : true,
        true
      );
    }
    if (block.kind === "comparison") {
      check(
        "[comparison] names every item",
        block.items.every((i) => text.includes(i.name)),
        block.items.map((i) => i.name).join(" vs ")
      );
      check(
        "[comparison] lists every axis",
        block.axes.every((a) => text.includes(a)),
        `${block.axes.length} axes`
      );
    }
  }

  sub("payload shape — every field the chat page reads");
  const sample = byKind.concept ?? byKind.formula ?? byKind.comparison;
  if (!sample) {
    check("at least one real block is available", false, "dev DB has no notes");
  } else {
    const payload: NotesChatHandoff = {
      blockTitle: blockTitleOf(sample),
      blockKind: sample.kind,
      blockContent: serializeBlockForChat(sample),
      subjectId: "00000000-0000-0000-0000-000000000000",
      moduleContext: "Module 1: Example",
    };

    // Round-trip through JSON — this is what actually crosses sessionStorage.
    const revived = JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;
    for (const field of REQUIRED_FIELDS) {
      check(
        `payload.${field} survives JSON round-trip as a non-empty string`,
        typeof revived[field] === "string" && (revived[field] as string).length > 0,
        String(revived[field]).slice(0, 40)
      );
    }
    check(
      "payload.blockKind is one of the three block kinds",
      ["concept", "formula", "comparison"].includes(revived.blockKind as string),
      String(revived.blockKind)
    );
    eq("payload carries exactly the five agreed fields", Object.keys(revived).sort(), [
      ...REQUIRED_FIELDS,
    ].sort());

    sub("buildNotesPrefillMessage — what lands in the composer");
    const msg = buildNotesPrefillMessage(payload);
    check("quotes the block title", msg.includes(payload.blockTitle));
    check("carries the module context", msg.includes(payload.moduleContext));
    check("embeds the serialised block verbatim", msg.includes(payload.blockContent));
    check(
      "reads as a student's question, not a data dump",
      msg.startsWith("I'm studying"),
      JSON.stringify(msg.slice(0, 50))
    );
  }

  const { passed, failed } = summary();
  console.log(`\n${passed} passed, ${failed} failed`);
  console.log(
    [
      "",
      "CODE-INSPECTION NOTES (not assertable over HTTP — verified by browser drive):",
      "  - takeNotesHandoff() does getItem THEN removeItem before parsing, so the",
      "    token is consumed exactly once even if parsing throws.",
      "    (src/lib/notes/chat-handoff.ts)",
      "  - the chat page strips ?notesHandoff from the URL with history.replaceState",
      "    whether or not the payload was found, so a refresh cannot re-fire it.",
      "    (src/app/(student)/student/chat/[subjectId]/page.tsx)",
      "  - sweepNotesHandoffs() drops tokens older than 10 minutes on chat mount.",
      "  - the notes handoff PREFILLS ONLY; unlike the quiz handoff it never calls",
      "    runExchange, so it cannot spend a chat quota unit unprompted.",
    ].join("\n")
  );
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
