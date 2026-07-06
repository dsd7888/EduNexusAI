/**
 * AI-based module → Course Outcome (CO) mapping.
 *
 * For one subject, asks Flash which COs each module plausibly *teaches toward*
 * (not mere keyword overlap) and records the result in `module_co_mapping`. This
 * is the per-module CO data that lets question slots target a module's real COs
 * instead of falling back to the subject's whole CO list.
 *
 * Like the Q Bank tagger, this module NEVER throws on a malformed/empty AI
 * response — it logs and returns early, so a bad classification run can't break
 * the syllabus save (or any other caller) it is piggybacked on.
 */

import { routeAI } from "@/lib/ai/router";
import { createAdminClient } from "@/lib/db/supabase-server";

// ─── Types ───────────────────────────────────────────────────────────────────

interface ModuleRow {
  id: string;
  module_number: number;
  name: string;
  description: string | null;
}

interface CourseOutcomeRow {
  co_code: string;
  description: string;
}

interface ClassifiedModule {
  module_number?: number;
  reasoning?: string;
  co_codes?: string[];
  confidence?: string;
}

// ─── Prompt ──────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT =
  "You are an Outcome-Based-Education (OBE) curriculum analyst for an Indian " +
  "engineering university. For each module of a subject you decide which Course " +
  "Outcomes (COs) that module's content genuinely TEACHES toward — i.e. studying " +
  "the module is what builds the ability the CO describes. Judge from the actual " +
  "content described, never from superficial keyword overlap. Be conservative: " +
  "assign a CO only when the module plausibly develops it, and use 'high' " +
  "confidence ONLY when the connection is unambiguous from the description text " +
  "alone. A module may legitimately map to more than one CO. When forced to pick " +
  "despite a weak match, mark that assignment confidence: 'low' rather than " +
  "declining to assign at all. " +
  "The 'always assign at least one CO' rule is a FLOOR, not license to relax " +
  "conservatism elsewhere — every CO beyond the required minimum of one must " +
  "independently meet the same high bar. Confidence rubric: 'high' = the module's " +
  "content is essentially a restatement of what the CO describes; 'medium' = the " +
  "module clearly contributes to building that CO's ability but isn't its primary " +
  "source; 'low' = this is the closest available CO under the floor rule, but the " +
  "genuine connection is weak.";

// Schema-constrained output — Gemini guarantees the shape, so no parse salvage.
// confidence is left as a plain string and normalised in code (matches the
// project's validateTags convention; avoids relying on the enum schema dialect).
const RESPONSE_SCHEMA = {
  type: "array",
  items: {
    type: "object",
    properties: {
      reasoning: {
        type: "string",
        description:
          "Briefly justify the CO choice(s) by referencing specific module content against the CO description — write this before deciding co_codes.",
      },
      module_number: {
        type: "integer",
        description: "The module number being classified.",
      },
      co_codes: {
        type: "array",
        items: { type: "string" },
        minItems: 1,
        description:
          "One or more CO codes (from the provided list) this module teaches toward.",
      },
      confidence: {
        type: "string",
        description:
          "high | medium | low — overall confidence in this module's CO assignment.",
      },
    },
    required: ["reasoning", "module_number", "co_codes", "confidence"],
  },
};

function buildUserPrompt(
  subjectName: string,
  modules: ModuleRow[],
  outcomes: CourseOutcomeRow[]
): string {
  const coBlock = outcomes
    .map((c) => `${c.co_code}: ${c.description}`)
    .join("\n");

  const moduleBlock = modules
    .map(
      (m) =>
        `Module ${m.module_number}: ${m.name}${
          m.description ? ` — ${m.description}` : ""
        }`
    )
    .join("\n\n");

  return `Subject: ${subjectName}

<course_outcomes>
${coBlock}
</course_outcomes>

<modules>
${moduleBlock}
</modules>

For EACH module above, list every CO it genuinely teaches toward. Only assign a
CO when the module's content plausibly develops that outcome — ignore shallow
keyword overlap. Every module maps to at least one CO — if no clean match exists,
assign the single CLOSEST one rather than leaving it empty, since the content is
taught in this course and carries exam weightage regardless of fit. A module may
map to several COs when genuinely warranted, but co_codes must never be an empty
array. Output one object per module: { module_number, co_codes, confidence }.`;
}

function normaliseConfidence(v: unknown): "high" | "medium" | "low" {
  const s = String(v ?? "").toLowerCase().trim();
  return s === "high" || s === "medium" || s === "low" ? s : "medium";
}

function lowerConfidence(
  a: "high" | "medium" | "low",
  b: "high" | "medium" | "low"
): "high" | "medium" | "low" {
  const rank: Record<string, number> = { high: 2, medium: 1, low: 0 };
  return rank[a] <= rank[b] ? a : b;
}

// ─── Public entrypoint ─────────────────────────────────────────────────────

/**
 * Classify every module of `subjectId` against the subject's COs and upsert the
 * result into `module_co_mapping` (source='ai_inferred'). Idempotent: re-running
 * for the same subject updates the same (module_id, co_code) rows rather than
 * adding duplicates. superadmin_verified and faculty_verified rows are left
 * untouched so a re-run can never downgrade a human-verified mapping back to
 * ai_inferred.
 */
export async function classifyModulesForSubject(
  subjectId: string
): Promise<void> {
  const admin = createAdminClient();

  const { data: subjectRow } = await admin
    .from("subjects")
    .select("name")
    .eq("id", subjectId)
    .maybeSingle();
  const subjectName = (subjectRow as { name?: string } | null)?.name ?? "this subject";

  const { data: moduleRows, error: modErr } = await admin
    .from("modules")
    .select("id, module_number, name, description")
    .eq("subject_id", subjectId)
    .order("module_number");
  const modules = (moduleRows ?? []) as ModuleRow[];

  const { data: coRows, error: coErr } = await admin
    .from("course_outcomes")
    .select("co_code, description")
    .eq("subject_id", subjectId);
  const outcomes = (coRows ?? []) as CourseOutcomeRow[];

  if (modErr || coErr) {
    console.warn(
      `[classifyModulesForSubject] fetch failed for ${subjectId}:`,
      modErr?.message ?? coErr?.message
    );
    return;
  }
  if (modules.length === 0 || outcomes.length === 0) {
    // Nothing to map against — not an error, just nothing to do.
    return;
  }

  const validCoCodes = new Set(outcomes.map((c) => c.co_code));
  const moduleIdByNumber = new Map(modules.map((m) => [m.module_number, m.id]));

  let parsed: ClassifiedModule[];
  try {
    const aiParams = {
      model: "flash" as const,
      messages: [
        {
          role: "user" as const,
          content: buildUserPrompt(subjectName, modules, outcomes),
        },
      ],
      systemPrompt: SYSTEM_PROMPT,
      temperature: 0,
      thinkingBudget: 0,
      maxTokens: 2048,
      responseSchema: RESPONSE_SCHEMA,
    };

    const [resultA, resultB] = await Promise.all([
      routeAI("module_co_classify", aiParams),
      routeAI("module_co_classify", aiParams),
    ]);

    const parsePass = (result: typeof resultA, label: string): ClassifiedModule[] => {
      const raw = JSON.parse(String(result.content ?? ""));
      if (!Array.isArray(raw)) {
        console.warn(`[classifyModulesForSubject] non-array response (${label}) for ${subjectId}`);
        return [];
      }
      return raw as ClassifiedModule[];
    };

    const passA = parsePass(resultA, "passA");
    const passB = parsePass(resultB, "passB");

    if (passA.length === 0 && passB.length === 0) {
      console.warn(`[classifyModulesForSubject] both passes returned empty for ${subjectId}`);
      return;
    }

    const passAMap = new Map<number, ClassifiedModule>();
    const passBMap = new Map<number, ClassifiedModule>();
    for (const e of passA) { if (typeof e.module_number === "number") passAMap.set(e.module_number, e); }
    for (const e of passB) { if (typeof e.module_number === "number") passBMap.set(e.module_number, e); }

    const allModuleNumbers = new Set([...passAMap.keys(), ...passBMap.keys()]);
    parsed = [];
    for (const modNum of allModuleNumbers) {
      const a = passAMap.get(modNum);
      const b = passBMap.get(modNum);
      if (a && !b) { parsed.push(a); continue; }
      if (b && !a) { parsed.push(b); continue; }
      if (a && b) {
        const sortedA = [...(a.co_codes ?? [])].sort();
        const sortedB = [...(b.co_codes ?? [])].sort();
        const sameSet =
          sortedA.length === sortedB.length &&
          sortedA.every((c, i) => c === sortedB[i]);
        if (sameSet) {
          parsed.push({
            module_number: modNum,
            co_codes: sortedA,
            confidence: lowerConfidence(
              normaliseConfidence(a.confidence),
              normaliseConfidence(b.confidence)
            ),
          });
        } else {
          const unionCodes = [...new Set([...sortedA, ...sortedB])];
          parsed.push({ module_number: modNum, co_codes: unionCodes, confidence: "low" });
        }
      }
    }
  } catch (err) {
    console.warn(
      `[classifyModulesForSubject] AI call/parse failed for ${subjectId}:`,
      err instanceof Error ? err.message : err
    );
    return;
  }

  // Build the ai_inferred rows, keeping only valid (module, CO) pairs.
  const rows: Array<{
    module_id: string;
    co_code: string;
    confidence: "high" | "medium" | "low";
    source: "ai_inferred";
  }> = [];
  const seen = new Set<string>(); // guards against duplicate pairs in one batch
  for (const entry of parsed) {
    const moduleId =
      typeof entry.module_number === "number"
        ? moduleIdByNumber.get(entry.module_number)
        : undefined;
    if (!moduleId || !Array.isArray(entry.co_codes)) continue;
    const confidence = normaliseConfidence(entry.confidence);
    for (const code of entry.co_codes) {
      const co = String(code ?? "").trim();
      if (!co || !validCoCodes.has(co)) continue;
      const key = `${moduleId}::${co}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({ module_id: moduleId, co_code: co, confidence, source: "ai_inferred" });
    }
  }

  if (rows.length === 0) {
    console.warn(
      `[classifyModulesForSubject] no usable mappings produced for ${subjectId}`
    );
    return;
  }

  // Never overwrite a human-verified mapping with an ai_inferred one.
  const { data: verifiedRows } = await admin
    .from("module_co_mapping")
    .select("module_id, co_code")
    .in("module_id", modules.map((m) => m.id))
    .in("source", ["superadmin_verified", "faculty_verified"]);
  const verified = new Set(
    ((verifiedRows ?? []) as Array<{ module_id: string; co_code: string }>).map(
      (r) => `${r.module_id}::${r.co_code}`
    )
  );
  const toUpsert = rows.filter(
    (r) => !verified.has(`${r.module_id}::${r.co_code}`)
  );
  if (toUpsert.length === 0) return;

  // ON CONFLICT (module_id, co_code) DO UPDATE — re-running is idempotent, not
  // additive: the same pairs are refreshed in place rather than duplicated.
  const { error: upsertErr } = await admin
    .from("module_co_mapping")
    .upsert(toUpsert, { onConflict: "module_id,co_code" });
  if (upsertErr) {
    console.warn(
      `[classifyModulesForSubject] upsert failed for ${subjectId}:`,
      upsertErr.message
    );
    return;
  }

  console.log(
    `[classifyModulesForSubject] ${subjectId}: upserted ${toUpsert.length} ` +
      `module↔CO mapping(s) across ${modules.length} module(s)`
  );
}
