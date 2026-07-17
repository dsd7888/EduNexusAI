// Single source of truth for valid branch codes — the faculty upload dropdown and
// server-side validation both read from this. Edit this array when a new branch is
// onboarded; there is no admin UI or DB-backed lookup table for this (kept minimal).
export const BRANCHES = [
  "CSE",
  "IT",
  "D2D",
  "ECE",
  "MECH",
  "CIVIL",
  "CE",
  "CEIT",
  "DCE",
  "DS",
  "MLAI",
] as const;

export type Branch = (typeof BRANCHES)[number];

export function isValidBranch(value: string): value is Branch {
  return (BRANCHES as readonly string[]).includes(value);
}

export const MIN_SEMESTER = 1;
export const MAX_SEMESTER = 8;

export function isValidSemester(value: number): boolean {
  return Number.isInteger(value) && value >= MIN_SEMESTER && value <= MAX_SEMESTER;
}
