/**
 * CP-24 verify — SQL-injection-shaped input -> raw HTML in logs.
 *
 * Pure-function harness, no DB/session needed: `isUuid`/`logCappedError`
 * (src/lib/api/helpers.ts) and the TRACK_SECTIONS known-label check (mirrors
 * prep/submit/route.ts's inline validation) have zero I/O.
 *
 * Asserts:
 *  1. isUuid happy path — a real UUID is accepted.
 *  2/3. Unhappy path — SQL/boolean-injection-shaped and malformed subjectId
 *       strings are rejected before they'd ever reach a `.in()` query.
 *  4. topic known-label check accepts a real TRACK_SECTIONS label and
 *     rejects injection-shaped / injection-suffixed strings.
 *  5. logCappedError bounds a huge/HTML upstream error message instead of
 *     dumping it raw (the actual finding: an unhandled failure previously
 *     logged an unbounded upstream body verbatim).
 *  6. Unhappy path — a normal short error is logged verbatim, untouched
 *     (the cap must not mangle the common case).
 */
import { isUuid, logCappedError } from "../src/lib/api/helpers";
import { TRACK_SECTIONS } from "../src/lib/placement/tracks";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    failures++;
    console.error("FAIL:", msg);
  } else {
    console.log("ok:", msg);
  }
}

assert(isUuid("550e8400-e29b-41d4-a716-446655440000"), "valid UUID accepted");

assert(!isUuid("'); DROP TABLE modules; --"), "SQL-injection-shaped subjectId rejected");
assert(!isUuid("1) OR (1=1"), "boolean-injection-shaped subjectId rejected");
assert(!isUuid(""), "empty string rejected");
assert(!isUuid("550e8400-e29b-41d4-a716-44665544000"), "truncated UUID rejected");

const aptitudeTopics = new Set(TRACK_SECTIONS.aptitude.flatMap((s) => s.topics));
assert(
  aptitudeTopics.has("Time & Work (Easy → Medium → Hard)"),
  "known aptitude topic accepted"
);
assert(!aptitudeTopics.has("<script>alert(1)</script>"), "HTML/injection-shaped topic rejected");
assert(
  !aptitudeTopics.has("Time & Work (Easy → Medium → Hard) OR 1=1"),
  "injection-suffixed real-looking topic rejected"
);

const hugeHtml = "<html><body>" + "X".repeat(5000) + "</body></html>";
let captured = "";
const origError = console.error;
console.error = (...args: unknown[]) => {
  captured = args.map(String).join(" ");
};
logCappedError("[test]", new Error(hugeHtml));
console.error = origError;
assert(captured.length < 700, `capped log stayed bounded (got ${captured.length} chars)`);
assert(captured.includes("truncated"), "capped log signals truncation happened");
assert(!captured.includes("X".repeat(600)), "capped log does not contain the full raw payload");

captured = "";
console.error = (...args: unknown[]) => {
  captured = args.map(String).join(" ");
};
logCappedError("[test]", new Error("short real error"));
console.error = origError;
assert(
  captured.includes("short real error") && !captured.includes("truncated"),
  "short error logged verbatim, untouched"
);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
