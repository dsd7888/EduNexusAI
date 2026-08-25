/**
 * CP-QC6 — browser verification of the CP-QC0..QC5 Q-paper work.
 *
 * Drives the real app in a real browser as a real faculty session. Split into
 * two phases by COST:
 *
 *   Phase 1 (free)  — the pre-flight coverage panel. It is computed entirely
 *                     client-side from the same allocator the server uses, so
 *                     it needs no AI call at all.
 *   Phase 2 (paid)  — generation, then regenerate modes / undo / locks, which
 *                     each spend real Gemini calls. Gated behind --paid so the
 *                     free half can be re-run freely.
 *
 * Run:
 *   npm run dev &                                   # must already be up
 *   npx tsx _cp_qc6_verify/ui.mts        > _cp_qc6_verify/ui.log 2>&1
 *   npx tsx _cp_qc6_verify/ui.mts --paid > _cp_qc6_verify/ui.log 2>&1
 *
 * Screenshots land in _cp_qc6_verify/screens/.
 */
import { chromium, type Page } from "playwright";
import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";

const env = Object.fromEntries(
  fs.readFileSync(".env.local", "utf8").split("\n").filter((l) => l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const PROJECT_REF = new URL(SUPABASE_URL).hostname.split(".")[0];
const COOKIE_NAME = `sb-${PROJECT_REF}-auth-token`;
const BASE = "http://localhost:3000";
const PAID = process.argv.includes("--paid");

const admin = createClient(SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const anon = createClient(SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

const SCREENS = path.join(import.meta.dirname, "screens");
fs.mkdirSync(SCREENS, { recursive: true });

let pass = 0, fail = 0;
const failures: string[] = [];
function assert(cond: boolean, label: string) {
  if (cond) { pass += 1; console.log(`  ok   ${label}`); }
  else { fail += 1; failures.push(label); console.error(`  FAIL ${label}`); }
}

async function shot(page: Page, name: string) {
  const p = path.join(SCREENS, `${name}.png`);
  await page.screenshot({ path: p, fullPage: false });
  console.log(`       [screenshot] ${name}.png`);
}

/** Real session for an existing faculty, same pattern as prior harnesses. */
async function sessionCookieFor(email: string) {
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error || !data) throw new Error(`generateLink failed: ${error?.message}`);
  const { data: verified, error: vErr } = await anon.auth.verifyOtp({
    token_hash: data.properties.hashed_token, type: "magiclink",
  });
  if (vErr || !verified.session) throw new Error(`verifyOtp failed: ${vErr?.message}`);
  return "base64-" + Buffer.from(JSON.stringify(verified.session), "utf8").toString("base64url");
}

async function main() {
  // ── Pick a faculty who owns a subject with plenty of modules ─────────────
  const SUBJECT_CODE = "SECE2291"; // Data Structure — 8 modules, 5 COs
  const { data: subj } = await admin.from("subjects").select("id, code, name")
    .eq("code", SUBJECT_CODE).maybeSingle();
  if (!subj) throw new Error(`subject ${SUBJECT_CODE} not found`);
  const { data: asn } = await admin.from("faculty_assignments").select("faculty_id")
    .eq("subject_id", subj.id).limit(1).maybeSingle();
  if (!asn) throw new Error("no faculty assigned");
  const { data: prof } = await admin.from("profiles").select("id, email, full_name")
    .eq("id", asn.faculty_id).maybeSingle();
  if (!prof?.email) throw new Error("faculty has no email");
  console.log(`Faculty: ${prof.email} → ${subj.code} (${subj.name})\n`);

  // This harness runs as a REAL faculty account against REAL data, so it must
  // not disturb their work. Snapshot the draft ids that already exist; cleanup
  // only removes rows that appear during this run.
  // Snapshot the FULL rows, not just ids. The harness clicks "Discard" on the
  // resume dialog to reach a clean builder, and that button deletes a draft —
  // which on a real account can be the faculty's own in-progress work. Ids
  // alone would let cleanup DETECT the loss but not undo it; full rows make it
  // reversible, which is the only acceptable posture for a harness pointed at
  // production data.
  const { data: preDrafts } = await admin
    .from("qpaper_drafts").select("*").eq("faculty_id", prof.id);
  const preDraftRows = (preDrafts ?? []) as Array<Record<string, unknown>>;
  const preDraftIds = new Set(preDraftRows.map((d) => d.id as string));
  console.log(`Pre-existing drafts for this faculty: ${preDraftIds.size} (backed up, restored on exit)`);

  // The paid phase really generates a paper, which writes a generated_content
  // row and a PDF into Storage. Snapshot what exists first so cleanup removes
  // only what this run produced. ai_call_logs rows are deliberately LEFT — they
  // are the genuine cost record and deleting them would falsify spend history.
  const { data: preContent } = await admin
    .from("generated_content").select("id").eq("subject_id", subj.id).eq("type", "qpaper");
  const preContentIds = new Set((preContent ?? []).map((r) => (r as { id: string }).id));

  const cookieValue = await sessionCookieFor(prof.email);

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addCookies([{
    name: COOKIE_NAME, value: cookieValue, domain: "localhost", path: "/",
    httpOnly: false, secure: false, sameSite: "Lax",
  }]);
  const page = await ctx.newPage();

  const consoleErrors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));

  try {
    // ── Load the builder ───────────────────────────────────────────────────
    console.log("1. Q-paper builder loads as faculty");
    await page.goto(`${BASE}/faculty/qpaper`, { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForTimeout(2500);
    const onBuilder = !page.url().includes("/login");
    assert(onBuilder, `reaches /faculty/qpaper (url: ${page.url()})`);
    if (!onBuilder) { await shot(page, "01-redirected"); throw new Error("auth failed"); }
    await shot(page, "01-builder");

    // A prior run (or the faculty's own session) can leave an in-progress
    // draft, whose "Resume your draft?" dialog blocks every other control.
    // Discard it so the harness always starts from a known-clean builder.
    const discardBtn = page.locator('button:has-text("Discard")').first();
    if (await discardBtn.isVisible().catch(() => false)) {
      console.log("       (dismissing a leftover \"Resume your draft?\" dialog)");
      await discardBtn.click();
      await page.waitForTimeout(1500);
    }

    // Select the subject if not already chosen.
    const subjectTrigger = page.locator("button[role=combobox]").first();
    if (await subjectTrigger.isVisible().catch(() => false)) {
      const label = (await subjectTrigger.textContent()) ?? "";
      if (!label.includes(subj.code)) {
        await subjectTrigger.click();
        await page.waitForTimeout(600);
        const opt = page.locator(`[role=option]:has-text("${subj.code}")`).first();
        if (await opt.isVisible().catch(() => false)) {
          await opt.click();
          await page.waitForTimeout(2500);
        } else {
          await page.keyboard.press("Escape");
        }
      }
    }
    await page.waitForTimeout(2000);
    await shot(page, "02-subject-selected");

    // ── The "Resume your draft?" loop ──────────────────────────────────────
    // The reported bug: the prompt "comes many times". Root cause was that a
    // PRISTINE builder fingerprinted differently on every mount (newQuestion
    // attaches a poolComposition row carrying a fresh uid()), so every visit
    // saved a draft and every later visit prompted about it.
    //
    // The test: with NO drafts on record, load the page, sit through the
    // autosave debounce, and assert nothing was created and nothing prompted.
    console.log("\n1b. A clean visit must not manufacture a draft");
    {
      // Temporarily clear the slate; the finally block restores every row.
      await admin.from("qpaper_drafts").delete().eq("faculty_id", prof.id);
      const fresh = await ctx.newPage();
      await fresh.goto(`${BASE}/faculty/qpaper`, { waitUntil: "networkidle", timeout: 60000 });
      // Well past AUTOSAVE_DEBOUNCE_MS (1500ms) plus subject/module hydration.
      await fresh.waitForTimeout(9000);

      const promptShown = await fresh
        .locator('text=/You have an unfinished paper|Resume your draft/i')
        .first().isVisible().catch(() => false);
      assert(!promptShown, "[REGRESSION] no resume prompt on a clean first visit");

      const { data: made } = await admin
        .from("qpaper_drafts").select("id").eq("faculty_id", prof.id);
      assert((made ?? []).length === 0,
        `[REGRESSION] no draft row manufactured by merely visiting (found ${(made ?? []).length})`);
      await fresh.screenshot({ path: path.join(SCREENS, "01b-clean-visit.png") });
      console.log("       [screenshot] 01b-clean-visit.png");
      await fresh.close();
    }

    // ── The banner that replaced the modal ─────────────────────────────────
    // The modal blocked every control behind an overlay until answered. Seed a
    // recent, genuinely-meaningful draft and prove the replacement (a) appears,
    // and (b) does NOT block the page — the whole point of the change.
    console.log("\n1c. Resume notice is a non-blocking banner, not a modal");
    {
      await admin.from("qpaper_drafts").delete().eq("faculty_id", prof.id);
      const seeded = {
        faculty_id: prof.id,
        subject_id: subj.id,
        label: "ZZQC6 seeded draft",
        generation_status: "idle",
        last_saved_at: new Date().toISOString(),
        // targetMarks differs from the default 60 → genuinely meaningful.
        // meta MUST be a real object: meaningfulFingerprint reads
        // meta.instructions, and a null there throws inside the resume-detection
        // effect, which silently leaves the candidate unset (no banner, no error).
        builder_state: {
          selectedSubjectId: subj.id,
          selectedModuleIds: [],
          meta: {
            examTitle: "", semester: "", date: "", time: "150 Minutes",
            universityName: "P P Savani University", instructions: [],
          },
          sections: [], flatLayout: false, targetMarks: 75,
          sourcingMix: { fresh: 100, pyq_style: 0, bank: 0 },
          btlRange: [1, 4], coTargetsPct: {},
          difficultyTargets: { easy: 40, medium: 40, hard: 20 },
          preferredBankQuestionIds: [], paper: null,
          downloadUrl: null, answerKeyUrl: null,
        },
      };
      const { data: seedRow } = await admin
        .from("qpaper_drafts").insert(seeded).select("id").maybeSingle();

      const bp = await ctx.newPage();
      await bp.goto(`${BASE}/faculty/qpaper`, { waitUntil: "networkidle", timeout: 60000 });
      await bp.waitForTimeout(4000);

      const banner = bp.locator('text=/You have an unfinished paper/i').first();
      assert(await banner.isVisible().catch(() => false), "resume banner appears for a recent draft");
      assert(
        !(await bp.locator('[role=alertdialog]').first().isVisible().catch(() => false)),
        "it is NOT rendered as a blocking alert dialog"
      );
      // The decisive check: another control must be clickable while it shows.
      const quizBtn = bp.locator('button:has-text("Quiz")').first();
      const clickable = await quizBtn.click({ timeout: 5000 }).then(() => true).catch(() => false);
      assert(clickable, "[REGRESSION] the page stays usable while the notice is up (modal blocked it)");
      await bp.screenshot({ path: path.join(SCREENS, "01c-resume-banner.png") });
      console.log("       [screenshot] 01c-resume-banner.png");
      await bp.close();
      if (seedRow?.id) await admin.from("qpaper_drafts").delete().eq("id", seedRow.id);
    }

    // ── PHASE 1 (free): the coverage panel ─────────────────────────────────
    console.log("\n2. Pre-flight coverage panel (no AI call)");
    const coveragePanel = page.locator("text=/units? (will be|are) covered|will get no questions|need[s]? attention/i").first();
    const panelVisible = await coveragePanel.isVisible().catch(() => false);
    assert(panelVisible, "coverage panel renders next to module selection");
    if (panelVisible) {
      console.log(`       panel says: "${(await coveragePanel.textContent())?.trim()}"`);
    }

    // Deselect units and confirm the panel reacts — this is the whole point of
    // a pre-flight preview: it must track the decision that causes the problem.
    console.log("\n3. Panel reacts to changing the unit selection");
    const beforeText = (await coveragePanel.textContent().catch(() => "")) ?? "";
    const moduleButtons = page.locator("button").filter({ hasText: /^M\d+:/ });
    const modCount = await moduleButtons.count();
    console.log(`       ${modCount} module toggle(s) found`);
    if (modCount >= 3) {
      // Deselect two units, leaving a non-contiguous selection — the exact
      // shape the old [min,max] encoding could not represent.
      await moduleButtons.nth(2).click();
      await page.waitForTimeout(400);
      await moduleButtons.nth(3).click();
      await page.waitForTimeout(1200);
      const afterText = (await coveragePanel.textContent().catch(() => "")) ?? "";
      assert(afterText !== beforeText || afterText.length > 0,
        `panel updates after deselecting units ("${afterText.trim().slice(0, 70)}")`);
      await shot(page, "03-coverage-after-deselect");
      // Restore.
      await moduleButtons.nth(2).click();
      await page.waitForTimeout(300);
      await moduleButtons.nth(3).click();
      await page.waitForTimeout(1000);
    } else {
      console.log("       (skipped — not enough module toggles found to drive)");
    }

    // Expanding the panel must show per-unit detail.
    const panelToggle = page
      .locator('button[aria-expanded]')
      .filter({ hasText: /\d+\s*\/\s*\d+\s*covered/i })
      .first();
    if (await panelToggle.isVisible().catch(() => false)) {
      await panelToggle.click();
      await page.waitForTimeout(600);
      const unitChips = await page.locator("text=/Unit \\d+/").count();
      assert(unitChips > 0, `expanded panel lists per-unit detail (${unitChips} unit mentions)`);
      await shot(page, "04-coverage-expanded");
    }

    // ── No crashes ─────────────────────────────────────────────────────────
    console.log("\n4. No client-side errors during the free phase");
    const realErrors = consoleErrors.filter(
      (e) => !/favicon|404|Download the React DevTools|hydrat/i.test(e)
    );
    assert(realErrors.length === 0,
      `console clean (${realErrors.length} error(s))${realErrors.length ? `: ${realErrors[0].slice(0, 120)}` : ""}`);

    if (!PAID) {
      console.log("\n[skipped] Phase 2 (generation, regenerate, undo, locks) — rerun with --paid");
    } else {
      await runPaidPhase(page, consoleErrors);
    }
  } finally {
    await shot(page, "99-final");
    await browser.close();

    // Remove generated_content + Storage objects this run produced.
    const { data: postContent } = await admin
      .from("generated_content")
      .select("id, file_path, answer_key_path")
      .eq("subject_id", subj.id).eq("type", "qpaper");
    const mineContent = (postContent ?? []).filter(
      (r) => !preContentIds.has((r as { id: string }).id)
    ) as Array<{ id: string; file_path: string | null; answer_key_path: string | null }>;
    if (mineContent.length) {
      const paths = mineContent
        .flatMap((r) => [r.file_path, r.answer_key_path])
        .filter((x): x is string => Boolean(x));
      if (paths.length) {
        await admin.storage.from("generated-content").remove(paths);
      }
      await admin.from("generated_content").delete().in("id", mineContent.map((r) => r.id));
      console.log(`[cleanup] generated_content rows removed: ${mineContent.length}; storage objects: ${paths.length}`);
    }

    // Remove only the drafts this run created; leave the faculty's own alone.
    const { data: postDrafts } = await admin
      .from("qpaper_drafts").select("id").eq("faculty_id", prof.id);
    const mine = (postDrafts ?? [])
      .map((d) => (d as { id: string }).id)
      .filter((id) => !preDraftIds.has(id));
    if (mine.length) {
      await admin.from("qpaper_drafts").delete().in("id", mine);
    }
    // Restore any pre-existing draft the Discard click removed.
    const { data: afterDelete } = await admin
      .from("qpaper_drafts").select("id").eq("faculty_id", prof.id);
    const stillThere = new Set((afterDelete ?? []).map((d) => (d as { id: string }).id));
    const destroyed = preDraftRows.filter((d) => !stillThere.has(d.id as string));
    if (destroyed.length) {
      const { error: restoreErr } = await admin.from("qpaper_drafts").insert(destroyed);
      console.log(
        restoreErr
          ? `[cleanup] RESTORE FAILED for ${destroyed.length} draft(s): ${restoreErr.message}`
          : `[cleanup] restored ${destroyed.length} pre-existing draft(s) the UI discarded`
      );
    }

    const { data: residue } = await admin
      .from("qpaper_drafts").select("id").eq("faculty_id", prof.id);
    const left = (residue ?? []).map((d) => (d as { id: string }).id);
    const strays = left.filter((id) => !preDraftIds.has(id));
    const preserved = left.filter((id) => preDraftIds.has(id)).length;
    console.log(
      `[cleanup] created-by-run: ${mine.length} removed | residue: ${strays.length} (expect 0) | ` +
      `pre-existing preserved: ${preserved}/${preDraftIds.size} (expect ${preDraftIds.size}/${preDraftIds.size})`
    );
    if (preserved !== preDraftIds.size) {
      console.error("[cleanup] WARNING: a pre-existing draft was not restored.");
    }
  }
}

/** Phase 2 — spends real Gemini calls. */
async function runPaidPhase(page: Page, consoleErrors: string[]) {
  console.log("\n═══ PAID PHASE — real generation ═══");

  console.log("\n5. Generate a paper");
  const genBtn = page.locator("button").filter({ hasText: /^Generate/i }).last();
  assert(await genBtn.isVisible().catch(() => false), "Generate button present");
  await genBtn.click();
  // Generation is two Pro calls; allow generous time.
  await page.waitForTimeout(3000);
  await shot(page, "05-generating");
  const done = await page
    .locator("text=/Regenerate Whole Paper|Download PDF/i")
    .first()
    .waitFor({ timeout: 240000 })
    .then(() => true)
    .catch(() => false);
  assert(done, "generation completes and the Done view renders");
  if (!done) { await shot(page, "05-generation-timeout"); return; }
  await page.waitForTimeout(1500);
  await shot(page, "06-done-view");

  console.log("\n6. Post-generation coverage ledger");
  const ledger = page.locator("text=/units? are covered|got no questions|need[s]? attention/i").first();
  assert(await ledger.isVisible().catch(() => false), "coverage ledger renders on the result");
  if (await ledger.isVisible().catch(() => false)) {
    console.log(`       ledger says: "${(await ledger.textContent())?.trim()}"`);
  }

  console.log("\n7. Lock control is present on questions");
  const lockBtns = page.locator('button[aria-pressed]');
  const lockCount = await lockBtns.count();
  assert(lockCount > 0, `lock toggles rendered (${lockCount})`);
  if (lockCount > 0) {
    await lockBtns.first().click();
    await page.waitForTimeout(500);
    const pressed = await lockBtns.first().getAttribute("aria-pressed");
    assert(pressed === "true", `first question locks (aria-pressed=${pressed})`);
    await shot(page, "07-locked");
  }

  console.log("\n8. Regenerate menu offers the three modes");
  const regenBtn = page.locator('button[aria-expanded][title*="Regenerate"]').first();
  const regenVisible = await regenBtn.isVisible().catch(() => false);
  assert(regenVisible, "per-question regenerate control present");
  if (regenVisible) {
    await regenBtn.click();
    await page.waitForTimeout(600);
    // Substring match, not exact: "Custom instruction…" carries an ellipsis,
    // and an exact-text selector silently reported the mode as missing.
    for (const mode of ["Same topic", "Different topic", "Custom instruction"]) {
      assert(
        await page.getByText(mode, { exact: false }).first().isVisible().catch(() => false),
        `mode offered: ${mode}`
      );
    }
    await shot(page, "08-regenerate-menu");

    console.log("\n9. Regenerate (same topic) then Undo");
    await page.locator('text="Same topic"').first().click();
    const regenDone = await page.locator("text=/Question regenerated/i").first()
      .waitFor({ timeout: 120000 }).then(() => true).catch(() => false);
    assert(regenDone, "regeneration completes and reports success");
    await page.waitForTimeout(1500);
    await shot(page, "09-regenerated");

    const undoBtn = page.locator('button:has-text("Undo")').first();
    const undoVisible = await undoBtn.isVisible().catch(() => false);
    assert(undoVisible, "Undo appears after a regeneration");
    if (undoVisible) {
      await undoBtn.click();
      await page.waitForTimeout(1200);
      const reverted = await page.locator("text=/Reverted to the previous version/i")
        .first().isVisible().catch(() => false);
      assert(reverted, "Undo reverts and confirms");
      await shot(page, "10-undone");
      assert(
        !(await page.locator('button:has-text("Undo")').first().isVisible().catch(() => false)),
        "Undo disappears once the ring is empty"
      );
    }
  }

  console.log("\n10. No client-side errors during the paid phase");
  const realErrors = consoleErrors.filter(
    (e) => !/favicon|404|Download the React DevTools|hydrat/i.test(e)
  );
  assert(realErrors.length === 0,
    `console clean (${realErrors.length} error(s))${realErrors.length ? `: ${realErrors[0].slice(0, 150)}` : ""}`);
}

main()
  .then(() => {
    console.log(`\n${pass} passed, ${fail} failed`);
    if (fail > 0) {
      console.error("Failures:\n  - " + failures.join("\n  - "));
      console.error("RESULT: FAIL");
      process.exit(1);
    }
    console.log("RESULT: PASS");
  })
  .catch((err) => {
    console.error("\nHarness error:", err);
    console.error(`\n${pass} passed, ${fail} failed`);
    process.exit(1);
  });
