/**
 * CP-E1 verify harness — pure in-memory unit tests for
 * src/lib/placement/archetypes.ts (getArchetype + computeSkillGap). No DB, no
 * network, no cleanup needed: both are pure functions over fixture data.
 *
 * Also asserts zero routeAI usage in the module (SPEC §7: "No per-student AI
 * call for the archetype").
 *
 * Run: npx tsx _cp_e1_verify/verify.ts
 */
import { readFileSync } from "fs";
import {
  getArchetype,
  computeSkillGap,
  listArchetypes,
  type SkillGapProfile,
} from "../src/lib/placement/archetypes";

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string) {
  if (condition) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    console.error(`  FAIL  ${label}`);
  }
}

function allMetProfile(): SkillGapProfile {
  return {
    readiness_aptitude: 100,
    readiness_verbal: 100,
    readiness_domain: 100,
    readiness_coding: 100,
    readiness_communication: 100,
    resume_completeness: 100,
    resume_data: {
      technical_skills: {
        languages: ["Java", "Python", "SQL"],
        frameworks: ["React", "Spring Boot"],
        tools: ["Git", "Docker"],
      },
      projects: [
        { github_url: "https://github.com/x/a", live_url: "https://a.example.com" },
        { github_url: "https://github.com/x/b", live_url: null },
      ],
      achievements: [{ id: "1", text: "Won a hackathon" }],
    },
  };
}

function allGapProfile(): SkillGapProfile {
  return {
    readiness_aptitude: 0,
    readiness_verbal: 0,
    readiness_domain: 0,
    readiness_coding: 0,
    readiness_communication: 0,
    resume_completeness: 0,
    resume_data: null,
  };
}

// ─── 1. Archetype catalog coverage ──────────────────────────────────────────
{
  console.log("\n[1] archetype catalog — every PlacementTarget has an ANY fallback");
  const targets = [
    "service_it",
    "product",
    "core_engineering",
    "bfsi",
    "consulting",
    "startup",
  ] as const;
  const archetypes = listArchetypes();
  for (const t of targets) {
    const hasAny = archetypes.some((a) => a.branch === "ANY" && a.target === t);
    assert(hasAny, `ANY fallback exists for target "${t}"`);
  }
  assert(archetypes.length >= 10, `catalog has ~a dozen slots (got ${archetypes.length})`);
}

// ─── 2. Exact-match resolution: CSE × service_it ────────────────────────────
{
  console.log("\n[2] getArchetype — exact branch+target match (CSE × service_it)");
  const a = getArchetype("CSE", "service_it");
  assert(a.id === "cse-service_it", `resolves to the CSE service_it archetype (got "${a.id}")`);
  assert(a.pillars.length > 0, "archetype has pillars");
}

// ─── 3. Exact-match resolution: MECH × core_engineering ─────────────────────
{
  console.log("\n[3] getArchetype — exact branch+target match (MECH × core_engineering)");
  const a = getArchetype("MECH", "core_engineering");
  assert(a.id === "mech-core_engineering", `resolves to the MECH core_engineering archetype (got "${a.id}")`);
}

// ─── 4. Fallback resolution: an unlisted branch × target ────────────────────
{
  console.log("\n[4] getArchetype — unlisted branch falls back to the ANY slot for its target");
  const a = getArchetype("MLAI", "consulting");
  assert(a.branch === "ANY" && a.target === "consulting", `falls back to ANY × consulting (got "${a.id}")`);
  const b = getArchetype("totally-unknown-branch", "bfsi");
  assert(b.branch === "ANY" && b.target === "bfsi", `unrecognized branch string still resolves (got "${b.id}")`);
}

// ─── 5. All-met student ──────────────────────────────────────────────────────
{
  console.log("\n[5] computeSkillGap — all-met student (CSE × service_it)");
  const archetype = getArchetype("CSE", "service_it");
  const report = computeSkillGap(allMetProfile(), archetype);
  assert(report.gapCount === 0, `zero gaps (got ${report.gapCount})`);
  assert(report.partialCount === 0, `zero partials (got ${report.partialCount})`);
  assert(report.metCount === archetype.pillars.length, `every pillar met (${report.metCount}/${archetype.pillars.length})`);
  assert(
    report.pillars.every((p) => p.status === "met"),
    "every pillar result status is 'met'"
  );
}

// ─── 6. All-gap student ──────────────────────────────────────────────────────
{
  console.log("\n[6] computeSkillGap — all-gap student (MECH × core_engineering)");
  const archetype = getArchetype("MECH", "core_engineering");
  const report = computeSkillGap(allGapProfile(), archetype);
  assert(report.metCount === 0, `zero pillars met (got ${report.metCount})`);
  assert(report.gapCount === archetype.pillars.length, `every pillar is a gap (${report.gapCount}/${archetype.pillars.length})`);
  assert(
    report.pillars.every((p) => p.status === "gap"),
    "every pillar result status is 'gap'"
  );
  assert(
    report.pillars.every((p) => p.remedy.kind === "track" || p.remedy.kind === "resume" || p.remedy.kind === "phase2"),
    "every gap pillar carries a remedy (track / resume / phase2), never a dead end"
  );
}

// ─── 7. Partial state + resume_data defensively defaulted ───────────────────
{
  console.log("\n[7] computeSkillGap — mixed met/partial/gap, and a null resume_data doesn't throw");
  const archetype = getArchetype("CSE", "product"); // dsa 75/45, 2 deployed projects, stack 5/2, domain 65/35, comms 60/30
  const profile: SkillGapProfile = {
    readiness_aptitude: 50,
    readiness_verbal: 50,
    readiness_domain: 50, // between 35 and 65 → partial
    readiness_coding: 50, // between 45 and 75 → partial
    readiness_communication: 0, // below 30 → gap
    resume_completeness: 40,
    resume_data: null, // simulates a brand-new profile that never touched the resume builder
  };
  let threw = false;
  let report;
  try {
    report = computeSkillGap(profile, archetype);
  } catch {
    threw = true;
  }
  assert(!threw, "does not throw when resume_data is null");
  assert(!!report && report.gapCount > 0 && report.partialCount > 0, "produces a mix of gap and partial pillars");
  const domainPillar = report!.pillars.find((p) => p.id === "core_fundamentals");
  assert(domainPillar?.status === "partial", `domain pillar (score 50, target 65/45) is 'partial' (got "${domainPillar?.status}")`);
  const commsPillar = report!.pillars.find((p) => p.id === "communication");
  assert(commsPillar?.status === "gap", `communication pillar (score 0, target 60/30) is 'gap' (got "${commsPillar?.status}")`);
  const projectPillar = report!.pillars.find((p) => p.id === "two_deployed_projects");
  assert(projectPillar?.value === 0 && projectPillar?.status === "gap", "null resume_data → 0 deployed projects → 'gap', not a crash");
}

// ─── 8. Zero AI calls — grep the module for routeAI/generative imports ──────
{
  console.log("\n[8] zero AI calls in archetypes.ts (SPEC §7: 'No per-student AI call for the archetype')");
  const src = readFileSync(new URL("../src/lib/placement/archetypes.ts", import.meta.url), "utf8");
  assert(!/routeAI\s*\(/.test(src), "no routeAI(...) call in archetypes.ts");
  assert(!/from ["']@\/lib\/ai\//.test(src), "no import from src/lib/ai/* in archetypes.ts");
  assert(!/generative-ai|gemini/i.test(src), "no direct generative-AI provider import in archetypes.ts");
}

// ─── Summary ─────────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
