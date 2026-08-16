// Pure-function checks for buildMockRound (no I/O, no cost) — run with
// `npx tsx _cp_f1_verify/round.ts`.
import {
  buildMockRound,
  INTERVIEW_QUESTIONS,
} from "../src/lib/placement/interview-prep";
import type { PlacementTarget } from "../src/types/placement";

let pass = 0;
let fail = 0;
function assert(name: string, cond: boolean, detail?: unknown) {
  if (cond) {
    pass++;
    console.log("  OK  ", name);
  } else {
    fail++;
    console.log("  FAIL", name, detail ?? "");
  }
}

console.log("=== Bank size ===");
assert("bank has >= 30 questions", INTERVIEW_QUESTIONS.length >= 30, INTERVIEW_QUESTIONS.length);
console.log("  actual count:", INTERVIEW_QUESTIONS.length);

const categories = [
  "introduction",
  "motivation",
  "behavioral",
  "situational",
  "technical_cs",
  "project_deep_dive",
  "stress",
] as const;
for (const c of categories) {
  const n = INTERVIEW_QUESTIONS.filter((q) => q.category === c).length;
  assert(`category "${c}" has >= 1 question`, n >= 1, n);
}

const ids = INTERVIEW_QUESTIONS.map((q) => q.id);
assert("all question ids unique", new Set(ids).size === ids.length);

console.log("\n=== buildMockRound: determinism ===");
const targets: PlacementTarget[] = [
  "service_it",
  "product",
  "core_engineering",
  "bfsi",
  "consulting",
  "startup",
];
for (const t of targets) {
  const a = buildMockRound(t, "hr").map((q) => q.id);
  const b = buildMockRound(t, "hr").map((q) => q.id);
  assert(`hr round for ${t} is deterministic`, JSON.stringify(a) === JSON.stringify(b), { a, b });
}

console.log("\n=== buildMockRound: shape ===");
for (const t of targets) {
  const hr = buildMockRound(t, "hr");
  const tech = buildMockRound(t, "technical");
  assert(`${t} hr round has 6 questions`, hr.length === 6, hr.length);
  assert(`${t} technical round has 4 questions`, tech.length === 4, tech.length);
  assert(
    `${t} hr round has no duplicate questions`,
    new Set(hr.map((q) => q.id)).size === hr.length
  );
  assert(
    `${t} technical round has no duplicate questions`,
    new Set(tech.map((q) => q.id)).size === tech.length
  );
  assert(
    `${t} technical round ends on project_deep_dive`,
    tech[tech.length - 1]?.category === "project_deep_dive",
    tech.map((q) => q.category)
  );
  assert(
    `${t} hr round categories match the fixed HR sequence`,
    JSON.stringify(hr.map((q) => q.category)) ===
      JSON.stringify(["introduction", "motivation", "behavioral", "behavioral", "situational", "stress"]),
    hr.map((q) => q.category)
  );
}

console.log("\n=== buildMockRound: target-specific preference ===");
const bfsiHr = buildMockRound("bfsi", "hr");
assert(
  "bfsi hr round picks the bfsi-tagged situational question over the generic one",
  bfsiHr.some((q) => q.id === "situ-004"),
  bfsiHr.map((q) => q.id)
);

const consultingHr = buildMockRound("consulting", "hr");
assert(
  "consulting hr round picks the consulting-tagged situational question",
  consultingHr.some((q) => q.id === "situ-005"),
  consultingHr.map((q) => q.id)
);

const coreEngMotiv = buildMockRound("core_engineering", "hr");
assert(
  "core_engineering hr round picks the core_engineering-tagged motivation question",
  coreEngMotiv.some((q) => q.id === "motiv-004"),
  coreEngMotiv.map((q) => q.id)
);

const startupMotiv = buildMockRound("startup", "hr");
// Two questions are legitimately startup-relevant (motiv-003: ['product','startup'],
// motiv-005: ['startup']) — either is a correct pick, tie-broken by id/difficulty.
assert(
  "startup hr round picks a startup-relevant motivation question, not the generic service_it one",
  startupMotiv.some((q) => q.id === "motiv-003" || q.id === "motiv-005"),
  startupMotiv.map((q) => q.id)
);

// A target with NO tagged questions anywhere (not even a partial match)
// should still fall back cleanly to the 'all' pool rather than dropping a
// slot — every category has at least an 'all'-tagged question.
console.log("\n=== buildMockRound: fallback for a target with zero dedicated tags in a category ===");
const serviceItTech = buildMockRound("service_it", "technical");
assert("service_it technical round still has 4 questions (falls back to 'all')", serviceItTech.length === 4);

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail > 0 ? 1 : 0;
