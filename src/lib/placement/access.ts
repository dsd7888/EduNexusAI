/**
 * Single server-side access-policy function for placement cohort/TPO
 * surfaces (CP-G2). Enforced in the API route, never the UI — UI hiding is
 * not security (SPEC §9's own instruction, repeated here because this file
 * is the one place that decision must never drift from).
 *
 * WHY ONE FUNCTION: the checkpoint spec asks for a design where a future
 * `placement_cell`/`tpo` role (not in today's role enum — do not add it
 * speculatively) can be wired in by adding ONE case below, without touching
 * the route's fetch/shape logic at all. Every role's access is expressed as
 * data (an AccessDecision), not scattered `if (role === ...)` branches in
 * the route.
 *
 * THE THREE AXES A ROLE CAN DIFFER ON:
 *   - includeNamedRows  — may the response contain per-student rows at all?
 *   - includeAggregates — may the response contain cohort aggregates at all?
 *   - pinnedBranch       — is this caller locked to one branch server-side,
 *                          ignoring whatever `?branch=` the client sends?
 *     null            → caller may see across all branches, optionally
 *                        narrowed by a client-supplied `?branch=` (dean,
 *                        dept_admin, superadmin).
 *     a branch string → caller's view is FORCED to this branch. Any
 *                        `?branch=` the client sends is ignored outright —
 *                        this is the literal enforcement point for "an HOD
 *                        must not be able to read another branch by passing
 *                        a query param" (see `effectiveBranchFilter` below).
 */

export type PlacementAccessDecision =
  | {
      blocked: false;
      includeNamedRows: boolean;
      includeAggregates: boolean;
      pinnedBranch: string | null;
      warning: null;
    }
  | {
      blocked: true;
      includeNamedRows: false;
      includeAggregates: false;
      pinnedBranch: null;
      warning: string;
    };

/**
 * Resolve what a caller role gets. `callerBranch` is the caller's OWN
 * `profiles.branch`, already looked up server-side by the route — never a
 * client-supplied value.
 */
export function decidePlacementAccess(
  role: string,
  callerBranch: string | null
): PlacementAccessDecision {
  switch (role) {
    case "superadmin":
      // Named per-student rows, all branches. Plus aggregates.
      return {
        blocked: false,
        includeNamedRows: true,
        includeAggregates: true,
        pinnedBranch: null,
        warning: null,
      };

    case "hod": {
      if (!callerBranch) {
        // Unhappy path: an HOD profile with no branch set. There is no
        // branch to scope a roster or an aggregate to — degrade to a clean
        // empty state rather than guessing (leaking all-branch data) or
        // 500ing. Reported explicitly in the response, not silently.
        return {
          blocked: true,
          includeNamedRows: false,
          includeAggregates: false,
          pinnedBranch: null,
          warning:
            "Your profile has no branch set. Ask an admin to configure it before placement data can be shown.",
        };
      }
      // Named per-student rows, but ONLY their own branch — forced
      // server-side. Plus aggregates for their branch.
      return {
        blocked: false,
        includeNamedRows: true,
        includeAggregates: true,
        pinnedBranch: callerBranch,
        warning: null,
      };
    }

    case "dean":
    case "dept_admin":
      // Aggregates only. No named individual rows at all — enforced by the
      // route never populating a `students` field for this decision, not by
      // the UI hiding a column. All-branch aggregates allowed (optionally
      // narrowed by `?branch=`, since narrowing an aggregate view carries no
      // named-row risk).
      return {
        blocked: false,
        includeNamedRows: false,
        includeAggregates: true,
        pinnedBranch: null,
        warning: null,
      };

    // Future placement-cell/tpo role: add one case here (e.g. aggregate-only
    // + optional branch pin) — no other file needs to change. Do NOT add the
    // role to the enum or requireRole speculatively; this case is dead until
    // that role exists.

    default:
      // Defensive fallback only — requireRole() already restricts callers to
      // an allowed role list before this function runs, so this path is not
      // expected to be reachable in production. Kept as a fail-closed
      // default (no rows, no aggregates) rather than an assumption that the
      // caller list here will always match the route's requireRole list.
      return {
        blocked: true,
        includeNamedRows: false,
        includeAggregates: false,
        pinnedBranch: null,
        warning: "You do not have access to placement cohort data.",
      };
  }
}

/**
 * The tamper-proof enforcement point: a pinned caller's branch always wins,
 * full stop — the client-requested branch is never even consulted for a
 * pinned caller. An unpinned caller (dean/dept_admin/superadmin) may
 * optionally narrow by the client-requested branch.
 */
export function effectiveBranchFilter(
  decision: PlacementAccessDecision,
  requestedBranch: string | null
): string | null {
  if (decision.blocked) return null;
  if (decision.pinnedBranch !== null) return decision.pinnedBranch;
  return requestedBranch;
}
