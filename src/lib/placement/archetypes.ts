// Skill-gap map (SPEC §7): "here's the placeable archetype for your branch ×
// target, here's your delta." Archetypes are hand-authored, cached content —
// NOT per-student AI generation (zero routeAI calls in this module, by
// design). The delta (`computeSkillGap`) is a pure, read-only function over
// data the platform already persists.
//
// This is the sanctioned replacement for the killed copy-a-project gallery:
// it shows the SHAPE of what's expected (capability pillars), never a
// copyable deliverable.

import type { PlacementTarget, StudentPlacementProfile } from "@/types/placement";
import { DIMENSION_HREF, DIMENSION_LABELS, type Dimension } from "@/lib/placement/nextMove";

// ─── Pillar metrics ─────────────────────────────────────────────────────────
// Every pillar is measured against a value this platform already computes or
// stores — no new AI call, no new data collection.

export type PillarMetricKind =
  | "readiness_aptitude"
  | "readiness_verbal"
  | "readiness_domain"
  | "readiness_coding"
  | "readiness_communication"
  | "resume_completeness"
  | "project_count"          // any resume project, deployed or not
  | "deployed_project_count" // resume project with a github_url or live_url
  | "tech_stack_breadth"     // technical_skills.{languages,frameworks,tools} union size
  | "extracurricular_count"; // resume achievements (hackathons, competitions, etc.)

const READINESS_METRIC_TO_DIMENSION: Partial<Record<PillarMetricKind, Dimension>> = {
  readiness_aptitude: "aptitude",
  readiness_verbal: "verbal",
  readiness_domain: "domain",
  readiness_coding: "coding",
  readiness_communication: "communication",
};

const PERCENT_METRICS = new Set<PillarMetricKind>([
  "readiness_aptitude",
  "readiness_verbal",
  "readiness_domain",
  "readiness_coding",
  "readiness_communication",
  "resume_completeness",
]);

// ─── Archetype shape ────────────────────────────────────────────────────────

export interface ArchetypePillar {
  id: string;
  label: string;
  /** What "meeting" this pillar looks like for this archetype — shown as the pillar's description. */
  description: string;
  metric: PillarMetricKind;
  /** Value at/above which the pillar is "met". */
  metTarget: number;
  /**
   * Value at/above which the pillar is "partial" (below `metTarget`).
   * Set equal to `metTarget` for count pillars with no meaningful partial
   * band (e.g. "one deployed project" — you either have one or you don't).
   */
  partialTarget: number;
}

export interface Archetype {
  id: string;
  /** A `BRANCHES` code (see `src/lib/constants/branches.ts`), or "ANY" for a branch-agnostic fallback slot. */
  branch: string;
  target: PlacementTarget;
  label: string;
  summary: string;
  pillars: ArchetypePillar[];
}

// ─── Archetype catalog (~a dozen slots, SPEC §7) ────────────────────────────
// Branch-specific slots exist where the platform's domain track is directly
// relevant (CSE/IT — the domain track is CS/IT-fixed regardless of branch,
// per CP-C1's finding) or where a distinct core-engineering shape is worth
// naming (MECH/CIVIL). Every other branch resolves to an "ANY" slot for its
// target — `getArchetype` guarantees this by construction (see below).

const CSE_IT_SERVICE_PILLARS: ArchetypePillar[] = [
  {
    id: "dsa_fundamentals",
    label: "DSA fundamentals",
    description: "Comfortable solving fill-in and MCQ questions across core data structures and algorithms.",
    metric: "readiness_coding",
    metTarget: 65,
    partialTarget: 35,
  },
  {
    id: "deployed_project",
    label: "One deployed project",
    description: "At least one resume project with a live link or a public repo — something a recruiter can actually open.",
    metric: "deployed_project_count",
    metTarget: 1,
    partialTarget: 1,
  },
  {
    id: "tech_stack",
    label: "Working tech stack",
    description: "A tech stack broad enough to hold a conversation about — languages, frameworks, and tools together.",
    metric: "tech_stack_breadth",
    metTarget: 4,
    partialTarget: 2,
  },
  {
    id: "hackathon",
    label: "One hackathon or competition",
    description: "Some evidence of building or competing outside coursework.",
    metric: "extracurricular_count",
    metTarget: 1,
    partialTarget: 1,
  },
  {
    id: "communication",
    label: "Communication",
    description: "Can explain a project and answer HR-round questions clearly.",
    metric: "readiness_communication",
    metTarget: 60,
    partialTarget: 30,
  },
];

const ARCHETYPES: Archetype[] = [
  {
    id: "cse-service_it",
    branch: "CSE",
    target: "service_it",
    label: "Placeable CSE — IT Services",
    summary: "What a mass-recruiter-ready CSE candidate looks like: solid fundamentals, one real project, clear communication.",
    pillars: CSE_IT_SERVICE_PILLARS,
  },
  {
    id: "it-service_it",
    branch: "IT",
    target: "service_it",
    label: "Placeable IT — IT Services",
    summary: "What a mass-recruiter-ready IT candidate looks like: solid fundamentals, one real project, clear communication.",
    pillars: CSE_IT_SERVICE_PILLARS,
  },
  {
    id: "cse-product",
    branch: "CSE",
    target: "product",
    label: "Placeable CSE — Product Companies",
    summary: "Product-company bars are higher on coding depth and project count — this is the delta from a service-IT slot.",
    pillars: [
      {
        id: "dsa_strong",
        label: "Strong DSA & problem solving",
        description: "Beyond fundamentals — consistently solving harder fill-in and coding questions.",
        metric: "readiness_coding",
        metTarget: 75,
        partialTarget: 45,
      },
      {
        id: "two_deployed_projects",
        label: "Two deployed projects",
        description: "More than one shipped project — depth and range both matter here.",
        metric: "deployed_project_count",
        metTarget: 2,
        partialTarget: 1,
      },
      {
        id: "tech_stack",
        label: "Working tech stack",
        description: "A tech stack broad enough to hold a conversation about — languages, frameworks, and tools together.",
        metric: "tech_stack_breadth",
        metTarget: 5,
        partialTarget: 2,
      },
      {
        id: "core_fundamentals",
        label: "Core CS fundamentals",
        description: "OS, DBMS, networks, OOP — the interview staples for product-company technical rounds.",
        metric: "readiness_domain",
        metTarget: 65,
        partialTarget: 35,
      },
      {
        id: "communication",
        label: "Communication",
        description: "Can explain design decisions and trade-offs, not just what the project does.",
        metric: "readiness_communication",
        metTarget: 60,
        partialTarget: 30,
      },
    ],
  },
  {
    id: "cse-startup",
    branch: "CSE",
    target: "startup",
    label: "Placeable CSE — Startups",
    summary: "Startups hire for range and shipping speed — breadth and a complete resume story matter as much as raw scores.",
    pillars: [
      {
        id: "practical_coding",
        label: "Practical coding ability",
        description: "Can write working code under time pressure, not just recognize the right answer.",
        metric: "readiness_coding",
        metTarget: 60,
        partialTarget: 30,
      },
      {
        id: "shipped_project",
        label: "A shipped, deployed project",
        description: "Something live that a founder could click on today.",
        metric: "deployed_project_count",
        metTarget: 1,
        partialTarget: 1,
      },
      {
        id: "broad_stack",
        label: "Broad tech stack",
        description: "Comfort across more of the stack — startups rarely hire for one narrow skill.",
        metric: "tech_stack_breadth",
        metTarget: 5,
        partialTarget: 2,
      },
      {
        id: "resume_story",
        label: "Resume tells a complete story",
        description: "Every section filled in — education, projects, skills, links.",
        metric: "resume_completeness",
        metTarget: 80,
        partialTarget: 50,
      },
      {
        id: "communication",
        label: "Communication",
        description: "Can pitch a project in two sentences, then go deep on request.",
        metric: "readiness_communication",
        metTarget: 55,
        partialTarget: 25,
      },
    ],
  },
  {
    id: "ece-service_it",
    branch: "ECE",
    target: "service_it",
    label: "Placeable ECE — IT Services",
    summary: "Mass recruiters hire ECE for IT-services roles on aptitude, general CS fundamentals, and communication — not a CS-specific project list.",
    pillars: [
      {
        id: "aptitude",
        label: "Aptitude & reasoning",
        description: "The core of every mass-recruiter OA.",
        metric: "readiness_aptitude",
        metTarget: 65,
        partialTarget: 35,
      },
      {
        id: "cs_fundamentals",
        label: "Core CS fundamentals",
        description: "Enough OS/DBMS/networks grounding to clear an IT-services technical round.",
        metric: "readiness_domain",
        metTarget: 55,
        partialTarget: 25,
      },
      {
        id: "communication",
        label: "Communication",
        description: "Clear, confident answers in the HR round.",
        metric: "readiness_communication",
        metTarget: 60,
        partialTarget: 30,
      },
      {
        id: "resume_complete",
        label: "Complete resume",
        description: "Every section filled in — education, one project, skills, links.",
        metric: "resume_completeness",
        metTarget: 70,
        partialTarget: 40,
      },
      {
        id: "one_project",
        label: "One project of any kind",
        description: "A course, mini, or personal project you can describe in an interview.",
        metric: "project_count",
        metTarget: 1,
        partialTarget: 1,
      },
    ],
  },
  {
    id: "mech-core_engineering",
    branch: "MECH",
    target: "core_engineering",
    label: "Placeable MECH — Core Engineering",
    summary: "Core-engineering recruiters weight domain fundamentals highest of any target — the delta here is mostly about depth, not breadth.",
    pillars: [
      {
        id: "core_domain",
        label: "Core domain fundamentals",
        description: "The highest-weighted dimension for core-engineering roles — thermodynamics, SOM, manufacturing fundamentals.",
        metric: "readiness_domain",
        metTarget: 70,
        partialTarget: 40,
      },
      {
        id: "aptitude",
        label: "Aptitude & reasoning",
        description: "Still tested in every core-engineering OA.",
        metric: "readiness_aptitude",
        metTarget: 60,
        partialTarget: 30,
      },
      {
        id: "communication",
        label: "Communication",
        description: "Clear technical explanations in the interview.",
        metric: "readiness_communication",
        metTarget: 55,
        partialTarget: 25,
      },
      {
        id: "resume_complete",
        label: "Complete resume",
        description: "Every section filled in — education, one technical project, skills, links.",
        metric: "resume_completeness",
        metTarget: 70,
        partialTarget: 40,
      },
      {
        id: "technical_project",
        label: "One technical project",
        description: "A design, simulation, or fabrication project you can walk through.",
        metric: "project_count",
        metTarget: 1,
        partialTarget: 1,
      },
    ],
  },
  {
    id: "civil-core_engineering",
    branch: "CIVIL",
    target: "core_engineering",
    label: "Placeable CIVIL — Core Engineering",
    summary: "Core-engineering recruiters weight domain fundamentals highest of any target — the delta here is mostly about depth, not breadth.",
    pillars: [
      {
        id: "core_domain",
        label: "Core domain fundamentals",
        description: "The highest-weighted dimension for core-engineering roles — structures, soil mechanics, transportation fundamentals.",
        metric: "readiness_domain",
        metTarget: 70,
        partialTarget: 40,
      },
      {
        id: "aptitude",
        label: "Aptitude & reasoning",
        description: "Still tested in every core-engineering OA.",
        metric: "readiness_aptitude",
        metTarget: 60,
        partialTarget: 30,
      },
      {
        id: "communication",
        label: "Communication",
        description: "Clear technical explanations in the interview.",
        metric: "readiness_communication",
        metTarget: 55,
        partialTarget: 25,
      },
      {
        id: "resume_complete",
        label: "Complete resume",
        description: "Every section filled in — education, one technical project, skills, links.",
        metric: "resume_completeness",
        metTarget: 70,
        partialTarget: 40,
      },
      {
        id: "technical_project",
        label: "One technical project",
        description: "A design or site-work project you can walk through.",
        metric: "project_count",
        metTarget: 1,
        partialTarget: 1,
      },
    ],
  },
  // ── ANY-branch fallback slots — one per PlacementTarget, so every
  // branch × target combination resolves to something (see getArchetype). ──
  {
    id: "any-service_it",
    branch: "ANY",
    target: "service_it",
    label: "Placeable candidate — IT Services",
    summary: "Mass recruiters weight aptitude and communication highest — this is the general shape across any branch.",
    pillars: [
      {
        id: "aptitude",
        label: "Aptitude & reasoning",
        description: "The core of every mass-recruiter OA.",
        metric: "readiness_aptitude",
        metTarget: 60,
        partialTarget: 30,
      },
      {
        id: "verbal",
        label: "Verbal ability",
        description: "Reading comprehension and grammar — the other half of most OAs.",
        metric: "readiness_verbal",
        metTarget: 55,
        partialTarget: 25,
      },
      {
        id: "communication",
        label: "Communication",
        description: "Clear, confident answers in the HR round.",
        metric: "readiness_communication",
        metTarget: 55,
        partialTarget: 25,
      },
      {
        id: "resume_complete",
        label: "Complete resume",
        description: "Every section filled in — education, one project, skills, links.",
        metric: "resume_completeness",
        metTarget: 70,
        partialTarget: 40,
      },
      {
        id: "one_project",
        label: "One project or internship",
        description: "Something concrete you can describe in an interview.",
        metric: "project_count",
        metTarget: 1,
        partialTarget: 1,
      },
    ],
  },
  {
    id: "any-product",
    branch: "ANY",
    target: "product",
    label: "Placeable candidate — Product Companies",
    summary: "Product companies weight coding depth highest of any target — the general shape across any branch.",
    pillars: [
      {
        id: "coding",
        label: "Coding ability",
        description: "Beyond fundamentals — consistently solving harder problems.",
        metric: "readiness_coding",
        metTarget: 70,
        partialTarget: 40,
      },
      {
        id: "deployed_project",
        label: "One deployed project",
        description: "At least one project with a live link or public repo.",
        metric: "deployed_project_count",
        metTarget: 1,
        partialTarget: 1,
      },
      {
        id: "tech_stack",
        label: "Working tech stack",
        description: "A tech stack broad enough to hold a conversation about.",
        metric: "tech_stack_breadth",
        metTarget: 4,
        partialTarget: 2,
      },
      {
        id: "core_domain",
        label: "Core fundamentals",
        description: "Domain fundamentals relevant to your field.",
        metric: "readiness_domain",
        metTarget: 60,
        partialTarget: 30,
      },
      {
        id: "communication",
        label: "Communication",
        description: "Can explain design decisions and trade-offs.",
        metric: "readiness_communication",
        metTarget: 55,
        partialTarget: 25,
      },
    ],
  },
  {
    id: "any-core_engineering",
    branch: "ANY",
    target: "core_engineering",
    label: "Placeable candidate — Core Engineering",
    summary: "Core-engineering recruiters weight domain fundamentals highest of any target — the general shape across any branch.",
    pillars: [
      {
        id: "core_domain",
        label: "Core domain fundamentals",
        description: "The highest-weighted dimension for core-engineering roles.",
        metric: "readiness_domain",
        metTarget: 70,
        partialTarget: 40,
      },
      {
        id: "aptitude",
        label: "Aptitude & reasoning",
        description: "Still tested in every core-engineering OA.",
        metric: "readiness_aptitude",
        metTarget: 60,
        partialTarget: 30,
      },
      {
        id: "communication",
        label: "Communication",
        description: "Clear technical explanations in the interview.",
        metric: "readiness_communication",
        metTarget: 55,
        partialTarget: 25,
      },
      {
        id: "resume_complete",
        label: "Complete resume",
        description: "Every section filled in — education, one technical project, skills, links.",
        metric: "resume_completeness",
        metTarget: 70,
        partialTarget: 40,
      },
      {
        id: "technical_project",
        label: "One technical project",
        description: "A design, simulation, or fabrication project you can walk through.",
        metric: "project_count",
        metTarget: 1,
        partialTarget: 1,
      },
    ],
  },
  {
    id: "any-bfsi",
    branch: "ANY",
    target: "bfsi",
    label: "Placeable candidate — Banking & Finance",
    summary: "BFSI recruiters weight aptitude and communication together — precision and clarity over raw coding depth.",
    pillars: [
      {
        id: "aptitude",
        label: "Aptitude & reasoning",
        description: "Quantitative accuracy under time pressure — the core of BFSI OAs.",
        metric: "readiness_aptitude",
        metTarget: 65,
        partialTarget: 35,
      },
      {
        id: "core_domain",
        label: "Core domain fundamentals",
        description: "Enough domain grounding to clear a BFSI technical/case round.",
        metric: "readiness_domain",
        metTarget: 60,
        partialTarget: 30,
      },
      {
        id: "communication",
        label: "Communication",
        description: "Precise, structured answers — BFSI interviews reward clarity.",
        metric: "readiness_communication",
        metTarget: 60,
        partialTarget: 30,
      },
      {
        id: "verbal",
        label: "Verbal ability",
        description: "Reading comprehension and grammar accuracy.",
        metric: "readiness_verbal",
        metTarget: 55,
        partialTarget: 25,
      },
      {
        id: "resume_complete",
        label: "Complete resume",
        description: "Every section filled in — education, one project, skills, links.",
        metric: "resume_completeness",
        metTarget: 70,
        partialTarget: 40,
      },
    ],
  },
  {
    id: "any-consulting",
    branch: "ANY",
    target: "consulting",
    label: "Placeable candidate — Consulting",
    summary: "Consulting recruiters weight communication highest of any target — structured thinking spoken clearly.",
    pillars: [
      {
        id: "communication",
        label: "Communication",
        description: "The highest-weighted dimension for consulting roles — structured, confident answers.",
        metric: "readiness_communication",
        metTarget: 70,
        partialTarget: 40,
      },
      {
        id: "aptitude",
        label: "Aptitude & reasoning",
        description: "Case-style quantitative reasoning under time pressure.",
        metric: "readiness_aptitude",
        metTarget: 60,
        partialTarget: 30,
      },
      {
        id: "verbal",
        label: "Verbal ability",
        description: "Reading comprehension and precise written communication.",
        metric: "readiness_verbal",
        metTarget: 60,
        partialTarget: 30,
      },
      {
        id: "resume_complete",
        label: "Complete resume",
        description: "Every section filled in, including a project or leadership activity.",
        metric: "resume_completeness",
        metTarget: 75,
        partialTarget: 45,
      },
      {
        id: "leadership_activity",
        label: "One leadership or team activity",
        description: "A club, competition, or organizing role — consulting recruiters look past pure academics.",
        metric: "extracurricular_count",
        metTarget: 1,
        partialTarget: 1,
      },
    ],
  },
  {
    id: "any-startup",
    branch: "ANY",
    target: "startup",
    label: "Placeable candidate — Startups",
    summary: "Startups hire for range and shipping speed — breadth and a complete resume story, across any branch.",
    pillars: [
      {
        id: "coding",
        label: "Practical, hands-on ability",
        description: "Can produce working output under time pressure, not just recognize the right answer.",
        metric: "readiness_coding",
        metTarget: 55,
        partialTarget: 25,
      },
      {
        id: "shipped_project",
        label: "A shipped, deployed project",
        description: "Something live that a founder could click on today.",
        metric: "deployed_project_count",
        metTarget: 1,
        partialTarget: 1,
      },
      {
        id: "broad_stack",
        label: "Broad tech stack",
        description: "Comfort across more of the stack — startups rarely hire for one narrow skill.",
        metric: "tech_stack_breadth",
        metTarget: 4,
        partialTarget: 2,
      },
      {
        id: "resume_story",
        label: "Resume tells a complete story",
        description: "Every section filled in — education, projects, skills, links.",
        metric: "resume_completeness",
        metTarget: 80,
        partialTarget: 50,
      },
      {
        id: "communication",
        label: "Communication",
        description: "Can pitch a project in two sentences, then go deep on request.",
        metric: "readiness_communication",
        metTarget: 55,
        partialTarget: 25,
      },
    ],
  },
];

// Every PlacementTarget must have an "ANY" fallback slot — getArchetype relies
// on this to guarantee resolution for any branch × target combination. Fails
// loudly at module load if a future edit removes one, rather than silently
// falling through to `undefined` at request time.
const ANY_TARGETS = new Set(ARCHETYPES.filter((a) => a.branch === "ANY").map((a) => a.target));
const ALL_TARGETS: PlacementTarget[] = [
  "service_it",
  "product",
  "core_engineering",
  "bfsi",
  "consulting",
  "startup",
];
for (const target of ALL_TARGETS) {
  if (!ANY_TARGETS.has(target)) {
    throw new Error(`archetypes.ts: missing "ANY" fallback archetype for target "${target}"`);
  }
}

/**
 * Resolve the archetype for a student's branch × target. Exact branch+target
 * match first, then the branch-agnostic "ANY" slot for that target — always
 * resolves (see the module-load assertion above).
 */
export function getArchetype(branch: string, target: PlacementTarget): Archetype {
  const exact = ARCHETYPES.find((a) => a.branch === branch && a.target === target);
  if (exact) return exact;
  const fallback = ARCHETYPES.find((a) => a.branch === "ANY" && a.target === target);
  // Unreachable given the module-load assertion above; satisfies the type checker.
  return fallback as Archetype;
}

export function listArchetypes(): Archetype[] {
  return ARCHETYPES;
}

// ─── Delta computation ──────────────────────────────────────────────────────

export interface SkillGapResumeProject {
  github_url: string | null;
  live_url: string | null;
}

export interface SkillGapResumeData {
  technical_skills?: {
    languages?: string[];
    frameworks?: string[];
    tools?: string[];
  } | null;
  projects?: SkillGapResumeProject[] | null;
  achievements?: unknown[] | null;
}

export type SkillGapProfile = Pick<
  StudentPlacementProfile,
  | "readiness_aptitude"
  | "readiness_verbal"
  | "readiness_domain"
  | "readiness_coding"
  | "readiness_communication"
  | "resume_completeness"
> & {
  resume_data: SkillGapResumeData | null;
};

export type PillarStatus = "met" | "partial" | "gap";

export type SkillGapRemedy =
  | { kind: "track"; label: string; href: string }
  | { kind: "resume"; label: string; href: string }
  | { kind: "phase2"; label: string };

export interface SkillGapPillarResult {
  id: string;
  label: string;
  description: string;
  status: PillarStatus;
  value: number;
  valueLabel: string;
  target: number;
  targetLabel: string;
  remedy: SkillGapRemedy;
}

export interface SkillGapReport {
  archetype: Archetype;
  pillars: SkillGapPillarResult[];
  metCount: number;
  partialCount: number;
  gapCount: number;
}

function metricValue(profile: SkillGapProfile, metric: PillarMetricKind): number {
  switch (metric) {
    case "readiness_aptitude":
      return profile.readiness_aptitude;
    case "readiness_verbal":
      return profile.readiness_verbal;
    case "readiness_domain":
      return profile.readiness_domain;
    case "readiness_coding":
      return profile.readiness_coding;
    case "readiness_communication":
      return profile.readiness_communication;
    case "resume_completeness":
      return profile.resume_completeness;
    case "project_count":
      return (profile.resume_data?.projects ?? []).length;
    case "deployed_project_count":
      return (profile.resume_data?.projects ?? []).filter((p) => Boolean(p.github_url || p.live_url)).length;
    case "tech_stack_breadth": {
      const ts = profile.resume_data?.technical_skills;
      return (ts?.languages?.length ?? 0) + (ts?.frameworks?.length ?? 0) + (ts?.tools?.length ?? 0);
    }
    case "extracurricular_count":
      return (profile.resume_data?.achievements ?? []).length;
  }
}

function pillarStatus(value: number, pillar: ArchetypePillar): PillarStatus {
  if (value >= pillar.metTarget) return "met";
  if (value >= pillar.partialTarget) return "partial";
  return "gap";
}

function formatValueLabel(metric: PillarMetricKind, value: number): string {
  if (PERCENT_METRICS.has(metric)) return `${value}/100`;
  if (metric === "project_count" || metric === "deployed_project_count") {
    return `${value} project${value === 1 ? "" : "s"}`;
  }
  if (metric === "tech_stack_breadth") return `${value} skill${value === 1 ? "" : "s"}`;
  if (metric === "extracurricular_count") return `${value}`;
  return `${value}`;
}

function formatTargetLabel(metric: PillarMetricKind, target: number): string {
  if (PERCENT_METRICS.has(metric)) return `Target ${target}/100`;
  return `Target ${target}`;
}

function pillarRemedy(pillar: ArchetypePillar): SkillGapRemedy {
  const dimension = READINESS_METRIC_TO_DIMENSION[pillar.metric];
  if (dimension) {
    return { kind: "track", label: `Practice ${DIMENSION_LABELS[dimension]}`, href: DIMENSION_HREF[dimension] };
  }
  if (
    pillar.metric === "resume_completeness" ||
    pillar.metric === "project_count" ||
    pillar.metric === "deployed_project_count" ||
    pillar.metric === "tech_stack_breadth"
  ) {
    return { kind: "resume", label: "Update your resume", href: "/student/placement/resume" };
  }
  // extracurricular_count: this build has no hackathon/competition-tracking
  // feature — the honest remedy is guided upskilling (Stage 0), which is
  // Phase-2 (SPEC §7/§11), not a "go update this form" dead end.
  return { kind: "phase2", label: "Guided upskilling — coming in your next stage" };
}

/**
 * Compute the delta between a student's current data and an archetype's
 * capability pillars. Pure, read-only, no AI, no I/O.
 */
export function computeSkillGap(profile: SkillGapProfile, archetype: Archetype): SkillGapReport {
  const pillars: SkillGapPillarResult[] = archetype.pillars.map((pillar) => {
    const value = metricValue(profile, pillar.metric);
    const status = pillarStatus(value, pillar);
    return {
      id: pillar.id,
      label: pillar.label,
      description: pillar.description,
      status,
      value,
      valueLabel: formatValueLabel(pillar.metric, value),
      target: pillar.metTarget,
      targetLabel: formatTargetLabel(pillar.metric, pillar.metTarget),
      remedy: pillarRemedy(pillar),
    };
  });

  return {
    archetype,
    pillars,
    metCount: pillars.filter((p) => p.status === "met").length,
    partialCount: pillars.filter((p) => p.status === "partial").length,
    gapCount: pillars.filter((p) => p.status === "gap").length,
  };
}
