import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import fs from "fs";

const env = Object.fromEntries(
  fs
    .readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((l) => l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1)];
    })
);

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const PROJECT_REF = new URL(SUPABASE_URL).hostname.split(".")[0];
const COOKIE_NAME = `sb-${PROJECT_REF}-auth-token`;

const admin = createClient(SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const anon = createClient(SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

const BASE = "http://localhost:3000";

async function sessionFor(email: string) {
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error || !data) throw new Error(`generateLink failed: ${error?.message}`);
  const { data: verified, error: verifyErr } = await anon.auth.verifyOtp({
    token_hash: data.properties.hashed_token,
    type: "magiclink",
  });
  if (verifyErr || !verified.session) throw new Error(`verifyOtp failed: ${verifyErr?.message}`);
  return verified.session;
}

function cookieValueFor(session: unknown): string {
  return "base64-" + Buffer.from(JSON.stringify(session), "utf8").toString("base64url");
}

async function main() {
  const session = await sessionFor("teststudent@gmail.com");
  const cookieValue = cookieValueFor(session);

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addCookies([
    { name: COOKIE_NAME, value: cookieValue, domain: "localhost", path: "/", httpOnly: false, secure: false, sameSite: "Lax" },
  ]);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/student/placement`, { waitUntil: "networkidle" });
  await page.waitForSelector("text=Next move", { timeout: 15000 });
  const readinessBtn = page.getByRole("button", { name: "Your readiness" });
  await readinessBtn.click();
  await page.waitForTimeout(300);

  // Resolve any CSS color (oklch/lab/etc.) to sRGB via a 1x1 canvas — matches
  // the project's established contrast-probe method (see commit 08016cc).
  // Passed as a plain JS string (not a native closure) so tsx's esbuild
  // __name() helper injection doesn't break Playwright's toString() serialization.
  const evalSrc = `
    (() => {
      const toRgb = (colorStr) => {
        const c = document.createElement("canvas");
        c.width = 1; c.height = 1;
        const ctx = c.getContext("2d");
        ctx.fillStyle = colorStr;
        ctx.fillRect(0, 0, 1, 1);
        const d = ctx.getImageData(0, 0, 1, 1).data;
        return [d[0], d[1], d[2]];
      };
      const luminance = ([r, g, b]) => {
        const [rs, gs, bs] = [r, g, b].map((v) => {
          const s = v / 255;
          return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
        });
        return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
      };
      const contrast = (fg, bg) => {
        const l1 = luminance(toRgb(fg));
        const l2 = luminance(toRgb(bg));
        const lighter = Math.max(l1, l2);
        const darker = Math.min(l1, l2);
        return (lighter + 0.05) / (darker + 0.05);
      };
      const bgOf = (el) => {
        let node = el;
        while (node) {
          const bg = getComputedStyle(node).backgroundColor;
          if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") return bg;
          node = node.parentElement;
        }
        return "rgb(255,255,255)";
      };
      const probes = [
        { label: "hero eyebrow (NEXT MOVE, text-ochre)", selector: "p", text: "Next move" },
        { label: "hero title (text-ink)", selector: "h2", text: "Return to Aptitude" },
        { label: "hero reason (text-ink-600)", selector: "p", text: "momentum fades fast" },
        { label: "hero CTA (text-paper on bg-ink)", selector: "a", text: "Return to Aptitude" },
        { label: "locked stage tag (text-ink-300 in mono-tag)", selector: "span", text: "Foundation" },
        { label: "current stage tag (active variant)", selector: "span", text: "Active Prep" },
        { label: "eyebrow label (text-ink-500)", selector: "p", text: "targeting startups" },
        { label: "amber-fill gap tag (text-ink on bg-amber)", selector: "span", text: "Verbal Ability: 0/100" },
        { label: "readiness section label (text-label text-ink-500)", selector: "p", text: "company fit" },
      ];
      const out = {};
      // Reference table: every ink-* shade's text contrast directly against
      // the paper background, so fixes can be picked from measured data
      // instead of guessing.
      const swatchHost = document.createElement("div");
      swatchHost.style.position = "fixed";
      swatchHost.style.top = "-9999px";
      swatchHost.className = "bg-paper";
      document.body.appendChild(swatchHost);
      for (const shade of [300, 400, 500, 600, 700]) {
        const el = document.createElement("span");
        el.className = "text-ink-" + shade;
        el.textContent = "x";
        swatchHost.appendChild(el);
        const cs = getComputedStyle(el);
        out["swatch ink-" + shade + " on paper"] = contrast(cs.color, getComputedStyle(swatchHost).backgroundColor).toFixed(2);
      }
      swatchHost.remove();
      for (const probe of probes) {
        const els = Array.from(document.querySelectorAll(probe.selector));
        const el = els.find((e) => e.textContent && e.textContent.toLowerCase().includes(probe.text.toLowerCase()));
        if (!el) { out[probe.label] = "NOT FOUND"; continue; }
        const cs = getComputedStyle(el);
        const fg = cs.color;
        const bg = bgOf(el);
        out[probe.label] = { fg, bg, fontSize: cs.fontSize, fontWeight: cs.fontWeight, contrast: contrast(fg, bg).toFixed(2) };
      }
      return out;
    })()
  `;
  const results = await page.evaluate(evalSrc);

  console.log(JSON.stringify(results, null, 2));
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
