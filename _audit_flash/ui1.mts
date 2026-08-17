import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { createBrowserClient } from "@supabase/ssr";
import { loadEnvLocal, BASE_URL } from "../src/lib/testing/httpHarness";

const IDME3532 = "113969c6-5c0e-452b-8689-33c5cae95ae5"; // 4 modules: concept/formula/comparison mix

async function mintCookies() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: "teststudent@gmail.com",
  });
  if (error || !data.properties?.hashed_token) {
    throw new Error(`generateLink failed: ${error?.message}`);
  }

  const jar = new Map<string, string>();
  const browserLike = createBrowserClient(url, anonKey, {
    isSingleton: false,
    cookies: {
      getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })),
      setAll: (list) => { for (const { name, value } of list) jar.set(name, value); },
    },
  });
  const { error: otpErr } = await browserLike.auth.verifyOtp({
    type: "email",
    token_hash: data.properties.hashed_token,
  });
  if (otpErr) throw new Error(`verifyOtp failed: ${otpErr.message}`);

  return [...jar.entries()].map(([name, value]) => ({ name, value }));
}

async function main() {
  loadEnvLocal();
  const browser = await chromium.launch();
  const cookies = await mintCookies();

  async function newCtx(viewport: { width: number; height: number }, colorScheme: "light" | "dark", reducedMotion?: "reduce") {
    const context = await browser.newContext({ viewport, colorScheme, reducedMotion });
    await context.addCookies(cookies.map((c) => ({ name: c.name, value: c.value, url: BASE_URL })));
    return context;
  }

  // 1. Desktop light, first card (concept, front)
  {
    const ctx = await newCtx({ width: 1280, height: 900 }, "light");
    const page = await ctx.newPage();
    const errs: string[] = [];
    page.on("pageerror", (e) => errs.push(e.message));
    page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
    await page.goto(`${BASE_URL}/student/notes/${IDME3532}/flashcards`, { waitUntil: "networkidle", timeout: 20000 });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: "_audit_flash/1-desktop-front-card1.png" });
    console.log("1 desktop front card1 errs:", errs);

    // measure touch targets
    const dims = await page.evaluate(() => {
      const out: Record<string, string> = {};
      document.querySelectorAll("button, a").forEach((el, i) => {
        const r = el.getBoundingClientRect();
        const label = (el.getAttribute("aria-label") || el.textContent || `el${i}`).trim().slice(0, 30);
        out[`${label}#${i}`] = `${Math.round(r.width)}x${Math.round(r.height)}`;
      });
      return out;
    });
    console.log("touch targets:", JSON.stringify(dims, null, 2));

    // reveal via click on card surface
    await page.click('[data-testid="flashcard-surface"]');
    await page.waitForTimeout(400);
    await page.screenshot({ path: "_audit_flash/2-desktop-revealed-card1.png" });

    // check contrast-relevant classes present, and focus ring on Reveal button
    await page.keyboard.press("Tab");
    await page.screenshot({ path: "_audit_flash/3-desktop-focus-ring.png" });

    await ctx.close();
  }

  // 2. Mobile light
  {
    const ctx = await newCtx({ width: 390, height: 844 }, "light");
    const page = await ctx.newPage();
    await page.goto(`${BASE_URL}/student/notes/${IDME3532}/flashcards`, { waitUntil: "networkidle", timeout: 20000 });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: "_audit_flash/4-mobile-front-card1.png" });
    await ctx.close();
  }

  // 3. Desktop dark (system) — should be byte-identical to light per "always night" design
  {
    const ctx = await newCtx({ width: 1280, height: 900 }, "dark");
    const page = await ctx.newPage();
    await page.goto(`${BASE_URL}/student/notes/${IDME3532}/flashcards`, { waitUntil: "networkidle", timeout: 20000 });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: "_audit_flash/5-desktop-dark-system.png" });
    await ctx.close();
  }

  // 4. Navigate to a formula-block card (module filter or paging) to see dark-surface layering (SymbolTable+WorkedExample)
  {
    const ctx = await newCtx({ width: 1280, height: 900 }, "light");
    const page = await ctx.newPage();
    await page.goto(`${BASE_URL}/student/notes/${IDME3532}/flashcards`, { waitUntil: "networkidle", timeout: 20000 });
    await page.waitForTimeout(1000);
    // advance through cards, revealing and capturing each until we hit a formula or comparison card, or run out
    for (let i = 0; i < 25; i++) {
      const counter = await page.locator("header span.font-plex-mono").textContent().catch(() => null);
      // reveal
      await page.click('[data-testid="flashcard-surface"]');
      await page.waitForTimeout(350);
      const kind = await page.evaluate(() => {
        return document.body.innerText.includes("Worked example") ? "formula-with-example"
          : document.querySelector("table") ? "table-block"
          : "other";
      });
      if (kind !== "other") {
        await page.screenshot({ path: `_audit_flash/6-dark-surface-${kind}-${i}.png` });
        console.log("found", kind, "at", counter);
        break;
      }
      // next card
      const nextBtn = page.locator('button[aria-label="Next card"]');
      const disabled = await nextBtn.isDisabled();
      if (disabled) { console.log("ran out of cards at", counter); break; }
      await nextBtn.click();
      await page.waitForTimeout(250);
    }
    await ctx.close();
  }

  // 5. Reduced motion
  {
    const ctx = await newCtx({ width: 1280, height: 900 }, "light", "reduce");
    const page = await ctx.newPage();
    await page.goto(`${BASE_URL}/student/notes/${IDME3532}/flashcards`, { waitUntil: "networkidle", timeout: 20000 });
    await page.waitForTimeout(1000);
    await page.click('[data-testid="flashcard-surface"]');
    await page.waitForTimeout(300);
    await page.screenshot({ path: "_audit_flash/7-reduced-motion-revealed.png" });
    await ctx.close();
  }

  // 6. Invalid moduleId query param (boundary test)
  {
    const ctx = await newCtx({ width: 1280, height: 900 }, "light");
    const page = await ctx.newPage();
    const errs: string[] = [];
    page.on("pageerror", (e) => errs.push(e.message));
    await page.goto(`${BASE_URL}/student/notes/${IDME3532}/flashcards?moduleId=<script>alert(1)</script>`, { waitUntil: "networkidle", timeout: 20000 });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: "_audit_flash/8-boundary-xss-moduleid.png" });
    console.log("xss moduleid errs:", errs, "url:", page.url());
    await ctx.close();
  }

  // 7. moduleId that matches nothing real (well-formed but unknown) — should show ALL per sliceToModule fallback
  {
    const ctx = await newCtx({ width: 1280, height: 900 }, "light");
    const page = await ctx.newPage();
    await page.goto(`${BASE_URL}/student/notes/${IDME3532}/flashcards?moduleId=nonexistent-module-id`, { waitUntil: "networkidle", timeout: 20000 });
    await page.waitForTimeout(1000);
    const counterText = await page.locator("header span.font-plex-mono").textContent().catch(() => null);
    console.log("unknown moduleId counter:", counterText);
    await page.screenshot({ path: "_audit_flash/9-unknown-moduleid-fallback.png" });
    await ctx.close();
  }

  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
