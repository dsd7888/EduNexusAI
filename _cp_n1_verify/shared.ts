/**
 * Shared plumbing for the CP-N1 Notes v2 harnesses.
 *
 * The `workAsyncStorage` shim EXECUTES the after() callback rather than
 * discarding it (CLAUDE.md harness rules): routeAI logs every call to
 * ai_call_logs via after(), and a shim that swallows it would make
 * cost_attribution.ts — the harness whose entire job is asserting
 * feature='notes' — pass vacuously over an empty table. Copied from the CP-Q2/
 * CP-Q3 shim, not the CP-Q1 one.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

(globalThis as Record<string, unknown>).AsyncLocalStorage = AsyncLocalStorage;

export function loadEnvLocal(): void {
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

export function adminClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

/** Runs `fn` inside a work store whose after() actually executes. */
export async function makeRunInScope() {
  const { workAsyncStorage } = await import(
    "next/dist/server/app-render/work-async-storage.external"
  );
  const store = {
    afterContext: {
      after: (fn: unknown) => {
        if (typeof fn === "function") void (fn as () => unknown)();
      },
    },
  };
  return <T>(fn: () => Promise<T>): Promise<T> =>
    workAsyncStorage.run(store as never, fn);
}

// ─── Fixtures ───────────────────────────────────────────────────────────────
//
// Real seeded subjects, resolved by CODE at runtime rather than by hardcoded
// uuid — a reseed changes the ids but not the codes.

export const FIXTURES = {
  /** Discrete mathematics. Conceptual with some notation. */
  IDSH2020: {
    code: "IDSH2020",
    /** "Set" — real content, moderate scope. Harness 1's target. */
    moduleOne: 1,
    /** "Mathematical Logic and Proofs" — the conceptual pole of harness 2. */
    conceptualModule: 5,
  },
  /** Basics of Electrical & Electronics. */
  SOEEC1010: {
    code: "SOEEC1010",
    /** "Fundamentals of Electrical Circuits" — Ohm's law, KCL, KVL. Formulaic pole. */
    formulaicModule: 1,
  },
} as const;

export type ResolvedModule = {
  subjectId: string;
  subjectCode: string;
  subjectName: string;
  moduleId: string;
  moduleNumber: number;
  moduleName: string;
};

export async function resolveModule(
  admin: SupabaseClient,
  subjectCode: string,
  moduleNumber: number
): Promise<ResolvedModule> {
  const { data: subject } = await admin
    .from("subjects")
    .select("id, code, name")
    .eq("code", subjectCode)
    .maybeSingle();
  if (!subject) throw new Error(`Fixture subject ${subjectCode} not found`);

  const { data: mod } = await admin
    .from("modules")
    .select("id, module_number, name")
    .eq("subject_id", subject.id)
    .eq("module_number", moduleNumber)
    .maybeSingle();
  if (!mod) throw new Error(`Fixture ${subjectCode} M${moduleNumber} not found`);

  return {
    subjectId: subject.id,
    subjectCode: subject.code,
    subjectName: subject.name,
    moduleId: mod.id,
    moduleNumber: mod.module_number,
    moduleName: mod.name,
  };
}

/** Deletes every study_notes row for the given modules. Returns residual count. */
export async function purgeNotes(
  admin: SupabaseClient,
  moduleIds: string[]
): Promise<number> {
  if (moduleIds.length === 0) return 0;
  await admin.from("study_notes").delete().in("module_id", moduleIds);
  const { count } = await admin
    .from("study_notes")
    .select("*", { count: "exact", head: true })
    .in("module_id", moduleIds);
  return count ?? 0;
}

// ─── Reporting ──────────────────────────────────────────────────────────────

export interface Checker {
  check: (label: string, ok: boolean, detail?: string) => void;
  eq: (label: string, actual: unknown, expected: unknown) => void;
  summary: () => { passed: number; failed: number };
}

export function makeChecker(): Checker {
  let passed = 0;
  let failed = 0;
  const check = (label: string, ok: boolean, detail = "") => {
    if (ok) {
      passed += 1;
      console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`);
    } else {
      failed += 1;
      console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
    }
  };
  const eq = (label: string, actual: unknown, expected: unknown) => {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    check(
      label,
      ok,
      ok
        ? String(JSON.stringify(actual))
        : `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
    );
  };
  return { check, eq, summary: () => ({ passed, failed }) };
}

export function hr(title: string): void {
  console.log(`\n${"═".repeat(78)}\n${title}\n${"═".repeat(78)}`);
}
export function sub(title: string): void {
  console.log(`\n${"─".repeat(70)}\n${title}\n${"─".repeat(70)}`);
}

/**
 * Same cleanup on every signal, not just in `finally` — a `finally` does not
 * run when the process is signalled, and piping a harness through `head`
 * SIGPIPE-kills it mid-run. Redirect output to a file; do not pipe.
 */
export function onSignals(cleanup: () => Promise<string>): void {
  let cleaning = false;
  for (const sig of ["SIGINT", "SIGTERM", "SIGPIPE", "SIGHUP"] as const) {
    process.on(sig, () => {
      if (cleaning) return;
      cleaning = true;
      void cleanup().then((notes) => {
        console.error(`\n[${sig}] cleanup: ${notes}`);
        process.exit(130);
      });
    });
  }
}
