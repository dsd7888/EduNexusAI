// IST (Asia/Kolkata) bucketing helpers for the Pilot Analysis page.
//
// created_at columns stay UTC/timestamptz — there is NO IST conversion in any write
// path. Bucketing is done here at read/query time. IST is a fixed UTC+5:30 offset with
// no DST, so shifting the epoch by +330 minutes and reading the UTC date is exactly
// equivalent to Postgres `(created_at AT TIME ZONE 'Asia/Kolkata')::date`.

const IST_OFFSET_MS = 330 * 60 * 1000; // +5:30

function shiftToIst(utcISO: string): Date {
  return new Date(new Date(utcISO).getTime() + IST_OFFSET_MS);
}

// YYYY-MM-DD in IST.
export function istDateKey(utcISO: string): string {
  return shiftToIst(utcISO).toISOString().slice(0, 10);
}

// ISO week key "YYYY-Www" in IST — used for the "active in ≥2 distinct weeks" metric.
export function istIsoWeekKey(utcISO: string): string {
  const d = shiftToIst(utcISO);
  // Work in the shifted UTC frame using UTC getters.
  const target = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  );
  // ISO week: Thursday-based. Day number 1..7 (Mon..Sun).
  const dayNr = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNr + 3); // nearest Thursday
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const firstDayNr = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNr + 3);
  const week =
    1 +
    Math.round(
      (target.getTime() - firstThursday.getTime()) / (7 * 24 * 3600 * 1000)
    );
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

// List of IST date keys (YYYY-MM-DD) for the last `days` days, oldest→newest, so
// charts can render a continuous axis with zero-filled gaps.
export function lastNIstDateKeys(days: number): string[] {
  const keys: string[] = [];
  const nowIst = new Date(Date.now() + IST_OFFSET_MS);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(nowIst.getTime() - i * 24 * 3600 * 1000);
    keys.push(d.toISOString().slice(0, 10));
  }
  return keys;
}
