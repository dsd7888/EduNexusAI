/**
 * AU-SHELL UI verification: dashboard, subjects, profile, chat-history at
 * desktop(1280) + mobile(390), light + dark, as the real seeded test student.
 * Also measures: sidebar collapse-control presence, nav touch-target sizes,
 * and mobile-menu open/close behavior.
 */
import { chromium } from "playwright";
import { createBrowserClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadEnvLocal(): void {
  const raw = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}
loadEnvLocal();

const EMAIL = "teststudent@gmail.com";
const BASE_URL = "http://localhost:3000";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

  const jar = new Map<string, string>();
  const browserLike = createBrowserClient(url, anonKey, {
    isSingleton: false,
    cookies: {
      getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })),
      setAll: (list) => {
        for (const { name, value } of list) jar.set(name, value);
      },
    },
  });

  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({ type: "magiclink", email: EMAIL });
  if (linkErr || !link.properties?.hashed_token) throw new Error(`generateLink failed: ${linkErr?.message}`);
  const { error: otpErr } = await browserLike.auth.verifyOtp({ type: "email", token_hash: link.properties.hashed_token });
  if (otpErr) throw new Error(`verifyOtp failed: ${otpErr.message}`);
  console.log(`signed in as ${EMAIL}, cookies: ${[...jar.keys()].join(", ")}`);

  const browser = await chromium.launch();
  const cookiesForPlaywright = [...jar.entries()].map(([name, value]) => ({
    name,
    value,
    domain: "localhost",
    path: "/",
  }));

  const pages: { route: string; slug: string }[] = [
    { route: "/student/dashboard", slug: "dashboard" },
    { route: "/student/subjects", slug: "subjects" },
    { route: "/student/profile", slug: "profile" },
    { route: "/student/history", slug: "history" },
  ];
  const viewports: { name: string; width: number; height: number }[] = [
    { name: "desktop", width: 1280, height: 800 },
    { name: "mobile", width: 390, height: 844 },
  ];
  const schemes: ("light" | "dark")[] = ["light", "dark"];

  for (const pg of pages) {
    for (const vp of viewports) {
      for (const scheme of schemes) {
        const context = await browser.newContext({
          viewport: { width: vp.width, height: vp.height },
          colorScheme: scheme,
        });
        await context.addCookies(cookiesForPlaywright);
        const page = await context.newPage();
        await page.goto(`${BASE_URL}${pg.route}`, { waitUntil: "networkidle", timeout: 30000 });
        await page.waitForTimeout(1200);
        const path = `_audit_shell/screenshots/${pg.slug}-${vp.name}-${scheme}.png`;
        await page.screenshot({ path, fullPage: false });
        console.log(`wrote ${path}`);

        if (vp.name === "desktop" && scheme === "light") {
          const collapseButtons = await page
            .locator('button[aria-label*="collapse" i], button[title*="collapse" i]')
            .count();
          const asideWidthClass = await page.locator("aside").first().evaluate((el) => el.className).catch(() => "n/a");
          console.log(`  [${pg.slug}] desktop collapse-labeled buttons=${collapseButtons}, aside class="${asideWidthClass}"`);
        }

        if (vp.name === "mobile" && scheme === "light") {
          // Measure the hamburger + close button touch targets.
          const openBtn = page.locator('button[aria-label="Open menu"]').first();
          const openBox = await openBtn.boundingBox().catch(() => null);
          console.log(`  [${pg.slug}] mobile "Open menu" button box=${JSON.stringify(openBox)}`);
          if (openBox) {
            await openBtn.click();
            await page.waitForTimeout(400);
            const closeBtn = page.locator('button[aria-label="Close menu"]').first();
            const closeBox = await closeBtn.boundingBox().catch(() => null);
            console.log(`  [${pg.slug}] mobile "Close menu" button box=${JSON.stringify(closeBox)}`);
            const overlayPath = `_audit_shell/screenshots/${pg.slug}-mobile-menu-open.png`;
            await page.screenshot({ path: overlayPath, fullPage: false });
            console.log(`  wrote ${overlayPath}`);
            // nav link target sizes inside the open drawer
            const navBoxes = await page.locator("nav a").evaluateAll((els) =>
              els.map((el) => {
                const r = el.getBoundingClientRect();
                return { text: el.textContent?.trim(), h: r.height, w: r.width };
              })
            );
            console.log(`  [${pg.slug}] nav link sizes: ${JSON.stringify(navBoxes)}`);
          }
        }

        await context.close();
      }
    }
  }

  await browser.close();
  console.log("done — no rows created, nothing to clean up (read-only session)");
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exitCode = 1;
});
