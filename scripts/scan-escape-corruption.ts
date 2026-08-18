/**
 * Scan stored AI-generated content for the Gemini JSON-escape collision.
 *
 * READ-ONLY by default. Makes no AI calls. Supabase SELECTs only.
 *
 *   npx tsx scripts/scan-escape-corruption.ts                 # report
 *   npx tsx scripts/scan-escape-corruption.ts --samples=20    # more context dumps
 *   npx tsx scripts/scan-escape-corruption.ts --mark-stale    # Part 4 remediation
 *
 * THE BUG (CP-N6): under a responseSchema Gemini sometimes emits a SINGLE
 * backslash before a LaTeX command whose first letter is also a JSON short
 * escape (`\frac` `\theta` `\nabla` `\rho` `\beta`). `JSON.parse` does not throw
 * — those are valid escapes — so the formula silently decodes to a raw control
 * character plus the command remainder (`\frac{dQ}{dt}` → 0x0C + "rac{dQ}{dt}").
 *
 * Detection lives in `findEscapeCorruption` (src/lib/text/latexSegments.ts), the
 * SAME whitelist the pre-parse repair uses, so scanner and repair can never
 * disagree about what counts as corruption.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  findEscapeCorruption,
  type EscapeCorruptionHit,
} from "../src/lib/text/latexSegments";

function loadEnvLocal(): void {
  let raw: string;
  try {
    raw = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
  } catch {
    return;
  }
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}
loadEnvLocal();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const db = createClient(url, serviceKey, { auth: { persistSession: false } });

const SAMPLE_LIMIT = Number(
  process.argv.find((a) => a.startsWith("--samples="))?.split("=")[1] ?? 10,
);
const MARK_STALE = process.argv.includes("--mark-stale");

/** Render control chars visibly so a terminal dump is readable. */
function visible(s: string): string {
  return s.replace(/[\x00-\x1F]/g, (c) => {
    const code = c.charCodeAt(0);
    const named: Record<number, string> = {
      8: "\\b", 9: "\\t", 10: "\\n", 11: "\\v", 12: "\\f", 13: "\\r",
    };
    return `«${named[code] ?? `0x${code.toString(16).padStart(2, "0")}`}»`;
  });
}

type PathHit = EscapeCorruptionHit & { path: string; context: string };

/** Walk any JSON value and scan every string leaf. */
function scanValue(value: unknown, path = "$"): PathHit[] {
  const out: PathHit[] = [];
  if (typeof value === "string") {
    for (const h of findEscapeCorruption(value)) {
      out.push({
        ...h,
        path,
        context: visible(value.slice(Math.max(0, h.index - 40), h.index + 45)),
      });
    }
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => out.push(...scanValue(v, `${path}[${i}]`)));
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out.push(...scanValue(v, `${path}.${k}`));
    }
  }
  return out;
}

interface TableSpec {
  table: string;
  /** LaTeX-bearing columns to scan; ["*"] scans the whole row. */
  fields: string[];
  meta: string[];
}

const TABLES: TableSpec[] = [
  { table: "study_notes", fields: ["blocks"], meta: ["id", "subject_id", "module_id", "version", "is_stale"] },
  { table: "faculty_question_bank", fields: ["question_text", "model_answer", "options"], meta: ["id", "subject_id", "faculty_id", "source", "is_verified"] },
  { table: "qpaper_drafts", fields: ["builder_state"], meta: ["id", "faculty_id", "subject_id", "label"] },
  { table: "qpaper_history", fields: ["structure_summary"], meta: ["id", "faculty_id", "subject_id", "label"] },
  { table: "generated_content", fields: ["title", "metadata"], meta: ["id", "subject_id", "type", "status"] },
  { table: "lab_manual_cache", fields: ["payload"], meta: ["id", "subject_id", "practical_no", "difficulty"] },
  // Faculty-OWNED editable manual — never auto-touched, only reported.
  { table: "lab_manuals", fields: ["doc"], meta: ["id", "subject_id", "faculty_id", "status"] },
  { table: "lesson_plan_cache", fields: ["*"], meta: ["id"] },
  { table: "lesson_plans", fields: ["*"], meta: ["id", "subject_id", "faculty_id"] },
  { table: "quizzes", fields: ["*"], meta: ["id", "subject_id"] },
  { table: "pyq_questions", fields: ["*"], meta: ["id", "subject_id"] },
  { table: "syllabus_audit_cache", fields: ["*"], meta: ["id", "subject_id"] },
  { table: "semantic_cache", fields: ["response"], meta: ["id", "module_id"] },
  { table: "chat_messages", fields: ["content"], meta: ["id", "session_id", "role"] },
];

interface FlaggedRow {
  table: string;
  meta: Record<string, unknown>;
  hits: PathHit[];
}

async function scanTable(spec: TableSpec) {
  const flagged: FlaggedRow[] = [];
  const bySeverity: Record<string, number> = { certain: 0, likely: 0 };
  let scanned = 0;
  const PAGE = 500;

  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db.from(spec.table).select("*").range(from, from + PAGE - 1);
    if (error) return { scanned, flagged, bySeverity, error: error.message };
    if (!data || data.length === 0) break;
    for (const row of data) {
      scanned++;
      const r = row as Record<string, unknown>;
      const target =
        spec.fields[0] === "*" ? r : Object.fromEntries(spec.fields.map((f) => [f, r[f]]));
      const hits = scanValue(target);
      if (hits.length) {
        for (const h of hits) bySeverity[h.severity]++;
        flagged.push({ table: spec.table, meta: Object.fromEntries(spec.meta.map((m) => [m, r[m]])), hits });
      }
    }
    if (data.length < PAGE) break;
  }
  return { scanned, flagged, bySeverity };
}

async function main() {
  console.log(
    `Gemini JSON-escape corruption scan — ${MARK_STALE ? "REMEDIATION (writes study_notes.is_stale)" : "READ-ONLY"}\n`,
  );
  const all: FlaggedRow[] = [];
  const lines: string[] = [];

  for (const spec of TABLES) {
    const res = await scanTable(spec);
    if ("error" in res && res.error) {
      lines.push(`${spec.table.padEnd(26)} SKIPPED — ${res.error}`);
      continue;
    }
    all.push(...res.flagged);
    lines.push(
      `${spec.table.padEnd(26)} scanned=${String(res.scanned).padStart(6)}  flagged=${String(res.flagged.length).padStart(5)}  hits(certain:${res.bySeverity.certain} likely:${res.bySeverity.likely})`,
    );
  }

  console.log("── PER-TABLE ──────────────────────────────────────────────");
  for (const l of lines) console.log(l);

  console.log(`\n── SAMPLES (up to ${SAMPLE_LIMIT} flagged rows) ────────────`);
  for (const row of all.slice(0, SAMPLE_LIMIT)) {
    console.log(`\n[${row.table}] ${JSON.stringify(row.meta)}`);
    for (const h of row.hits.slice(0, 4)) {
      console.log(`    ${h.severity.padEnd(7)} ${h.path}  ${JSON.stringify(h.command)}`);
      console.log(`      …${h.context}…`);
    }
  }
  console.log(`\nTOTAL flagged rows: ${all.length}`);

  if (!MARK_STALE) {
    console.log("\n(read-only; pass --mark-stale to apply Part 4 remediation)");
    return;
  }

  // ── Part 4 remediation ────────────────────────────────────────────────────
  // study_notes: regenerable on next request → mark stale, never edit in place.
  const notes = all.filter((r) => r.table === "study_notes");
  for (const r of notes) {
    const { error } = await db
      .from("study_notes")
      .update({ is_stale: true })
      .eq("id", r.meta.id as string);
    console.log(error ? `  FAILED ${r.meta.id}: ${error.message}` : `  marked stale: ${r.meta.id}`);
  }
  // lab_manual_cache: a pure shared regeneration cache (first faculty pays,
  // colleagues reuse) — deleting a row costs one regeneration, nothing else.
  const lmc = all.filter((r) => r.table === "lab_manual_cache");
  for (const r of lmc) {
    const { error } = await db.from("lab_manual_cache").delete().eq("id", r.meta.id as string);
    console.log(error ? `  FAILED ${r.meta.id}: ${error.message}` : `  cache row deleted: ${r.meta.id}`);
  }
  // Everything else is faculty-owned or finalized → reported, never auto-touched.
  const manual = all.filter(
    (r) => r.table !== "study_notes" && r.table !== "lab_manual_cache",
  );
  console.log(`\nFACULTY-OWNED / FINALIZED — manual review required (${manual.length}):`);
  for (const r of manual) console.log(`  [${r.table}] ${JSON.stringify(r.meta)}`);
  if (manual.length === 0) console.log("  (none)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
