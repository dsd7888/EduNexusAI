/**
 * Shared harness plumbing for _cp_q3_verify.
 *
 * The `workAsyncStorage` shim EXECUTES the after() callback rather than
 * discarding it — copied from the CP-Q2 harness, NOT the CP-Q1 one. routeAI
 * logs every call to ai_call_logs via after(); a shim that swallows the
 * callback makes any "which AI tasks ran?" assertion pass over an empty table,
 * vacuously. Executing means this harness's real spend lands in ai_call_logs,
 * which is where it belongs. (CLAUDE.md, harness rules.)
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";

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
    check(label, ok, ok ? String(JSON.stringify(actual)) : `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
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
 * Register the same cleanup on every signal, not just in `finally`.
 * A `finally` does not run when the process is signalled, and piping a harness
 * through `head` SIGPIPE-kills it mid-run — which once left a subject
 * half-mutated and the NEXT run snapshotted the contaminated state as its
 * "original". (CLAUDE.md, harness rules.) Redirect output to a file; do not pipe.
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

export const STUDENT_EMAIL = process.env.STUDENT ?? "teststudent@gmail.com";
