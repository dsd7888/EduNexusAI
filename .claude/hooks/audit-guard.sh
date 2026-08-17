#!/usr/bin/env bash
# .claude/hooks/audit-guard.sh
# ---------------------------------------------------------------------------
# PreToolUse guard for the AUDIT harness. Registered in .claude/settings.json
# with matcher "Bash". Runs before every Bash command the session tries.
#   exit 2 -> DENY (holds even under --dangerously-skip-permissions)
#   exit 0 -> allow
#
# The audit INSPECTS; it must never FIX. So this guard's whole job is to keep
# the session from modifying application code or state:
#   (A) Block destructive / main-branch commands, always.
#   (B) Block any git COMMIT/ADD that touches anything OUTSIDE the allowed
#       audit paths (.claude/findings/**, .claude/AUDIT_LEDGER.md, _audit_*/).
#       => a findings/ledger commit is fine; a src/** commit is refused.
#   (C) Block any PUSH unless ALLOW_PUSH=1 (the runner sets it per checkpoint).
#   (D) Block obvious in-place edits to app code via shell (sed -i / tee / >>
#       redirection into src|supabase|config) — the model should be reading
#       these files, not rewriting them.
# Anything else (reading, grepping, npm run dev, curl, screenshots, tsx
# harnesses that WRITE only under _audit_*/) is allowed.
# ---------------------------------------------------------------------------
set -uo pipefail

INPUT="$(cat)"
if ! command -v jq >/dev/null 2>&1; then
  echo "AUDIT-GUARD: jq not installed; cannot parse tool input. Install jq and retry." >&2
  exit 2
fi
CMD="$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)"
if [ -z "$CMD" ]; then
  echo "AUDIT-GUARD: could not read command from tool input — denying to fail safe." >&2
  exit 2
fi

# (A) destructive / main-branch --------------------------------------------
DANGER='rm[[:space:]]+-rf|git[[:space:]]+push[[:space:]].*--force|git[[:space:]]+push[[:space:]]+.*\bmain\b|git[[:space:]]+checkout[[:space:]]+main|git[[:space:]]+reset[[:space:]]+--hard|git[[:space:]]+branch[[:space:]]+-D|DROP[[:space:]]+TABLE|TRUNCATE[[:space:]]'
if printf '%s' "$CMD" | grep -Eiq "$DANGER"; then
  echo "AUDIT-GUARD: blocked destructive/main-branch command: $CMD" >&2
  exit 2
fi

# (D) block in-place edits to protected trees via shell ---------------------
# Any mention of a protected path together with an in-place-edit mechanism.
# Split into two independent checks so flag spacing / path position can't dodge it:
#   1. an edit mechanism is present (sed -i, tee, > or >> redirection), AND
#   2. a protected path (src/, supabase/, or a root config) appears anywhere.
HAS_WRITE_MECH=false
printf '%s' "$CMD" | grep -Eq 'sed[[:space:]]+-i|(^|[[:space:]|])tee([[:space:]]|$)|>>?' && HAS_WRITE_MECH=true
HITS_PROTECTED=false
printf '%s' "$CMD" | grep -Eq '(\./)?(src|supabase)/|(\./)?(package\.json|tsconfig|next\.config|tailwind\.config|CLAUDE\.md|globals\.css)' && HITS_PROTECTED=true
if [ "$HAS_WRITE_MECH" = true ] && [ "$HITS_PROTECTED" = true ]; then
  echo "AUDIT-GUARD: blocked an in-place write into protected app code/config — the audit only reports." >&2
  echo "   command: $CMD" >&2
  exit 2
fi

# classify git ops ----------------------------------------------------------
IS_COMMIT=false; IS_ADD=false; IS_PUSH=false
printf '%s' "$CMD" | grep -Eq '\bgit[[:space:]]+commit\b' && IS_COMMIT=true
printf '%s' "$CMD" | grep -Eq '\bgit[[:space:]]+add\b'    && IS_ADD=true
printf '%s' "$CMD" | grep -Eq '\bgit[[:space:]]+push\b'   && IS_PUSH=true

# (C) push gate -------------------------------------------------------------
if [ "$IS_PUSH" = true ]; then
  [ "${ALLOW_PUSH:-0}" = "1" ] && exit 0
  echo "AUDIT-GUARD: push blocked (human reviews findings, then pushes)." >&2
  exit 2
fi

# (B) commit/add must only touch allowed audit paths ------------------------
# The audit may only write findings + ledger + throwaway harnesses. We judge this
# by what is ACTUALLY STAGED (git-tracked reality), never by parsing shell tokens
# out of the command string (which produced false positives on '&&', 'commit', etc).
#
# Rule: block a commit/add only when the STAGED set contains a path outside the
# allow-list. A `git add <path>` is allowed through here and re-checked at commit,
# because the guard also runs before the commit, and by then the path is staged.
is_allowed_path() {
  case "$1" in
    .claude/findings/*|./.claude/findings/*) return 0 ;;
    .claude/AUDIT_LEDGER.md|./.claude/AUDIT_LEDGER.md) return 0 ;;
    _audit_*|./_audit_*) return 0 ;;
    *) return 1 ;;
  esac
}

if [ "$IS_COMMIT" = true ] || [ "$IS_ADD" = true ]; then
  # For `git add <explicit paths>`, block immediately if any explicit path is
  # a protected tree (catches `git add src/...` before it's ever staged).
  if [ "$IS_ADD" = true ]; then
    # pull tokens after 'git add' that look like paths (contain a slash or a dot-dir)
    ADD_ARGS="$(printf '%s' "$CMD" | sed -E 's/.*git[[:space:]]+add[[:space:]]+//; s/[[:space:]]*&&.*$//; s/[[:space:]]*;.*$//')"
    for tok in $ADD_ARGS; do
      case "$tok" in
        -*) continue ;;                       # flags
        .|-A|--all) echo "AUDIT-GUARD: 'git add $tok' is too broad for an audit — add specific findings paths only." >&2; exit 2 ;;
      esac
      if printf '%s' "$tok" | grep -q '/'; then
        if ! is_allowed_path "$tok"; then
          echo "AUDIT-GUARD: 'git add $tok' targets a non-audit path — refused (audit reports, does not edit)." >&2
          exit 2
        fi
      fi
    done
  fi

  # For the commit itself, judge the actually-staged set.
  STAGED="$(git diff --cached --name-only 2>/dev/null || true)"
  BAD=""
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    if ! is_allowed_path "$f"; then BAD="$BAD$f
"; fi
  done <<< "$STAGED"
  if [ -n "$BAD" ]; then
    echo "AUDIT-GUARD: commit touches non-audit paths — refused. The audit reports, it does not edit:" >&2
    printf '%s' "$BAD" | sed 's/^/   /' >&2
    echo "   Allowed only: .claude/findings/**, .claude/AUDIT_LEDGER.md, _audit_*/**" >&2
    exit 2
  fi
fi

exit 0
