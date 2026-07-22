// ============================================================================
// Syllabus Health Audit — cache fingerprint
//
// Same idea as computeSyllabusFingerprint (lessonplan/generator.ts) and
// computePracticalFingerprint (labmanual/fingerprint.ts): hash the inputs a
// generation depends on, store it on the cache row, treat a mismatch as a miss.
//
// The audit's input surface is WIDER than either of those, which is why this
// isn't a straight reuse of the lesson-plan function:
//
//   modules      — the AI proposes CO mappings and BTL additions against them
//   CO codes AND DESCRIPTIONS — co_verb_quality rewrites the description, so a
//                  description edit MUST invalidate a proposal to rewrite it
//                  (the lesson-plan fingerprint covers CO codes only)
//   practicals   — feed the module digest the prompt carries
//   CO-PO rows   — drive the PO coverage findings sent to the model
//
// Anything the model was shown must be in here. A field that is shown but not
// hashed is the stale-proposal bug: the faculty edits it, the fingerprint still
// matches, and the cache serves a fix for a syllabus that no longer exists.
// ============================================================================

import { createHash } from "node:crypto";
import type { AuditInput } from "./types";

export function computeAuditFingerprint(input: AuditInput): string {
  const { ctx, coPoMappings } = input;
  const h = createHash("sha256");

  const modules = [...ctx.modules].sort((a, b) => a.module_number - b.module_number);
  for (const m of modules) {
    h.update(
      `M${m.module_number}|${m.name}|${m.description}|${m.hours ?? ""}|` +
        `${m.weightage_percent ?? ""}|${[...m.btl_levels].sort((a, b) => a - b).join(",")}|` +
        `${[...m.coCodes].sort().join(",")}\n`,
    );
  }

  const cos = [...ctx.courseOutcomes].sort((a, b) =>
    a.co_code.localeCompare(b.co_code),
  );
  for (const c of cos) h.update(`C${c.co_code}|${c.description}\n`);

  const pracs = [...ctx.practicals].sort((a, b) => a.sr_no - b.sr_no);
  for (const p of pracs) h.update(`P${p.sr_no}|${p.name}|${p.hours ?? ""}\n`);

  const poRows = coPoMappings
    .map((r) => `${r.co_code}>${r.po_code}=${r.strength ?? ""}`)
    .sort();
  for (const r of poRows) h.update(`O${r}\n`);

  return h.digest("hex").slice(0, 32);
}
