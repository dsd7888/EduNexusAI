/**
 * Assessment Engine — slot planning (CP-Q1).
 *
 * ONE public function: planAssessment(). It turns a student's request
 * ("30 questions, mastery mode, these 3 modules, mixed difficulty") into a list
 * of fully-determined QuestionSlots. Nothing is generated or fetched here — the
 * plan is pure allocation, and the two sourcing layers (bankFill.ts, then
 * generator.ts for whatever the bank could not cover) consume it.
 *
 * WHY A PLAN AT ALL — this is the fix for the bug the current
 * /api/quiz/generate route has: it asks Flash for N questions in one 8k call
 * with `combinedSyllabus.slice(0, 2000)`, then stores whatever comes back
 * against the first module of the primary subject. Nothing about coverage,
 * module weightage, or difficulty is actually enforced; it is asserted in a
 * prompt and hoped for. Here, coverage is arithmetic: slots are apportioned
 * from syllabus weightage BEFORE any model is called, exactly as the Q paper
 * generator does (§12: "Module assignment computed in code — AI never picks
 * modules"), so a 100-question, 3-subject request is as accurate as a
 * 10-question one.
 *
 * SERVER-ONLY: uses the admin client (bypasses RLS). Callers must have already
 * authorised the student.
 */

import { createAdminClient } from "@/lib/db/supabase-server";
import {
  marksForSlot,
  type AssessmentDifficulty,
  type AssessmentPlan,
  type AssessmentPlanInput,
  type AssessmentPreset,
  type AssessmentQuestionType,
  type NatDegradation,
  type QuestionSlot,
  type SourcingSummary,
} from "./types";

type AdminClient = ReturnType<typeof createAdminClient>;

const DIFFICULTIES: AssessmentDifficulty[] = ["easy", "medium", "hard"];

/** Default when a module has no student_topic_mastery row yet (§16 pattern:
 *  placement starts every unseen topic at 'easy' and promotes on evidence). */
const ADAPTIVE_DEFAULT: AssessmentDifficulty = "easy";

interface ModuleRow {
  id: string;
  subject_id: string;
  module_number: number;
  name: string;
  weightage_percent: number | null;
  /** 'quantitative' | 'conceptual' | null (unclassified → NAT allowed). */
  quant_profile: string | null;
}

// ─── Hamilton apportionment ────────────────────────────────────────────────

/**
 * Largest-remainder (Hamilton) apportionment of `total` across `weights`.
 *
 * REUSE: this is the same method as `allocateSlotSources` in
 * src/lib/qpaper/sourcing.ts and `distributeMcqsAcrossModules` /
 * `apportionDifficulty` in src/lib/qpaper/moduleAssignment.ts. Those three are
 * NOT exported (they are private to their modules and keyed on qpaper's own
 * template types), so the method is re-implemented here in its general form
 * rather than duplicated three-ways-shaped. Tie-break order is identical to
 * sourcing.ts: larger fractional remainder, then larger weight, then earlier
 * index — which is what makes the allocation deterministic run-to-run
 * (§19: "Hamilton apportionment for sourcing mix … random sampling drifts").
 */
export function apportion(total: number, weights: number[]): number[] {
  const n = weights.length;
  if (n === 0 || total <= 0) return new Array(Math.max(0, n)).fill(0);

  const sum = weights.reduce((s, w) => s + Math.max(0, w), 0);
  if (sum <= 0) {
    // No usable weights → spread equally (the "weightages absent" fallback).
    return apportion(total, new Array(n).fill(1));
  }

  const exact = weights.map((w) => (Math.max(0, w) / sum) * total);
  const counts = exact.map((e) => Math.floor(e));
  let remainder = total - counts.reduce((a, b) => a + b, 0);
  const order = exact
    .map((e, i) => ({ i, frac: e - Math.floor(e), w: Math.max(0, weights[i]) }))
    .sort((a, b) => b.frac - a.frac || b.w - a.w || a.i - b.i);
  for (let k = 0; remainder > 0; k++, remainder--) {
    counts[order[k % order.length].i] += 1;
  }
  return counts;
}

/**
 * Spread `labels` (already apportioned to `counts`) across `n` positions so
 * they interleave instead of clustering — position 0..n-1 gets a label picked
 * by highest remaining fraction of its own budget.
 *
 * REUSE: lifted from the greedy-deficit sweep inside `apportionDifficulty`
 * (src/lib/qpaper/moduleAssignment.ts, private). Without it a "mixed" 30-slot
 * quiz would be 10 easy, then 10 medium, then 10 hard — technically the right
 * distribution, experientially a difficulty cliff.
 */
function spreadEvenly<T>(n: number, labels: T[], counts: number[]): T[] {
  const out: T[] = [];
  const remaining = [...counts];
  const budget = [...counts];
  for (let i = 0; i < n; i++) {
    let best = -1;
    let bestScore = -Infinity;
    for (let j = 0; j < labels.length; j++) {
      if (remaining[j] > 0) {
        const score = budget[j] > 0 ? remaining[j] / budget[j] : 0;
        if (score > bestScore) {
          bestScore = score;
          best = j;
        }
      }
    }
    if (best === -1) break;
    out.push(labels[best]);
    remaining[best] -= 1;
  }
  return out;
}

// ─── CO targeting ──────────────────────────────────────────────────────────

/**
 * Most-under-served-CO picker over module_co_mapping.
 *
 * REUSE: mirrors `targetCoFor` inside `makePicker`
 * (src/lib/qpaper/moduleAssignment.ts, private). Same idea — a ledger of how
 * many slots each CO has been credited, and each slot claims the CO its module
 * can reach that is furthest behind — simplified because a student quiz has no
 * faculty-set CO% target: every CO the selected modules can reach is treated as
 * equally demanded, so the effect is "spread across COs evenly", not "hit a
 * configured distribution".
 */
function makeCoPicker(coByModule: Map<string, string[]>) {
  const assigned = new Map<string, number>();
  return function targetCoFor(moduleId: string | null): string | undefined {
    if (!moduleId) return undefined;
    const cos = coByModule.get(moduleId);
    if (!cos || cos.length === 0) return undefined;
    let best = cos[0];
    let bestCount = assigned.get(best) ?? 0;
    for (const co of cos) {
      const c = assigned.get(co) ?? 0;
      if (c < bestCount) {
        best = co;
        bestCount = c;
      }
    }
    assigned.set(best, bestCount + 1);
    return best;
  };
}

// ─── Public entry point ────────────────────────────────────────────────────

/**
 * Build the slot plan for one assessment request.
 *
 * Allocation, in order:
 *  1. MODULES — questionCount is apportioned across subjects first (equal
 *     share; a subject's module count must not decide how much of the quiz it
 *     gets), then across each subject's modules by `weightage_percent`
 *     (equal split when a subject has no weightages).
 *  2. DIFFICULTY — 'mixed' → Hamilton 33/33/33 spread evenly across the whole
 *     plan; an explicit easy/medium/hard → every slot takes it; 'adaptive' →
 *     per-slot lookup of student_topic_mastery.current_difficulty for that
 *     (subject, module), defaulting to 'easy'.
 *  3. TYPE — deterministic cycle by slot index over questionTypes.
 *  4. CO — most under-served CO available to the slot's module.
 *  5. NAT GATE — NAT slots on modules classified 'conceptual' are relocated to
 *     eligible modules, or degraded to MCQ when there is no eligible capacity
 *     (CP-Q1.5, gate 1; see applyNatGate and CP_Q2_NAT_INTEGRITY.md).
 *  6. MARKS — from mode config, applied AFTER the gate so a degraded slot is
 *     priced as what it became (GATE preset overrides; see marksForSlot).
 *
 * @param admin injectable for tests/harnesses; defaults to the admin client.
 */
export async function planAssessment(
  input: AssessmentPlanInput,
  admin: AdminClient = createAdminClient()
): Promise<AssessmentPlan> {
  const warnings: string[] = [];

  const subjectIds = Array.from(new Set(input.subjectIds)).filter(Boolean);
  if (subjectIds.length === 0) {
    throw new Error("planAssessment: at least one subjectId is required");
  }
  if (!Number.isFinite(input.questionCount) || input.questionCount <= 0) {
    throw new Error(
      `planAssessment: questionCount must be a positive number (got ${input.questionCount})`
    );
  }

  // GATE preset: the two GATE-critical types are non-negotiable. Missing ones
  // are added rather than throwing — a caller that asked for "GATE" and listed
  // only MCQ wants a GATE paper, not an error.
  let questionTypes = Array.from(new Set(input.questionTypes)).filter(Boolean);
  if (questionTypes.length === 0) questionTypes = ["mcq"];
  if (input.preset === "gate") {
    const added: AssessmentQuestionType[] = [];
    for (const t of ["msq", "nat"] as AssessmentQuestionType[]) {
      if (!questionTypes.includes(t)) {
        questionTypes.push(t);
        added.push(t);
      }
    }
    if (added.length > 0) {
      warnings.push(
        `GATE preset requires ${added.join(" and ")} — added to the requested question types.`
      );
    }
  }

  // ── 1. Modules ────────────────────────────────────────────────────────────
  const { data: moduleRows, error: moduleErr } = await admin
    .from("modules")
    .select(
      "id, subject_id, module_number, name, weightage_percent, quant_profile"
    )
    .in("subject_id", subjectIds)
    .order("module_number");
  if (moduleErr) {
    throw new Error(`planAssessment: module lookup failed — ${moduleErr.message}`);
  }

  let modules = (moduleRows ?? []) as ModuleRow[];
  if (input.moduleIds && input.moduleIds.length > 0) {
    const wanted = new Set(input.moduleIds);
    const scoped = modules.filter((m) => wanted.has(m.id));
    const missing = input.moduleIds.filter(
      (id) => !scoped.some((m) => m.id === id)
    );
    if (missing.length > 0) {
      warnings.push(
        `${missing.length} requested module id(s) do not belong to the selected subjects and were ignored.`
      );
    }
    modules = scoped;
  }

  // Subjects that contributed no modules still deserve slots — a subject with
  // no modules seeded would otherwise silently vanish from the quiz.
  const subjectsWithModules = new Set(modules.map((m) => m.subject_id));
  for (const sid of subjectIds) {
    if (!subjectsWithModules.has(sid)) {
      warnings.push(
        `Subject ${sid} has no modules in scope — its slots are module-less (moduleId null).`
      );
    }
  }

  // Equal share per subject, then weightage share per module within it.
  const perSubject = apportion(
    input.questionCount,
    subjectIds.map(() => 1)
  );

  interface SlotSeed {
    subjectId: string;
    module: ModuleRow | null;
  }
  const seeds: SlotSeed[] = [];

  subjectIds.forEach((subjectId, si) => {
    const count = perSubject[si];
    if (count <= 0) return;
    const subjectModules = modules
      .filter((m) => m.subject_id === subjectId)
      .sort((a, b) => a.module_number - b.module_number);

    if (subjectModules.length === 0) {
      for (let k = 0; k < count; k++) seeds.push({ subjectId, module: null });
      return;
    }

    const allMissing = subjectModules.every(
      (m) => m.weightage_percent == null || m.weightage_percent === 0
    );
    if (allMissing) {
      warnings.push(
        `Subject ${subjectId} has no module weightages — distributing slots equally across ${subjectModules.length} modules.`
      );
    }
    // Fallback mirrors computeEffectiveWeights (qpaper/moduleAssignment.ts):
    // all-missing → equal weights; individually-missing → the equal share.
    const equal = 100 / subjectModules.length;
    const weights = subjectModules.map((m) =>
      allMissing ? equal : (m.weightage_percent ?? equal)
    );
    const perModule = apportion(count, weights);
    subjectModules.forEach((m, mi) => {
      for (let k = 0; k < perModule[mi]; k++) {
        seeds.push({ subjectId, module: m });
      }
    });
  });

  const total = seeds.length;

  // ── 2. Difficulty ─────────────────────────────────────────────────────────
  let difficultyPerSlot: AssessmentDifficulty[];
  let adaptiveApplied = false;

  if (input.difficulty === "mixed") {
    const sequence = spreadEvenly(
      total,
      DIFFICULTIES,
      apportion(total, [1, 1, 1])
    );
    // DEAL, don't lay down in order. Question type cycles by slot index, so
    // handing out an easy/medium/hard sequence positionally makes the two
    // cycles resonate whenever the type count divides 3 — with
    // [mcq, msq, nat] every MCQ comes out easy and every NAT hard, which is
    // both a worse quiz and a false difficulty signal. Dealing round-robin
    // ACROSS the type cycle (all slots of type 0, then type 1, …) keeps both
    // distributions exact while decorrelating them.
    const dealOrder = seeds
      .map((_, i) => i)
      .sort(
        (a, b) =>
          (a % questionTypes.length) - (b % questionTypes.length) || a - b
      );
    difficultyPerSlot = new Array<AssessmentDifficulty>(total);
    dealOrder.forEach((slotIndex, k) => {
      difficultyPerSlot[slotIndex] = sequence[k] ?? ADAPTIVE_DEFAULT;
    });
  } else if (input.difficulty === "adaptive") {
    const { data: masteryRows, error: masteryErr } = await admin
      .from("student_topic_mastery")
      .select("subject_id, module_id, current_difficulty")
      .eq("student_id", input.studentId)
      .in("subject_id", subjectIds);
    if (masteryErr) {
      warnings.push(
        `Adaptive difficulty: mastery lookup failed (${masteryErr.message}) — every slot defaults to '${ADAPTIVE_DEFAULT}'.`
      );
    }
    const byKey = new Map<string, AssessmentDifficulty>();
    for (const r of (masteryRows ?? []) as Array<{
      subject_id: string;
      module_id: string;
      current_difficulty: string;
    }>) {
      if (DIFFICULTIES.includes(r.current_difficulty as AssessmentDifficulty)) {
        byKey.set(
          `${r.subject_id}:${r.module_id}`,
          r.current_difficulty as AssessmentDifficulty
        );
      }
    }
    difficultyPerSlot = seeds.map((s) => {
      const hit = s.module
        ? byKey.get(`${s.subjectId}:${s.module.id}`)
        : undefined;
      if (hit) adaptiveApplied = true;
      return hit ?? ADAPTIVE_DEFAULT;
    });
  } else {
    const fixed = input.difficulty as AssessmentDifficulty;
    difficultyPerSlot = seeds.map(() => fixed);
  }

  // ── 3/4/5. Type, marks, CO ────────────────────────────────────────────────
  const coByModule = await loadModuleCoMap(
    admin,
    modules.map((m) => m.id)
  );
  const targetCoFor = makeCoPicker(coByModule);

  const slots: QuestionSlot[] = seeds.map((seed, i) => ({
    slotId: `S${i + 1}`,
    subjectId: seed.subjectId,
    moduleId: seed.module?.id ?? null,
    questionType: questionTypes[i % questionTypes.length],
    difficulty: difficultyPerSlot[i] ?? ADAPTIVE_DEFAULT,
    // marks are assigned AFTER the NAT gate below — a degraded nat→mcq slot
    // must be re-priced (GATE: NAT is 2 marks, MCQ is 1), and pricing it here
    // would leave a 1-mark question carrying 2 marks.
    marks: 0,
    targetCo: targetCoFor(seed.module?.id ?? null),
    moduleNumber: seed.module?.module_number,
    moduleName: seed.module?.name,
  }));

  // ── 6. NAT gate (CP-Q1.5, gate 1) ─────────────────────────────────────────
  const natDegraded = applyNatGate(slots, modules, warnings, input.preset);

  for (const s of slots) {
    s.marks = marksForSlot(input.mode, s.questionType, input.preset);
  }

  const sourcing = summarise(slots, adaptiveApplied, warnings);
  if (natDegraded) sourcing.natDegraded = natDegraded;

  return { slots, sourcing, warnings };
}

/**
 * Refuse NAT slots on modules classified 'conceptual', preserving the NAT count
 * wherever the subject has the capacity to carry it (CP_Q2_NAT_INTEGRITY.md,
 * gate 1).
 *
 * The order matters and is the whole point:
 *
 *  1. RELOCATE first. A NAT slot sitting on a conceptual module is swapped with
 *     a non-NAT slot on an eligible module — the two slots trade TYPES, never
 *     modules. Module assignment came from syllabus weightage and is the one
 *     thing that must not move (§12); swapping types leaves every module's slot
 *     count untouched, so weightage compliance is unaffected and the student
 *     still gets the NAT count they asked for.
 *  2. DEGRADE only what relocation cannot place. If eligible modules cannot
 *     absorb the NAT demand, the excess becomes MCQ.
 *
 * Eligible = quant_profile is 'quantitative' OR NULL. Unclassified is
 * deliberately permissive: blocking NAT until a backfill runs would silently
 * disable GATE mode platform-wide, and CP-Q2's per-item verifier is the backstop
 * for a module that turns out to be a bad NAT host.
 *
 * Returns undefined when the plan asked for no NAT at all.
 */
function applyNatGate(
  slots: QuestionSlot[],
  modules: ModuleRow[],
  warnings: string[],
  preset?: AssessmentPreset
): NatDegradation | undefined {
  const requested = slots.filter((s) => s.questionType === "nat").length;
  if (requested === 0) return undefined;

  const profileById = new Map(modules.map((m) => [m.id, m.quant_profile]));
  const nameById = new Map(modules.map((m) => [m.id, m.name]));
  // A module-less slot has no classification to consult, so it stays eligible.
  const refuses = (moduleId: string | null): boolean =>
    moduleId != null && profileById.get(moduleId) === "conceptual";

  const affected = new Map<string, string>();
  const blocked = slots.filter(
    (s) => s.questionType === "nat" && refuses(s.moduleId)
  );
  for (const s of blocked) {
    if (s.moduleId) {
      affected.set(s.moduleId, nameById.get(s.moduleId) ?? s.moduleId);
    }
  }

  if (blocked.length === 0) {
    return { requested, delivered: requested, reason: null, affectedModules: [] };
  }

  // 1. Relocate: donors are non-NAT slots on eligible modules.
  const donors = slots.filter(
    (s) => s.questionType !== "nat" && !refuses(s.moduleId)
  );
  let donorIdx = 0;
  let degraded = 0;
  for (const s of blocked) {
    const donor = donors[donorIdx];
    if (donor) {
      donorIdx += 1;
      s.questionType = donor.questionType;
      donor.questionType = "nat";
    } else {
      // 2. Degrade: no eligible home left for this NAT slot.
      s.questionType = "mcq";
      degraded += 1;
    }
  }

  const delivered = requested - degraded;
  const affectedModules = Array.from(affected.entries()).map(
    ([moduleId, moduleName]) => ({ moduleId, moduleName })
  );
  const reason: NatDegradation["reason"] =
    degraded > 0 ? "insufficient_quantitative_modules" : "conceptual_module_refusal";

  if (degraded > 0) {
    warnings.push(
      `${degraded} NAT slot(s) degraded to MCQ — the selected modules do not have enough quantitative capacity to carry ${requested} numerical question(s).`
    );
  } else {
    warnings.push(
      `${blocked.length} NAT slot(s) moved off conceptual module(s) (${affectedModules
        .map((m) => m.moduleName)
        .join(", ")}); the requested NAT count is unchanged.`
    );
  }
  if (preset === "gate" && delivered < requested) {
    warnings.push(
      `GATE preset: only ${delivered} of ${requested} numerical (NAT) questions could be placed. A GATE-style paper under-weighted on NAT is not representative — consider adding quantitative modules to the scope.`
    );
  }

  return { requested, delivered, reason, affectedModules };
}

async function loadModuleCoMap(
  admin: AdminClient,
  moduleIds: string[]
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (moduleIds.length === 0) return out;
  const { data } = await admin
    .from("module_co_mapping")
    .select("module_id, co_code")
    .in("module_id", moduleIds);
  for (const r of (data ?? []) as Array<{ module_id: string; co_code: string }>) {
    const list = out.get(r.module_id) ?? [];
    list.push(r.co_code);
    out.set(r.module_id, list);
  }
  for (const list of out.values()) list.sort();
  return out;
}

function summarise(
  slots: QuestionSlot[],
  adaptiveApplied: boolean,
  warnings: string[]
): SourcingSummary {
  const bySubject: Record<string, number> = {};
  const byModule: Record<string, number> = {};
  const byDifficulty: Record<AssessmentDifficulty, number> = {
    easy: 0,
    medium: 0,
    hard: 0,
  };
  const byType: Record<string, number> = {};

  for (const s of slots) {
    bySubject[s.subjectId] = (bySubject[s.subjectId] ?? 0) + 1;
    const mk = s.moduleId ?? "__none__";
    byModule[mk] = (byModule[mk] ?? 0) + 1;
    byDifficulty[s.difficulty] += 1;
    byType[s.questionType] = (byType[s.questionType] ?? 0) + 1;
  }

  return {
    totalSlots: slots.length,
    bySubject,
    byModule,
    byDifficulty,
    byType,
    adaptiveApplied,
    warnings,
  };
}
