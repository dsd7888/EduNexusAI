// ============================================================================
// Lab Manual — per-practical AI generation + validation gate (spec §4b)
//
// ONE routeAI("lab_manual_gen", …) call PER PRACTICAL, concurrency 4. Each call
// emits the largest structured payload in the product (theory + worked example +
// scaffold + solution + viva + rubric + conduct guide in one object), so the
// narrow responseSchema + thinkingBudget:0 are load-bearing, not decoration
// (CLAUDE_CONTEXT §19).
//
// buildOnePracticalSection is the ONE gate, shared by batch generation and
// single-practical regen — the same rule that makes buildOneTheorySession the
// shared gate in lessonplan/generator.ts. Two gates drift; one cannot. Every
// repair emits a warning rather than silently coercing (§17).
//
// The syllabus, not the model, owns practicalNo / title / hours / difficulty:
// they come from the skeleton and the request verbatim and are never generated.
// ============================================================================

import { routeAI } from "@/lib/ai/router";
import { validateCoOrNull } from "@/lib/qpaper/sectionGen";
import { buildModuleDigest, type SubjectContext } from "@/lib/subjectContext";
import type { AILogContext } from "@/lib/ai/providers/types";
import {
  GAP_COUNT_RANGE,
  SCAFFOLD_KINDS,
  RUBRIC_TOTAL_MARKS,
  RUBRIC_MAX_ROWS,
  COMMON_ERRORS_COUNT,
  VIVA_COUNT,
  CHECKPOINT_COUNT,
  CODE_PRACTICAL_PATTERN,
  CALC_PRACTICAL_PATTERN,
  URL_PATTERN,
  TODO_MARKER_PATTERN,
  BOILERPLATE_LEARN_PATTERN,
  type Difficulty,
  type ScaffoldKind,
  type PracticalManualSection,
  type LabManualWarning,
  type LearningPath,
  type CodeGap,
  type RubricRow,
  type VivaQA,
  type ExtensionProblem,
} from "./types";

const CONCURRENCY = 4;

/** The syllabus-owned skeleton of a practical — never AI-supplied. */
export interface PracticalSkeleton {
  practicalNo: number;
  title: string;
  hours: number;
}

/** Resolve a practical's skeleton from the subject context (title/hours verbatim). */
export function practicalSkeleton(
  ctx: SubjectContext,
  practicalNo: number,
): PracticalSkeleton | null {
  const p = ctx.practicals.find((x) => x.sr_no === practicalNo);
  if (!p) return null;
  return {
    practicalNo: p.sr_no,
    title: p.name,
    // 2h is the standard lab slot; same fallback as the lesson-plan skeleton.
    hours:
      typeof p.hours === "number" && Number.isFinite(p.hours) && p.hours >= 1
        ? Math.floor(p.hours)
        : 2,
  };
}

// ─── Prompt ──────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT =
  "You are a senior laboratory instructor and pedagogy designer for term work at " +
  "an Indian technical university. You write BOTH the student-facing manual pages " +
  "and the instructor-only conduct notes for a practical. You are concrete and " +
  "specific to the practical in front of you: real errors students actually hit, " +
  "real numbers in worked examples, real viva questions. No filler, no textbook " +
  "padding, no generic advice. Output must obey the provided JSON schema exactly.";

const DIFFICULTY_MEANING: Record<Difficulty, string> = {
  guided:
    "GUIDED — the student is meeting this idea for the first time. Prefill most of " +
    "the artifact and leave 3-4 SHORT gaps, with generous inline comments around " +
    "each one. CAREFUL: 'short' describes the LENGTH of each gap (roughly one " +
    "line/step), NOT its importance. A guided gap is still a piece of the " +
    "conceptual core — the smallest meaningful slice of it. Prefilling the core " +
    "and gapping the boilerplate around it is the single worst thing you can do " +
    "here: it produces a practical the student can complete while learning nothing.",
  standard:
    "STANDARD — the student has seen the idea in a lecture. Leave 4-6 gaps covering " +
    "the CORE LOGIC of the task. Moderate inline comments.",
  challenge:
    "CHALLENGE — the student should build the core themselves. Prefill ONLY the I/O " +
    "shell, the data setup, and the function/step signatures. Leave 5-7 gaps spanning " +
    "the whole core. Minimal comments. Note this is about how LITTLE you prefill, " +
    "not about gap count — a challenge scaffold may have fewer, larger gaps than a " +
    "standard one.",
};

/**
 * A worked example of good vs bad gapping.
 *
 * CLAUDE_CONTEXT §19: models copy visible discipline far more reliably than they
 * follow an abstract instruction to be disciplined. Rule 1 alone ("gap the
 * conceptual core") did NOT hold at the guided level — Flash prefilled the
 * modular arithmetic of a Caesar cipher and gapped the two function CALLS
 * instead, producing a practical a student could complete while learning
 * nothing. This example exists to make that failure concrete. Do not shorten it
 * to save prompt tokens.
 */
const GAP_QUALITY_EXAMPLE = `<gap_quality_worked_example>
Task: "Implement a Caesar cipher", difficulty GUIDED.

BAD — this is the trap. The core is prefilled; the gaps are invocations:
    def encrypt(text, key):
        for ch in text:
            if 'A' <= ch <= 'Z':
                code = (ord(ch) - ord('A') + key) % 26 + ord('A')   ← THE CORE, handed over
                out += chr(code)
        return out
    if __name__ == "__main__":
        encrypted = TODO(1)      ← gap is just "call encrypt(msg, key)"
        decrypted = TODO(2)      ← gap is just "call decrypt(...)"
  A student fills both gaps by copying the function name off the line above and
  has proven NOTHING about the cipher. The shift arithmetic — the entire point of
  the practical — was never theirs to work out.

GOOD — same difficulty, same gap count, core is gapped and scaffolding is given:
    def encrypt(text, key):
        out = ""
        for ch in text:
            if 'A' <= ch <= 'Z':
                # Map 'A'-'Z' to 0-25, shift by key, wrap at 26, map back to ASCII
                code = TODO(1)
                out += chr(code)
            else:
                out += ch
        return out
    if __name__ == "__main__":
        print(encrypt("HELLO", 3))     ← given: this is not what we are teaching
  gaps[1].hint: "Convert the letter to a 0-25 index, add the key, wrap with % 26,
                 then convert back to an ASCII code."
  gaps[1].learn: "modular arithmetic for alphabet wrap-around"

THE TEST, apply it to every gap you write: if a student could fill this gap by
copying a nearby line or reading the variable name, it is the WRONG gap. Gap what
they must REASON about; give them everything they would merely be typing.

If applying that test leaves you with fewer gaps than the difficulty asks for,
RETURN FEWER. Do not top up the count with invocations or declarations — a
padded gap is worse than a missing one, because it costs the student time and
teaches nothing.

The converse is NOT true: never blow past the difficulty's ceiling. If a task
has many steps (a long algebraic simplification, a multi-stage titration), gap
the few that carry the reasoning and PREFILL the rest as worked steps. A
scaffold where every other line is a blank teaches nothing either — the student
is transcribing, not thinking.
</gap_quality_worked_example>`;

/** The unit context block — lets prereqChecks reference what came before (§4b). */
function buildUnitContextBlock(
  path: LearningPath | null,
  practicalNo: number,
  ctx: SubjectContext,
): string {
  if (!path || path.units.length === 0) {
    return "(no learning path approved — treat this practical as standalone)";
  }
  const unitIdx = path.units.findIndex((u) => u.practicalNos.includes(practicalNo));
  if (unitIdx === -1) {
    return "(this practical is not placed in any unit — treat it as standalone)";
  }
  const unit = path.units[unitIdx];
  const titleOf = (n: number) =>
    ctx.practicals.find((p) => p.sr_no === n)?.name ?? `Practical #${n}`;

  const posInUnit = unit.practicalNos.indexOf(practicalNo);
  const siblings = unit.practicalNos
    .map((n, i) => {
      const marker =
        n === practicalNo ? "◀ THIS ONE" : i < posInUnit ? "(already done)" : "(comes later)";
      return `    #${n}: ${titleOf(n)} ${marker}`;
    })
    .join("\n");

  // Everything from earlier units is safely assumed known.
  const earlier = path.units
    .slice(0, unitIdx)
    .flatMap((u) => u.practicalNos)
    .map((n) => `    #${n}: ${titleOf(n)}`)
    .join("\n");

  return `Unit ${unit.unitNo}: ${unit.name}
  Why these are grouped: ${unit.rationale}
  Practicals in this unit, in teaching order:
${siblings}
${earlier ? `  Already covered in EARLIER units (students know this — prereqChecks may draw on it):\n${earlier}` : "  (this is the first unit)"}`;
}

export interface BuildPromptInput {
  ctx: SubjectContext;
  skeleton: PracticalSkeleton;
  path: LearningPath | null;
  difficulty: Difficulty;
  language: string | null;
  customInstruction?: string;
}

export function buildPracticalPrompt(input: BuildPromptInput): string {
  const { ctx, skeleton, path, difficulty, language, customInstruction } = input;

  // CO codes listed VERBATIM as stored in this subject's DB rows. The seeded
  // data is internally consistent per subject but differs across subjects
  // ("CO 1" vs "CO1"), so echoing the exact strings keeps the model aligned with
  // whichever spelling this subject uses. validateCoOrNull normalises either way.
  const coBlock =
    ctx.courseOutcomes.length > 0
      ? ctx.courseOutcomes.map((c) => `  ${c.co_code}: ${c.description}`).join("\n")
      : "  (no course outcomes recorded)";

  const languageBlock = language
    ? `Programming language for this subject: ${language}
Every code artifact you write MUST be in ${language}. Do not switch languages.`
    : "This is NOT a programming subject — do NOT produce a code scaffold unless the practical is unambiguously a coding task.";

  const instructionBlock = customInstruction?.trim()
    ? `\n<binding_faculty_instruction>\nThe assigned faculty gave this instruction for THIS practical. Treat it as BINDING — follow it exactly, even where it overrides a stylistic rule below:\n${customInstruction.trim()}\n</binding_faculty_instruction>\n`
    : "";

  const { min, max } = GAP_COUNT_RANGE[difficulty];

  // A multi-slot practical conducted as one block reads wrong to any lab
  // instructor — 6 hours is three sessions, not one long slot.
  const sessionRule =
    skeleton.hours > 2
      ? `This practical runs ${skeleton.hours} hours — that is ${Math.ceil(skeleton.hours / 2)} lab sessions, NOT one long slot. Structure conductGuide.opener and conductGuide.hintRelease as per-session phases ("Session 1: …", "Session 2: …"), not a single opening.`
      : `This practical runs ${skeleton.hours} hours — a single lab slot. conductGuide.opener and conductGuide.hintRelease describe that one slot.`;

  return `Subject: ${ctx.subjectName}${ctx.subjectCode ? ` (${ctx.subjectCode})` : ""}

<all_modules_digest>
${buildModuleDigest(ctx.modules)}
</all_modules_digest>

<the_practical>
Practical number: ${skeleton.practicalNo}
Title (VERBATIM from the syllabus — restate it as the aim, do not reword it):
  ${skeleton.title}
Duration: ${skeleton.hours} hours
</the_practical>

<unit_context>
${buildUnitContextBlock(path, skeleton.practicalNo, ctx)}
</unit_context>

<course_outcomes>
Use these CO codes EXACTLY as spelled here — copy the string verbatim:
${coBlock}
</course_outcomes>

<language>
${languageBlock}
</language>

<difficulty>
${DIFFICULTY_MEANING[difficulty]}
</difficulty>
${instructionBlock}
RULES (follow every one):

1. scaffold.kind — pick the ONE kind that fits THIS practical:
   - "code_scaffold" for programming tasks (set scaffold.language to the language above)
   - "procedure_scaffold" for bench / observation / apparatus labs (language: null)
   - "calculation_scaffold" for numerical / analysis labs (language: null)
   scaffold.body is a COMPLETE runnable or followable artifact EXCEPT the gaps:
   put TODO(1), TODO(2) … TODO(n) markers inline where the student must work, and
   list every one in gaps[] with a hint and a learn (≤100 chars: the concept
   mastering this gap proves).
   The hint DESCRIBES THE REASONING — it must NEVER contain the literal code,
   expression, or formula that fills the gap. "Convert the letter to a 0-25
   index, add the key, wrap with % 26, then map back to ASCII" is a hint.
   "Calculate (ord(c) - ord('A') + key) % 26 + ord('A')" is the answer pasted
   into the hint, and it makes the gap pointless — the student copies it in
   without reasoning. This holds at EVERY difficulty: guided means a fuller
   explanation of the reasoning, never handing over the line.

   THE GAPS ARE THE WHOLE POINT. Gap the CONCEPTUAL CORE — the reasoning this
   practical exists to teach. NEVER gap:
     - a function/method CALL (the name is on the line above — that is copying)
     - imports, input/Scanner setup, variable declarations, print statements
     - anything a student could fill by pattern-matching a nearby line
   Gap instead the step they must REASON about: the governing expression, the
   comparison, the pointer/state update, the decisive condition.

   For this difficulty: ${min}-${max} gaps. The two bounds are NOT symmetric:
     - NEVER exceed ${max} gaps. This is a hard ceiling. A scaffold with a dozen
       blanks is a worksheet, not a guided artifact — the student loses the
       thread and the gaps table becomes unreadable. If the task decomposes into
       more than ${max} steps, gap only the ${max} most conceptually important
       ones and PREFILL the rest as worked steps.
     - You MAY return fewer than ${min} if this practical genuinely contains
       fewer ideas worth reasoning about. Never invent a filler gap to reach the
       number — a short scaffold of real gaps teaches; one with a function call
       bolted on to hit a count does not.
   In short: quality of each gap beats hitting the floor, but the ceiling is firm.
   The same rule applies to procedure_scaffold (blank the decisive observation or
   control step, not "switch on the apparatus") and calculation_scaffold (blank
   the governing relation and its substitution, not the unit conversion).

${GAP_QUALITY_EXAMPLE}

2. solution — scaffold.body with EVERY TODO(n) replaced by a correct, idiomatic
   fill, and NOTHING else changed. It must read/run as a complete correct
   artifact. It must contain NO "TODO(" text and must NOT be identical to body.

3. theory (≤1800 chars): crisp conceptual brief, no textbook padding.
   workedExample (≤1500 chars): a concrete trace / dry-run with REAL numbers —
   show the actual intermediate values, not a description of what would happen.

4. extensions: 2-3 SELF-CONTAINED problems (statement + expected), graded
   basic → intermediate → stretch. NEVER include a URL, a platform problem
   number, or the name of a specific external problem. You may say "similar
   problems can be practiced on LeetCode/HackerRank" and nothing more specific.

5. commonErrors: EXACTLY 3, each a REAL error a student hits in THIS practical
   (a compiler message, a runtime failure, or a specific conceptual slip), with
   what it means. Specific to this task — not "syntax errors are common".

6. viva: EXACTLY 6, ordered easy → hard. hint is a nudge (≤160 chars), never a
   full answer.

7. rubric: 3-5 criteria summing to EXACTLY 10, matching the PPSU practical CE
   scheme (implementation, understanding, output, viva, record).

8. conductGuide — written to a colleague who will run this lab, never seen by
   students. ${sessionRule}
   checkpoints: EXACTLY 2 mid-lab questions, each phrased with a minute-mark
   intervention trigger ("by minute 40, if they can't say why … intervene and …").
   deliberateMistake: the ONE error worth LETTING students make, plus the debrief
   that turns it into the lesson.
   wrapUp: a closing discussion prompt that ties back to the CO.

9. coCodes: choose ONLY from the CO codes listed above, copied verbatim.
   btl: an integer 1-6 (Bloom) sensible for this task.

10. Teach the syllabus AS WRITTEN, even if the technology is legacy or
    deprecated. If the syllabus says Applets, teach Applets: the scaffold and the
    solution MUST target the syllabus technology. You may add ONE line in theory
    noting the contemporary alternative — but never substitute it, and never
    refuse the task on the grounds that it is outdated.

11. Output JSON only, conforming to the schema.`;
}

// Narrow schema (§19) — mirrors PracticalManualSection MINUS practicalNo/title/
// hours/difficulty, which the skeleton and the request own.
const SECTION_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    aim: { type: "string", maxLength: 300 },
    objectives: {
      type: "array",
      items: { type: "string", maxLength: 140 },
      minItems: 2,
      maxItems: 4,
    },
    coCodes: { type: "array", items: { type: "string", maxLength: 12 } },
    btl: { type: "integer" },
    prereqChecks: {
      type: "array",
      items: { type: "string", maxLength: 160 },
      minItems: 2,
      maxItems: 3,
    },
    theory: { type: "string", maxLength: 1800 },
    workedExample: { type: "string", maxLength: 1500 },
    scaffold: {
      type: "object",
      properties: {
        kind: { type: "string", maxLength: 24 },
        language: { type: "string", maxLength: 24 },
        body: { type: "string", maxLength: 4000 },
        gaps: {
          type: "array",
          items: {
            type: "object",
            properties: {
              n: { type: "integer" },
              hint: { type: "string", maxLength: 200 },
              learn: { type: "string", maxLength: 100 },
            },
            required: ["n", "hint", "learn"],
          },
        },
      },
      required: ["kind", "body", "gaps"],
    },
    solution: { type: "string", maxLength: 6000 },
    expectedOutput: { type: "string", maxLength: 800 },
    commonErrors: {
      type: "array",
      items: {
        type: "object",
        properties: {
          error: { type: "string", maxLength: 200 },
          meaning: { type: "string", maxLength: 240 },
        },
        required: ["error", "meaning"],
      },
    },
    extensions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          level: { type: "string", maxLength: 14 },
          statement: { type: "string", maxLength: 400 },
          expected: { type: "string", maxLength: 240 },
        },
        required: ["level", "statement", "expected"],
      },
    },
    viva: {
      type: "array",
      items: {
        type: "object",
        properties: {
          q: { type: "string", maxLength: 220 },
          hint: { type: "string", maxLength: 160 },
        },
        required: ["q", "hint"],
      },
    },
    rubric: {
      type: "array",
      items: {
        type: "object",
        properties: {
          criterion: { type: "string", maxLength: 80 },
          marks: { type: "integer" },
        },
        required: ["criterion", "marks"],
      },
    },
    conductGuide: {
      type: "object",
      properties: {
        opener: { type: "string", maxLength: 300 },
        hintRelease: { type: "string", maxLength: 300 },
        checkpoints: { type: "array", items: { type: "string", maxLength: 240 } },
        deliberateMistake: { type: "string", maxLength: 240 },
        wrapUp: { type: "string", maxLength: 240 },
      },
      required: ["opener", "hintRelease", "checkpoints", "deliberateMistake", "wrapUp"],
    },
  },
  required: [
    "aim",
    "objectives",
    "coCodes",
    "btl",
    "prereqChecks",
    "theory",
    "workedExample",
    "scaffold",
    "solution",
    "expectedOutput",
    "commonErrors",
    "extensions",
    "viva",
    "rubric",
    "conductGuide",
  ],
};

// ─── Gate helpers ────────────────────────────────────────────────────────────

function str(v: unknown, max: number): string {
  const s = typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
  return s.length > max ? s.slice(0, max) : s;
}

/**
 * Strip every http(s) URL from a string (§8 — MANDATORY, no external links in
 * any generated text). Returns whether anything was removed so the caller can
 * warn once per section rather than once per field.
 */
function stripUrls(s: string): { text: string; stripped: boolean } {
  if (!s) return { text: s, stripped: false };
  URL_PATTERN.lastIndex = 0;
  if (!URL_PATTERN.test(s)) return { text: s, stripped: false };
  URL_PATTERN.lastIndex = 0;
  const text = s
    .replace(URL_PATTERN, "")
    .replace(/\(\s*\)/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
  return { text, stripped: true };
}

/** Which TODO(n) numbers appear in a scaffold body. */
export function todoMarkersIn(body: string): number[] {
  const out: number[] = [];
  TODO_MARKER_PATTERN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TODO_MARKER_PATTERN.exec(body)) !== null) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && !out.includes(n)) out.push(n);
  }
  return out.sort((a, b) => a - b);
}

/**
 * Subject-family fallback when the model returns a kind outside the enum.
 * Deliberately generic (no per-subject hardcoding): the practical's own title
 * decides, with the faculty's language choice as the tiebreak for code.
 */
export function defaultScaffoldKind(
  title: string,
  language: string | null,
): ScaffoldKind {
  if (CODE_PRACTICAL_PATTERN.test(title)) return "code_scaffold";
  if (language) return "code_scaffold";
  if (CALC_PRACTICAL_PATTERN.test(title)) return "calculation_scaffold";
  return "procedure_scaffold";
}

/** Pad or truncate a list to exactly `n`, warning if it had to act. */
function fitList<T>(
  list: T[],
  n: number,
  filler: (i: number) => T,
  label: string,
  practicalNo: number,
  warnings: LabManualWarning[],
): T[] {
  if (list.length === n) return list;
  warnings.push({
    practicalNo,
    kind: "list_length_adjusted",
    message: `${label}: AI returned ${list.length}, expected exactly ${n} — ${
      list.length > n ? "truncated" : "padded (fill the blanks in manually)"
    }.`,
  });
  if (list.length > n) return list.slice(0, n);
  const out = [...list];
  while (out.length < n) out.push(filler(out.length));
  return out;
}

/** Force the rubric to total exactly 10 by adjusting its largest row (§4b). */
function fixRubric(
  rows: RubricRow[],
  practicalNo: number,
  warnings: LabManualWarning[],
): RubricRow[] {
  let out = rows
    .map((r) => ({
      criterion: str(r.criterion, 80),
      marks: Math.trunc(Number(r.marks)) || 0,
    }))
    .filter((r) => r.criterion);

  if (out.length === 0) {
    warnings.push({
      practicalNo,
      kind: "rubric_sum_adjusted",
      message: "Rubric: AI returned no usable rows — inserted the default CE split.",
    });
    return [
      { criterion: "Implementation", marks: 4 },
      { criterion: "Understanding", marks: 3 },
      { criterion: "Output & Record", marks: 3 },
    ];
  }

  if (out.length > RUBRIC_MAX_ROWS) {
    out = out.slice(0, RUBRIC_MAX_ROWS);
  }

  const sum = out.reduce((a, r) => a + r.marks, 0);
  if (sum === RUBRIC_TOTAL_MARKS) return out;

  const delta = RUBRIC_TOTAL_MARKS - sum;
  let largestIdx = 0;
  for (let i = 1; i < out.length; i++) {
    if (out[i].marks > out[largestIdx].marks) largestIdx = i;
  }
  const adjusted = out[largestIdx].marks + delta;

  if (adjusted <= 0) {
    // Adjusting the largest row can't work (e.g. AI returned marks totalling 40).
    // Fall back to an even split rather than emit a zero/negative criterion.
    const base = Math.floor(RUBRIC_TOTAL_MARKS / out.length);
    const rebuilt = out.map((r) => ({ ...r, marks: base }));
    rebuilt[0].marks += RUBRIC_TOTAL_MARKS - base * out.length;
    warnings.push({
      practicalNo,
      kind: "rubric_sum_adjusted",
      message: `Rubric summed to ${sum}, not 10, and could not be fixed by adjusting one row — redistributed evenly. Check the marks.`,
    });
    return rebuilt;
  }

  out[largestIdx] = { ...out[largestIdx], marks: adjusted };
  warnings.push({
    practicalNo,
    kind: "rubric_sum_adjusted",
    message: `Rubric summed to ${sum}, not 10 — adjusted "${out[largestIdx].criterion}" to ${adjusted}.`,
  });
  return out;
}

// ─── The gate ────────────────────────────────────────────────────────────────

export interface GateInput {
  skeleton: PracticalSkeleton;
  difficulty: Difficulty;
  language: string | null;
  validCoCodes: string[];
  /** module_co_mapping codes for the CO fallback — validated, unlike lessonplan's. */
  fallbackCoCodes?: string[];
}

/**
 * Build ONE validated PracticalManualSection from a raw AI object.
 *
 * The single gate for both batch generation and single-practical regen — a
 * second gate would drift. Never throws on bad AI data: it repairs and warns, so
 * a faculty always gets an editable section plus an honest list of what was
 * wrong with it.
 */
export function buildOnePracticalSection(
  row: Record<string, unknown>,
  input: GateInput,
  warnings: LabManualWarning[],
): PracticalManualSection {
  const { skeleton, difficulty, language, validCoCodes } = input;
  const pNo = skeleton.practicalNo;
  let urlHit = false;

  /** Every free-text field goes through here — that's what makes the URL strip total. */
  const clean = (v: unknown, max: number): string => {
    const { text, stripped } = stripUrls(str(v, max));
    if (stripped) urlHit = true;
    return text;
  };

  // ── CO validation (hard gate — strip invalid, warn; never guess) ───────────
  const rawCos = Array.isArray(row.coCodes) ? (row.coCodes as unknown[]) : [];
  const validCos: string[] = [];
  for (const c of rawCos) {
    const valid = validateCoOrNull(String(c), validCoCodes);
    if (valid && !validCos.includes(valid)) validCos.push(valid);
    else if (!valid && String(c).trim()) {
      warnings.push({
        practicalNo: pNo,
        kind: "co_stripped",
        message: `Invalid CO "${String(c).trim()}" removed.`,
      });
    }
  }
  if (validCos.length === 0) {
    // Unlike the lesson-plan fallback, the module-mapped codes are themselves
    // validated before use — module_co_mapping and course_outcomes can drift
    // (see Future_plans.MD), so an unvalidated fallback would smuggle a
    // non-existent CO into the manual on the exact path where the AI already
    // failed.
    const fallback = (input.fallbackCoCodes ?? [])
      .map((c) => validateCoOrNull(c, validCoCodes))
      .filter((c): c is string => !!c);
    if (fallback.length > 0) validCos.push(fallback[0]);
    warnings.push({
      practicalNo: pNo,
      kind: "co_empty",
      message:
        fallback.length > 0
          ? `No valid CO from AI — defaulted to ${fallback[0]}. Confirm it.`
          : "No valid CO from AI and no usable fallback — assign a CO manually.",
    });
  }

  // ── Scaffold ──────────────────────────────────────────────────────────────
  const rawScaffold = (row.scaffold ?? {}) as Record<string, unknown>;
  const rawKind = String(rawScaffold.kind ?? "").trim();
  let kind: ScaffoldKind;
  if ((SCAFFOLD_KINDS as string[]).includes(rawKind)) {
    kind = rawKind as ScaffoldKind;
  } else {
    kind = defaultScaffoldKind(skeleton.title, language);
    warnings.push({
      practicalNo: pNo,
      kind: "scaffold_kind_defaulted",
      message: `Unknown scaffold kind "${rawKind || "(none)"}" — defaulted to ${kind} from the practical title.`,
    });
  }

  const body = clean(rawScaffold.body, 4000);

  const rawGaps = Array.isArray(rawScaffold.gaps) ? (rawScaffold.gaps as unknown[]) : [];
  const gaps: CodeGap[] = rawGaps
    .map((g) => {
      const row2 = (g ?? {}) as Record<string, unknown>;
      return {
        n: Math.trunc(Number(row2.n)),
        hint: clean(row2.hint, 200),
        learn: clean(row2.learn, 100),
      };
    })
    .filter((g) => Number.isFinite(g.n) && g.hint);

  // gap-count vs the difficulty contract — warn, never coerce (§4b): the content
  // is still usable, and only faculty can judge whether to regenerate.
  const { min, max } = GAP_COUNT_RANGE[difficulty];
  if (gaps.length < min || gaps.length > max) {
    warnings.push({
      practicalNo: pNo,
      kind: "gap_count_off_contract",
      message: `${difficulty} expects ${min}-${max} gaps; this scaffold has ${gaps.length}. Regenerate if it reads wrong for the level.`,
    });
  }

  // Gap QUALITY — the contract's real requirement (§4b rule 1): gaps must be the
  // conceptual core. Prompt-only enforcement proved flaky run-to-run, so this
  // catches the residue and surfaces it instead of letting a padded gap ship
  // silently into a student's manual.
  for (const g of gaps) {
    if (BOILERPLATE_LEARN_PATTERN.test(g.learn)) {
      warnings.push({
        practicalNo: pNo,
        kind: "gap_quality_suspect",
        message: `Gap ${g.n} looks like boilerplate — it claims to teach "${g.learn}". Gaps should be the conceptual core; regenerate or re-word this gap.`,
      });
    }
  }

  // TODO(n) ↔ gaps[] correspondence, both directions
  const markers = todoMarkersIn(body);
  const gapNos = gaps.map((g) => g.n);
  const orphanMarkers = markers.filter((n) => !gapNos.includes(n));
  const orphanGaps = gapNos.filter((n) => !markers.includes(n));
  if (orphanMarkers.length > 0) {
    warnings.push({
      practicalNo: pNo,
      kind: "gap_marker_mismatch",
      message: `Scaffold has TODO(${orphanMarkers.join("), TODO(")}) with no matching entry in the gaps table.`,
    });
  }
  if (orphanGaps.length > 0) {
    warnings.push({
      practicalNo: pNo,
      kind: "gap_marker_mismatch",
      message: `Gaps table lists ${orphanGaps.map((n) => `#${n}`).join(", ")} with no matching TODO(n) marker in the scaffold body.`,
    });
  }

  // ── Solution check (§4b — surfaced on the practical card) ──────────────────
  const solution = clean(row.solution, 6000);
  const solutionHasTodo = /TODO\(/.test(solution);
  const solutionIsBody = solution.trim() === body.trim() && body.trim().length > 0;
  if (solutionHasTodo || solutionIsBody || !solution) {
    // Order matters: a solution echoed verbatim from the body ALSO contains the
    // body's TODO markers, so both diagnoses are true at once. "Identical" is
    // the more specific failure and the more actionable one for faculty, so it
    // wins — reporting "contains TODO(" there would describe a symptom rather
    // than the cause.
    warnings.push({
      practicalNo: pNo,
      kind: "solution_incomplete",
      message: !solution
        ? "Model solution is empty — it cannot be used as a marking aid."
        : solutionIsBody
          ? "Model solution is identical to the scaffold — nothing was filled in."
          : "Model solution still contains TODO( markers — it is not a complete solution.",
    });
  }

  // ── Fixed-length lists ────────────────────────────────────────────────────
  const rawErrors = Array.isArray(row.commonErrors) ? (row.commonErrors as unknown[]) : [];
  const commonErrors = fitList(
    rawErrors
      .map((e) => {
        const r = (e ?? {}) as Record<string, unknown>;
        return { error: clean(r.error, 200), meaning: clean(r.meaning, 240) };
      })
      .filter((e) => e.error),
    COMMON_ERRORS_COUNT,
    () => ({ error: "", meaning: "" }),
    "Common errors",
    pNo,
    warnings,
  );

  const rawViva = Array.isArray(row.viva) ? (row.viva as unknown[]) : [];
  const viva: VivaQA[] = fitList(
    rawViva
      .map((v) => {
        const r = (v ?? {}) as Record<string, unknown>;
        return { q: clean(r.q, 220), hint: clean(r.hint, 160) };
      })
      .filter((v) => v.q),
    VIVA_COUNT,
    () => ({ q: "", hint: "" }),
    "Viva questions",
    pNo,
    warnings,
  );

  const rawExt = Array.isArray(row.extensions) ? (row.extensions as unknown[]) : [];
  const allowedLevels = ["basic", "intermediate", "stretch"];
  const extensions: ExtensionProblem[] = rawExt
    .map((e) => {
      const r = (e ?? {}) as Record<string, unknown>;
      const lvl = String(r.level ?? "").toLowerCase().trim();
      return {
        level: (allowedLevels.includes(lvl) ? lvl : "basic") as ExtensionProblem["level"],
        statement: clean(r.statement, 400),
        expected: clean(r.expected, 240),
      };
    })
    .filter((e) => e.statement)
    .slice(0, 3);

  const rawConduct = (row.conductGuide ?? {}) as Record<string, unknown>;
  const rawCheckpoints = Array.isArray(rawConduct.checkpoints)
    ? (rawConduct.checkpoints as unknown[]).map((c) => clean(c, 240)).filter(Boolean)
    : [];
  const checkpoints = fitList(
    rawCheckpoints,
    CHECKPOINT_COUNT,
    () => "",
    "Conduct checkpoints",
    pNo,
    warnings,
  );

  const rubric = fixRubric(
    Array.isArray(row.rubric) ? (row.rubric as RubricRow[]) : [],
    pNo,
    warnings,
  );

  const objectives = (Array.isArray(row.objectives) ? (row.objectives as unknown[]) : [])
    .map((o) => clean(o, 140))
    .filter(Boolean)
    .slice(0, 4);

  const prereqChecks = (Array.isArray(row.prereqChecks) ? (row.prereqChecks as unknown[]) : [])
    .map((p) => clean(p, 160))
    .filter(Boolean)
    .slice(0, 3);

  const btlRaw = Math.trunc(Number(row.btl));
  const btl = Number.isFinite(btlRaw) && btlRaw >= 1 && btlRaw <= 6 ? btlRaw : 3;

  const section: PracticalManualSection = {
    // syllabus-owned — never from the model
    practicalNo: skeleton.practicalNo,
    title: skeleton.title,
    hours: skeleton.hours,
    difficulty,
    aim: clean(row.aim, 300) || skeleton.title,
    objectives,
    coCodes: validCos,
    btl,
    prereqChecks,
    theory: clean(row.theory, 1800),
    workedExample: clean(row.workedExample, 1500),
    scaffold: {
      kind,
      // A code scaffold takes the faculty's chosen language; only if none was
      // chosen does the model's own guess stand in. Non-code kinds are always
      // null (§2) — a "language" on a bench procedure is meaningless.
      language:
        kind === "code_scaffold"
          ? language ?? (clean(rawScaffold.language, 24) || null)
          : null,
      body,
      gaps,
    },
    solution,
    expectedOutput: clean(row.expectedOutput, 800),
    commonErrors,
    extensions,
    viva,
    rubric,
    conductGuide: {
      opener: clean(rawConduct.opener, 300),
      hintRelease: clean(rawConduct.hintRelease, 300),
      checkpoints,
      deliberateMistake: clean(rawConduct.deliberateMistake, 240),
      wrapUp: clean(rawConduct.wrapUp, 240),
    },
  };

  if (urlHit) {
    warnings.push({
      practicalNo: pNo,
      kind: "url_stripped",
      message:
        "An external link was removed from the generated text — check the affected field still reads correctly.",
    });
  }

  return section;
}

// ─── JSON parse ──────────────────────────────────────────────────────────────

function parseJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = String(text ?? "").trim();
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    if (Array.isArray(parsed) && parsed[0]) return parsed[0] as Record<string, unknown>;
  } catch {
    // fall through to brace salvage
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      const parsed = JSON.parse(trimmed.slice(start, end + 1));
      if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
    } catch {
      /* give up */
    }
  }
  return null;
}

// ─── Public: generate ONE practical ──────────────────────────────────────────

export interface GenerateOneInput {
  ctx: SubjectContext;
  practicalNo: number;
  difficulty: Difficulty;
  language: string | null;
  path: LearningPath | null;
  customInstruction?: string;
}

export async function generateOnePractical(
  input: GenerateOneInput,
  logContext: AILogContext,
): Promise<{ section: PracticalManualSection; warnings: LabManualWarning[] }> {
  const { ctx, practicalNo, difficulty, language, path, customInstruction } = input;
  const skeleton = practicalSkeleton(ctx, practicalNo);
  if (!skeleton) {
    throw new Error(`Practical #${practicalNo} not found for this subject`);
  }

  const warnings: LabManualWarning[] = [];
  const validCoCodes = ctx.courseOutcomes.map((c) => c.co_code);
  // module_co_mapping codes, for the validated CO fallback
  const fallbackCoCodes = Array.from(new Set(ctx.modules.flatMap((m) => m.coCodes)));

  const prompt = buildPracticalPrompt({
    ctx,
    skeleton,
    path,
    difficulty,
    language,
    customInstruction,
  });

  let raw: Record<string, unknown> | null = null;
  try {
    const res = await routeAI("lab_manual_gen", {
      model: "flash",
      messages: [{ role: "user", content: prompt }],
      systemPrompt: SYSTEM_PROMPT,
      temperature: 0.4,
      responseSchema: SECTION_RESPONSE_SCHEMA,
      thinkingBudget: 0,
      logContext: {
        ...logContext,
        metadata: {
          ...(logContext.metadata ?? {}),
          stage: "section",
          practicalNo,
          difficulty,
        },
      },
    });
    raw = parseJsonObject(String(res.content ?? ""));
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    console.warn(`[labmanual gen] practical ${practicalNo} failed: ${message}`);
  }

  if (!raw) {
    throw new Error(`Generation returned no usable content for practical #${practicalNo}`);
  }

  const section = buildOnePracticalSection(
    raw,
    { skeleton, difficulty, language, validCoCodes, fallbackCoCodes },
    warnings,
  );
  return { section, warnings };
}

// ─── Public: generate a batch (concurrency 4) ────────────────────────────────

export interface GenerateBatchInput {
  ctx: SubjectContext;
  practicalNos: number[];
  language: string | null;
  path: LearningPath | null;
  difficulties: Record<number, Difficulty>;
  instructions?: Record<number, string>;
}

export interface BatchResult {
  sections: PracticalManualSection[];
  warnings: LabManualWarning[];
  /** practicalNos that threw — surfaced, never silently missing. */
  failed: number[];
}

export async function generatePracticalSections(
  input: GenerateBatchInput,
  logContext: AILogContext,
): Promise<BatchResult> {
  const { ctx, practicalNos, language, path, difficulties, instructions } = input;
  const sections: PracticalManualSection[] = [];
  const warnings: LabManualWarning[] = [];
  const failed: number[] = [];

  for (let i = 0; i < practicalNos.length; i += CONCURRENCY) {
    const window = practicalNos.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      window.map(async (practicalNo) => {
        try {
          return {
            ok: true as const,
            practicalNo,
            ...(await generateOnePractical(
              {
                ctx,
                practicalNo,
                difficulty: difficulties[practicalNo] ?? "standard",
                language,
                path,
                customInstruction: instructions?.[practicalNo],
              },
              logContext,
            )),
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : "unknown error";
          console.warn(`[labmanual gen] practical ${practicalNo}: ${message}`);
          return { ok: false as const, practicalNo };
        }
      }),
    );
    for (const r of results) {
      if (r.ok) {
        sections.push(r.section);
        warnings.push(...r.warnings);
      } else {
        failed.push(r.practicalNo);
      }
    }
  }

  sections.sort((a, b) => a.practicalNo - b.practicalNo);
  return { sections, warnings, failed };
}
