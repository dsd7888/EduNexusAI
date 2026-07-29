/**
 * CP-Q4 Part 5e — the snapshot freshness model, over real HTTP.
 *
 * Proves the three states of the read-through cache:
 *   1. missing  → recompute inline, refreshedInline: true
 *   2. fresh    → serve stored, refreshedInline: false, NO recompute
 *   3. stale    → recompute inline, refreshedInline: true
 *
 * "No recompute" is asserted by watching `computed_at` rather than by trusting
 * the boolean the route reports about itself. A route that recomputed anyway
 * while reporting `refreshedInline: false` would pass a flag-only check and
 * still cost what this whole design exists to avoid.
 *
 * Requires a dev server:  npm run dev
 *   npx tsx _cp_q4_verify/snapshot_freshness.ts > out.txt 2>&1
 */

import {
  signInAsStudent,
  makeChecker,
  hr,
  sub,
  onSignals,
  waitForServer,
  sleep,
  type StudentSession,
} from "@/lib/testing/httpHarness";
import { seedScenario, type SeedScenario } from "./seed";
import { SCENARIO } from "./scenario";

interface Envelope {
  snapshot: { computed_at: string; attempt_count: number };
  staleAt: string;
  refreshedInline: boolean;
  refreshRejectedUntil: string | null;
}

async function main() {
  const c = makeChecker();
  hr("CP-Q4 Part 5e — SNAPSHOT FRESHNESS (real HTTP)");
  await waitForServer();

  let scenario: SeedScenario | null = null;
  let faculty: StudentSession | null = null;

  const cleanupAll = async (): Promise<string> => {
    const notes: string[] = [];
    if (faculty) notes.push(await faculty.cleanup());
    if (scenario) notes.push(await scenario.cleanup());
    return notes.join("; ");
  };
  onSignals(cleanupAll);

  try {
    sub("0. Seed + an assigned faculty");
    scenario = await seedScenario(SCENARIO);
    const s = scenario;
    faculty = await signInAsStudent(undefined, undefined, {
      role: "faculty",
      fullName: "CPQ4 Freshness Faculty",
    });
    await faculty.admin.from("faculty_assignments").insert({
      faculty_id: faculty.userId,
      subject_id: s.subjectId,
      assigned_by: faculty.userId,
    });
    const path = `/api/faculty/analytics/subject/${s.subjectId}`;

    // No snapshot exists yet — seedScenario does not create one.
    const { count: before } = await s.admin
      .from("faculty_analytics_snapshots")
      .select("*", { count: "exact", head: true })
      .eq("subject_id", s.subjectId);
    c.eq("no snapshot exists before the first read", before ?? 0, 0);

    // ── 1. MISSING → inline refresh ──
    sub("1. First read — snapshot missing");
    const first = await faculty.json<Envelope>(path);
    c.eq("status 200", first.status, 200);
    c.check("refreshedInline = true", first.body?.refreshedInline === true);
    c.eq(
      "snapshot has the seeded attempt count",
      first.body?.snapshot.attempt_count,
      30
    );
    const firstComputedAt = first.body!.snapshot.computed_at;
    c.check(
      "computed_at is current (within 60s)",
      Math.abs(Date.now() - new Date(firstComputedAt).getTime()) < 60_000,
      firstComputedAt
    );
    c.check(
      "staleAt is 2 hours after computed_at",
      Math.abs(
        new Date(first.body!.staleAt).getTime() -
          new Date(firstComputedAt).getTime() -
          2 * 60 * 60 * 1000
      ) < 1000
    );

    // ── 2. FRESH → served from cache, no recompute ──
    sub("2. Immediate second read — snapshot fresh");
    await sleep(1100); // so a recompute would produce a visibly different computed_at
    const second = await faculty.json<Envelope>(path);
    c.eq("status 200", second.status, 200);
    c.check("refreshedInline = false", second.body?.refreshedInline === false);
    c.eq(
      "computed_at UNCHANGED — proves no recompute happened",
      second.body?.snapshot.computed_at,
      firstComputedAt
    );
    c.check(
      "…and it is byte-identical across cache/recompute paths (no format drift)",
      second.body?.snapshot.computed_at === firstComputedAt &&
        /Z$/.test(second.body!.snapshot.computed_at)
    );

    const { data: rowAfterSecond } = await s.admin
      .from("faculty_analytics_snapshots")
      .select("computed_at")
      .eq("subject_id", s.subjectId)
      .maybeSingle();
    // Compared as an INSTANT: Postgres serialises +00:00 where JS emits Z.
    // The route normalises its own output (see snapshotStore.envelope), but a
    // direct DB read still returns the Postgres form.
    c.eq(
      "stored computed_at also unchanged (the DB was not written)",
      new Date(
        (rowAfterSecond as { computed_at: string }).computed_at
      ).toISOString(),
      firstComputedAt
    );

    // ── 3. STALE → inline refresh ──
    sub("3. Age computed_at by 3 hours — snapshot stale");
    const aged = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    await s.admin
      .from("faculty_analytics_snapshots")
      .update({ computed_at: aged })
      .eq("subject_id", s.subjectId);

    const third = await faculty.json<Envelope>(path);
    c.eq("status 200", third.status, 200);
    c.check("refreshedInline = true", third.body?.refreshedInline === true);
    c.check(
      "computed_at moved forward past the aged value",
      new Date(third.body!.snapshot.computed_at).getTime() >
        new Date(aged).getTime(),
      third.body!.snapshot.computed_at
    );
    c.check(
      "…and is current again",
      Math.abs(Date.now() - new Date(third.body!.snapshot.computed_at).getTime()) <
        60_000
    );

    // ── 4. Still exactly one row after three reads ──
    sub("4. Still one row per subject");
    const { count: after } = await s.admin
      .from("faculty_analytics_snapshots")
      .select("*", { count: "exact", head: true })
      .eq("subject_id", s.subjectId);
    c.eq("exactly 1 snapshot row after 3 reads", after ?? 0, 1);

    // ── 5. Manual refresh floor ──
    sub("5. Manual refresh is rate-limited (15 min per subject)");
    const forced = await faculty.json<Envelope>(`${path}?force=1`);
    c.eq("forced refresh right after a fresh compute → 200", forced.status, 200);
    c.check(
      "refreshRejectedUntil is set (the force was refused)",
      forced.body?.refreshRejectedUntil != null,
      String(forced.body?.refreshRejectedUntil)
    );
    c.check(
      "…and no recompute happened",
      forced.body?.refreshedInline === false
    );

    // Age past the manual floor but NOT past the 2h staleness window, so the
    // only thing that can trigger a recompute is the force itself.
    const agedPastFloor = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    await s.admin
      .from("faculty_analytics_snapshots")
      .update({ computed_at: agedPastFloor })
      .eq("subject_id", s.subjectId);
    const forcedOk = await faculty.json<Envelope>(`${path}?force=1`);
    c.check(
      "after 20 min, force is allowed",
      forcedOk.body?.refreshRejectedUntil == null
    );
    c.check(
      "…and it recomputed even though the snapshot was still within the 2h window",
      forcedOk.body?.refreshedInline === true
    );
  } catch (err) {
    c.check("harness ran without throwing", false, String(err));
  } finally {
    sub("6. Cleanup — verified, not assumed");
    const notes = await cleanupAll();
    console.log(`  cleanup: ${notes}`);
    if (scenario) {
      const { count } = await scenario.admin
        .from("faculty_analytics_snapshots")
        .select("*", { count: "exact", head: true })
        .eq("subject_id", scenario.subjectId);
      c.eq("no snapshot left behind", count ?? 0, 0);
    }
  }

  const { passed, failed } = c.summary();
  hr(`RESULT — ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

void main();
