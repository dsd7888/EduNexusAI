/**
 * Bulk-ingest real company placement-prep material into placement_question_bank
 * (source='real_company'), so bank-first serving in /api/placement/prep/generate
 * mixes real questions ahead of AI-generated ones — no serving-code change needed.
 *
 * Requires migration 20260907000000_placement_bank_source.sql applied first
 * (adds source/source_document/is_verified/content_hash columns).
 *
 * Usage:
 *   npx tsx scripts/ingest-placement-bank.ts <root-dir> [--company=TCS] [--limit=N]
 *     [--concurrency=N] [--dry-run]
 *
 * Handles PDF + image (direct Gemini multimodal attachment), DOCX/PPTX (OOXML
 * text extraction via adm-zip, no new deps), HTML/HTM (tag-stripped text), TXT
 * (read directly), and ZIP (recursed one level, each entry processed by its own
 * extension). Explicitly skips: page-resource dumps (`<N>_files/` directories
 * from "Save Page As, Complete"), decorative images/icons (<15KB) and GIFs,
 * legacy .doc/.rar/.enc/.xlsx (no parser available, logged not silently lost),
 * and .css/.js webpage assets.
 *
 * Resumable: progress is checkpointed to <root-dir>/.placement-ingest-state.json
 * after every file, so an interrupted run (Ctrl-C, crash, rate limit) picks up
 * where it left off on the next invocation instead of re-spending on files
 * already processed. SIGINT/SIGTERM flush the state file before exit.
 *
 * Dedup: content_hash (sha256 of normalized question+options) is unique-indexed
 * in the DB; inserts use upsert(...,{onConflict:'content_hash',ignoreDuplicates:true})
 * so the same question recurring across overlapping source files is a no-op,
 * not an error — safe to re-run over the same corpus.
 */

import { readFileSync, readdirSync, writeFileSync, existsSync, Dirent } from "node:fs";
import { join, extname, relative, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import AdmZip from "adm-zip";

(globalThis as Record<string, unknown>).AsyncLocalStorage = AsyncLocalStorage;

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

// ─── CLI args ───────────────────────────────────────────────────────────────

interface Opts {
  root: string;
  company?: string;
  limit?: number;
  concurrency: number;
  dryRun: boolean;
}

function parseArgs(): Opts {
  const args = process.argv.slice(2);
  const positional = args.filter((a) => !a.startsWith("--"));
  const root = positional[0];
  if (!root) {
    console.error(
      "Usage: npx tsx scripts/ingest-placement-bank.ts <root-dir> [--company=TCS] [--limit=N] [--concurrency=N] [--dry-run]"
    );
    process.exit(1);
  }
  const flag = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
  return {
    root: resolve(root),
    company: flag("company"),
    limit: flag("limit") ? Number(flag("limit")) : undefined,
    concurrency: flag("concurrency") ? Number(flag("concurrency")) : 4,
    dryRun: args.includes("--dry-run"),
  };
}

// ─── File classification ───────────────────────────────────────────────────

const SKIP_DIR_RE = /^\d+_files$/i;
const ATTACHMENT_EXT = new Set([".pdf", ".png", ".jpg", ".jpeg"]);
const OOXML_EXT = new Set([".docx", ".pptx"]);
const HTML_EXT = new Set([".htm", ".html"]);
const TEXT_EXT = new Set([".txt"]);
const ARCHIVE_EXT = new Set([".zip"]);
const SILENT_SKIP_EXT = new Set([".css", ".js", ".gif", ".map"]);
const UNSUPPORTED_EXT = new Set([".doc", ".rar", ".enc", ".xlsx", ".zenc"]);

const MIN_IMAGE_BYTES = 15_000; // filters out icons/logos/buttons
const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024; // Gemini inline-data safety margin

const COMPANY_LABELS: Record<string, string> = {
  ACCENTURE: "Accenture",
  CAPGEMINI: "Capgemini",
  DELLOITE: "Deloitte",
  IBM: "IBM",
  INFOSYS: "Infosys",
  TCS: "TCS",
  WIPRO: "Wipro",
  ZENPACT: "Genpact", // folder is misnamed — contents are all Genpact-branded material
};

function companyLabelFor(relPath: string): string {
  const top = relPath.split(/[/\\]/)[0] ?? "";
  return COMPANY_LABELS[top.toUpperCase()] ?? top;
}

interface FileRef {
  relPath: string;
  ext: string;
  read: () => Buffer;
}

function walk(dir: string, root: string, out: FileRef[]): void {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    console.warn(`  cannot read dir ${dir}: ${err instanceof Error ? err.message : err}`);
    return;
  }
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    const abs = join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIR_RE.test(e.name)) continue;
      walk(abs, root, out);
    } else if (e.isFile()) {
      out.push({
        relPath: relative(root, abs),
        ext: extname(e.name).toLowerCase(),
        read: () => readFileSync(abs),
      });
    }
  }
}

// ─── OOXML / HTML text extraction (no new deps — reuses adm-zip, already a
// dependency for ppt-refine's XML patching) ─────────────────────────────────

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/g, "&");
}

function extractRuns(xml: string, re: RegExp): string {
  const parts: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) parts.push(decodeXmlEntities(m[1]));
  return parts.join(" ");
}

function extractDocxText(buf: Buffer): string {
  const zip = new AdmZip(buf);
  const entry = zip.getEntry("word/document.xml");
  if (!entry) return "";
  return extractRuns(entry.getData().toString("utf8"), /<w:t[^>]*>([\s\S]*?)<\/w:t>/g);
}

function extractPptxText(buf: Buffer): string {
  const zip = new AdmZip(buf);
  const slides = zip
    .getEntries()
    .filter((e) => /^ppt\/slides\/slide\d+\.xml$/.test(e.entryName))
    .sort((a, b) => {
      const na = Number(a.entryName.match(/slide(\d+)\.xml$/)?.[1] ?? 0);
      const nb = Number(b.entryName.match(/slide(\d+)\.xml$/)?.[1] ?? 0);
      return na - nb;
    });
  return slides.map((e) => extractRuns(e.getData().toString("utf8"), /<a:t[^>]*>([\s\S]*?)<\/a:t>/g)).join("\n\n");
}

function extractHtmlText(buf: Buffer): string {
  let html = buf.toString("utf8");
  html = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ");
  return decodeXmlEntities(html).replace(/\s+/g, " ").trim();
}

type ExtractionInput =
  | { kind: "attachment"; mediaType: string; data: string }
  | { kind: "text"; text: string }
  | null;

function buildExtractionInput(ext: string, buf: Buffer): ExtractionInput {
  switch (ext) {
    case ".pdf":
      if (buf.length > MAX_ATTACHMENT_BYTES) return null;
      return { kind: "attachment", mediaType: "application/pdf", data: buf.toString("base64") };
    case ".png":
    case ".jpg":
    case ".jpeg":
      if (buf.length < MIN_IMAGE_BYTES || buf.length > MAX_ATTACHMENT_BYTES) return null;
      return {
        kind: "attachment",
        mediaType: ext === ".png" ? "image/png" : "image/jpeg",
        data: buf.toString("base64"),
      };
    case ".docx": {
      const t = extractDocxText(buf);
      return t.trim().length > 20 ? { kind: "text", text: t } : null;
    }
    case ".pptx": {
      const t = extractPptxText(buf);
      return t.trim().length > 20 ? { kind: "text", text: t } : null;
    }
    case ".htm":
    case ".html": {
      const t = extractHtmlText(buf);
      return t.trim().length > 40 ? { kind: "text", text: t } : null;
    }
    case ".txt": {
      const t = buf.toString("utf8");
      return t.trim().length > 20 ? { kind: "text", text: t } : null;
    }
    default:
      return null;
  }
}

// One level of zip recursion: each entry re-enters buildExtractionInput by its
// own extension. Nested zips beyond depth 1 are skipped (bounded complexity).
function collectZipEntries(buf: Buffer, relPath: string, depth: number): FileRef[] {
  if (depth > 1) return [];
  try {
    const zip = new AdmZip(buf);
    const out: FileRef[] = [];
    for (const entry of zip.getEntries()) {
      if (entry.isDirectory) continue;
      if (SKIP_DIR_RE.test(entry.entryName.split("/").find((s) => SKIP_DIR_RE.test(s)) ?? "")) continue;
      const ext = extname(entry.entryName).toLowerCase();
      const entryRelPath = `${relPath}::${entry.entryName}`;
      if (ext === ".zip") {
        out.push(...collectZipEntries(entry.getData(), entryRelPath, depth + 1));
      } else {
        out.push({ relPath: entryRelPath, ext, read: () => entry.getData() });
      }
    }
    return out;
  } catch (err) {
    console.warn(`  zip read failed for ${relPath}: ${err instanceof Error ? err.message : err}`);
    return [];
  }
}

// ─── Question extraction (Gemini) ──────────────────────────────────────────

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    questions: {
      // No maxItems here — a maxItems bound on a large nested-object array
      // blows Gemini's constraint-state limit (400 "too many states for
      // serving"), same class of bug as MODULE_NOTES_RESPONSE_SCHEMA
      // (src/lib/notes/generator.ts). The 25-question cap is prompt-only.
      // Every string leaf IS maxLength-capped, though (safe — the "too many
      // states" bug is specific to maxItems on the array, not per-field
      // maxLength): with thinkingBudget:0, reasoning-heavy items (logical
      // puzzles, seating arrangement) made the model "think out loud" inside
      // `explanation` with unbounded multi-attempt exploration, truncating
      // the JSON mid-string even at 32768 maxTokens (measured, Sep 2026).
      type: "array",
      items: {
        type: "object",
        properties: {
          question_text: { type: "string", maxLength: 800 },
          options: {
            type: "array",
            items: {
              type: "object",
              properties: {
                key: { type: "string", maxLength: 5 },
                text: { type: "string", maxLength: 300 },
              },
              required: ["key", "text"],
            },
          },
          correct_answer: { type: "string", maxLength: 5 },
          answer_in_source: { type: "boolean" },
          explanation: { type: "string", maxLength: 350 },
          difficulty: { type: "string", maxLength: 10 },
          track: { type: "string", maxLength: 20 },
          topic: { type: "string", maxLength: 150 },
        },
        required: [
          "question_text",
          "options",
          "correct_answer",
          "answer_in_source",
          "explanation",
          "difficulty",
          "track",
          "topic",
        ],
      },
    },
  },
  required: ["questions"],
};

const SYSTEM_PROMPT =
  "You are extracting genuine multiple-choice placement-preparation questions from real Indian campus " +
  "recruitment prep material (company OA papers, question banks, prep-site dumps). Extract only — never " +
  "invent questions. Skip narrative/interview-experience text, resume tips, subjective/essay questions, and " +
  "open-ended 'write a program' coding questions — only extract items that already have discrete " +
  "multiple-choice options in the source.";

function buildUserPrompt(companyLabel: string, sourceLabel: string, taxonomy: string): string {
  return (
    `Source: ${companyLabel} placement prep material — "${sourceLabel}".\n\n` +
    `Extract genuine multiple-choice questions from this material — STOP at 25 even if the source has ` +
    `more (pick the clearest and most varied 25; never exceed 25). For each question:\n` +
    `- question_text: the exact question, cleaned of OCR/formatting noise\n` +
    `- options: the exact answer options as given (2-6, typically 4), key A/B/C/D... matching the source\n` +
    `- correct_answer: the option key, if the source states or clearly marks it; otherwise your own best-determined answer\n` +
    `- answer_in_source: true ONLY if the source itself states/marks the correct answer; false if you had to work it out yourself\n` +
    `- explanation: ONE short sentence, max ~40 words. State the method/answer directly — never show exploratory ` +
    `working, multiple attempts, or phrases like "let me try" / "this means... assume instead". If you cannot ` +
    `confidently solve it in one pass, give your best single answer, set answer_in_source: false, and write a ` +
    `terse one-line explanation anyway — do not reason at length in this field\n` +
    `- difficulty: easy, medium, or hard\n` +
    `- track: EXACTLY one of: aptitude, verbal, domain, communication\n` +
    `- topic: EXACTLY one string copied verbatim from the allowed list for that track below — pick the closest match, never invent a new topic string\n\n` +
    `Allowed track -> topic taxonomy (topic must be copied verbatim from this list):\n${taxonomy}\n\n` +
    `If the material has no genuine MCQ content (pure narrative, interview experience, resume tips, ` +
    `code-writing problems with no options), return an empty questions array.`
  );
}

interface RawQuestion {
  question_text?: string;
  options?: { key?: string; text?: string }[];
  correct_answer?: string;
  answer_in_source?: boolean;
  explanation?: string;
  difficulty?: string;
  track?: string;
  topic?: string;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeForHash(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function contentHash(questionText: string, options: { key: string; text: string }[]): string {
  const optPart = options
    .map((o) => normalizeForHash(o.text))
    .sort()
    .join("|");
  return createHash("sha256").update(`${normalizeForHash(questionText)}::${optPart}`).digest("hex");
}

interface BankRow {
  track: string;
  topic: string;
  topic_bucket: string;
  difficulty: "easy" | "medium" | "hard";
  question_text: string;
  options: { key: string; text: string }[];
  correct_answer: string;
  explanation: string;
  company_context: string;
  source: "real_company";
  source_document: string;
  content_hash: string;
  is_verified: boolean;
  is_active: boolean;
  question_type: "mcq";
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const opts = parseArgs();
  if (!existsSync(opts.root)) {
    console.error(`Root dir not found: ${opts.root}`);
    process.exit(1);
  }

  const { workAsyncStorage } = await import(
    "next/dist/server/app-render/work-async-storage.external.js"
  );
  const { routeAI } = await import("@/lib/ai/router");
  const { createAdminClient } = await import("@/lib/db/supabase-server");
  const { TRACKS, TRACK_SECTIONS, VALID_TRACKS } = await import("@/lib/placement/tracks");

  const TAXONOMY_BY_TRACK: Record<string, Set<string>> = {};
  const taxonomyLines: string[] = [];
  for (const track of TRACKS) {
    const topics = TRACK_SECTIONS[track].flatMap((s) => s.topics);
    TAXONOMY_BY_TRACK[track] = new Set(topics.map((t) => t.toLowerCase()));
    taxonomyLines.push(`${track}: ${topics.join(" | ")}`);
  }
  const taxonomyMap: Record<string, Record<string, string>> = {}; // track -> lower(topic) -> canonical topic
  for (const track of TRACKS) {
    taxonomyMap[track] = {};
    for (const s of TRACK_SECTIONS[track]) {
      for (const t of s.topics) taxonomyMap[track][t.toLowerCase()] = t;
    }
  }
  const taxonomy = taxonomyLines.join("\n");

  // Real request scope not available outside Next's runtime — routeAI logs cost
  // via next/server's after(). Per CLAUDE.md's harness guidance: INVOKE the
  // callback (don't discard it), so ai_call_logs actually records this run's
  // spend rather than silently going empty.
  const store = { afterContext: { after: (fn: () => void) => fn() } };

  const admin = createAdminClient();

  const allFiles: FileRef[] = [];
  walk(opts.root, opts.root, allFiles);

  const statePath = join(opts.root, ".placement-ingest-state.json");
  interface State {
    done: Record<string, { status: string; questions: number; at: string }>;
    totals: { files: number; questions: number; costInr: number };
  }
  let state: State = { done: {}, totals: { files: 0, questions: 0, costInr: 0 } };
  if (existsSync(statePath)) {
    try {
      state = JSON.parse(readFileSync(statePath, "utf8"));
    } catch {
      console.warn("  state file unreadable, starting fresh");
    }
  }

  let flushScheduled = false;
  function flushState(): void {
    flushScheduled = false;
    writeFileSync(statePath, JSON.stringify(state, null, 2));
  }
  function scheduleFlush(): void {
    if (flushScheduled) return;
    flushScheduled = true;
    setImmediate(flushState);
  }

  let shuttingDown = false;
  function shutdown(signal: string): void {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\nReceived ${signal} — flushing state and exiting...`);
    flushState();
    process.exit(130);
  }
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  const skipUnsupported: Record<string, number> = {};
  const counts = { attachment: 0, ooxml: 0, html: 0, txt: 0, archive: 0, silentSkip: 0, unsupported: 0, alreadyDone: 0 };

  // Expand archives up front so they participate in the same worker pool.
  const workItems: FileRef[] = [];
  for (const f of allFiles) {
    if (opts.company && !f.relPath.toUpperCase().startsWith(opts.company.toUpperCase())) continue;
    if (ARCHIVE_EXT.has(f.ext)) {
      counts.archive++;
      try {
        workItems.push(...collectZipEntries(f.read(), f.relPath, 0));
      } catch (err) {
        console.warn(`  failed to open archive ${f.relPath}: ${err instanceof Error ? err.message : err}`);
      }
      continue;
    }
    if (SILENT_SKIP_EXT.has(f.ext) || f.relPath.split(/[/\\]/).pop() === ".DS_Store") {
      counts.silentSkip++;
      continue;
    }
    if (UNSUPPORTED_EXT.has(f.ext)) {
      counts.unsupported++;
      skipUnsupported[f.ext] = (skipUnsupported[f.ext] ?? 0) + 1;
      continue;
    }
    if (ATTACHMENT_EXT.has(f.ext)) counts.attachment++;
    else if (OOXML_EXT.has(f.ext)) counts.ooxml++;
    else if (HTML_EXT.has(f.ext)) counts.html++;
    else if (TEXT_EXT.has(f.ext)) counts.txt++;
    else {
      counts.silentSkip++;
      continue;
    }
    workItems.push(f);
  }

  // File-level dedup, BEFORE any AI call: the corpus has heavy exact-duplicate
  // overlap (the same PrepInsta/FreshersWorld dump mirrored across multiple
  // company folders — measured ~34% of files, Sep 2026). Post-extraction
  // content_hash dedup already prevents duplicate DB rows, but that happens
  // AFTER paying for the Gemini call — this catches it before spending
  // anything. First-encountered-in-walk-order file per hash is canonical;
  // later ones are marked done with zero cost, no AI call.
  const seenFileHashes = new Set<string>();
  const canonicalForHash = new Map<string, string>();
  let duplicateFileCount = 0;
  const dedupedWorkItems: FileRef[] = [];
  for (const f of workItems) {
    let hash: string;
    try {
      hash = createHash("sha256").update(f.read()).digest("hex");
    } catch {
      dedupedWorkItems.push(f); // unreadable — let normal processing surface the error
      continue;
    }
    if (seenFileHashes.has(hash)) {
      duplicateFileCount++;
      if (!opts.dryRun && !state.done[f.relPath]) {
        state.done[f.relPath] = {
          status: `duplicate_of:${canonicalForHash.get(hash)}`,
          questions: 0,
          at: new Date().toISOString(),
        };
      }
      continue;
    }
    seenFileHashes.add(hash);
    canonicalForHash.set(hash, f.relPath);
    dedupedWorkItems.push(f);
  }
  if (duplicateFileCount > 0 && !opts.dryRun) scheduleFlush();

  const pending = dedupedWorkItems.filter((f) => !state.done[f.relPath]);
  counts.alreadyDone = dedupedWorkItems.length - pending.length;
  const queue = opts.limit ? pending.slice(0, opts.limit) : pending;

  console.log(`Root: ${opts.root}`);
  console.log(
    `Discovered: ${counts.attachment} pdf/image, ${counts.ooxml} docx/pptx, ${counts.html} html, ` +
      `${counts.txt} txt, ${counts.archive} archives expanded, ${counts.unsupported} unsupported ` +
      `(${JSON.stringify(skipUnsupported)}), ${counts.silentSkip} asset files ignored`
  );
  console.log(
    `Exact-duplicate files skipped (zero AI cost): ${duplicateFileCount}. ` +
      `Already processed (resumed): ${counts.alreadyDone}. Queued this run: ${queue.length}.`
  );
  if (opts.dryRun) console.log("--dry-run: no AI calls, no DB writes.");

  let cursor = 0;
  let ok = 0;
  let failed = 0;
  let questionsInserted = 0;
  let questionsDiscarded = 0;
  let totalCostInr = 0;

  async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
    let lastErr: unknown;
    for (let i = 0; i < attempts; i++) {
      try {
        return await fn();
      } catch (err) {
        lastErr = err;
        const delay = 1500 * 2 ** i;
        console.warn(`    retry ${i + 1}/${attempts}: ${err instanceof Error ? err.message : err}`);
        await sleep(delay);
      }
    }
    throw lastErr;
  }

  async function processOne(f: FileRef): Promise<void> {
    const companyLabel = companyLabelFor(f.relPath);
    let input: ExtractionInput;
    try {
      input = buildExtractionInput(f.ext, f.read());
    } catch (err) {
      console.log(`  ✗ ${f.relPath} — read/parse failed: ${err instanceof Error ? err.message : err}`);
      if (!opts.dryRun) {
        state.done[f.relPath] = { status: "read_failed", questions: 0, at: new Date().toISOString() };
        failed++;
        scheduleFlush();
      }
      return;
    }
    if (!input) {
      if (!opts.dryRun) {
        state.done[f.relPath] = { status: "empty_or_skipped", questions: 0, at: new Date().toISOString() };
        scheduleFlush();
      }
      return;
    }

    if (opts.dryRun) {
      console.log(`  [dry-run] would extract from ${f.relPath} (${companyLabel})`);
      return;
    }

    try {
      const messages = [
        {
          role: "user" as const,
          content:
            input.kind === "text"
              ? `${buildUserPrompt(companyLabel, f.relPath, taxonomy)}\n\n---SOURCE TEXT---\n${input.text.slice(0, 120_000)}`
              : buildUserPrompt(companyLabel, f.relPath, taxonomy),
        },
      ];
      const attachments = input.kind === "attachment" ? [{ mediaType: input.mediaType, data: input.data }] : undefined;

      const ai = await withRetry(() =>
        routeAI("placement_bank_extract", {
          systemPrompt: SYSTEM_PROMPT,
          messages,
          attachments,
          responseSchema: RESPONSE_SCHEMA,
          thinkingBudget: 0,
          logContext: {
            userId: null,
            userEmail: "placement-ingest-script@local",
            userRole: "superadmin",
            subjectId: null,
            subjectCode: null,
            jobId: randomUUID(),
            relatedContentId: null,
            feature: "placement_bank_ingest",
            metadata: { source_document: f.relPath, company: companyLabel },
          },
        })
      );
      totalCostInr += ai.costInr ?? 0;

      let parsed: { questions?: RawQuestion[] };
      const rawContent = String(ai.content ?? "{}");
      try {
        parsed = JSON.parse(rawContent);
      } catch (parseErr) {
        console.log(
          `  ✗ ${f.relPath} — unparseable response (${rawContent.length} chars, ` +
            `${parseErr instanceof Error ? parseErr.message : String(parseErr)}). ` +
            `tail: ...${rawContent.slice(-200)}`
        );
        state.done[f.relPath] = { status: "parse_failed", questions: 0, at: new Date().toISOString() };
        failed++;
        scheduleFlush();
        return;
      }

      const rawQuestions = Array.isArray(parsed.questions) ? parsed.questions : [];
      const rows: BankRow[] = [];
      for (const q of rawQuestions) {
        const track = (q.track ?? "").toLowerCase();
        if (!VALID_TRACKS.has(track)) {
          questionsDiscarded++;
          continue;
        }
        const canonicalTopic = taxonomyMap[track][(q.topic ?? "").toLowerCase()];
        if (!canonicalTopic) {
          questionsDiscarded++;
          continue;
        }
        const text = (q.question_text ?? "").trim();
        if (text.length < 10 || text.length > 3000) {
          questionsDiscarded++;
          continue;
        }
        const rawOptions = (q.options ?? [])
          .map((o) => ({ key: (o.key ?? "").trim(), text: (o.text ?? "").trim() }))
          .filter((o) => o.key && o.text);
        // DB check constraint requires correct_answer in ('A','B','C','D') exactly —
        // no E/F, no lowercase. Source material's own option lettering (a/b/c/d,
        // 1/2/3/4, i/ii/iii...) is discarded and replaced with a clean A-D by
        // position, since only the ORDER carries meaning, not the source's label.
        if (rawOptions.length < 2 || rawOptions.length > 4) {
          questionsDiscarded++;
          continue;
        }
        const matchedIndex = rawOptions.findIndex(
          (o) => o.key.toLowerCase() === (q.correct_answer ?? "").trim().toLowerCase()
        );
        if (matchedIndex === -1) {
          questionsDiscarded++;
          continue;
        }
        const LETTERS = ["A", "B", "C", "D"] as const;
        const options = rawOptions.map((o, i) => ({ key: LETTERS[i], text: o.text }));
        const matched = options[matchedIndex];
        const difficulty = (["easy", "medium", "hard"] as const).includes(q.difficulty as "easy")
          ? (q.difficulty as "easy" | "medium" | "hard")
          : "medium";

        rows.push({
          track,
          topic: canonicalTopic,
          topic_bucket: `${track}_${slugify(canonicalTopic)}`,
          difficulty,
          question_text: text,
          options,
          correct_answer: matched.key,
          explanation: (q.explanation ?? "").trim(),
          company_context: companyLabel,
          source: "real_company",
          source_document: f.relPath,
          content_hash: contentHash(text, options),
          is_verified: q.answer_in_source === true,
          is_active: true,
          question_type: "mcq",
        });
      }

      if (rows.length > 0) {
        const { error } = await admin
          .from("placement_question_bank")
          .upsert(rows, { onConflict: "content_hash", ignoreDuplicates: true });
        if (error) {
          console.log(`  ✗ ${f.relPath} — insert failed: ${error.message}`);
          state.done[f.relPath] = { status: "insert_failed", questions: 0, at: new Date().toISOString() };
          failed++;
          scheduleFlush();
          return;
        }
      }

      questionsInserted += rows.length;
      console.log(
        `  ✓ ${f.relPath} — ${rows.length}/${rawQuestions.length} questions (₹${(ai.costInr ?? 0).toFixed(4)})`
      );
      state.done[f.relPath] = { status: "ok", questions: rows.length, at: new Date().toISOString() };
      ok++;
      scheduleFlush();
    } catch (err) {
      console.log(`  ✗ ${f.relPath} — ${err instanceof Error ? err.message : String(err)}`);
      state.done[f.relPath] = { status: "error", questions: 0, at: new Date().toISOString() };
      failed++;
      scheduleFlush();
    }
  }

  await workAsyncStorage.run(store as never, async () => {
    async function worker(): Promise<void> {
      while (cursor < queue.length && !shuttingDown) {
        const f = queue[cursor++];
        await processOne(f);
      }
    }
    await Promise.all(Array.from({ length: opts.concurrency }, () => worker()));
  });

  if (!opts.dryRun) {
    flushState();
    // Let trailing after()-scheduled logAICall promises settle before exit.
    await sleep(1500);
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(
    `${ok} files ok, ${failed} failed, ${questionsInserted} questions inserted (upsert-deduped), ` +
      `${questionsDiscarded} discarded (bad taxonomy/shape). Total AI cost: ₹${totalCostInr.toFixed(3)}`
  );
  console.log(`State: ${statePath}`);
  console.log("=".repeat(60));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
