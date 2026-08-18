/**
 * Module → quantitative/conceptual classification (CP-Q1.5, gate 1 of NAT
 * integrity).
 *
 * A NAT (numerical answer type) question is only legitimate where the module's
 * content actually supports computing a number. Posing one over a module that
 * teaches symbolic or descriptive material produces the worst possible output:
 * a confidently-stated wrong number, which looks legitimate to precisely the
 * student who cannot check it. Verified during CP-Q1 — a NAT item generated
 * against Cryptography's classical-ciphers module got the Vigenère ciphertext
 * wrong and then correctly counted the unique letters of its own wrong string.
 *
 * This module decides, once per module, whether NAT is admissible there.
 *
 * REUSE — this is `src/lib/qpaper/moduleCoClassifier.ts` with a different
 * question. Same dual-pass Flash structure (§17: "for any AI judgment with
 * high-stakes output, run a second independent call"), same
 * agreement→keep-with-lower-confidence / disagreement→force-low resolution,
 * same never-throw contract, and the same never-overwrite-a-human rule that
 * module_co_mapping uses for faculty_verified rows. It is a sibling rather than
 * a generalisation of that file because the output shape (one enum per module,
 * written onto `modules`) shares no code with a many-to-many CO upsert — the
 * pattern is shared, the mechanics are not.
 *
 * ONE INPUT IT DOES NOT SHARE with the CO classifier: sample bank questions.
 * `modules.description` is a topic list, and topic lists systematically hide
 * task shape — the keyword probe that motivated this table classified an
 * AC-circuits module as non-quantitative because "Impedance and Power Factor"
 * contains no verb. Real questions previously written for a module reveal what
 * students are actually asked to do with it, so up to 5 are fed in when they
 * exist.
 */

import { routeAI } from "@/lib/ai/router";
import type { createAdminClient } from "@/lib/db/supabase-server";
import type { AILogContext } from "@/lib/ai/providers/types";

type AdminClient = ReturnType<typeof createAdminClient>;

export type QuantProfile = "quantitative" | "conceptual";
export type QuantConfidence = "high" | "medium" | "low";

/** Sample questions per module fed into the prompt. */
const BANK_SAMPLES_PER_MODULE = 5;

interface ModuleRow {
  id: string;
  module_number: number;
  name: string;
  description: string | null;
  quant_profile: string | null;
  quant_confidence: string | null;
  quant_source: string | null;
}

interface ClassifiedModule {
  module_number?: number;
  rationale?: string;
  profile?: string;
  confidence?: string;
}

export interface QuantClassificationRow {
  moduleId: string;
  moduleNumber: number;
  moduleName: string;
  profile: QuantProfile;
  confidence: QuantConfidence;
  /** True when this row was written; false when it was identical to what was
   *  already stored (so quant_classified_at was deliberately left alone). */
  written: boolean;
}

export interface QuantClassificationResult {
  subjectId: string;
  classified: QuantClassificationRow[];
  /** Modules skipped because a human already judged them. */
  skippedFacultyVerified: Array<{ moduleId: string; moduleNumber: number }>;
  /** Non-fatal notes (empty subject, unparseable pass, no usable output). */
  warnings: string[];
}

// ─── Prompt ────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT =
  "You are a curriculum analyst for an Indian engineering university. For each " +
  "module of a subject you decide ONE thing: can a Numerical Answer Type (NAT) " +
  "question be posed from this module's content — a question whose answer is a " +
  "single number the student computes, and which an examiner can mark right or " +
  "wrong without judgement?\n\n" +
  "'quantitative' = yes. The module contains formulae, laws, algorithms with " +
  "measurable cost, or defined arithmetic/statistical procedures, so a concrete " +
  "numeric instance can be posed and solved. Examples: circuit analysis (Ohm's " +
  "law, KCL/KVL), probability, algorithm complexity on a given input, " +
  "stoichiometry, number systems and binary arithmetic.\n" +
  "'conceptual' = no. The module teaches definitions, classifications, " +
  "architectures, protocols, symbolic manipulation, or comparative discussion. " +
  "A number could only be extracted by contriving one — counting letters in a " +
  "cipher output, counting items in a list, or asking how many phases a protocol " +
  "has. Those are NOT quantitative questions; they are trivia dressed as " +
  "arithmetic, and they are the exact failure this classification prevents.\n\n" +
  "Judge from what a student DOES with the content, not from whether numbers " +
  "appear in it. A module can mention key sizes and rounds and still be entirely " +
  "conceptual. When genuinely torn, answer 'quantitative' with confidence 'low' " +
  "— a downstream verifier re-checks every numeric answer, so an over-inclusive " +
  "low-confidence call is recoverable, whereas wrongly marking a module " +
  "conceptual silently removes a valid question type with no signal.\n\n" +
  "Confidence: 'high' = unambiguous from the content alone; 'medium' = clear " +
  "enough but the content is mixed; 'low' = genuinely borderline.";

// Narrow schema (§19). `rationale` is generated BEFORE `profile` so the model
// reasons then decides rather than decides then justifies — the same field
// ordering the CO classifier relies on.
const RESPONSE_SCHEMA = {
  type: "array",
  items: {
    type: "object",
    properties: {
      rationale: {
        type: "string",
        maxLength: 240,
        description:
          "One sentence naming the specific module content that decides it. Write this before choosing profile.",
      },
      module_number: { type: "integer" },
      profile: {
        type: "string",
        description: "quantitative | conceptual",
      },
      confidence: {
        type: "string",
        description: "high | medium | low",
      },
    },
    required: ["rationale", "module_number", "profile", "confidence"],
  },
};

function buildUserPrompt(
  subjectName: string,
  modules: ModuleRow[],
  samplesByModule: Map<string, string[]>
): string {
  const moduleBlock = modules
    .map((m) => {
      const samples = samplesByModule.get(m.id) ?? [];
      const sampleBlock =
        samples.length > 0
          ? `\n  Questions previously set on this module:\n${samples
              .map((q) => `    - ${q.replace(/\s+/g, " ").slice(0, 200)}`)
              .join("\n")}`
          : "\n  (no questions have been set on this module yet)";
      return `Module ${m.module_number}: ${m.name}\n  Topics: ${
        m.description?.replace(/\s+/g, " ").trim() || "(none recorded)"
      }${sampleBlock}`;
    })
    .join("\n\n");

  return `Subject: ${subjectName}

<modules>
${moduleBlock}
</modules>

Classify EVERY module above as 'quantitative' or 'conceptual' per the definition
you were given. Output one object per module.

The "Topics" line is a syllabus topic list — it states what is covered, never
what a student is asked to do, so its lack of verbs like "calculate" means
nothing. Where sample questions are present, weight them heavily: they are direct
evidence of the task shape this module actually carries.

"rationale" is at most 25 words. Name the deciding content and stop — do not
restate the definitions or weigh both sides.`;
}

// ─── Normalisation / dual-pass resolution ──────────────────────────────────

function normaliseProfile(v: unknown): QuantProfile | null {
  const s = String(v ?? "").toLowerCase().trim();
  if (s === "quantitative" || s === "quant") return "quantitative";
  if (s === "conceptual" || s === "concept") return "conceptual";
  return null;
}

function normaliseConfidence(v: unknown): QuantConfidence {
  const s = String(v ?? "").toLowerCase().trim();
  return s === "high" || s === "medium" || s === "low" ? s : "medium";
}

function lowerConfidence(
  a: QuantConfidence,
  b: QuantConfidence
): QuantConfidence {
  const rank: Record<QuantConfidence, number> = { high: 2, medium: 1, low: 0 };
  return rank[a] <= rank[b] ? a : b;
}

/**
 * Resolve one module's two passes.
 *
 * Agreement → keep the label, take the LOWER confidence (the CO classifier's
 * rule: two passes agreeing does not make either more certain than its own
 * weaker estimate).
 *
 * Disagreement → 'quantitative' at confidence 'low'. This is the binary
 * analogue of the CO classifier's union-with-force-low: union means "the more
 * inclusive answer", and here inclusion means allowing the question type. It
 * also fails in the recoverable direction — an over-inclusive call is caught by
 * CP-Q2's per-item verifier, whereas a wrongly-conceptual call silently deletes
 * NAT from that module with no downstream signal.
 */
function resolvePasses(
  a: ClassifiedModule | undefined,
  b: ClassifiedModule | undefined
): { profile: QuantProfile; confidence: QuantConfidence } | null {
  const pa = a ? normaliseProfile(a.profile) : null;
  const pb = b ? normaliseProfile(b.profile) : null;
  if (!pa && !pb) return null;
  if (pa && !pb) return { profile: pa, confidence: normaliseConfidence(a?.confidence) };
  if (pb && !pa) return { profile: pb, confidence: normaliseConfidence(b?.confidence) };
  if (pa === pb) {
    return {
      profile: pa as QuantProfile,
      confidence: lowerConfidence(
        normaliseConfidence(a?.confidence),
        normaliseConfidence(b?.confidence)
      ),
    };
  }
  return { profile: "quantitative", confidence: "low" };
}

// ─── Public entrypoint ─────────────────────────────────────────────────────

/**
 * Classify every module of `subjectId` and write the result onto `modules`.
 *
 * Never throws — a failed classification leaves modules unclassified, and
 * unclassified means NAT-allowed, so a bad run degrades to today's behaviour
 * rather than breaking a caller.
 *
 * Idempotent in the strong sense: re-running skips `faculty_verified` rows
 * entirely, and leaves an `ai_classified` row's `quant_classified_at` untouched
 * when the profile and confidence both come back identical — so the timestamp
 * means "when this judgement last CHANGED", not "when the classifier last ran".
 */
export async function classifyModulesForSubjectQuant(
  subjectId: string,
  admin: AdminClient,
  logContext?: Partial<AILogContext>
): Promise<QuantClassificationResult> {
  const result: QuantClassificationResult = {
    subjectId,
    classified: [],
    skippedFacultyVerified: [],
    warnings: [],
  };

  const { data: subjectRow } = await admin
    .from("subjects")
    .select("name, code")
    .eq("id", subjectId)
    .maybeSingle();
  const subjectName =
    (subjectRow as { name?: string } | null)?.name ?? "this subject";
  const subjectCode =
    (subjectRow as { code?: string | null } | null)?.code ?? null;

  const { data: moduleRows, error: modErr } = await admin
    .from("modules")
    .select(
      "id, module_number, name, description, quant_profile, quant_confidence, quant_source"
    )
    .eq("subject_id", subjectId)
    .order("module_number");
  if (modErr) {
    result.warnings.push(`module fetch failed: ${modErr.message}`);
    return result;
  }
  const allModules = (moduleRows ?? []) as ModuleRow[];

  // Never re-judge what a human has judged (module_co_mapping semantics).
  const modules = allModules.filter((m) => {
    if (m.quant_source === "faculty_verified") {
      result.skippedFacultyVerified.push({
        moduleId: m.id,
        moduleNumber: m.module_number,
      });
      return false;
    }
    return true;
  });

  if (modules.length === 0) {
    if (allModules.length > 0) {
      result.warnings.push(
        "every module is faculty_verified — nothing for the classifier to do"
      );
    }
    return result;
  }

  // Sample bank questions per module — task shape where topics hide it.
  const samplesByModule = new Map<string, string[]>();
  const { data: bankRows } = await admin
    .from("faculty_question_bank")
    .select("module_id, question_text")
    .eq("subject_id", subjectId)
    .in(
      "module_id",
      modules.map((m) => m.id)
    )
    .limit(BANK_SAMPLES_PER_MODULE * modules.length * 2);
  for (const r of (bankRows ?? []) as Array<{
    module_id: string | null;
    question_text: string;
  }>) {
    if (!r.module_id) continue;
    const list = samplesByModule.get(r.module_id) ?? [];
    if (list.length < BANK_SAMPLES_PER_MODULE) {
      list.push(r.question_text);
      samplesByModule.set(r.module_id, list);
    }
  }

  // ── Dual pass ───────────────────────────────────────────────────────────
  let parsed: Map<number, { profile: QuantProfile; confidence: QuantConfidence }>;
  try {
    const baseLogContext: AILogContext = {
      userId: logContext?.userId ?? null,
      userEmail: logContext?.userEmail ?? null,
      userRole: logContext?.userRole ?? null,
      subjectId,
      subjectCode,
      jobId: logContext?.jobId ?? crypto.randomUUID(),
      relatedContentId: null,
      feature: logContext?.feature ?? "admin_classification",
    };
    const aiParams = {
      model: "flash" as const,
      messages: [
        {
          role: "user" as const,
          content: buildUserPrompt(subjectName, modules, samplesByModule),
        },
      ],
      systemPrompt: SYSTEM_PROMPT,
      temperature: 0,
      thinkingBudget: 0,
      maxTokens: 2048,
      responseSchema: RESPONSE_SCHEMA,
    };

    const [resA, resB] = await Promise.all([
      routeAI("module_quant_classify", {
        ...aiParams,
        logContext: { ...baseLogContext, metadata: { pass: 1 } },
      }),
      routeAI("module_quant_classify", {
        ...aiParams,
        logContext: { ...baseLogContext, metadata: { pass: 2 } },
      }),
    ]);

    const parsePass = (content: unknown, label: string): ClassifiedModule[] => {
      try {
        const raw = JSON.parse(String(content ?? ""));
        if (!Array.isArray(raw)) {
          result.warnings.push(`${label}: non-array response`);
          return [];
        }
        return raw as ClassifiedModule[];
      } catch {
        result.warnings.push(`${label}: unparseable response`);
        return [];
      }
    };

    const passA = parsePass(resA.content, "pass 1");
    const passB = parsePass(resB.content, "pass 2");
    if (passA.length === 0 && passB.length === 0) {
      result.warnings.push("both passes returned nothing usable");
      return result;
    }

    const byNumA = new Map<number, ClassifiedModule>();
    const byNumB = new Map<number, ClassifiedModule>();
    for (const e of passA) {
      if (typeof e.module_number === "number") byNumA.set(e.module_number, e);
    }
    for (const e of passB) {
      if (typeof e.module_number === "number") byNumB.set(e.module_number, e);
    }

    parsed = new Map();
    for (const m of modules) {
      const resolved = resolvePasses(
        byNumA.get(m.module_number),
        byNumB.get(m.module_number)
      );
      if (resolved) parsed.set(m.module_number, resolved);
    }
  } catch (err) {
    result.warnings.push(
      `AI call failed: ${err instanceof Error ? err.message : "unknown error"}`
    );
    return result;
  }

  // ── Write-back ──────────────────────────────────────────────────────────
  const now = new Date().toISOString();
  for (const m of modules) {
    const verdict = parsed.get(m.module_number);
    if (!verdict) {
      result.warnings.push(
        `module ${m.module_number}: no verdict from either pass — left unclassified`
      );
      continue;
    }

    const unchanged =
      m.quant_profile === verdict.profile &&
      m.quant_confidence === verdict.confidence &&
      m.quant_source === "ai_classified";

    if (!unchanged) {
      const { error } = await admin
        .from("modules")
        .update({
          quant_profile: verdict.profile,
          quant_confidence: verdict.confidence,
          quant_source: "ai_classified",
          quant_classified_at: now,
        })
        .eq("id", m.id)
        // Defence in depth against a concurrent faculty edit landing between
        // the read above and this write. Written as an explicit `is.null OR
        // neq` because SQL's `quant_source <> 'faculty_verified'` evaluates to
        // NULL — not true — on an unclassified row, so a bare .neq() would
        // silently match nothing on exactly the rows this classifier exists to
        // fill in.
        .or("quant_source.is.null,quant_source.neq.faculty_verified");
      if (error) {
        result.warnings.push(
          `module ${m.module_number}: write failed — ${error.message}`
        );
        continue;
      }
    }

    result.classified.push({
      moduleId: m.id,
      moduleNumber: m.module_number,
      moduleName: m.name,
      profile: verdict.profile,
      confidence: verdict.confidence,
      written: !unchanged,
    });
  }

  console.log(
    `[quantClassifier] ${subjectId}: ${result.classified.length} classified ` +
      `(${result.classified.filter((r) => r.written).length} written), ` +
      `${result.skippedFacultyVerified.length} faculty_verified skipped`
  );
  return result;
}
