import { createClient } from "@supabase/supabase-js";
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
const BASE = "http://localhost:3000";

const admin = createClient(SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const anon = createClient(SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

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

function cookieHeaderFor(session: unknown): string {
  const value = "base64-" + Buffer.from(JSON.stringify(session), "utf8").toString("base64url");
  return `${COOKIE_NAME}=${value}`;
}

// A deliberately hollow bullet (impressive verb, zero scope/metric) + a JD
// whose language ("distributed systems", "Kafka", "on-call") is NOT present
// anywhere in the bullet, so a JD-tailored rewrite should visibly move
// toward the JD's vocabulary while an untailored rewrite has no reason to.
const HOLLOW_BULLET = "Worked on the backend and helped improve performance";
const JD_TEXT =
  "We are hiring a Backend Engineer to build and operate distributed systems. " +
  "You will work with Kafka for event streaming, own services in production, " +
  "and participate in on-call rotations. Strong Java or Go experience required. " +
  "Experience with Kubernetes and observability tooling (Prometheus, Grafana) is a plus.";

const RESUME = {
  full_name: "Test Student",
  email: "teststudent@gmail.com",
  phone: "9999999999",
  linkedin_url: null,
  github_url: null,
  portfolio_url: null,
  education: [],
  technical_skills: { languages: ["Java", "Python"], frameworks: ["Spring Boot"], tools: ["Git"], concepts: ["DSA", "OOP"] },
  soft_skills: [],
  projects: [
    {
      id: "p1",
      title: "Order Processing Service",
      tech_stack: ["Java", "Spring Boot", "PostgreSQL"],
      bullets: [HOLLOW_BULLET, "Built a REST API for order tracking used by 3 internal teams"],
      github_url: null,
      live_url: null,
      duration: "Jan 2025 - Mar 2025",
    },
  ],
  internships: [],
  certifications: [],
  achievements: [],
  summary: "",
  skills: [],
  last_updated: "",
  completeness: 0,
};

async function main() {
  const email = "teststudent@gmail.com";
  const session = await sessionFor(email);
  const cookie = cookieHeaderFor(session);
  const studentId = session.user.id;

  async function post(path: string, body: unknown) {
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    return { status: res.status, json };
  }

  async function latestLogRows(since: string, task = "placement_prep") {
    const { data } = await admin
      .from("ai_call_logs")
      .select("task, feature, status, model, created_at")
      .eq("user_id", studentId)
      .eq("task", task)
      .gte("created_at", since)
      .order("created_at", { ascending: false });
    return data ?? [];
  }

  const t0 = new Date().toISOString();

  // ── 1. JD-targeted rewrite: same bullet, with vs without JD ──────────────
  console.log("=== 1. JD-targeted rewrite ===");
  const untailored = await post("/api/placement/resume/rewrite-bullet", {
    bullet: HOLLOW_BULLET,
    context: "Order Processing Service using Java, Spring Boot, PostgreSQL",
  });
  console.log("  untailored: status", untailored.status, "tailored flag:", untailored.json.tailored);
  console.log("  variants:", (untailored.json.variants ?? []).map((v: { text: string }) => v.text));

  const tailored = await post("/api/placement/resume/rewrite-bullet", {
    bullet: HOLLOW_BULLET,
    context: "Order Processing Service using Java, Spring Boot, PostgreSQL",
    jd_text: JD_TEXT,
  });
  console.log("  tailored: status", tailored.status, "tailored flag:", tailored.json.tailored);
  console.log("  variants:", (tailored.json.variants ?? []).map((v: { text: string }) => v.text));

  const jdVocab = ["kafka", "distributed", "on-call", "kubernetes", "prometheus", "grafana", "event"];
  const tailoredText = (tailored.json.variants ?? []).map((v: { text: string }) => v.text.toLowerCase()).join(" ");
  const hitsJdVocab = jdVocab.some((w) => tailoredText.includes(w));
  console.log("  tailored variants reference JD vocabulary or its genuine synonyms:", hitsJdVocab, "(informational — the guard forbids injecting JD terms the bullet doesn't already support, so this can legitimately be false)");

  // 1b. A bullet that DOES genuinely overlap with the JD (mentions Kafka) —
  // here the tailored rewrite should be free to retain/lean into that overlap,
  // unlike case 1 where there was nothing legitimate to lean into.
  console.log("\n  --- 1b. bullet with genuine JD overlap ---");
  const OVERLAP_BULLET = "Used Kafka to process order events asynchronously in production";
  const untailored1b = await post("/api/placement/resume/rewrite-bullet", {
    bullet: OVERLAP_BULLET,
    context: "Order Processing Service using Java, Spring Boot, Kafka",
  });
  const tailored1b = await post("/api/placement/resume/rewrite-bullet", {
    bullet: OVERLAP_BULLET,
    context: "Order Processing Service using Java, Spring Boot, Kafka",
    jd_text: JD_TEXT,
  });
  console.log("  untailored:", (untailored1b.json.variants ?? []).map((v: { text: string }) => v.text));
  console.log("  tailored:  ", (tailored1b.json.variants ?? []).map((v: { text: string }) => v.text));

  // ── 2. Interviewer lens: fires alongside ATS scoring ──────────────────────
  console.log("\n=== 2. Interviewer lens (via /ats) ===");
  const ats = await post("/api/placement/resume/ats", { resume: RESUME, jd_text: JD_TEXT });
  console.log("  status:", ats.status, "overall_score:", ats.json.overall_score);
  console.log("  bullet_issues count:", (ats.json.bullet_issues ?? []).length);
  console.log("  interviewer_lens count:", (ats.json.interviewer_lens ?? []).length);
  const flagged = (ats.json.interviewer_lens ?? []).find(
    (h: { original: string }) => h.original === HOLLOW_BULLET
  );
  console.log("  hollow bullet flagged:", Boolean(flagged));
  if (flagged) console.log("  problem:", flagged.problem, "\n  suggested:", flagged.suggested);
  const substantiveBulletFlagged = (ats.json.interviewer_lens ?? []).some(
    (h: { original: string }) => h.original.includes("REST API for order tracking")
  );
  console.log("  substantive bullet NOT flagged (should be false):", substantiveBulletFlagged);

  // ── 3. Cost-log rows: right task/feature for both calls ───────────────────
  // after() runs post-response, asynchronously — poll briefly rather than
  // assuming the insert has landed the instant our fetch() calls return.
  console.log("\n=== 3. ai_call_logs rows since test start ===");
  let rows = await latestLogRows(t0);
  for (let i = 0; i < 8 && rows.length < 4; i++) {
    await new Promise((r) => setTimeout(r, 750));
    rows = await latestLogRows(t0);
  }
  console.log(`  ${rows.length} placement_prep rows for this student since t0`);
  for (const r of rows) console.log("   -", r.task, r.feature, r.status, r.model, r.created_at);
  const allPlacementFeature = rows.every((r) => r.feature === "placement");
  console.log("  all rows feature=placement:", allPlacementFeature);
  console.log("  expect >= 3 rows (1 untailored rewrite + 1 tailored rewrite + 1 ats-call-pair[2 calls]) — actual:", rows.length);

  // ── 4. Unhappy paths ────────────────────────────────────────────────────
  console.log("\n=== 4. Unhappy paths ===");

  const emptyJd = await post("/api/placement/resume/ats", { resume: RESUME, jd_text: "" });
  console.log("  empty JD -> status:", emptyJd.status, "error:", emptyJd.json.error);

  const shortJd = await post("/api/placement/resume/ats", { resume: RESUME, jd_text: "too short" });
  console.log("  short JD (<50 chars) -> status:", shortJd.status, "error:", shortJd.json.error);

  const malformed = await post("/api/placement/resume/ats", { resume: null, jd_text: JD_TEXT });
  console.log("  malformed (null resume) -> status:", malformed.status, "error:", malformed.json.error);

  const emptyResume = { ...RESUME, projects: [], technical_skills: { languages: [], frameworks: [], tools: [], concepts: [] } };
  const emptyContent = await post("/api/placement/resume/ats", { resume: emptyResume, jd_text: JD_TEXT });
  console.log(
    "  empty-content resume -> status:",
    emptyContent.status,
    "_empty:",
    emptyContent.json._empty,
    "interviewer_lens present & empty:",
    Array.isArray(emptyContent.json.interviewer_lens) && emptyContent.json.interviewer_lens.length === 0
  );

  const noBullet = await post("/api/placement/resume/rewrite-bullet", { bullet: "", context: "x" });
  console.log("  rewrite-bullet with empty bullet -> status:", noBullet.status, "error:", noBullet.json.error);

  const shortJdRewrite = await post("/api/placement/resume/rewrite-bullet", {
    bullet: HOLLOW_BULLET,
    context: "x",
    jd_text: "too short to condition on",
  });
  console.log(
    "  rewrite-bullet with short jd_text -> status:",
    shortJdRewrite.status,
    "tailored flag (should be false, floor not met):",
    shortJdRewrite.json.tailored
  );

  // ── 5. Concurrent: two overlapping ATS analyses + two overlapping rewrites,
  // simulating a double-click / re-fetch race. Neither call site has shared
  // mutable state (no DB write in either route), so this is a crash/cross-
  // contamination check, not a locking check. ─────────────────────────────
  console.log("\n=== 5. Concurrent requests ===");
  const [atsA, atsB] = await Promise.all([
    post("/api/placement/resume/ats", { resume: RESUME, jd_text: JD_TEXT }),
    post("/api/placement/resume/ats", { resume: RESUME, jd_text: JD_TEXT + " Extra sentence to make this JD text distinct." }),
  ]);
  console.log("  concurrent ATS A -> status:", atsA.status, "interviewer_lens count:", (atsA.json.interviewer_lens ?? []).length);
  console.log("  concurrent ATS B -> status:", atsB.status, "interviewer_lens count:", (atsB.json.interviewer_lens ?? []).length);
  console.log("  A's jd_text echoed back matches A's request (no cross-talk):", atsA.json.jd_text === JD_TEXT);

  const [rwA, rwB] = await Promise.all([
    post("/api/placement/resume/rewrite-bullet", { bullet: HOLLOW_BULLET, context: "x" }),
    post("/api/placement/resume/rewrite-bullet", { bullet: HOLLOW_BULLET, context: "x", jd_text: JD_TEXT }),
  ]);
  console.log("  concurrent rewrite A (no JD) -> status:", rwA.status, "tailored:", rwA.json.tailored);
  console.log("  concurrent rewrite B (with JD) -> status:", rwB.status, "tailored:", rwB.json.tailored);
  console.log("  no cross-talk (A false, B true):", rwA.json.tailored === false && rwB.json.tailored === true);

  console.log("\nDone.");
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exitCode = 1;
});
