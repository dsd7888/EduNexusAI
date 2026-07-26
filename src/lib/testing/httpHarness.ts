/**
 * HTTP verification harness — drive real API routes over real HTTP as a real
 * authenticated student.
 *
 * WHY THIS EXISTS
 * The `_cp_*_verify` harnesses so far call `src/lib/**` functions directly.
 * That is the right shape for engine-level assertions (planAssessment, the NAT
 * verifier, RLS policies), but it cannot test a ROUTE: it skips `proxy.ts`,
 * `requireRole()`, cookie parsing, JSON body handling, and the status codes the
 * client actually branches on. CP-Q3 Part 2+ makes claims about route
 * behaviour — "answers are rejected after the timer expires", "feedback is
 * withheld by mode" — and those claims are only worth what the transport they
 * were tested over is worth. This module supplies that transport.
 *
 * WHY IT LIVES IN src/lib/testing AND NOT IN _cp_q3_verify/
 * CP-Q4 and later will want the same thing. Importing `@/lib/testing/httpHarness`
 * from any `_cp_qN_verify/` beats `../_cp_q3_verify/lib/http` forever after.
 * Nothing in `src/app/**` imports this file, so it is never bundled — it is
 * type-checked by `npm run build` (which is the point) and shipped nowhere.
 *
 * ── THE COOKIE FORMAT, ESTABLISHED EMPIRICALLY ───────────────────────────────
 *
 * The @supabase/ssr session cookie format is version-specific, so this module
 * does not encode it by hand. Verified against the INSTALLED @supabase/ssr
 * (0.8.0) by reading `node_modules/@supabase/ssr/dist/main/`:
 *
 *   - `createBrowserClient.js:21` — `cookieEncoding: options?.cookieEncoding ?? "base64url"`.
 *   - `cookies.js:7,155` — a base64url payload is stored as `"base64-" + stringToBase64URL(json)`.
 *   - `utils/chunker.js:26` — `createChunks` splits when `encodeURIComponent(value).length > 3180`
 *     into `<key>.0`, `<key>.1`, …; UNDER the threshold the cookie keeps its
 *     bare name with NO `.0` suffix. Both shapes must round-trip.
 *   - storage key: `sb-<project-ref>-auth-token`, from supabase-js.
 *
 * Rather than reimplement any of that, `signInAsStudent` drives
 * @supabase/ssr's OWN `createBrowserClient` with an in-memory cookie jar wired
 * to `getAll`/`setAll`. `verifyOtp()` then makes the library write the session
 * through its real browser-storage path, so the jar ends up holding byte-exact
 * what a signed-in browser holds — correct prefix, correct encoding, correct
 * chunk boundaries — for whatever version happens to be installed. A version
 * bump that changes the format changes this harness's output automatically
 * instead of silently invalidating it.
 *
 * `isSingleton: false` is required: `createBrowserClient` memoises a module-level
 * client when it detects a browser or when asked to, and two harness sessions in
 * one process must not share one.
 *
 * ── AUTH ─────────────────────────────────────────────────────────────────────
 * Magic link minted with the service role (`admin.auth.admin.generateLink`) and
 * redeemed via `verifyOtp({ type: "email", token_hash })` — the same pattern as
 * `_cp_q3_verify/key_exposure.ts`, so no password needs to live in `.env.local`.
 *
 * ── CLEANUP ──────────────────────────────────────────────────────────────────
 * `cleanup()` is idempotent and runs on SIGINT/SIGTERM/SIGPIPE/SIGHUP as well as
 * in `finally` (CLAUDE.md: a `finally` does not run when the process is
 * signalled, and piping a harness through `head` SIGPIPE-kills it mid-run).
 * It deletes the ephemeral student's rows in FK-safe order, then the auth user.
 *
 * A student the caller did NOT create is never deleted — passing an existing
 * email marks the session unowned, so pointing this at `teststudent@gmail.com`
 * cannot destroy it. Only the rows this run created are swept in that case.
 */

import { createBrowserClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

// ─── env ─────────────────────────────────────────────────────────────────────

/** Load `.env.local` into process.env without overwriting anything already set. */
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

export const BASE_URL =
  process.env.HARNESS_BASE_URL?.replace(/\/$/, "") ?? "http://localhost:3000";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`[httpHarness] missing env var ${name}`);
  return v;
}

// ─── cookie jar ──────────────────────────────────────────────────────────────

interface JarCookie {
  name: string;
  value: string;
}

/**
 * Minimal cookie jar.
 *
 * Values are stored DECODED, which is the contract @supabase/ssr's `setAll`
 * uses, and percent-encoded only when serialised into a `Cookie:` header —
 * mirroring what `cookie.serialize()` does in a browser and what
 * `NextRequest.cookies.get()` undoes on the server. Storing them encoded would
 * double-encode on the wire and the server would decode to garbage.
 *
 * Deliberately ignores Domain/Path/Expires: everything here is one origin and
 * one short-lived process. It DOES honour deletion (`Max-Age=0` / empty value),
 * because @supabase/ssr clears stale chunks that way and a jar that kept them
 * would send both the old and new chunk sets and fail to parse.
 */
export class CookieJar {
  private jar = new Map<string, string>();

  getAll(): JarCookie[] {
    return [...this.jar.entries()].map(([name, value]) => ({ name, value }));
  }

  set(name: string, value: string, maxAge?: number): void {
    if (value === "" || maxAge === 0) this.jar.delete(name);
    else this.jar.set(name, value);
  }

  /** Serialise to a `Cookie:` request header, or null when empty. */
  header(): string | null {
    if (this.jar.size === 0) return null;
    return [...this.jar.entries()]
      .map(([n, v]) => `${n}=${encodeURIComponent(v)}`)
      .join("; ");
  }

  /** Absorb `Set-Cookie` response headers so a mid-run token refresh sticks. */
  absorb(setCookies: string[]): void {
    for (const raw of setCookies) {
      const [pair, ...attrs] = raw.split(";");
      const eq = pair.indexOf("=");
      if (eq === -1) continue;
      const name = pair.slice(0, eq).trim();
      let value = pair.slice(eq + 1).trim();
      try {
        value = decodeURIComponent(value);
      } catch {
        // leave as-is; a non-encoded value is still a usable value
      }
      const maxAgeAttr = attrs
        .map((a) => a.trim().toLowerCase())
        .find((a) => a.startsWith("max-age="));
      const maxAge = maxAgeAttr ? Number(maxAgeAttr.slice(8)) : undefined;
      this.set(name, value, maxAge);
    }
  }

  names(): string[] {
    return [...this.jar.keys()].sort();
  }
}

// ─── session ─────────────────────────────────────────────────────────────────

export interface HarnessResponse<T = unknown> {
  status: number;
  ok: boolean;
  body: T;
  /** Wall-clock ms for the request, measured client-side by the harness. */
  ms: number;
}

export interface StudentSession {
  /** fetch-compatible; relative paths resolve against BASE_URL and carry auth cookies. */
  fetch: (path: string, init?: RequestInit) => Promise<Response>;
  /** JSON convenience wrapper around `fetch` — returns status + parsed body + timing. */
  json: <T = unknown>(
    path: string,
    init?: RequestInit
  ) => Promise<HarnessResponse<T>>;
  /** anon key + this user's real JWT — the exact client a browser holds (RLS applies). */
  client: SupabaseClient;
  /** service role — for DB assertions and seeding only. Bypasses RLS. */
  admin: SupabaseClient;
  userId: string;
  email: string;
  /** true when this run created the auth user, and cleanup may delete it. */
  owned: boolean;
  cookieNames: () => string[];
  /** Idempotent. Returns a human-readable note for the run report. */
  cleanup: () => Promise<string>;
}

export interface SignInOptions {
  /** Copy branch/semester/department from this student, so the assessment engine has scope. */
  templateEmail?: string;
  branch?: string;
  semester?: number;
}

/**
 * Create (or adopt) a student, establish a real session, and return an
 * authenticated HTTP surface plus a service-role client for DB assertions.
 *
 * With no arguments: mints an ephemeral student that `cleanup()` fully deletes.
 * With an `email` that already exists: adopts it, and cleanup leaves the user
 * alone (only rows created during the run are swept).
 */
export async function signInAsStudent(
  email?: string,
  password?: string,
  options: SignInOptions = {}
): Promise<StudentSession> {
  loadEnvLocal();

  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const anonKey = requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const targetEmail =
    email ?? `cp-harness-${randomUUID().slice(0, 8)}@edunexus-harness.invalid`;
  const targetPassword = password ?? `Hx-${randomUUID()}`;

  // ── resolve or create the auth user ────────────────────────────────────────
  let userId: string | null = null;
  let owned = false;

  if (email) {
    // listUsers is paged; the harness student count is small, but filter
    // explicitly rather than assuming page 1 holds everyone.
    for (let page = 1; page <= 20 && !userId; page += 1) {
      const { data, error } = await admin.auth.admin.listUsers({
        page,
        perPage: 200,
      });
      if (error) throw new Error(`[httpHarness] listUsers: ${error.message}`);
      if (!data.users.length) break;
      userId =
        data.users.find(
          (u) => u.email?.toLowerCase() === email.toLowerCase()
        )?.id ?? null;
    }
  }

  if (!userId) {
    const { data, error } = await admin.auth.admin.createUser({
      email: targetEmail,
      password: targetPassword,
      email_confirm: true,
      user_metadata: { full_name: "CP Harness Student" },
    });
    if (error || !data.user) {
      throw new Error(
        `[httpHarness] createUser(${targetEmail}): ${error?.message ?? "no user returned"}`
      );
    }
    userId = data.user.id;
    owned = true;
  }

  // ── profile ───────────────────────────────────────────────────────────────
  // `handle_new_user` (initial_schema.sql) auto-inserts a profile row on
  // auth.users INSERT, but only id/email/full_name. requireRole(["student"])
  // reads `role`, and the assessment engine scopes by branch/semester, so those
  // are set explicitly here rather than trusted to a column default.
  if (owned) {
    let scope: { branch: string; semester: number; department: string } = {
      branch: options.branch ?? "CSE",
      semester: options.semester ?? 1,
      department: "Engineering", // DB invariant: always "Engineering" (CLAUDE.md)
    };
    if (options.templateEmail) {
      const { data } = await admin
        .from("profiles")
        .select("branch, semester, department")
        .eq("email", options.templateEmail)
        .maybeSingle();
      const t = data as {
        branch: string | null;
        semester: number | null;
        department: string | null;
      } | null;
      if (t) {
        scope = {
          branch: options.branch ?? t.branch ?? scope.branch,
          semester: options.semester ?? t.semester ?? scope.semester,
          department: t.department ?? scope.department,
        };
      }
    }

    // The trigger fires on INSERT, but wait for it rather than assume it has
    // committed by the time createUser() returned.
    let profileSeen = false;
    for (let i = 0; i < 20 && !profileSeen; i += 1) {
      const { data } = await admin
        .from("profiles")
        .select("id")
        .eq("id", userId)
        .maybeSingle();
      if (data) profileSeen = true;
      else await sleep(100);
    }

    const row = {
      id: userId,
      email: targetEmail,
      full_name: "CP Harness Student",
      role: "student",
      ...scope,
    };
    const { error: upErr } = profileSeen
      ? await admin.from("profiles").update(row).eq("id", userId)
      : await admin.from("profiles").insert(row);
    if (upErr) {
      throw new Error(`[httpHarness] profile write: ${upErr.message}`);
    }
  }

  // ── establish a session, capturing cookies through @supabase/ssr itself ────
  const jar = new CookieJar();
  const browserLike = createBrowserClient(url, anonKey, {
    isSingleton: false,
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (list) => {
        for (const { name, value, options: opts } of list) {
          jar.set(name, value, opts?.maxAge as number | undefined);
        }
      },
    },
  });

  if (password) {
    const { error } = await browserLike.auth.signInWithPassword({
      email: targetEmail,
      password,
    });
    if (error) {
      throw new Error(`[httpHarness] signInWithPassword: ${error.message}`);
    }
  } else {
    // Magic link via the service role → verifyOtp. No password in .env.local.
    const { data, error } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email: targetEmail,
    });
    if (error || !data.properties?.hashed_token) {
      throw new Error(
        `[httpHarness] generateLink: ${error?.message ?? "no hashed_token"}`
      );
    }
    const { error: otpErr } = await browserLike.auth.verifyOtp({
      type: "email",
      token_hash: data.properties.hashed_token,
    });
    if (otpErr) {
      throw new Error(`[httpHarness] verifyOtp: ${otpErr.message}`);
    }
  }

  // Assert the jar actually holds an auth cookie. Without this a format change
  // would surface as a confusing 401 from every route instead of a clear
  // "sign-in produced no cookies" here.
  const authCookies = jar.names().filter((n) => n.includes("auth-token"));
  if (authCookies.length === 0) {
    throw new Error(
      `[httpHarness] sign-in set no auth cookie; jar has: ${jar.names().join(", ") || "(empty)"}`
    );
  }

  // ── fetch wrapper ─────────────────────────────────────────────────────────
  const harnessFetch = async (
    path: string,
    init: RequestInit = {}
  ): Promise<Response> => {
    const target = path.startsWith("http") ? path : `${BASE_URL}${path}`;
    const headers = new Headers(init.headers);
    const cookieHeader = jar.header();
    if (cookieHeader) headers.set("cookie", cookieHeader);
    if (init.body && !headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }
    const res = await fetch(target, {
      ...init,
      headers,
      redirect: "manual", // a 307 to /login IS the auth failure — do not follow it
    });
    jar.absorb(res.headers.getSetCookie());
    return res;
  };

  const json = async <T = unknown>(
    path: string,
    init: RequestInit = {}
  ): Promise<HarnessResponse<T>> => {
    const t0 = Date.now();
    const res = await harnessFetch(path, init);
    const ms = Date.now() - t0;
    const text = await res.text();
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      // A redirect to /login or an HTML error page — keep it, truncated, so the
      // failure message shows what actually came back.
      body = { _nonJson: text.slice(0, 400), _status: res.status };
    }
    return { status: res.status, ok: res.ok, body: body as T, ms };
  };

  const client = createClient(url, anonKey);
  const {
    data: { session },
  } = await browserLike.auth.getSession();
  if (session) {
    await client.auth.setSession({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
    });
  }

  // ── cleanup ───────────────────────────────────────────────────────────────
  let cleaned = false;
  const cleanup = async (): Promise<string> => {
    if (cleaned) return "already cleaned";
    cleaned = true;
    const notes: string[] = [];

    const sweep = async (table: string, column: string) => {
      const { error } = await admin.from(table).delete().eq(column, userId);
      if (error) notes.push(`${table}: ${error.message}`);
    };

    // FK-safe order. quiz_session_keys references quiz_sessions; delete the
    // children first rather than relying on an ON DELETE CASCADE this harness
    // has not verified.
    const { data: sessions } = await admin
      .from("quiz_sessions")
      .select("id")
      .eq("student_id", userId);
    const sessionIds = ((sessions ?? []) as { id: string }[]).map((s) => s.id);
    if (sessionIds.length > 0) {
      const { error } = await admin
        .from("quiz_session_keys")
        .delete()
        .in("session_id", sessionIds);
      if (error) notes.push(`quiz_session_keys: ${error.message}`);
    }
    await sweep("student_question_attempts", "student_id");
    await sweep("quiz_sessions", "student_id");
    await sweep("student_topic_mastery", "student_id");
    await sweep("usage_analytics", "user_id");

    if (owned) {
      await sweep("profiles", "id");
      const { error } = await admin.auth.admin.deleteUser(userId);
      if (error) notes.push(`auth user: ${error.message}`);
      notes.push(`deleted student ${targetEmail} (${sessionIds.length} session(s))`);
    } else {
      notes.push(
        `adopted student ${targetEmail} left in place; swept ${sessionIds.length} session(s)`
      );
    }

    return notes.join("; ");
  };

  return {
    fetch: harnessFetch,
    json,
    client,
    admin,
    userId,
    email: targetEmail,
    owned,
    cookieNames: () => jar.names(),
    cleanup,
  };
}

// ─── misc helpers ────────────────────────────────────────────────────────────

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Register `cleanup` on every termination signal, not just in `finally`.
 * CLAUDE.md, harness rules: a `finally` does not run when the process is
 * signalled, and piping a harness through `head` SIGPIPE-kills it mid-run,
 * which once left a subject half-mutated. Redirect output to a file; do not pipe.
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

/** Fail fast with a usable message when the dev server isn't up. */
export async function waitForServer(timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr = "";
  while (Date.now() < deadline) {
    try {
      await fetch(`${BASE_URL}/api/assessment/landing`, { redirect: "manual" });
      return; // any response at all means the server is listening
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
      await sleep(500);
    }
  }
  throw new Error(
    `[httpHarness] no server at ${BASE_URL} after ${timeoutMs}ms (${lastErr}). Start it with \`npm run dev\`, or set HARNESS_BASE_URL.`
  );
}

// ─── assertions ──────────────────────────────────────────────────────────────

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

/** p-th percentile by nearest-rank, on a copy. */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(Math.max(rank, 1), sorted.length) - 1];
}
