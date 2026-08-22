/**
 * CO-code canonicalization for PYQ data.
 *
 * Exam papers print the course-outcome column in whatever dialect the template
 * author chose: "03", "CO-3", "co3", "C.O.3". `module_co_mapping.co_code` — the
 * other side of every join we do — is always canonical "CO3".
 *
 * Every PYQ consumer joins on exact string equality:
 *   - src/lib/notes/pyq-frequency.ts  → .in("co", allCoCodes)
 *   - src/lib/pyq/coverage.ts         → CO coverage for the readiness panel
 *   - the qpaper CO-aware module picker
 *
 * so an un-normalized `co` doesn't produce a *wrong* answer, it produces a
 * silently empty one — the PYQ frequency signal would read as "no signal" for
 * every module even with papers uploaded. Normalize once, on write.
 *
 * Kept deliberately free of imports so both the API routes and the migration's
 * SQL equivalent can be checked against each other by eye.
 */

/**
 * "03" | "CO-3" | "co3" | "C.O. 3" → "CO3".
 * Returns null when the value carries no usable digit (a garbled extraction) —
 * null is honest, a junk code that can never match anything is not.
 */
export function normalizeCoCode(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const digits = String(raw).match(/\d+/)?.[0];
  if (!digits) return null;
  // "03" → 3 → "CO3". Number() also collapses "003" and "3" onto one code.
  const n = Number(digits);
  if (!Number.isFinite(n) || n <= 0) return null;
  return `CO${n}`;
}

/**
 * True when a PostgREST/Postgres error is "that column doesn't exist".
 *
 * WHY THIS EXISTS: `documents.exam_type` arrives in migration
 * 20260822000000, which is applied by hand against the live pilot DB and
 * therefore may land BEFORE or AFTER the code that writes it is deployed.
 * CLAUDE.md's "schema and code ship together" rule exists because that gap has
 * already bitten this repo once; here the gap is unavoidable (the deploy is
 * automatic, the migration is manual), so the code absorbs it instead.
 *
 * Every read and write of `exam_type` is wrapped in a fallback keyed off this
 * check: with the column present, behaviour is exactly as written; without it,
 * exam type is simply absent and the past-paper feature works in every other
 * respect. Crucially this also keeps the PRE-EXISTING superadmin PYQ upload
 * from regressing on a deploy that lands first.
 *
 * Delete this, and its call sites, once the migration is confirmed applied.
 *
 * 42703 = undefined_column (Postgres). PGRST204 = PostgREST's own
 * "column not found in schema cache", returned when its cached schema predates
 * the column.
 */
export function isMissingColumnError(
  err: { code?: string | null; message?: string | null } | null | undefined
): boolean {
  if (!err) return false;
  if (err.code === "42703" || err.code === "PGRST204") return true;
  return /column .* does not exist|could not find the .* column/i.test(
    err.message ?? ""
  );
}
