/**
 * CP-N6 Part 5.1 — BROWSER render check.
 *
 * The one thing every other CP-N6 check cannot prove: that a human looking at
 * the page sees TYPESET math, not raw `$\frac{dQ}{dt}$` source or a garbled
 * control-char remnant. The original bug was invisible to generation, storage,
 * parsing and validation — it was only visible to a person reading a rendered
 * card. So the closing check has to be a rendered page.
 *
 * Drives a real Chromium against the dev server as a real signed-in student:
 *   1. reading view  /student/notes/<subjectId>   (module 1 selected)
 *   2. flashcard deck /student/notes/<subjectId>/flashcards  (+ reveal)
 *
 * Asserts, per page:
 *   - KaTeX actually rendered  (.katex nodes present)
 *   - NO raw control chars in any visible text (the corruption signature)
 *   - NO leaked `$…$` / `\frac` source in visible text (the fallback signature)
 *   - KaTeX's own error class is absent (.katex-error / color:#cc0000)
 * and screenshots both.
 *
 *   npx tsx _cp_n6_verify/render_check.ts
 */
import { readFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { chromium, type BrowserContext } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { createBrowserClient } from "@supabase/ssr";
import { findEscapeCorruption } from "../src/lib/text/latexSegments";

const ROOT = resolve(__dirname, "..");
const SHOTS = resolve(__dirname, "shots");
const BASE = process.env.HARNESS_BASE_URL ?? "http://localhost:3000";
const SUBJECT_CODE = "SOEEC1010";

for (const line of readFileSync(resolve(ROOT, ".env.local"), "utf8").split("\n")) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const eq = t.indexOf("=");
  if (eq > 0) process.env[t.slice(0, eq).trim()] ||= t.slice(eq + 1).trim();
}

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
}

/** Sign in a throwaway student scoped to the subject, return browser cookies. */
async function makeSession(branch: string, semester: number) {
  const admin = createClient(URL_, SERVICE, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const email = `cp-n6-browser-${randomUUID().slice(0, 8)}@edunexus-harness.invalid`;
  const { data: created, error: cErr } = await admin.auth.admin.createUser({
    email,
    password: `Hx-${randomUUID()}`,
    email_confirm: true,
    user_metadata: { full_name: "CP-N6 Render Check" },
  });
  if (cErr || !created.user) throw new Error(`createUser: ${cErr?.message}`);
  const userId = created.user.id;

  const { error: pErr } = await admin
    .from("profiles")
    .update({ role: "student", branch, semester, department: "Engineering" })
    .eq("id", userId);
  if (pErr) throw new Error(`profile: ${pErr.message}`);

  // Capture cookies through @supabase/ssr itself — the cookie format is
  // version-specific, so let the library write it rather than hand-rolling.
  const jar = new Map<string, string>();
  const client = createBrowserClient(URL_, ANON, {
    isSingleton: false,
    cookies: {
      getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })),
      setAll: (list) => {
        for (const { name, value, options } of list) {
          if (value === "" || options?.maxAge === 0) jar.delete(name);
          else jar.set(name, value);
        }
      },
    },
  });
  const { data: link, error: lErr } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (lErr || !link.properties?.hashed_token) throw new Error(`generateLink: ${lErr?.message}`);
  const { error: oErr } = await client.auth.verifyOtp({
    type: "email",
    token_hash: link.properties.hashed_token,
  });
  if (oErr) throw new Error(`verifyOtp: ${oErr.message}`);
  if (![...jar.keys()].some((k) => k.includes("auth-token"))) {
    throw new Error(`no auth cookie; jar: ${[...jar.keys()].join(", ")}`);
  }

  const cookies = [...jar.entries()].map(([name, value]) => ({
    name,
    value,
    domain: "localhost",
    path: "/",
  }));
  return { admin, userId, email, cookies };
}

/**
 * The corruption signature in RENDERED text.
 *
 * Uses the SAME detector as the rest of CP-N6 rather than "any control char":
 * KaTeX's own DOM (struts, mspace, the MathML annotation) puts tabs and
 * zero-width spaces into `innerText`, so a bare control-char scan flags every
 * correctly-typeset formula on the page. The real signature is a control char
 * followed by a LaTeX command REMAINDER, which is exactly what
 * findEscapeCorruption tests.
 */
function controlCharsIn(text: string): string[] {
  return findEscapeCorruption(text).map(
    (h) => `${h.severity} ${h.command} @${h.index} …${JSON.stringify(text.slice(Math.max(0, h.index - 25), h.index + 25))}…`,
  );
}

/** The fallback signature: LaTeX source that never became typeset math. */
function leakedSource(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\\(frac|theta|nabla|rho|beta|vec|times|text|forall|begin|boxed)\b/g)) {
    out.push(`${m[0]} @${m.index}`);
  }
  for (const m of text.matchAll(/\$[^$\n]{2,60}\$/g)) out.push(`raw span ${JSON.stringify(m[0])}`);
  return out;
}

async function auditPage(ctx: BrowserContext, label: string, shot: string, page: import("playwright").Page) {
  const katexCount = await page.locator(".katex").count();
  const errCount = await page.locator(".katex-error").count();
  // Scan the page text with every .katex subtree REMOVED. Rendered math is by
  // definition not corrupted — if KaTeX typeset it, the source was well-formed —
  // and KaTeX's own DOM (struts, mspace, MathML annotation) injects tabs and
  // newlines into innerText, so including it flags every correct formula. What
  // we actually want to know is whether any text FAILED to become math.
  const bodyText: string = await page.evaluate(`(() => {
    var main = document.querySelector("main") || document.body;
    var clone = main.cloneNode(true);
    var math = clone.querySelectorAll(".katex, script, style");
    for (var i = 0; i < math.length; i++) math[i].remove();
    return clone.innerText || clone.textContent || "";
  })()`);

  const ctrl = controlCharsIn(bodyText);
  const leak = leakedSource(bodyText);

  console.log(`\n── ${label} ──`);
  check("KaTeX rendered at least one formula", katexCount > 0, `${katexCount} .katex node(s)`);
  check("no KaTeX render errors", errCount === 0, `${errCount} .katex-error`);
  check(
    "no raw control characters in visible text",
    ctrl.length === 0,
    ctrl.length ? ctrl.slice(0, 3).join(" | ") : "clean",
  );
  check(
    "no leaked LaTeX source in visible text",
    leak.length === 0,
    leak.length ? leak.slice(0, 3).join(" | ") : "clean",
  );

  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: resolve(SHOTS, shot), fullPage: true });
  console.log(`  screenshot → _cp_n6_verify/shots/${shot}`);
  return katexCount;
}

async function main() {
  const admin = createClient(URL_, SERVICE, { auth: { persistSession: false } });
  const { data: subject } = await admin
    .from("subjects")
    .select("id, code, branch, semester")
    .eq("code", SUBJECT_CODE)
    .single();
  if (!subject) throw new Error(`${SUBJECT_CODE} not found`);

  console.log(`CP-N6 render check — ${SUBJECT_CODE} (${subject.branch} sem ${subject.semester})`);
  const session = await makeSession(subject.branch as string, subject.semester as number);
  console.log(`signed in as ${session.email}\n`);

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await ctx.addCookies(session.cookies);
  const page = await ctx.newPage();
  page.on("console", (m) => {
    if (m.type() === "error") console.log(`    [browser console error] ${m.text().slice(0, 160)}`);
  });

  try {
    // ── 1. Reading view. Notes for M1 are stale/absent, so this exercises a
    //    REAL generation through the fixed pipeline and then renders it.
    await page.goto(`${BASE}/student/notes/${subject.id}`, { waitUntil: "domcontentloaded" });
    console.log("waiting for notes to generate + render (up to 180s)…");
    await page.waitForSelector(".katex", { timeout: 180_000 });
    await page.waitForTimeout(2500); // let remaining blocks settle
    await auditPage(ctx, "READING VIEW — /student/notes", "01-reading-view.png", page);

    // Zoom the first formula-bearing card for a legible close-up.
    const formula = page.locator(".katex").first();
    await formula.scrollIntoViewIfNeeded();
    const card = formula.locator("xpath=ancestor::*[self::article or self::section or self::div][1]");
    mkdirSync(SHOTS, { recursive: true });
    await card.screenshot({ path: resolve(SHOTS, "02-formula-card.png") });
    console.log("  screenshot → _cp_n6_verify/shots/02-formula-card.png");
    console.log(`  first formula reads: ${JSON.stringify((await formula.innerText()).slice(0, 80))}`);

    // Comparison block close-up. Its axis headers / row labels carry `$I_L$`,
    // `$V_P$`, `$\\Delta$` — they rendered as RAW SOURCE until CP-N6 routed
    // every label (not just the cells) through RichQuestionText, so this shot
    // is the evidence for that fix specifically.
    const cmp = page.locator("article").filter({ hasText: /Delta|Star \(Y\)/ }).first();
    if (await cmp.count()) {
      await cmp.scrollIntoViewIfNeeded();
      await cmp.screenshot({ path: resolve(SHOTS, "05-comparison-block.png") });
      console.log("  screenshot → _cp_n6_verify/shots/05-comparison-block.png");
    }

    // ── 2. Flashcards + reveal.
    await page.goto(`${BASE}/student/notes/${subject.id}/flashcards`, {
      waitUntil: "domcontentloaded",
    });
    await page.waitForSelector(".katex", { timeout: 120_000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await auditPage(ctx, "FLASHCARDS — front", "03-flashcard-front.png", page);

    // Reveal: the deck's reveal control, else Space (the documented shortcut).
    const revealBtn = page
      .getByRole("button", { name: /reveal|show answer|flip/i })
      .first();
    if (await revealBtn.count()) await revealBtn.click();
    else await page.keyboard.press("Space");
    await page.waitForTimeout(1500);
    await auditPage(ctx, "FLASHCARDS — revealed", "04-flashcard-revealed.png", page);
  } finally {
    await browser.close();
    await session.admin.auth.admin.deleteUser(session.userId).catch(() => {});
    const { data: residue } = await session.admin
      .from("profiles")
      .select("id")
      .eq("id", session.userId);
    console.log(
      `\ncleanup: deleted ${session.email} (profile residual=${residue?.length ?? 0})`,
    );
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
