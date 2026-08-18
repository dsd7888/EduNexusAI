/**
 * CP-15 verification: resume autosave upsert + shape validation + array caps.
 * Real HTTP against the running dev server, real DB via httpHarness.
 */
import {
  signInAsStudent,
  waitForServer,
  onSignals,
  makeChecker,
  hr,
} from "../src/lib/testing/httpHarness";

async function main() {
  await waitForServer();
  const session = await signInAsStudent();
  onSignals(session.cleanup);
  const check = makeChecker();

  hr("CP-15: resume autosave upsert + validation + array caps");

  // ── 1. Fresh student (no prior student_placement_profiles row) POSTs a
  //       resume -> immediate GET must return the same data.
  //       (Was: .update() silently no-oped, GET kept returning DEFAULT_RESUME
  //       full_name:"" forever.)
  const { data: before } = await session.admin
    .from("student_placement_profiles")
    .select("student_id")
    .eq("student_id", session.userId)
    .maybeSingle();
  check.eq("precondition: no existing profile row", before, null);

  const fullResume = {
    full_name: "Test Student",
    email: session.email,
    phone: "9999999999",
    linkedin_url: null,
    github_url: null,
    portfolio_url: null,
    education: [
      {
        degree: "B.Tech",
        branch: "CSE",
        university: "Test University",
        cgpa: "8.0",
        year_of_passing: "2026",
        relevant_courses: ["DSA", "OS", "DBMS"],
      },
    ],
    technical_skills: {
      languages: ["Java", "Python"],
      frameworks: ["React"],
      tools: ["Git"],
      concepts: ["DSA"],
    },
    soft_skills: ["Communication"],
    projects: [
      { id: "p1", title: "Project 1", tech_stack: ["React"], bullets: ["Built X"], github_url: null, live_url: null, duration: null },
    ],
    internships: [],
    certifications: [],
    achievements: [],
    last_updated: "",
    completeness: 0,
  };

  const post1 = await session.json("/api/placement/resume", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ resume: fullResume }),
  });
  check.eq("POST fresh resume -> 200", post1.status, 200);

  const get1 = await session.json<{ resume: { full_name: string } }>("/api/placement/resume");
  check.eq("GET after fresh POST -> 200", get1.status, 200);
  check.eq("GET reflects saved full_name (upsert, not silent no-op)", get1.body.resume.full_name, "Test Student");

  // ── 2. Second POST (row now exists) -> upsert path still works (update-equivalent).
  const post2 = await session.json("/api/placement/resume", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ resume: { ...fullResume, full_name: "Updated Name" } }),
  });
  check.eq("POST again (row exists) -> 200", post2.status, 200);
  const get2 = await session.json<{ resume: { full_name: string } }>("/api/placement/resume");
  check.eq("GET reflects second update", get2.body.resume.full_name, "Updated Name");

  // ── 3. Malformed payload -> 400, not 500.
  const malformed1 = await session.json("/api/placement/resume", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ resume: { full_name: "X" } }), // missing education/technical_skills/projects etc.
  });
  check.eq("malformed payload (missing arrays) -> 400", malformed1.status, 400);

  const malformed2 = await session.json("/api/placement/resume", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ resume: { ...fullResume, technical_skills: { languages: "not-an-array" } } }),
  });
  check.eq("malformed technical_skills -> 400", malformed2.status, 400);

  const missingBody = await session.json("/api/placement/resume", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  check.eq("missing resume key entirely -> 400", missingBody.status, 400);

  // ── 4. 200-project payload -> capped, not silently accepted in full.
  const manyProjects = Array.from({ length: 200 }, (_, i) => ({
    id: `p${i}`,
    title: `Project ${i}`,
    tech_stack: [],
    bullets: ["a", "b", "c", "d", "e"], // also exceeds MAX_BULLETS=3
    github_url: null,
    live_url: null,
    duration: null,
  }));
  const bigPost = await session.json<{ resume: { projects: Array<{ bullets: string[] }> } }>(
    "/api/placement/resume",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ resume: { ...fullResume, projects: manyProjects } }),
    }
  );
  check.eq("200-project payload -> still 200 (accepted+capped)", bigPost.status, 200);
  check.eq("projects capped to MAX_PROJECTS=4", bigPost.body.resume.projects.length, 4);
  check.eq("bullets capped to MAX_BULLETS=3", bigPost.body.resume.projects[0].bullets.length, 3);

  const getFinal = await session.json<{ resume: { projects: unknown[] } }>("/api/placement/resume");
  check.eq("DB-persisted projects also capped (not just response body)", getFinal.body.resume.projects.length, 4);

  // ── 5. Concurrent POSTs — two overlapping saves, no crash, no corruption.
  const [c1, c2] = await Promise.all([
    session.json("/api/placement/resume", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ resume: { ...fullResume, full_name: "Concurrent A" } }),
    }),
    session.json("/api/placement/resume", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ resume: { ...fullResume, full_name: "Concurrent B" } }),
    }),
  ]);
  check.eq("concurrent POST 1 -> 200", c1.status, 200);
  check.eq("concurrent POST 2 -> 200", c2.status, 200);
  const getAfterConcurrent = await session.json<{ resume: { full_name: string } }>("/api/placement/resume");
  const landedName = getAfterConcurrent.body.resume.full_name;
  check.check(
    "concurrent writes: one of the two names landed, not corrupted",
    landedName === "Concurrent A" || landedName === "Concurrent B",
    landedName
  );

  const notes = await session.cleanup();
  console.error(`[cleanup] ${notes}`);

  const { passed, failed } = check.summary();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
