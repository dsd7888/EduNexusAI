import { createAdminClient } from "@/lib/db/supabase-server";

const BANK_MIN_FRESH = 30; // minimum fresh questions before triggering refresh
const BANK_FRESH_THRESHOLD = 5; // times_used < this = "fresh"
const HISTORY_WINDOW_DAYS = 7; // don't repeat questions seen in last 7 days

// ── PLACEMENT BANK ──────────────────────────────────────────────

export async function getQuestionsFromBank(options: {
  companyId: string;
  branch: string;
  studentId: string;
  totalNeeded: number;
  distribution: Record<string, number>; // {quantitative: 7, logical: 6, verbal: 4, technical: 3}
}): Promise<{ questions: any[]; bankIds: string[] } | null> {
  const { companyId, branch, studentId, totalNeeded, distribution } = options;
  const adminClient = createAdminClient();

  // Get question IDs student has seen in last 7 days
  const seenCutoff = new Date(
    Date.now() - HISTORY_WINDOW_DAYS * 86400000
  ).toISOString();
  const { data: seenRows } = await adminClient
    .from("student_question_history")
    .select("question_bank_id")
    .eq("student_id", studentId)
    .gt("seen_at", seenCutoff)
    .not("question_bank_id", "is", null);

  const seenIds =
    seenRows?.map((r: any) => r.question_bank_id).filter(Boolean) ?? [];

  // Fetch questions per category
  const selectedQuestions: any[] = [];
  const selectedBankIds: string[] = [];

  for (const [category, needed] of Object.entries(distribution)) {
    if (needed === 0) continue;

    let query = adminClient
      .from("placement_question_bank")
      .select("id, question, times_used, quality_score")
      .eq("company_id", companyId)
      .eq("branch", branch)
      .eq("category", category)
      .eq("is_stale", false)
      .order("times_used", { ascending: true }) // fresh first
      .limit(needed * 4); // fetch extras for filtering

    const { data: pool } = await query;

    if (!pool || pool.length === 0) return null; // bank empty for this category

    // Filter out seen questions
    const available =
      seenIds.length > 0 ? pool.filter((q: any) => !seenIds.includes(q.id)) : pool;

    // If not enough unseen, fall back to least-recently-seen
    const candidates =
      available.length >= needed ? available : pool; // use all if not enough unseen

    if (candidates.length < needed) return null; // truly not enough

    // Pick with weighted random:
    // Fresh (times_used < 5): 70% of picks
    // Seasoned (5-15): 25%
    // Classic (>15): 5%
    const fresh = candidates.filter(
      (q: any) => q.times_used < BANK_FRESH_THRESHOLD
    );
    const seasoned = candidates.filter(
      (q: any) =>
        q.times_used >= BANK_FRESH_THRESHOLD && q.times_used <= 15
    );
    const classic = candidates.filter((q: any) => q.times_used > 15);

    const picked = pickWeighted(
      fresh,
      seasoned,
      classic,
      needed
    );

    selectedQuestions.push(...picked.map((q: any) => q.question));
    selectedBankIds.push(...picked.map((q: any) => q.id));
  }

  if (selectedQuestions.length < totalNeeded * 0.8) return null;

  return {
    questions: shuffleArray(selectedQuestions),
    bankIds: selectedBankIds,
  };
}

export async function saveToBankAndRecord(options: {
  companyId: string;
  branch: string;
  studentId: string;
  questions: any[];
  usedBankIds: string[]; // IDs of bank questions that were served
}) {
  const { companyId, branch, studentId, questions, usedBankIds } = options;
  const adminClient = createAdminClient();

  // Save new questions to bank (those not from bank)
  const newQuestions = questions.filter((q) => !q._bankId);
  if (newQuestions.length > 0) {
    const bankRows = newQuestions.map((q) => ({
      company_id: companyId,
      branch,
      category: q.category ?? "quantitative",
      subcategory: q.subcategory ?? "general",
      difficulty: q.difficulty ?? "medium",
      question: q,
      times_used: 0,
      last_used_at: new Date().toISOString(),
    }));

    const { data: inserted } = await adminClient
      .from("placement_question_bank")
      .insert(bankRows)
      .select("id");

    // Record in history
    if (inserted) {
      const historyRows = inserted.map((row: any) => ({
        student_id: studentId,
        question_bank_id: row.id,
      }));
      await adminClient.from("student_question_history").insert(historyRows);
    }
  }

  // Update usage counts for bank questions that were served
  if (usedBankIds.length > 0) {
    // Prefer RPC increment if it exists; fall back to per-row updates.
    try {
      await adminClient.rpc("increment_bank_usage", {
        bank_ids: usedBankIds,
        table_name: "placement_question_bank",
      });
    } catch {
      // Fallback: update one by one
      await Promise.all(
        usedBankIds.map(async (id) => {
          const { data } = await adminClient
            .from("placement_question_bank")
            .select("times_used")
            .eq("id", id)
            .single();

          if (!data) return;

          const nextTimesUsed =
            typeof (data as any).times_used === "number"
              ? (data as any).times_used + 1
              : Number((data as any).times_used ?? 0) + 1;

          await adminClient
            .from("placement_question_bank")
            .update({
              times_used: nextTimesUsed,
              last_used_at: new Date().toISOString(),
            })
            .eq("id", id);
        })
      );
    }

    // Record in student history
    const historyRows = usedBankIds.map((id) => ({
      student_id: studentId,
      question_bank_id: id,
    }));
    await adminClient.from("student_question_history").insert(historyRows);
  }
}

export async function checkBankHealth(
  companyId: string,
  branch: string
): Promise<{
  total: number;
  fresh: number;
  needsRefresh: boolean;
}> {
  const adminClient = createAdminClient();

  const { count: total } = await adminClient
    .from("placement_question_bank")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("branch", branch)
    .eq("is_stale", false);

  const { count: fresh } = await adminClient
    .from("placement_question_bank")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("branch", branch)
    .eq("is_stale", false)
    .lt("times_used", BANK_FRESH_THRESHOLD);

  return {
    total: total ?? 0,
    fresh: fresh ?? 0,
    needsRefresh: (fresh ?? 0) < BANK_MIN_FRESH,
  };
}

// ── PRACTICE BANK ───────────────────────────────────────────────

export async function getPracticeQuestionsFromBank(options: {
  moduleId: string;
  branch: string | null;
  studentId: string;
  totalNeeded: number;
}): Promise<{ questions: any[]; bankIds: string[] } | null> {
  const { moduleId, branch, studentId, totalNeeded } = options;
  const adminClient = createAdminClient();

  const seenCutoff = new Date(
    Date.now() - HISTORY_WINDOW_DAYS * 86400000
  ).toISOString();
  const { data: seenRows } = await adminClient
    .from("student_question_history")
    .select("practice_bank_id")
    .eq("student_id", studentId)
    .gt("seen_at", seenCutoff)
    .not("practice_bank_id", "is", null);

  const seenIds =
    seenRows?.map((r: any) => r.practice_bank_id).filter(Boolean) ?? [];

  // Universal questions (branch IS NULL) always included;
  // branch-specific rows only when branch is provided.
  const branchFilter = branch
    ? `branch.is.null,branch.eq.${branch}`
    : `branch.is.null`;

  const { data: pool } = await adminClient
    .from("practice_question_bank")
    .select("id, question, times_used, difficulty_level")
    .eq("module_id", moduleId)
    .eq("is_stale", false)
    .or(branchFilter)
    .order("times_used", { ascending: true })
    .limit(totalNeeded * 5);

  if (!pool || pool.length < totalNeeded) return null;

  const available =
    seenIds.length > 0
      ? pool.filter((q: any) => !seenIds.includes(q.id))
      : pool;

  const candidates = available.length >= totalNeeded ? available : pool;
  if (candidates.length < totalNeeded) return null;

  // Ensure difficulty distribution: 4 foundational, 5 intermediate, 3 advanced
  // (Assumes `totalNeeded` is typically 12 for this practice flow.)
  const distribution = { foundational: 4, intermediate: 5, advanced: 3 };

  const picked: any[] = [];
  const pickedIds: string[] = [];

  for (const [level, needed] of Object.entries(distribution)) {
    const levelPool = candidates.filter((q: any) => q.difficulty_level === level);
    const take = levelPool.slice(0, needed);
    picked.push(...take.map((q: any) => q.question));
    pickedIds.push(...take.map((q: any) => q.id));
  }

  // If distribution not met (bank might not have all levels), fill remainder
  if (picked.length < totalNeeded) {
    const remaining = candidates
      .filter((q: any) => !pickedIds.includes(q.id))
      .slice(0, totalNeeded - picked.length);
    picked.push(...remaining.map((q: any) => q.question));
    pickedIds.push(...remaining.map((q: any) => q.id));
  }

  return {
    questions: shuffleArray(picked.slice(0, totalNeeded)),
    bankIds: pickedIds.slice(0, totalNeeded),
  };
}

export async function savePracticeToBank(options: {
  moduleId: string;
  branch: string | null;
  studentId: string;
  questions: any[];
  usedBankIds: string[];
}) {
  const { moduleId, branch, studentId, questions, usedBankIds } = options;
  const adminClient = createAdminClient();

  const newQuestions = questions.filter((q) => !q._bankId);
  if (newQuestions.length > 0) {
    const bankRows = newQuestions.map((q) => ({
      module_id: moduleId,
      branch: branch ?? null,
      difficulty_level: q.difficulty_level ?? "intermediate",
      question: q,
      times_used: 0,
      last_used_at: new Date().toISOString(),
    }));

    const { data: inserted } = await adminClient
      .from("practice_question_bank")
      .insert(bankRows)
      .select("id");

    if (inserted) {
      await adminClient.from("student_question_history").insert(
        inserted.map((row: any) => ({
          student_id: studentId,
          practice_bank_id: row.id,
        }))
      );
    }
  }

  if (usedBankIds.length > 0) {
    // Update usage counts
    for (const id of usedBankIds) {
      const { data } = await adminClient
        .from("practice_question_bank")
        .select("times_used")
        .eq("id", id)
        .single();

      if (data) {
        const nextTimesUsed =
          typeof (data as any).times_used === "number"
            ? (data as any).times_used + 1
            : Number((data as any).times_used ?? 0) + 1;

        await adminClient
          .from("practice_question_bank")
          .update({
            times_used: nextTimesUsed,
            last_used_at: new Date().toISOString(),
          })
          .eq("id", id);
      }
    }

    await adminClient.from("student_question_history").insert(
      usedBankIds.map((id) => ({
        student_id: studentId,
        practice_bank_id: id,
      }))
    );
  }
}

// ── HELPERS ─────────────────────────────────────────────────────

function pickWeighted(
  fresh: any[],
  seasoned: any[],
  classic: any[],
  needed: number
): any[] {
  const freshTarget = Math.round(needed * 0.7);
  const seasonedTarget = Math.round(needed * 0.25);

  const freshCount = Math.min(freshTarget, fresh.length);
  const seasonedCount = Math.min(seasonedTarget, seasoned.length);
  let classicCount = Math.min(
    needed - freshCount - seasonedCount,
    classic.length
  );

  const picked = [
    ...shuffleArray(fresh).slice(0, freshCount),
    ...shuffleArray(seasoned).slice(0, seasonedCount),
    ...shuffleArray(classic).slice(0, classicCount),
  ];

  if (picked.length < needed) {
    const remaining = needed - picked.length;
    const pickedIds = new Set(picked.map((q: any) => q.id));
    const allAvailable = shuffleArray([...fresh, ...seasoned, ...classic]).filter(
      (q: any) => !pickedIds.has(q.id)
    );
    picked.push(...allAvailable.slice(0, remaining));
  }

  return picked.slice(0, needed);
}

function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

