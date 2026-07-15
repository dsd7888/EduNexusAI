// ============================================================================
// Lab Manual — practical-scoped syllabus fingerprint
//
// Mirrors computeSyllabusFingerprint in lessonplan/generator.ts, but scoped to a
// SINGLE practical: lab-manual content is cached per (subject, practical,
// difficulty), so a change to practical #3 must not invalidate #1's cache.
//
// The fingerprint covers exactly the inputs the generated content depends on:
//   title    — the practical's verbatim name (the whole prompt hangs off it)
//   hours    — drives the conduct guide's session structure (§4b rule 8)
//   language — a Python scaffold must NEVER be served to a faculty who chose C,
//              which is why language is IN the fingerprint rather than being a
//              separate cache-key column (§3 note b)
//   COs      — the subject's CO list, which the model picks coCodes from
//
// Difficulty is deliberately NOT here: it is its own cache-key column, so the
// three difficulties of one practical coexist as distinct rows rather than
// evicting each other.
// ============================================================================

import { createHash } from "node:crypto";
import type { SubjectContext } from "@/lib/subjectContext";

export function computePracticalFingerprint(
  ctx: SubjectContext,
  practicalNo: number,
  language: string | null,
): string {
  const practical = ctx.practicals.find((p) => p.sr_no === practicalNo);
  const title = practical?.name ?? "";
  const hours = practical?.hours ?? "";
  const sortedCos = ctx.courseOutcomes
    .map((c) => c.co_code)
    .sort()
    .join(",");

  return createHash("sha256")
    .update(`${title}|${hours}|${language ?? ""}|${sortedCos}`)
    .digest("hex")
    .slice(0, 32);
}
