/**
 * AU-SHELL authorization check: can student B read student A's chat_sessions /
 * chat_messages via an unfiltered or guessed-ID select, the same shape of
 * query the History page issues client-side? Positive-control style: this is
 * the counterpart to the profiles-table finding — confirming which tables DO
 * hold the line, not just the one that doesn't.
 */
import { signInAsStudent, onSignals, hr, makeChecker } from "../src/lib/testing/httpHarness";

async function main() {
  const chk = makeChecker();
  const a = await signInAsStudent();
  const b = await signInAsStudent();
  onSignals(async () => `${await a.cleanup()}; ${await b.cleanup()}`);

  hr("AU-SHELL: cross-student chat_sessions/chat_messages IDOR check");
  console.log(`A: ${a.email} (${a.userId})`);
  console.log(`B: ${b.email} (${b.userId})`);

  const { data: subj } = await a.admin.from("subjects").select("id").limit(1).single();
  const { data: sess, error: sessErr } = await a.admin
    .from("chat_sessions")
    .insert({ student_id: a.userId, subject_id: subj!.id })
    .select("id")
    .single();
  if (sessErr || !sess) throw new Error(`seed session failed: ${sessErr?.message}`);
  await a.admin.from("chat_messages").insert({
    session_id: sess.id,
    role: "user",
    content: "AU-SHELL-IDOR-CANARY-98214",
  });
  console.log(`seeded A's session ${sess.id} with a canary message`);

  // B tries to read A's session by guessing/knowing the ID.
  const bReadSession = await b.client.from("chat_sessions").select("*").eq("id", sess.id);
  const bReadMessages = await b.client.from("chat_messages").select("*").eq("session_id", sess.id);
  const bReadAllSessions = await b.client.from("chat_sessions").select("id, student_id");

  console.log("B reading A's session by ID:", JSON.stringify(bReadSession));
  console.log("B reading A's messages by session_id:", JSON.stringify(bReadMessages));
  console.log("B reading ALL chat_sessions (no filter):", JSON.stringify(bReadAllSessions));

  chk.check(
    "B cannot read A's chat_sessions row",
    (bReadSession.data?.length ?? 0) === 0,
    `got ${bReadSession.data?.length ?? 0} rows`
  );
  chk.check(
    "B cannot read A's chat_messages (canary must not appear)",
    (bReadMessages.data?.length ?? 0) === 0,
    `got ${bReadMessages.data?.length ?? 0} rows`
  );
  const foreignRows = (bReadAllSessions.data ?? []).filter((r: any) => r.student_id !== b.userId);
  chk.check(
    "unfiltered chat_sessions select returns ONLY B's own rows",
    foreignRows.length === 0,
    `${foreignRows.length} foreign rows visible out of ${bReadAllSessions.data?.length ?? 0} total`
  );

  const summary = chk.summary();
  console.log(`\n${summary.passed} passed, ${summary.failed} failed`);

  await a.admin.from("chat_messages").delete().eq("session_id", sess.id);
  await a.admin.from("chat_sessions").delete().eq("id", sess.id);
  console.log(`cleanup A: ${await a.cleanup()}`);
  console.log(`cleanup B: ${await b.cleanup()}`);
  process.exit(summary.failed > 0 ? 1 : 0);
}
main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
