/**
 * PYQ coverage — the single source of truth for "does this subject have past
 * papers, and how good is that coverage?".
 *
 * WHY THIS EXISTS AS ONE MODULE: before it, the platform offered three PYQ-
 * backed capabilities (the qpaper "PYQ-style" sourcing category, the qbank
 * "PYQ-Inspired" slot style, the Notes frequency chip) and none of them could
 * tell whether any PYQ data actually existed. `defaultSourcingMix()` shipped
 * 20% PYQ-style for every subject including the ones with zero papers, so a
 * fifth of every generated paper claimed to mirror past exams while the model
 * was in fact falling back to the subject-family archetype hints in
 * `src/lib/qpaper/archetypes.ts`. A capability the UI offers must be a
 * capability the data can honour; that check has to be computed somewhere
 * shared, or the three call sites drift.
 *
 * THREE STATES, matching the `PyqSignal` contract in
 * src/lib/notes/pyq-frequency.ts (rich / weak / absent):
 *   none — 0 papers. The PYQ capability is inert; UI disables it.
 *   thin — some papers, but not enough to generalise from. UI enables it with
 *          an explicit caveat rather than pretending it's solid.
 *   rich — ≥2 papers AND ≥10 extracted questions. Two papers is the floor for
 *          "a pattern" rather than "one author's paper"; mirroring a single
 *          paper reproduces its quirks as if they were the department's style.
 *
 * CO COVERAGE, NOT MODULE COVERAGE. `pyq_questions` has no `module_id` (see
 * that table's migration) — the only structural bridge to the syllabus is
 * module → module_co_mapping.co_code → pyq_questions.co. So coverage is
 * reported per CO. This is what makes the "CO4 isn't represented in any paper
 * you've uploaded" gap concrete enough to act on, and it is the same bridge
 * pyq-frequency.ts already uses, so the two can never disagree.
 *
 * Every read is best-effort: a DB error degrades to "none" rather than
 * throwing. PYQ absence is not a failure mode, and neither is a flaky read —
 * an unavailable coverage check must never block paper generation.
 */

import { isMissingColumnError } from "./co";

// Structurally typed to accept both the service-role client and the
// browser/SSR clients without importing @supabase/supabase-js generics here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = { from: (table: string) => any };

export type PyqCoverageState = "none" | "thin" | "rich";

export const EXAM_TYPES = [
  "mid_sem",
  "end_sem",
  "internal",
  "other",
] as const;
export type ExamType = (typeof EXAM_TYPES)[number];

export const EXAM_TYPE_LABELS: Record<ExamType, string> = {
  mid_sem: "Mid-sem",
  end_sem: "End-sem",
  internal: "Internal",
  other: "Other",
};

export function isExamType(v: unknown): v is ExamType {
  return typeof v === "string" && (EXAM_TYPES as readonly string[]).includes(v);
}

/** Exam-type label for a possibly-null / possibly-legacy stored value. */
export function examTypeLabel(v: string | null | undefined): string | null {
  return isExamType(v) ? EXAM_TYPE_LABELS[v] : null;
}

export interface PyqPaper {
  id: string;
  title: string;
  year: number | null;
  exam_type: string | null;
  created_at: string;
  uploaded_by: string;
  /** Extracted question count for this specific paper. */
  question_count: number;
}

export interface PyqCoCoverage {
  co_code: string;
  /** Questions across all uploaded papers tagged with this CO. */
  questions: number;
  /** Distinct papers that examined this CO. */
  papers: number;
}

export interface PyqCoverage {
  state: PyqCoverageState;
  /** Distinct PYQ documents uploaded for the subject. */
  papers: number;
  /** Total extracted questions across those papers. */
  questions: number;
  /** Descending, de-duplicated. */
  years: number[];
  /** Exam types present, as stored values (label via examTypeLabel). */
  examTypes: string[];
  /**
   * One entry per course outcome DEFINED FOR THE SUBJECT — including the ones
   * with zero questions. The zeroes are the point: they're the actionable gap.
   * Empty when the subject has no course outcomes recorded.
   */
  coCoverage: PyqCoCoverage[];
  /** Subset of coCoverage with zero questions, as bare codes. */
  missingCos: string[];
  /** Marks value → question count, ascending by marks. */
  marksDistribution: Array<{ marks: number; count: number }>;
}

interface PyqDocRow {
  id: string;
  title: string;
  year: number | null;
  exam_type: string | null;
  created_at: string;
  uploaded_by: string;
}

/**
 * Read this subject's PYQ documents, tolerating a DB where `exam_type` has not
 * been added yet (see isMissingColumnError). Without the column every paper
 * simply reports a null exam type; nothing else about coverage changes.
 */
async function readPyqDocs(
  adminClient: AdminClient,
  subjectId: string
): Promise<{ docs: PyqDocRow[]; error: unknown }> {
  const withExamType = await adminClient
    .from("documents")
    .select("id, title, year, exam_type, created_at, uploaded_by")
    .eq("subject_id", subjectId)
    .eq("type", "pyq")
    .order("year", { ascending: false })
    .order("created_at", { ascending: false });

  if (!withExamType.error) {
    return { docs: (withExamType.data ?? []) as PyqDocRow[], error: null };
  }
  if (!isMissingColumnError(withExamType.error)) {
    return { docs: [], error: withExamType.error };
  }

  // Column absent — same query without it.
  const fallback = await adminClient
    .from("documents")
    .select("id, title, year, created_at, uploaded_by")
    .eq("subject_id", subjectId)
    .eq("type", "pyq")
    .order("year", { ascending: false })
    .order("created_at", { ascending: false });

  if (fallback.error) return { docs: [], error: fallback.error };
  return {
    docs: ((fallback.data ?? []) as Array<Omit<PyqDocRow, "exam_type">>).map(
      (d) => ({ ...d, exam_type: null })
    ),
    error: null,
  };
}

export const EMPTY_COVERAGE: PyqCoverage = {
  state: "none",
  papers: 0,
  questions: 0,
  years: [],
  examTypes: [],
  coCoverage: [],
  missingCos: [],
  marksDistribution: [],
};

/** ≥2 papers AND ≥10 questions ⇒ rich. See the module header for the reasoning. */
const RICH_MIN_PAPERS = 2;
const RICH_MIN_QUESTIONS = 10;

export function coverageState(papers: number, questions: number): PyqCoverageState {
  if (papers === 0) return "none";
  if (papers >= RICH_MIN_PAPERS && questions >= RICH_MIN_QUESTIONS) return "rich";
  return "thin";
}

/**
 * One short sentence describing the coverage, for use as an inline hint under
 * a control. Returns null for the "none" state — callers render their own
 * empty-state copy there, which needs to be a call to action, not a summary.
 */
export function coverageSummary(c: PyqCoverage): string | null {
  if (c.state === "none") return null;
  const paperPart = `${c.papers} paper${c.papers === 1 ? "" : "s"}`;
  const yearPart =
    c.years.length === 0
      ? ""
      : c.years.length === 1
        ? ` (${c.years[0]})`
        : ` (${Math.min(...c.years)}–${Math.max(...c.years)})`;
  const coPart =
    c.coCoverage.length === 0
      ? ""
      : ` · covers ${c.coCoverage.length - c.missingCos.length} of ${c.coCoverage.length} COs`;
  return `Mirroring ${paperPart}${yearPart}${coPart}`;
}

/**
 * Compute coverage for one subject. Two batched reads plus the subject's CO
 * list; no RPC, grouping done in JS (same approach as pyq-frequency.ts).
 */
export async function computePyqCoverage(
  adminClient: AdminClient,
  subjectId: string
): Promise<PyqCoverage> {
  try {
    const [docsRes, questionsRes, cosRes] = await Promise.all([
      readPyqDocs(adminClient, subjectId),
      adminClient
        .from("pyq_questions")
        .select("document_id, co, marks")
        .eq("subject_id", subjectId),
      adminClient
        .from("course_outcomes")
        .select("co_code")
        .eq("subject_id", subjectId)
        .order("co_code", { ascending: true }),
    ]);

    if (docsRes.error) {
      console.error("[pyq/coverage] documents read failed:", docsRes.error);
      return EMPTY_COVERAGE;
    }

    const docs = docsRes.docs;
    if (docs.length === 0) return EMPTY_COVERAGE;

    const questionRows = (questionsRes.data ?? []) as Array<{
      document_id: string | null;
      co: string | null;
      marks: number | null;
    }>;

    // ── Per-document question counts ──────────────────────────────────────
    const perDoc = new Map<string, number>();
    for (const r of questionRows) {
      if (!r.document_id) continue;
      perDoc.set(r.document_id, (perDoc.get(r.document_id) ?? 0) + 1);
    }

    // ── CO coverage, seeded with every CO the subject defines ─────────────
    // Seeding with the full list (not just the ones that appear in papers) is
    // what makes `missingCos` meaningful — a CO absent from every paper has no
    // row in pyq_questions to discover it from.
    const subjectCos = ((cosRes.data ?? []) as Array<{ co_code: string }>)
      .map((r) => r.co_code)
      .filter(Boolean);

    const coQuestions = new Map<string, number>();
    const coPapers = new Map<string, Set<string>>();
    for (const r of questionRows) {
      if (!r.co) continue;
      coQuestions.set(r.co, (coQuestions.get(r.co) ?? 0) + 1);
      if (r.document_id) {
        const set = coPapers.get(r.co) ?? new Set<string>();
        set.add(r.document_id);
        coPapers.set(r.co, set);
      }
    }

    const coCoverage: PyqCoCoverage[] = subjectCos.map((code) => ({
      co_code: code,
      questions: coQuestions.get(code) ?? 0,
      papers: coPapers.get(code)?.size ?? 0,
    }));

    // ── Marks distribution ────────────────────────────────────────────────
    const marksMap = new Map<number, number>();
    for (const r of questionRows) {
      if (r.marks == null) continue;
      marksMap.set(r.marks, (marksMap.get(r.marks) ?? 0) + 1);
    }

    const years = [
      ...new Set(docs.map((d) => d.year).filter((y): y is number => y != null)),
    ].sort((a, b) => b - a);

    const examTypes = [
      ...new Set(docs.map((d) => d.exam_type).filter((t): t is string => !!t)),
    ];

    return {
      state: coverageState(docs.length, questionRows.length),
      papers: docs.length,
      questions: questionRows.length,
      years,
      examTypes,
      coCoverage,
      missingCos: coCoverage.filter((c) => c.questions === 0).map((c) => c.co_code),
      marksDistribution: [...marksMap.entries()]
        .map(([marks, count]) => ({ marks, count }))
        .sort((a, b) => a.marks - b.marks),
    };
  } catch (err) {
    console.error("[pyq/coverage] failed:", err);
    return EMPTY_COVERAGE;
  }
}

/** The papers list, for the Past Papers management table. */
export async function listPyqPapers(
  adminClient: AdminClient,
  subjectId: string
): Promise<PyqPaper[]> {
  try {
    const [docsRes, questionsRes] = await Promise.all([
      readPyqDocs(adminClient, subjectId),
      adminClient
        .from("pyq_questions")
        .select("document_id")
        .eq("subject_id", subjectId),
    ]);

    if (docsRes.error) return [];

    const perDoc = new Map<string, number>();
    for (const r of (questionsRes.data ?? []) as Array<{ document_id: string | null }>) {
      if (!r.document_id) continue;
      perDoc.set(r.document_id, (perDoc.get(r.document_id) ?? 0) + 1);
    }

    return docsRes.docs.map((d) => ({
      ...d,
      question_count: perDoc.get(d.id) ?? 0,
    }));
  } catch (err) {
    console.error("[pyq/coverage] listPyqPapers failed:", err);
    return [];
  }
}
