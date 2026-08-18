/**
 * CP-21 verify — Resume PDF/DOCX export null-guard.
 *
 * Bug: `buildResumeDocument`/`buildResumeDoc` accessed `resume.technical_skills`,
 * `resume.education[0]`, `resume.projects`, `resume.internships`,
 * `resume.certifications`, `resume.achievements` (and several nested arrays,
 * e.g. `p.tech_stack`, `it.bullets`, `edu.relevant_courses`) without guards,
 * even though the route only checks `typeof resume === "object"` before
 * building the document. A stored/older resume payload missing any of these
 * keys threw inside `renderToBuffer`/`Packer.toBuffer`, which the route's
 * try/catch converts into a 500 — an unhappy-path crash, not a clean export.
 *
 * Fix: `?? []` / `?? {...}` defaults mirroring the pattern already used in
 * resume/ats/route.ts's buildResumeText.
 *
 * This harness posts a resume payload with every guarded field entirely
 * absent (not just empty) to both export routes and asserts a real
 * PDF/DOCX buffer comes back with 200, not a 500. It also fires the two
 * requests concurrently (concurrent-flow check) and a client-abort mid
 * request (interrupted-flow check).
 */
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
const STUDENT_EMAIL = "teststudent@gmail.com";

const admin = createClient(SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const anon = createClient(SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

// Deliberately missing technical_skills, education, projects, internships,
// certifications, achievements — the exact shape a pre-migration or
// partially-hydrated resume row could have.
const MALFORMED_RESUME: Record<string, unknown> = {
  full_name: "CP-21 Test Student",
  email: "cp21@example.com",
};

for (const sig of ["SIGINT", "SIGTERM", "SIGPIPE", "SIGHUP"] as const) {
  process.on(sig, () => process.exit(1));
}

async function main() {
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: STUDENT_EMAIL,
  });
  if (error || !data) throw new Error(`generateLink failed: ${error?.message}`);
  const { data: verified, error: verifyErr } = await anon.auth.verifyOtp({
    token_hash: data.properties.hashed_token,
    type: "magiclink",
  });
  if (verifyErr || !verified.session)
    throw new Error(`verifyOtp failed: ${verifyErr?.message}`);
  const cookie =
    `${COOKIE_NAME}=` +
    "base64-" +
    Buffer.from(JSON.stringify(verified.session), "utf8").toString("base64url");

  async function exportDoc(path: string, resume: unknown, signal?: AbortSignal) {
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ resume }),
      signal,
    });
    const buf = res.status === 200 ? await res.arrayBuffer() : undefined;
    return { status: res.status, size: buf?.byteLength ?? 0, text: buf ? "" : await res.text() };
  }

  let pass = true;

  // 1. Happy-ish path with the malformed (fields-missing) payload — PDF
  const pdf = await exportDoc("/api/placement/resume/export/pdf", MALFORMED_RESUME);
  console.log("[pdf] status:", pdf.status, "size:", pdf.size, pdf.text);
  if (pdf.status !== 200 || pdf.size < 100) {
    console.error("FAIL: PDF export crashed/failed on resume missing fields");
    pass = false;
  } else {
    console.log("PASS: PDF export produced a real buffer despite missing fields");
  }

  // 2. Same for DOCX
  const docx = await exportDoc("/api/placement/resume/export/docx", MALFORMED_RESUME);
  console.log("[docx] status:", docx.status, "size:", docx.size, docx.text);
  if (docx.status !== 200 || docx.size < 100) {
    console.error("FAIL: DOCX export crashed/failed on resume missing fields");
    pass = false;
  } else {
    console.log("PASS: DOCX export produced a real buffer despite missing fields");
  }

  // 3. Concurrent flow — fire PDF+DOCX at once, both against the malformed payload
  const [cPdf, cDocx] = await Promise.all([
    exportDoc("/api/placement/resume/export/pdf", MALFORMED_RESUME),
    exportDoc("/api/placement/resume/export/docx", MALFORMED_RESUME),
  ]);
  if (cPdf.status !== 200 || cDocx.status !== 200) {
    console.error("FAIL: concurrent exports did not both succeed", cPdf.status, cDocx.status);
    pass = false;
  } else {
    console.log("PASS: concurrent PDF+DOCX exports both succeeded (200/200)");
  }

  // 4. Interrupted flow — abort a request mid-flight, then confirm a fresh
  // request against the same route still succeeds (server not wedged).
  const ac = new AbortController();
  const abortedPromise = exportDoc(
    "/api/placement/resume/export/pdf",
    MALFORMED_RESUME,
    ac.signal
  ).catch((e) => ({ aborted: true, message: String(e) }));
  ac.abort();
  const abortedResult = await abortedPromise;
  console.log("[interrupted] result:", abortedResult);
  const retry = await exportDoc("/api/placement/resume/export/pdf", MALFORMED_RESUME);
  if (retry.status !== 200) {
    console.error("FAIL: export route did not recover after an aborted request");
    pass = false;
  } else {
    console.log("PASS: export route recovered cleanly after a client-aborted request");
  }

  // 5. Also confirm a resume with education as an empty array (not absent)
  // and technical_skills present but partially empty doesn't crash either —
  // the other realistic "null-ish" shape.
  const emptyArraysResume = {
    ...MALFORMED_RESUME,
    education: [],
    technical_skills: { languages: [] }, // frameworks/tools/concepts absent
    projects: [],
    internships: [],
    certifications: [],
    achievements: [],
  };
  const both = await Promise.all([
    exportDoc("/api/placement/resume/export/pdf", emptyArraysResume),
    exportDoc("/api/placement/resume/export/docx", emptyArraysResume),
  ]);
  if (both.some((r) => r.status !== 200)) {
    console.error("FAIL: empty-array-shape resume crashed an export", both);
    pass = false;
  } else {
    console.log("PASS: empty-array-shape resume exported cleanly (both formats)");
  }

  console.log(pass ? "\n=== CP-21 VERIFY: ALL PASS ===" : "\n=== CP-21 VERIFY: FAILURES ===");
  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  console.error("harness error:", err);
  process.exit(1);
});
