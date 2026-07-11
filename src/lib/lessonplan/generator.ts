// ============================================================================
// Lesson Plan — AI generation + validation gate
//
// One routeAI("lesson_plan_gen", …) call PER THEORY MODULE, and one call for
// the whole practicals list (spec §4). Theory modules run with a concurrency
// window of 4 (mirrors qbank/generator.ts). Every call passes a NARROW
// responseSchema (only the free-text fields, maxLength-bounded — §19) and, via
// the isStructuredTask allowlist, thinkingBudget:0.
//
// The AI NEVER decides the session count: the deterministic skeleton (skeleton.ts)
// fixes how many sessions exist and their global numbering; the model only fills
// pedagogical content into those exact stubs. The validation gate then reconciles
// the AI output against the skeleton and strips/clamps anything invalid, emitting
// warnings (never silent coercion — §19).
// ============================================================================

import { routeAI } from "@/lib/ai/router";
import { createAdminClient } from "@/lib/db/supabase-server";
import { validateCoOrNull } from "@/lib/qpaper/sectionGen";
import type { AILogContext } from "@/lib/ai/providers/types";
import {
  buildTheorySkeleton,
  buildPracticalSkeleton,
  type SkeletonModule,
  type TheorySessionStub,
} from "./skeleton";
import type {
  TheorySession,
  PracticalSession,
  TeachingMethod,
  LessonPlanWarning,
  TheoryCachePayload,
  PracticalCachePayload,
} from "./types";

// ─── Context ────────────────────────────────────────────────────────────────

export interface LpModule {
  id: string;
  module_number: number;
  name: string;
  description: string;
  hours: number | null;
  weightage_percent: number | null;
  btl_levels: number[]; // parsed to ints 1–6
  coCodes: string[]; // from module_co_mapping (validated against subject COs)
}

export interface LpCourseOutcome {
  co_code: string;
  description: string;
}

export interface LpPractical {
  sr_no: number;
  name: string;
  hours: number | null;
}

export interface LessonPlanContext {
  subjectId: string;
  subjectName: string;
  subjectCode: string | null;
  modules: LpModule[];
  courseOutcomes: LpCourseOutcome[];
  practicals: LpPractical[];
}

const CONCURRENCY = 4;

const ALLOWED_METHODS: TeachingMethod[] = [
  "lecture_board",
  "demo",
  "problem_solving",
  "activity",
  "flipped",
  "discussion",
];

const DEFAULT_BTL_LEVELS = [1, 2, 3];

const BTL_LABEL_TO_LEVEL: Record<string, number> = {
  remember: 1,
  understand: 2,
  apply: 3,
  analyze: 4,
  analyse: 4,
  evaluate: 5,
  create: 6,
};

/** Parse a modules.btl_levels text[] into distinct ints 1–6. */
function parseBtlLevels(raw: unknown): number[] {
  if (!Array.isArray(raw) || raw.length === 0) return [...DEFAULT_BTL_LEVELS];
  const out = new Set<number>();
  for (const item of raw as Array<string | number>) {
    if (typeof item === "number" && item >= 1 && item <= 6) {
      out.add(Math.trunc(item));
      continue;
    }
    const s = String(item).trim().toLowerCase();
    const n = Number(s.replace(/[^0-9]/g, ""));
    if (Number.isFinite(n) && n >= 1 && n <= 6) {
      out.add(n);
      continue;
    }
    if (BTL_LABEL_TO_LEVEL[s] != null) out.add(BTL_LABEL_TO_LEVEL[s]);
  }
  return out.size > 0
    ? Array.from(out).sort((a, b) => a - b)
    : [...DEFAULT_BTL_LEVELS];
}

/**
 * Load everything the generator needs for one subject via the admin client
 * (server-only; bypasses RLS — the API route does the faculty-assignment check).
 * Also used by the test harness.
 */
export async function loadLessonPlanContext(
  subjectId: string,
): Promise<LessonPlanContext> {
  const admin = createAdminClient();

  const { data: subjectRow } = await admin
    .from("subjects")
    .select("name, code")
    .eq("id", subjectId)
    .maybeSingle();

  const { data: moduleRows } = await admin
    .from("modules")
    .select("id, module_number, name, description, hours, weightage_percent, btl_levels")
    .eq("subject_id", subjectId)
    .order("module_number");

  const { data: coRows } = await admin
    .from("course_outcomes")
    .select("co_code, description")
    .eq("subject_id", subjectId);

  const { data: contentRow } = await admin
    .from("subject_content")
    .select("practicals")
    .eq("subject_id", subjectId)
    .maybeSingle();

  const moduleIds = (moduleRows ?? []).map((m) => (m as { id: string }).id);
  const { data: mcoRows } = moduleIds.length
    ? await admin
        .from("module_co_mapping")
        .select("module_id, co_code")
        .in("module_id", moduleIds)
    : { data: [] as { module_id: string; co_code: string }[] };

  const coByModule = new Map<string, string[]>();
  for (const r of (mcoRows ?? []) as { module_id: string; co_code: string }[]) {
    const list = coByModule.get(r.module_id) ?? [];
    list.push(r.co_code);
    coByModule.set(r.module_id, list);
  }

  const modules: LpModule[] = (moduleRows ?? []).map((m) => {
    const row = m as {
      id: string;
      module_number: number;
      name: string;
      description: string | null;
      hours: number | null;
      weightage_percent: number | null;
      btl_levels: string[] | null;
    };
    return {
      id: row.id,
      module_number: row.module_number,
      name: row.name,
      description: row.description ?? "",
      hours: row.hours,
      weightage_percent: row.weightage_percent,
      btl_levels: parseBtlLevels(row.btl_levels),
      coCodes: coByModule.get(row.id) ?? [],
    };
  });

  const practicalsRaw = (contentRow as { practicals?: unknown } | null)
    ?.practicals;
  const practicals: LpPractical[] = Array.isArray(practicalsRaw)
    ? (practicalsRaw as Array<{ sr_no?: number; name?: string; hours?: number }>)
        .filter((p) => p && typeof p.name === "string")
        .map((p, i) => ({
          sr_no: typeof p.sr_no === "number" ? p.sr_no : i + 1,
          name: String(p.name).trim(),
          hours: typeof p.hours === "number" ? p.hours : null,
        }))
    : [];

  return {
    subjectId,
    subjectName: (subjectRow as { name?: string } | null)?.name ?? "this subject",
    subjectCode: (subjectRow as { code?: string | null } | null)?.code ?? null,
    modules,
    courseOutcomes: (coRows ?? []) as LpCourseOutcome[],
    practicals,
  };
}

// ─── Prompts ─────────────────────────────────────────────────────────────────

const THEORY_SYSTEM_PROMPT =
  "You are a senior professor and pedagogy designer for Indian technical " +
  "universities (AICTE/NBA course files). You design session-wise lesson plans " +
  "that are concrete, classroom-ready, and outcome-based. You write for a fellow " +
  "faculty member: specific methods, specific misconceptions, no filler. You " +
  "NEVER decide how many sessions there are — the session slots are given to you " +
  "and you fill each one. Output must obey the provided JSON schema exactly.";

/** ≤100-char one-line digest of every module (cross-module context). */
function buildModuleDigest(modules: LpModule[]): string {
  return modules
    .map((m) => {
      const topics = m.description.replace(/\s+/g, " ").trim();
      const line = `Module ${m.module_number} (${m.name}): ${topics}`;
      return line.length > 100 ? `${line.slice(0, 97)}…` : line;
    })
    .join("\n");
}

function buildTheoryModulePrompt(
  ctx: LessonPlanContext,
  module: LpModule,
  stubs: TheorySessionStub[],
  customInstruction: string | undefined,
): string {
  const coDescriptions = ctx.courseOutcomes.filter((c) =>
    module.coCodes.includes(c.co_code),
  );
  const coBlock =
    coDescriptions.length > 0
      ? coDescriptions.map((c) => `  ${c.co_code}: ${c.description}`).join("\n")
      : "  (no CO mapping recorded for this module)";

  const sessionNumbers = stubs.map((s) => s.sessionNo).join(", ");

  const instructionBlock = customInstruction?.trim()
    ? `\n<binding_faculty_instruction>\nThe assigned faculty gave this instruction for THIS module. Treat it as BINDING — follow it exactly:\n${customInstruction.trim()}\n</binding_faculty_instruction>\n`
    : "";

  return `Subject: ${ctx.subjectName}${ctx.subjectCode ? ` (${ctx.subjectCode})` : ""}

<all_modules_digest>
${buildModuleDigest(ctx.modules)}
</all_modules_digest>

<focus_module>
Module number: ${module.module_number}
Name: ${module.name}
Full description / topics: ${module.description || "(none provided)"}
Teaching hours: ${module.hours ?? "(unspecified)"}
Weightage: ${module.weightage_percent != null ? `${module.weightage_percent}%` : "(unspecified)"}
Allowed BTL levels (Bloom, 1=Remember … 6=Create): ${module.btl_levels.join(", ")}
Course Outcomes this module teaches toward:
${coBlock}
</focus_module>
${instructionBlock}
<sessions_to_fill>
You MUST return exactly ${stubs.length} session object(s), one per session number below, and nothing else:
Session numbers: ${sessionNumbers}
</sessions_to_fill>

RULES (follow every one):
1. Sequence topics pedagogically — prerequisites first, within this module only.
2. Every distinct topic fragment in the module description must appear in exactly
   ONE session's topics[]. Do not drop a topic and do not invent topics not in the
   description. Each session carries 1–3 topic fragments.
3. objective: a single measurable sentence phrased as a student outcome, using a
   verb that matches that session's BTL level.
4. coCodes: choose only from the module's CO codes listed above.
5. btl: an integer within the allowed BTL levels above.
6. method: vary across this module's sessions — do NOT make them all
   "lecture_board". Choose from: lecture_board, demo, problem_solving, activity,
   flipped, discussion.
7. methodNote (≤120 chars): concretely HOW to run this session.
8. misconception (≤140 chars): ONE specific student misconception for this
   session's content — specific, e.g. "students confuse O(log n) growth with
   halving the input just once", never generic like "students find this hard".
9. examNote (≤120 chars): a PYQ / exam-weightage note ONLY when genuinely
   defensible from the weightage or typical exam patterns; otherwise omit it.
10. Output JSON only, conforming to the schema.`;
}

// Narrow schema — ONLY the free-text fields, maxLength-bounded (§19). moduleNumber
// is fixed by code; sessionNo pins each object to a skeleton stub.
const THEORY_RESPONSE_SCHEMA = {
  type: "array",
  items: {
    type: "object",
    properties: {
      sessionNo: { type: "integer" },
      topics: {
        type: "array",
        items: { type: "string", maxLength: 120 },
        minItems: 1,
        maxItems: 3,
      },
      objective: { type: "string", maxLength: 220 },
      coCodes: { type: "array", items: { type: "string", maxLength: 12 } },
      btl: { type: "integer" },
      method: { type: "string", maxLength: 20 },
      methodNote: { type: "string", maxLength: 120 },
      misconception: { type: "string", maxLength: 140 },
      examNote: { type: "string", maxLength: 120 },
    },
    required: [
      "sessionNo",
      "topics",
      "objective",
      "coCodes",
      "btl",
      "method",
      "methodNote",
      "misconception",
    ],
  },
};

const PRACTICAL_SYSTEM_PROMPT =
  "You are a senior professor designing the laboratory plan for an AICTE/NBA " +
  "course file at an Indian technical university. For each practical you write a " +
  "concrete lab-prep note, an assessment hint for the standard 10-mark rubric, and " +
  "one representative viva question. Be specific to the practical's title. Output " +
  "must obey the provided JSON schema exactly.";

function buildPracticalPrompt(
  ctx: LessonPlanContext,
  practicals: { practicalNo: number; title: string; hours: number }[],
): string {
  const coBlock =
    ctx.courseOutcomes.length > 0
      ? ctx.courseOutcomes
          .map((c) => `  ${c.co_code}: ${c.description}`)
          .join("\n")
      : "  (no course outcomes recorded)";

  const listBlock = practicals
    .map((p) => `  #${p.practicalNo} (${p.hours}h): ${p.title}`)
    .join("\n");

  return `Subject: ${ctx.subjectName}${ctx.subjectCode ? ` (${ctx.subjectCode})` : ""}

<course_outcomes>
${coBlock}
</course_outcomes>

<practicals>
You MUST return exactly ${practicals.length} object(s), one per practical number below:
${listBlock}
</practicals>

For EACH practical above, return:
- practicalNo: the practical number (echo it back).
- coCodes: the CO code(s) this practical develops — choose only from the list above.
- prepNote (≤140 chars): setup / dataset / a specific pitfall students hit in this lab.
- assessmentHint (≤120 chars): what to evaluate in the 10-mark rubric for this lab.
- vivaSeed (≤200 chars): one representative viva question for this practical.

Output JSON only, conforming to the schema. Do not restate the title or hours.`;
}

const PRACTICAL_RESPONSE_SCHEMA = {
  type: "array",
  items: {
    type: "object",
    properties: {
      practicalNo: { type: "integer" },
      coCodes: { type: "array", items: { type: "string", maxLength: 12 } },
      prepNote: { type: "string", maxLength: 140 },
      assessmentHint: { type: "string", maxLength: 120 },
      vivaSeed: { type: "string", maxLength: 200 },
    },
    required: ["practicalNo", "coCodes", "prepNote", "assessmentHint", "vivaSeed"],
  },
};

// ─── JSON helpers ─────────────────────────────────────────────────────────────

function parseJsonArray(text: string): Record<string, unknown>[] | null {
  const trimmed = text.trim();
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed as Record<string, unknown>[];
  } catch {
    // fall through to bracket salvage
  }
  const start = trimmed.indexOf("[");
  const end = trimmed.lastIndexOf("]");
  if (start !== -1 && end > start) {
    try {
      const parsed = JSON.parse(trimmed.slice(start, end + 1));
      if (Array.isArray(parsed)) return parsed as Record<string, unknown>[];
    } catch {
      /* give up */
    }
  }
  return null;
}

function str(v: unknown, max: number): string {
  const s = typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
  return s.length > max ? s.slice(0, max) : s;
}

function normalizeMethod(v: unknown): {
  method: TeachingMethod;
  defaulted: boolean;
} {
  const s = String(v ?? "").toLowerCase().trim().replace(/[\s-]+/g, "_");
  if ((ALLOWED_METHODS as string[]).includes(s)) {
    return { method: s as TeachingMethod, defaulted: false };
  }
  return { method: "lecture_board", defaulted: true };
}

// ─── Topic-coverage fuzzy check ────────────────────────────────────────────────

const STOPWORDS = new Set([
  "the", "and", "for", "with", "into", "from", "this", "that", "using", "use",
  "its", "are", "was", "not", "but", "all", "any", "how", "why", "what", "when",
  "their", "your", "you", "our", "will", "can", "may", "such", "via", "per",
  "about", "over", "under", "between", "within", "each", "other", "than", "then",
  "also", "these", "those", "which", "who", "whom", "have", "has", "had", "them",
]);

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

/** Split a module description into candidate topic fragments. */
function splitDescriptionFragments(description: string): string[] {
  return description
    .split(/[;\n,•·]|(?: [-–—] )/)
    .map((f) => f.trim())
    .filter((f) => f.length >= 4);
}

/** A fragment is "covered" if ≥60% of its content tokens appear in the topics text. */
function isFragmentCovered(fragment: string, topicsTokenSet: Set<string>): boolean {
  const fragTokens = tokenize(fragment);
  if (fragTokens.length === 0) return true;
  const hit = fragTokens.filter((t) => topicsTokenSet.has(t)).length;
  return hit / fragTokens.length >= 0.6;
}

// ─── Validation gate helpers (shared by full-module + single-session regen) ─────

/** Clamp a BTL value to the module's nearest allowed level. */
function clampBtlToModule(
  raw: unknown,
  allowedBtl: number[],
): { btl: number; clamped: boolean } {
  const n = Math.trunc(Number(raw));
  if (Number.isFinite(n) && allowedBtl.includes(n)) return { btl: n, clamped: false };
  const nearest = allowedBtl.reduce(
    (best, lvl) => (Math.abs(lvl - n) < Math.abs(best - n) ? lvl : best),
    allowedBtl[0] ?? 1,
  );
  return { btl: nearest, clamped: true };
}

/** Placeholder session for a stub the AI didn't return (or that failed). */
function emptyTheorySession(module: LpModule, sessionNo: number): TheorySession {
  return {
    sessionNo,
    moduleNumber: module.module_number,
    topics: [],
    objective: "",
    coCodes: module.coCodes.slice(0, 1),
    btl: module.btl_levels[0] ?? 1,
    method: "lecture_board",
    methodNote: "",
    misconception: "",
    examNote: null,
  };
}

/**
 * Build one validated TheorySession from a raw AI object, pushing any
 * strip/clamp/default warnings. Shared by the full-module gate and single-session
 * regen so both paths validate identically.
 */
function buildOneTheorySession(
  module: LpModule,
  sessionNo: number,
  row: Record<string, unknown>,
  validCoCodes: string[],
  warnings: LessonPlanWarning[],
): TheorySession {
  const allowedBtl = module.btl_levels;

  const topics = Array.isArray(row.topics)
    ? (row.topics as unknown[]).map((t) => str(t, 120)).filter(Boolean).slice(0, 3)
    : [];

  // CO validation (validateCoOrNull gate — strip invalid, warn)
  const rawCos = Array.isArray(row.coCodes) ? (row.coCodes as unknown[]) : [];
  const validCos: string[] = [];
  for (const c of rawCos) {
    const valid = validateCoOrNull(String(c), validCoCodes);
    if (valid && !validCos.includes(valid)) validCos.push(valid);
    else if (!valid && String(c).trim()) {
      warnings.push({
        moduleNumber: module.module_number,
        kind: "co_stripped",
        message: `Session ${sessionNo}: invalid CO "${String(c).trim()}" removed.`,
      });
    }
  }
  if (validCos.length === 0) {
    const fallback = module.coCodes.slice(0, 1);
    if (fallback.length) validCos.push(...fallback);
    warnings.push({
      moduleNumber: module.module_number,
      kind: "co_empty",
      message: `Session ${sessionNo}: no valid CO from AI — defaulted to ${fallback[0] ?? "none"}.`,
    });
  }

  const { btl, clamped } = clampBtlToModule(row.btl, allowedBtl);
  if (clamped) {
    warnings.push({
      moduleNumber: module.module_number,
      kind: "btl_clamped",
      message: `Session ${sessionNo}: BTL ${row.btl} outside allowed [${allowedBtl.join(",")}] — set to ${btl}.`,
    });
  }

  const { method, defaulted } = normalizeMethod(row.method);
  if (defaulted && row.method) {
    warnings.push({
      moduleNumber: module.module_number,
      kind: "method_defaulted",
      message: `Session ${sessionNo}: unknown method "${String(row.method)}" — set to lecture_board.`,
    });
  }

  const examNoteStr = str(row.examNote, 120);

  return {
    sessionNo,
    moduleNumber: module.module_number,
    topics,
    objective: str(row.objective, 220),
    coCodes: validCos,
    btl,
    method,
    methodNote: str(row.methodNote, 120),
    misconception: str(row.misconception, 140),
    examNote: examNoteStr || null,
  };
}

// ─── Validation gate: one theory module ────────────────────────────────────────

function validateTheoryModule(
  module: LpModule,
  stubs: TheorySessionStub[],
  aiRaw: Record<string, unknown>[],
  validCoCodes: string[],
): { sessions: TheorySession[]; warnings: LessonPlanWarning[] } {
  const warnings: LessonPlanWarning[] = [];
  const byNo = new Map<number, Record<string, unknown>>();
  for (const row of aiRaw) {
    const n = Number(row.sessionNo);
    if (Number.isFinite(n)) byNo.set(n, row);
  }

  const sessions: TheorySession[] = stubs.map((stub) => {
    const row = byNo.get(stub.sessionNo);
    if (!row) {
      warnings.push({
        moduleNumber: module.module_number,
        kind: "session_missing",
        message: `Session ${stub.sessionNo} (Module ${module.module_number}) was not generated — fill it in manually.`,
      });
      return emptyTheorySession(module, stub.sessionNo);
    }
    return buildOneTheorySession(module, stub.sessionNo, row, validCoCodes, warnings);
  });

  // drop-warnings for AI sessions that don't map to any stub
  const stubNos = new Set(stubs.map((s) => s.sessionNo));
  for (const n of byNo.keys()) {
    if (!stubNos.has(n)) {
      warnings.push({
        moduleNumber: module.module_number,
        kind: "session_dropped",
        message: `AI returned an unexpected session ${n} for Module ${module.module_number} — dropped.`,
      });
    }
  }

  // topic-coverage check
  const topicsTokenSet = new Set(
    sessions.flatMap((s) => s.topics).flatMap((t) => tokenize(t)),
  );
  for (const frag of splitDescriptionFragments(module.description)) {
    if (!isFragmentCovered(frag, topicsTokenSet)) {
      warnings.push({
        moduleNumber: module.module_number,
        kind: "uncovered_topic",
        message: `Not scheduled in any session: "${frag}"`,
        fragment: frag,
      });
    }
  }

  return { sessions, warnings };
}

// ─── Public: generate theory section ───────────────────────────────────────────

export async function generateTheorySection(
  ctx: LessonPlanContext,
  hoursOverride: Record<number, number> | null,
  moduleInstructions: Record<number, string> | undefined,
  logContext: AILogContext,
): Promise<TheoryCachePayload> {
  const skeletonModules: SkeletonModule[] = ctx.modules.map((m) => ({
    module_number: m.module_number,
    hours: m.hours,
  }));
  const skeleton = buildTheorySkeleton(skeletonModules, hoursOverride);

  // group skeleton stubs by module
  const stubsByModule = new Map<number, TheorySessionStub[]>();
  for (const stub of skeleton.sessions) {
    const list = stubsByModule.get(stub.moduleNumber) ?? [];
    list.push(stub);
    stubsByModule.set(stub.moduleNumber, list);
  }

  const validCoCodes = ctx.courseOutcomes.map((c) => c.co_code);
  const modulesInOrder = [...ctx.modules].sort(
    (a, b) => a.module_number - b.module_number,
  );

  const perModule: { sessions: TheorySession[]; warnings: LessonPlanWarning[] }[] =
    [];

  for (let i = 0; i < modulesInOrder.length; i += CONCURRENCY) {
    const window = modulesInOrder.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      window.map(async (module) => {
        const stubs = stubsByModule.get(module.module_number) ?? [];
        if (stubs.length === 0) {
          return { sessions: [] as TheorySession[], warnings: [] as LessonPlanWarning[] };
        }
        const prompt = buildTheoryModulePrompt(
          ctx,
          module,
          stubs,
          moduleInstructions?.[module.module_number],
        );
        try {
          const res = await routeAI("lesson_plan_gen", {
            model: "flash",
            messages: [{ role: "user", content: prompt }],
            systemPrompt: THEORY_SYSTEM_PROMPT,
            temperature: 0.5,
            responseSchema: THEORY_RESPONSE_SCHEMA,
            thinkingBudget: 0,
            logContext: {
              ...logContext,
              metadata: {
                ...(logContext.metadata ?? {}),
                section: "theory",
                moduleNumber: module.module_number,
                sessionCount: stubs.length,
              },
            },
          });
          const arr = parseJsonArray(String(res.content ?? "")) ?? [];
          return validateTheoryModule(module, stubs, arr, validCoCodes);
        } catch (err) {
          const message = err instanceof Error ? err.message : "unknown error";
          console.warn(
            `[lessonplan theory] module ${module.module_number} failed: ${message}`,
          );
          // still return skeleton-aligned empty sessions + a missing warning each
          return validateTheoryModule(module, stubs, [], validCoCodes);
        }
      }),
    );
    perModule.push(...results);
  }

  const sessions = perModule
    .flatMap((r) => r.sessions)
    .sort((a, b) => a.sessionNo - b.sessionNo);
  const warnings = perModule.flatMap((r) => r.warnings);

  return { sessions, warnings, defaultedModules: skeleton.defaultedModules };
}

// ─── Public: generate practical section ────────────────────────────────────────

export async function generatePracticalSection(
  ctx: LessonPlanContext,
  logContext: AILogContext,
): Promise<PracticalCachePayload> {
  const skeleton = buildPracticalSkeleton(
    ctx.practicals.map((p) => ({ sr_no: p.sr_no, name: p.name, hours: p.hours })),
  );
  if (skeleton.practicals.length === 0) {
    return { practicals: [], warnings: [] };
  }

  const validCoCodes = ctx.courseOutcomes.map((c) => c.co_code);
  const prompt = buildPracticalPrompt(ctx, skeleton.practicals);
  const warnings: LessonPlanWarning[] = [];

  let aiRaw: Record<string, unknown>[] = [];
  try {
    const res = await routeAI("lesson_plan_gen", {
      model: "flash",
      messages: [{ role: "user", content: prompt }],
      systemPrompt: PRACTICAL_SYSTEM_PROMPT,
      temperature: 0.5,
      responseSchema: PRACTICAL_RESPONSE_SCHEMA,
      thinkingBudget: 0,
      logContext: {
        ...logContext,
        metadata: {
          ...(logContext.metadata ?? {}),
          section: "practical",
          practicalCount: skeleton.practicals.length,
        },
      },
    });
    aiRaw = parseJsonArray(String(res.content ?? "")) ?? [];
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    console.warn(`[lessonplan practical] generation failed: ${message}`);
  }

  const byNo = new Map<number, Record<string, unknown>>();
  for (const row of aiRaw) {
    const n = Number(row.practicalNo);
    if (Number.isFinite(n)) byNo.set(n, row);
  }

  const practicals: PracticalSession[] = skeleton.practicals.map((stub) => {
    const row = byNo.get(stub.practicalNo);
    if (!row) {
      warnings.push({
        moduleNumber: null,
        kind: "session_missing",
        message: `Practical #${stub.practicalNo} ("${stub.title}") was not generated — fill it in manually.`,
      });
      return {
        practicalNo: stub.practicalNo,
        title: stub.title,
        hours: stub.hours,
        coCodes: [],
        prepNote: "",
        assessmentHint: "",
        vivaSeed: "",
      };
    }

    const rawCos = Array.isArray(row.coCodes) ? (row.coCodes as unknown[]) : [];
    const validCos: string[] = [];
    for (const c of rawCos) {
      const valid = validateCoOrNull(String(c), validCoCodes);
      if (valid && !validCos.includes(valid)) validCos.push(valid);
      else if (!valid && String(c).trim()) {
        warnings.push({
          moduleNumber: null,
          kind: "co_stripped",
          message: `Practical #${stub.practicalNo}: invalid CO "${String(c).trim()}" removed.`,
        });
      }
    }

    return {
      practicalNo: stub.practicalNo,
      title: stub.title, // verbatim from skeleton, never from AI
      hours: stub.hours,
      coCodes: validCos,
      prepNote: str(row.prepNote, 140),
      assessmentHint: str(row.assessmentHint, 120),
      vivaSeed: str(row.vivaSeed, 200),
    };
  });

  return { practicals, warnings };
}

// ─── Single-session / single-practical regeneration (ReviewStage "↻") ──────────

const SINGLE_THEORY_SCHEMA = {
  type: "object",
  properties: {
    topics: {
      type: "array",
      items: { type: "string", maxLength: 120 },
      minItems: 1,
      maxItems: 3,
    },
    objective: { type: "string", maxLength: 220 },
    coCodes: { type: "array", items: { type: "string", maxLength: 12 } },
    btl: { type: "integer" },
    method: { type: "string", maxLength: 20 },
    methodNote: { type: "string", maxLength: 120 },
    misconception: { type: "string", maxLength: 140 },
    examNote: { type: "string", maxLength: 120 },
  },
  required: [
    "topics",
    "objective",
    "coCodes",
    "btl",
    "method",
    "methodNote",
    "misconception",
  ],
};

export interface RegenerateTheoryInput {
  moduleNumber: number;
  sessionNo: number;
  /** Topics currently assigned to other sessions in this module (avoid duplicating). */
  siblingTopics: string[];
  /** The session's current content, so the model refines rather than starts blind. */
  current?: Partial<TheorySession>;
  /** Optional one-line faculty instruction (BINDING). */
  instruction?: string;
}

/**
 * Regenerate ONE theory session (same task, session-scoped prompt). Returns the
 * validated session + any warnings. Throws only on a total AI failure so the
 * route can surface it; the caller keeps the old session on error.
 */
export async function regenerateTheorySession(
  ctx: LessonPlanContext,
  input: RegenerateTheoryInput,
  logContext: AILogContext,
): Promise<{ session: TheorySession; warnings: LessonPlanWarning[] }> {
  const mod = ctx.modules.find(
    (m) => m.module_number === input.moduleNumber,
  );
  if (!mod) {
    throw new Error(`Module ${input.moduleNumber} not found for this subject`);
  }
  const validCoCodes = ctx.courseOutcomes.map((c) => c.co_code);

  const coDescriptions = ctx.courseOutcomes.filter((c) =>
    mod.coCodes.includes(c.co_code),
  );
  const coBlock =
    coDescriptions.length > 0
      ? coDescriptions.map((c) => `  ${c.co_code}: ${c.description}`).join("\n")
      : "  (no CO mapping recorded for this module)";

  const siblingBlock = input.siblingTopics.length
    ? input.siblingTopics.map((t) => `  - ${t}`).join("\n")
    : "  (none)";

  const currentBlock = input.current
    ? `Current draft of this session (improve on it):
  topics: ${(input.current.topics ?? []).join(" | ") || "(none)"}
  objective: ${input.current.objective ?? "(none)"}
  method: ${input.current.method ?? "(none)"}`
    : "(no current draft)";

  const instructionBlock = input.instruction?.trim()
    ? `\n<binding_instruction>\nThe faculty gave this instruction for this ONE session — treat it as BINDING:\n${input.instruction.trim()}\n</binding_instruction>\n`
    : "";

  const prompt = `Subject: ${ctx.subjectName}${ctx.subjectCode ? ` (${ctx.subjectCode})` : ""}

<module>
Module ${mod.module_number}: ${mod.name}
Full description / topics: ${mod.description || "(none provided)"}
Allowed BTL levels: ${mod.btl_levels.join(", ")}
Course Outcomes:
${coBlock}
</module>

<already_covered_in_other_sessions>
Do NOT repeat these topics — they belong to other sessions of this module:
${siblingBlock}
</already_covered_in_other_sessions>

${currentBlock}
${instructionBlock}
Rewrite session ${input.sessionNo} of this module as a SINGLE session object.
Rules:
- 1–3 topic fragments from THIS module's description, not already covered above.
- objective: one measurable sentence matching the chosen BTL.
- btl: an integer within the allowed BTL levels.
- method: one of lecture_board, demo, problem_solving, activity, flipped, discussion.
- methodNote (≤120), misconception (≤140, specific), examNote (≤120, only if defensible else omit).
Output a single JSON object conforming to the schema.`;

  const res = await routeAI("lesson_plan_gen", {
    model: "flash",
    messages: [{ role: "user", content: prompt }],
    systemPrompt: THEORY_SYSTEM_PROMPT,
    temperature: 0.6,
    responseSchema: SINGLE_THEORY_SCHEMA,
    thinkingBudget: 0,
    logContext: {
      ...logContext,
      metadata: {
        ...(logContext.metadata ?? {}),
        section: "theory",
        regen: true,
        moduleNumber: input.moduleNumber,
        sessionNo: input.sessionNo,
      },
    },
  });

  const warnings: LessonPlanWarning[] = [];
  let row: Record<string, unknown> | null = null;
  try {
    const parsed = JSON.parse(String(res.content ?? "").trim());
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      row = parsed as Record<string, unknown>;
    } else if (Array.isArray(parsed) && parsed[0]) {
      row = parsed[0] as Record<string, unknown>;
    }
  } catch {
    // fall through — handled below
  }
  if (!row) {
    throw new Error("Regeneration returned no usable content");
  }

  const session = buildOneTheorySession(
    mod,
    input.sessionNo,
    row,
    validCoCodes,
    warnings,
  );
  return { session, warnings };
}

const SINGLE_PRACTICAL_SCHEMA = {
  type: "object",
  properties: {
    coCodes: { type: "array", items: { type: "string", maxLength: 12 } },
    prepNote: { type: "string", maxLength: 140 },
    assessmentHint: { type: "string", maxLength: 120 },
    vivaSeed: { type: "string", maxLength: 200 },
  },
  required: ["coCodes", "prepNote", "assessmentHint", "vivaSeed"],
};

export interface RegeneratePracticalInput {
  practicalNo: number;
  title: string;
  hours: number;
  instruction?: string;
}

/** Regenerate ONE practical (prep/assessment/viva/CO). Title + hours are kept verbatim. */
export async function regeneratePracticalSession(
  ctx: LessonPlanContext,
  input: RegeneratePracticalInput,
  logContext: AILogContext,
): Promise<{ practical: PracticalSession; warnings: LessonPlanWarning[] }> {
  const validCoCodes = ctx.courseOutcomes.map((c) => c.co_code);
  const coBlock =
    ctx.courseOutcomes.length > 0
      ? ctx.courseOutcomes.map((c) => `  ${c.co_code}: ${c.description}`).join("\n")
      : "  (no course outcomes recorded)";

  const instructionBlock = input.instruction?.trim()
    ? `\n<binding_instruction>\n${input.instruction.trim()}\n</binding_instruction>\n`
    : "";

  const prompt = `Subject: ${ctx.subjectName}${ctx.subjectCode ? ` (${ctx.subjectCode})` : ""}

<course_outcomes>
${coBlock}
</course_outcomes>

Practical #${input.practicalNo} (${input.hours}h): ${input.title}
${instructionBlock}
Return a single JSON object for this practical:
- coCodes: CO code(s) it develops (choose only from the list above).
- prepNote (≤140): setup / dataset / a specific pitfall students hit.
- assessmentHint (≤120): what to evaluate in the 10-mark rubric.
- vivaSeed (≤200): one representative viva question.
Do not restate the title or hours.`;

  const res = await routeAI("lesson_plan_gen", {
    model: "flash",
    messages: [{ role: "user", content: prompt }],
    systemPrompt: PRACTICAL_SYSTEM_PROMPT,
    temperature: 0.6,
    responseSchema: SINGLE_PRACTICAL_SCHEMA,
    thinkingBudget: 0,
    logContext: {
      ...logContext,
      metadata: {
        ...(logContext.metadata ?? {}),
        section: "practical",
        regen: true,
        practicalNo: input.practicalNo,
      },
    },
  });

  const warnings: LessonPlanWarning[] = [];
  let row: Record<string, unknown> | null = null;
  try {
    const parsed = JSON.parse(String(res.content ?? "").trim());
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      row = parsed as Record<string, unknown>;
    } else if (Array.isArray(parsed) && parsed[0]) {
      row = parsed[0] as Record<string, unknown>;
    }
  } catch {
    // handled below
  }
  if (!row) throw new Error("Regeneration returned no usable content");

  const rawCos = Array.isArray(row.coCodes) ? (row.coCodes as unknown[]) : [];
  const validCos: string[] = [];
  for (const c of rawCos) {
    const valid = validateCoOrNull(String(c), validCoCodes);
    if (valid && !validCos.includes(valid)) validCos.push(valid);
    else if (!valid && String(c).trim()) {
      warnings.push({
        moduleNumber: null,
        kind: "co_stripped",
        message: `Practical #${input.practicalNo}: invalid CO "${String(c).trim()}" removed.`,
      });
    }
  }

  return {
    practical: {
      practicalNo: input.practicalNo,
      title: input.title,
      hours: input.hours,
      coCodes: validCos,
      prepNote: str(row.prepNote, 140),
      assessmentHint: str(row.assessmentHint, 120),
      vivaSeed: str(row.vivaSeed, 200),
    },
    warnings,
  };
}
