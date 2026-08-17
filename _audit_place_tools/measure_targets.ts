import { chromium } from "playwright";
import { createBrowserClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";

function loadEnvLocal(): void {
  const raw = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (!process.env[key]) process.env[key] = val;
  }
}
loadEnvLocal();
const BASE_URL = "http://localhost:3000";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

  const email = `cp-audit-place-tools-measure-${randomUUID().slice(0, 8)}@edunexus-harness.invalid`;
  const { data: created } = await admin.auth.admin.createUser({ email, password: `Hx-${randomUUID()}`, email_confirm: true });
  const userId = created!.user!.id;
  for (let i = 0; i < 20; i++) {
    const { data } = await admin.from("profiles").select("id").eq("id", userId).maybeSingle();
    if (data) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  await admin.from("profiles").update({ role: "student", branch: "Computer Science", semester: 7, department: "Engineering" }).eq("id", userId);
  await admin.from("student_placement_profiles").upsert({ student_id: userId, setup_complete: true, primary_target: "service_it", cgpa: 8.2 });

  const jar = new Map<string, { value: string }>();
  const browserLike = createBrowserClient(url, anonKey, {
    isSingleton: false,
    cookies: {
      getAll: () => [...jar.entries()].map(([name, v]) => ({ name, value: v.value })),
      setAll: (list) => { for (const { name, value } of list) jar.set(name, { value }); },
    },
  });
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  await browserLike.auth.verifyOtp({ type: "email", token_hash: link!.properties!.hashed_token! });

  const browser = await chromium.launch();
  const cookies = [...jar.entries()].map(([name, v]) => ({ name, value: v.value, domain: "localhost", path: "/" }));

  const pages = [
    { slug: "resume", path: "/student/placement/resume" },
    { slug: "jd-analyzer", path: "/student/placement/jd-analyzer" },
    { slug: "projects", path: "/student/placement/projects" },
    { slug: "skill-map", path: "/student/placement/skill-map" },
    { slug: "interview-mock", path: "/student/placement/interview/mock" },
  ];

  for (const pg of pages) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.addCookies(cookies);
    const page = await context.newPage();
    await page.goto(`${BASE_URL}${pg.path}`, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(800);
    const sizes = await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll("button, a[href]"));
      return els
        .filter((el) => (el as HTMLElement).offsetParent !== null)
        .map((el) => {
          const r = el.getBoundingClientRect();
          return { text: (el.textContent || "").trim().slice(0, 30), h: Math.round(r.height), w: Math.round(r.width) };
        })
        .filter((s) => s.text.length > 0 && s.h > 0);
    });
    console.log(`\n=== ${pg.slug} ===`);
    for (const s of sizes) {
      const flag = s.h < 44 ? " <-- UNDER 44px" : "";
      console.log(`  h=${s.h} w=${s.w}  "${s.text}"${flag}`);
    }
    await context.close();
  }

  await browser.close();
  await admin.from("student_placement_profiles").delete().eq("student_id", userId);
  await admin.from("profiles").delete().eq("id", userId);
  await admin.auth.admin.deleteUser(userId);
}
main().catch((e) => { console.error(e); process.exit(1); });
