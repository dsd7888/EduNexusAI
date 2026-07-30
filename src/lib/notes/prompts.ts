/**
 * Notes v2 — generation prompt and responseSchema for module-scope notes.
 *
 * The schema below and the ceilings quoted in the prompt are both derived from
 * LIMITS in ./types.ts (§17 single-source rule). Per §19 the schema is narrow —
 * a real `anyOf` discriminated union, NOT one flat object with every field
 * optional. That distinction is load-bearing: a flattened union invites the
 * model to emit `symbols` on a concept block and `axes` on a formula block, and
 * irrelevant optional fields are exactly what drives runaway token cost.
 * (Verified against the deployed Flash endpoint: anyOf is accepted, and concept
 * blocks come back free of formula fields.)
 */

import { MATH_CHEM_NOTATION_GUIDE } from "@/lib/text/latexSegments";
import { LIMITS, NOTE_BLOCKS_MIN, NOTE_BLOCKS_MAX } from "./types";

// ─── responseSchema ─────────────────────────────────────────────────────────

const CONCEPT_SCHEMA = {
  type: "object",
  properties: {
    kind: { type: "string", enum: ["concept"] },
    id: { type: "string", maxLength: LIMITS.id },
    title: { type: "string", maxLength: LIMITS.concept.title },
    plainExplanation: { type: "string", maxLength: LIMITS.concept.plainExplanation },
    formalStatement: { type: "string", maxLength: LIMITS.concept.formalStatement },
    whyItMatters: { type: "string", maxLength: LIMITS.concept.whyItMatters },
    relatedTerms: {
      type: "array",
      maxItems: LIMITS.concept.relatedTerms.maxItems,
      items: { type: "string", maxLength: LIMITS.concept.relatedTerms.maxLength },
    },
  },
  required: ["kind", "id", "title", "plainExplanation", "whyItMatters"],
};

const FORMULA_SCHEMA = {
  type: "object",
  properties: {
    kind: { type: "string", enum: ["formula"] },
    id: { type: "string", maxLength: LIMITS.id },
    name: { type: "string", maxLength: LIMITS.formula.name },
    formula: { type: "string", maxLength: LIMITS.formula.formula },
    symbols: {
      type: "array",
      minItems: 1,
      maxItems: LIMITS.formula.symbols.maxItems,
      items: {
        type: "object",
        properties: {
          symbol: { type: "string", maxLength: LIMITS.formula.symbols.symbol },
          meaning: { type: "string", maxLength: LIMITS.formula.symbols.meaning },
          unit: { type: "string", maxLength: LIMITS.formula.symbols.unit },
        },
        required: ["symbol", "meaning"],
      },
    },
    workedExample: {
      type: "object",
      properties: {
        problem: { type: "string", maxLength: LIMITS.formula.workedExample.problem },
        solution: { type: "string", maxLength: LIMITS.formula.workedExample.solution },
      },
      required: ["problem", "solution"],
    },
    conditions: { type: "string", maxLength: LIMITS.formula.conditions },
  },
  required: ["kind", "id", "name", "formula", "symbols"],
};

const COMPARISON_SCHEMA = {
  type: "object",
  properties: {
    kind: { type: "string", enum: ["comparison"] },
    id: { type: "string", maxLength: LIMITS.id },
    title: { type: "string", maxLength: LIMITS.comparison.title },
    axes: {
      type: "array",
      minItems: 1,
      maxItems: LIMITS.comparison.axes.maxItems,
      items: { type: "string", maxLength: LIMITS.comparison.axes.maxLength },
    },
    items: {
      type: "array",
      minItems: LIMITS.comparison.items.minItems,
      maxItems: LIMITS.comparison.items.maxItems,
      items: {
        type: "object",
        properties: {
          name: { type: "string", maxLength: LIMITS.comparison.items.name },
          values: {
            type: "array",
            minItems: 1,
            maxItems: LIMITS.comparison.axes.maxItems,
            items: { type: "string", maxLength: LIMITS.comparison.items.value },
          },
        },
        required: ["name", "values"],
      },
    },
  },
  required: ["kind", "id", "title", "axes", "items"],
};

/**
 * The whole response.
 *
 * THE OUTER ARRAY CARRIES NO minItems/maxItems, AND THAT IS DELIBERATE.
 *
 * Gemini rejects a responseSchema whose constraint state count is too large
 * ("The specified schema produces a constraint that has too many states for
 * serving" — a 400 at request validation). §19 already records that maxItems
 * drives that count; measured against the deployed Flash endpoint, the OUTER
 * array's bounds dominate it, and this union is expensive enough that they are
 * unaffordable:
 *
 *   strings + nested bounds + outer maxItems 12  → REJECTED
 *   strings + nested bounds + outer maxItems  4  → REJECTED
 *   strings + nested bounds + outer minItems  4  → REJECTED
 *   strings + nested bounds + NO outer bounds    → SERVED   ← this one
 *
 * Dropping the outer bounds keeps everything that cannot be recovered
 * elsewhere: every string maxLength, and every nested array bound (symbols ≤ 8,
 * comparison items 2–4, axes ≤ 6). Block COUNT is the one constraint the prompt
 * can state plainly and validateNoteBlocks can enforce exactly, so it is the
 * cheapest thing to move out of the schema. NOTE_BLOCKS_MIN/MAX still bind —
 * in <coverage> in the prompt and as a hard reject in the validator.
 *
 * Do not "tidy" minItems/maxItems back onto `blocks`: it makes every call 400.
 */
export const MODULE_NOTES_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    blocks: {
      type: "array",
      items: { anyOf: [CONCEPT_SCHEMA, FORMULA_SCHEMA, COMPARISON_SCHEMA] },
    },
  },
  required: ["blocks"],
};

// ─── Prompt ─────────────────────────────────────────────────────────────────

export const NOTES_SYSTEM_PROMPT =
  "You are producing exam-preparation study notes for a university engineering " +
  "student. Structure matters more than volume. A concept block IS the concept — " +
  "not an introduction TO it: the student reads the block instead of the " +
  "textbook, not before it. Write what a strong student would write on a revision " +
  "card the night before the exam.";

/**
 * Few-shot examples, one per kind.
 *
 * Layout discipline is learned far better from a concrete good/bad pair than
 * from instructions — proven by CP4's visualize interactive worked example. The
 * BAD cases here are the three failure modes actually worth pre-empting:
 * a concept that only announces its topic, a formula with unexplained symbols,
 * and a "comparison" that is really two disconnected descriptions.
 */
const BLOCK_EXAMPLES = `EXAMPLES — study the difference between GOOD and BAD.

CONCEPT — GOOD:
{"kind":"concept","id":"concept-kirchhoffs-voltage-law","title":"Kirchhoff's Voltage Law",
 "plainExplanation":"Walk around any closed loop in a circuit and add up every voltage rise and drop as you go. When you arrive back where you started, the total is always zero — you cannot gain or lose energy by walking in a circle.",
 "formalStatement":"For any closed loop in a lumped circuit, the algebraic sum of the potential differences is zero: $\\\\sum_{k=1}^{n} V_k = 0$.",
 "whyItMatters":"Every mesh-analysis question starts by writing one KVL equation per loop. Without it you cannot solve any multi-loop circuit.",
 "relatedTerms":["mesh analysis","loop current","KCL"]}

CONCEPT — BAD (announces the topic instead of teaching it; whyItMatters is filler):
{"kind":"concept","id":"concept-kvl","title":"KVL",
 "plainExplanation":"Kirchhoff's Voltage Law is an important law in circuit theory that students should understand well.",
 "whyItMatters":"It is important for exams."}

FORMULA — GOOD (every symbol explained; worked example is a real calculation):
{"kind":"formula","id":"formula-ohms-law","name":"Ohm's Law","formula":"$V = IR$",
 "symbols":[{"symbol":"V","meaning":"Potential difference","unit":"V"},
            {"symbol":"I","meaning":"Current through the element","unit":"A"},
            {"symbol":"R","meaning":"Resistance","unit":"\\\\Omega"}],
 "workedExample":{"problem":"A 5 Ω resistor carries 2 A. Find the voltage across it.",
                  "solution":"Substitute into $V = IR$: $V = 2 \\\\times 5 = 10$ V."},
 "conditions":"Applies to ohmic conductors at constant temperature."}

FORMULA — BAD (symbols unexplained, no units, worked example restates the formula):
{"kind":"formula","id":"formula-1","name":"Ohms law","formula":"V=IR",
 "symbols":[{"symbol":"V","meaning":"V"}],
 "workedExample":{"problem":"Find V.","solution":"Use V=IR."}}

COMPARISON — GOOD (axes are shared dimensions; every item answers every axis):
{"kind":"comparison","id":"comparison-series-vs-parallel-resistors","title":"Series vs Parallel Resistors",
 "axes":["Current","Voltage","Equivalent resistance"],
 "items":[{"name":"Series","values":["Same through every resistor","Divides across resistors","$R_{eq}=R_1+R_2$"]},
          {"name":"Parallel","values":["Divides between branches","Same across every branch","$1/R_{eq}=1/R_1+1/R_2$"]}]}

COMPARISON — BAD (axes are not shared dimensions; values do not line up):
{"kind":"comparison","id":"comparison-resistors","title":"Resistors",
 "axes":["Series","Parallel"],
 "items":[{"name":"Description","values":["Resistors in a line"]}]}`;

export function buildModuleNotesPrompt(input: {
  subjectName: string;
  subjectCode: string;
  moduleNumber: number;
  moduleName: string;
  moduleDescription: string | null;
  /** The syllabus section for this module (or the subject content fallback). */
  syllabusContent: string;
}): string {
  const {
    subjectName,
    subjectCode,
    moduleNumber,
    moduleName,
    moduleDescription,
    syllabusContent,
  } = input;

  const L = LIMITS;

  return `Produce exam-preparation study notes for ONE module of a university engineering subject.

<subject>
${subjectName} (${subjectCode})
</subject>

<module>
Module ${moduleNumber}: ${moduleName}
${moduleDescription ? `\nTopics: ${moduleDescription}` : ""}
</module>

<syllabus_content>
${syllabusContent}
</syllabus_content>

<how_to_choose_block_types>
Read the module topics. For each significant idea, decide which of the three
block types fits it best:

- "concept"    — definitions, theorems, principles. Use when the thing to learn
                 is WHAT something is and why it holds.
- "formula"    — any quantitative rule with symbols. Use whenever the idea is
                 expressed as an equation the student must apply.
- "comparison" — use when the exam question IS the distinction between two to
                 four things ("X vs Y", "types of Z").

Do not force a type. A module of pure theory should produce mostly concept
blocks and few or no formula blocks; a module built on equations should produce
several formula blocks. Choose per idea, not per module.
</how_to_choose_block_types>

<coverage>
Produce at least ${NOTE_BLOCKS_MIN} and at most ${NOTE_BLOCKS_MAX} blocks.
If you have fewer than ${NOTE_BLOCKS_MIN} strong ideas, look again at the
syllabus content for the sub-topics you skipped. If you have more than
${NOTE_BLOCKS_MAX}, CONSOLIDATE — merge closely related ideas into one block and
drop the marginal ones. Comprehensive is worse than focused for exam prep.
</coverage>

<length_ceilings>
These are hard ceilings, not targets. Shorter is better everywhere.
- concept.title              ≤ ${L.concept.title} characters
- concept.plainExplanation   ≤ ${L.concept.plainExplanation} characters (about 90 words)
- concept.formalStatement    ≤ ${L.concept.formalStatement} characters (omit if the concept has no formal form)
- concept.whyItMatters       ≤ ${L.concept.whyItMatters} characters (about 45 words)
- concept.relatedTerms       ≤ ${L.concept.relatedTerms.maxItems} terms, each ≤ ${L.concept.relatedTerms.maxLength} characters
- formula.name               ≤ ${L.formula.name} characters
- formula.formula            ≤ ${L.formula.formula} characters
- formula.symbols            ≤ ${L.formula.symbols.maxItems} rows; explain EVERY symbol that appears in the formula
- formula.workedExample      problem ≤ ${L.formula.workedExample.problem}, solution ≤ ${L.formula.workedExample.solution} characters
- formula.conditions         ≤ ${L.formula.conditions} characters
- comparison.title           ≤ ${L.comparison.title} characters
- comparison.axes            ≤ ${L.comparison.axes.maxItems} axes, each ≤ ${L.comparison.axes.maxLength} characters
- comparison.items           ${L.comparison.items.minItems}–${L.comparison.items.maxItems} items, name ≤ ${L.comparison.items.name}, each value ≤ ${L.comparison.items.value} characters
</length_ceilings>

<comparison_rule>
axes are the SHARED DIMENSIONS being compared (e.g. "Key count", "Speed",
"Use case") — never the names of the things being compared. Every item MUST
supply exactly one value per axis, in the same order as axes. A row with a
different number of values is invalid.
</comparison_rule>

<worked_examples>
Include a workedExample on a formula block whenever a numeric example is
possible. A formula the student has seen applied once is worth far more than a
formula they have only read. The solution must show the substitution and the
arithmetic, not merely restate the formula.
</worked_examples>

<block_ids>
Every block needs an "id" of the form <kind>-<slug>:
  - <kind> is exactly the block's own kind: concept, formula, or comparison.
  - <slug> is the block's title (or name, for a formula) lowercased, with
    apostrophes REMOVED and every other run of non-alphanumeric characters
    replaced by a single hyphen. No leading, trailing or doubled hyphens.
  Examples:
    "Kirchhoff's Voltage Law"          -> concept-kirchhoffs-voltage-law
    "Ohm's Law"                        -> formula-ohms-law
    "Symmetric vs Asymmetric Encryption" -> comparison-symmetric-vs-asymmetric-encryption

Derive the id from the title EVERY time — never invent a random or numeric id.
Regenerating these notes for unchanged content must produce the same ids.
Ids must be unique within the response.
</block_ids>

${MATH_CHEM_NOTATION_GUIDE}

<accuracy>
Do not invent formulas, theorems, constants or results that the syllabus content
above does not support. If you are unsure whether a concept belongs to this
module, OMIT it. Completeness is not the goal; correctness is. A confidently
wrong formula in a student's revision notes is worse than a missing one.
</accuracy>

${BLOCK_EXAMPLES}

Return JSON only, matching the provided schema: {"blocks":[ ... ]}.`;
}
