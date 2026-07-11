/**
 * Unit tests for the deterministic lesson-plan skeleton math.
 *
 * There is no test framework in this repo (see CLAUDE.md); this is a
 * self-contained assertion runner, same convention as the other scripts/*.ts.
 *
 *   npx tsx scripts/test-lessonplan-skeleton.ts
 *
 * Exit code 0 = all passed, 1 = at least one failure.
 */
import {
  buildTheorySkeleton,
  buildPracticalSkeleton,
  DEFAULT_MODULE_HOURS,
  type SkeletonModule,
  type SkeletonPractical,
} from "../src/lib/lessonplan/skeleton";

let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${msg}`);
  }
}

function eq<T>(actual: T, expected: T, msg: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed++;
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${msg}\n      expected ${e}\n      got      ${a}`);
  }
}

// ── 1. module hours → stub counts, continuous numbering across modules ──────
{
  const modules: SkeletonModule[] = [
    { module_number: 1, hours: 3 },
    { module_number: 2, hours: 2 },
    { module_number: 3, hours: 4 },
  ];
  const r = buildTheorySkeleton(modules);
  eq(r.totalSessions, 9, "total sessions = 3+2+4");
  eq(
    r.sessionCountByModule,
    { 1: 3, 2: 2, 3: 4 },
    "per-module session counts match hours",
  );
  eq(
    r.sessions.map((s) => s.sessionNo),
    [1, 2, 3, 4, 5, 6, 7, 8, 9],
    "session numbers continuous 1..N",
  );
  eq(
    r.sessions.map((s) => s.moduleNumber),
    [1, 1, 1, 2, 2, 3, 3, 3, 3],
    "sessions grouped by module in order",
  );
  eq(r.defaultedModules, [], "no defaulted modules when hours present");
}

// ── 2. numbering follows module_number order even when input is unsorted ────
{
  const modules: SkeletonModule[] = [
    { module_number: 3, hours: 2 },
    { module_number: 1, hours: 1 },
    { module_number: 2, hours: 2 },
  ];
  const r = buildTheorySkeleton(modules);
  eq(
    r.sessions.map((s) => s.moduleNumber),
    [1, 2, 2, 3, 3],
    "unsorted input still numbers in module_number order",
  );
  eq(r.sessions[0].sessionNo, 1, "first session is #1 = module 1");
}

// ── 3. null/0 hours guard → DEFAULT_MODULE_HOURS + flagged ──────────────────
{
  const modules: SkeletonModule[] = [
    { module_number: 1, hours: null },
    { module_number: 2, hours: 0 },
    { module_number: 3, hours: 5 },
  ];
  const r = buildTheorySkeleton(modules);
  eq(
    r.sessionCountByModule,
    { 1: DEFAULT_MODULE_HOURS, 2: DEFAULT_MODULE_HOURS, 3: 5 },
    "null and 0 hours both default",
  );
  eq(r.defaultedModules, [1, 2], "both null/0 modules flagged as defaulted");
  eq(
    r.totalSessions,
    DEFAULT_MODULE_HOURS * 2 + 5,
    "total counts defaulted modules",
  );
}

// ── 4. hoursOverride takes precedence (incl. over a null-hours module) ──────
{
  const modules: SkeletonModule[] = [
    { module_number: 1, hours: 3 },
    { module_number: 2, hours: null },
  ];
  const r = buildTheorySkeleton(modules, { 1: 5, 2: 6 });
  eq(r.sessionCountByModule, { 1: 5, 2: 6 }, "override replaces hours");
  eq(
    r.defaultedModules,
    [],
    "overridden null-hours module is NOT flagged as defaulted",
  );
  eq(r.totalSessions, 11, "override totals honored");
}

// ── 5. override is clamped to >= 1 and floored ──────────────────────────────
{
  const modules: SkeletonModule[] = [{ module_number: 1, hours: 4 }];
  const r0 = buildTheorySkeleton(modules, { 1: 0 });
  eq(r0.sessionCountByModule[1], 1, "override of 0 clamps to 1");
  const rNeg = buildTheorySkeleton(modules, { 1: -3 });
  eq(rNeg.sessionCountByModule[1], 1, "negative override clamps to 1");
  const rFrac = buildTheorySkeleton(modules, { 1: 3.9 });
  eq(rFrac.sessionCountByModule[1], 3, "fractional override floored");
}

// ── 6. partial override only affects named modules ──────────────────────────
{
  const modules: SkeletonModule[] = [
    { module_number: 1, hours: 3 },
    { module_number: 2, hours: 2 },
  ];
  const r = buildTheorySkeleton(modules, { 2: 5 });
  eq(
    r.sessionCountByModule,
    { 1: 3, 2: 5 },
    "unspecified module keeps its hours; specified one overridden",
  );
}

// ── 7. empty modules → empty skeleton ───────────────────────────────────────
{
  const r = buildTheorySkeleton([]);
  eq(r.totalSessions, 0, "no modules → 0 sessions");
  assert(r.sessions.length === 0, "sessions array empty");
}

// ── 8. practical skeleton: one stub per row, sr_no order, hours default ──────
{
  const practicals: SkeletonPractical[] = [
    { sr_no: 2, name: "Sorting lab", hours: 2 },
    { sr_no: 1, name: "Intro to IDE", hours: null },
    { sr_no: 3, name: "Graphs", hours: 0 },
  ];
  const r = buildPracticalSkeleton(practicals);
  eq(r.totalPracticals, 3, "one stub per practical row");
  eq(
    r.practicals.map((p) => p.practicalNo),
    [1, 2, 3],
    "practicals sorted by sr_no",
  );
  eq(
    r.practicals.map((p) => p.title),
    ["Intro to IDE", "Sorting lab", "Graphs"],
    "titles verbatim, in sr_no order",
  );
  eq(
    r.practicals.map((p) => p.hours),
    [2, 2, 2],
    "null/0 practical hours default to 2, explicit kept",
  );
}

// ── 9. empty practicals → empty skeleton ────────────────────────────────────
{
  const r = buildPracticalSkeleton([]);
  eq(r.totalPracticals, 0, "no practicals → empty");
}

console.log(`\nlesson-plan skeleton tests: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
