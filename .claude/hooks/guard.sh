#!/usr/bin/env bash
# .claude/hooks/guard.sh
# ---------------------------------------------------------------------------
# PreToolUse guard. Registered in .claude/settings.json with matcher "Bash",
# so it runs BEFORE every Bash command Claude Code tries to execute.
#
# It reads the tool call as JSON on stdin. Exit code meaning:
#   exit 2  -> DENY the command (this hold even under --dangerously-skip-permissions)
#   exit 0  -> allow
#
# What it guarantees (deterministically — not "the model promised to"):
#   (A) Never run an obviously destructive or main-branch command.
#   (B) Never PUSH unless the runner set ALLOW_PUSH=1 (non-HALT checkpoints only).
#   (C) Never COMMIT a schema migration (supabase/migrations/**) autonomously.
#   (D) Never COMMIT when tsc has a NEW type error (the one known pre-existing
#       broken file is ignored so the gate doesn't block every commit).
#
# Anything that is not a git commit / git push is allowed straight through.
# ---------------------------------------------------------------------------
set -uo pipefail

INPUT="$(cat)"

# --- read the actual command out of the tool-call JSON ---------------------
if ! command -v jq >/dev/null 2>&1; then
  echo "GUARD: jq is not installed; cannot parse tool input. Install jq, then retry." >&2
  exit 2   # fail loud + safe rather than silently allowing
fi

CMD="$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)"

if [ -z "$CMD" ]; then
  echo "GUARD: could not read a command from tool input — denying to fail safe." >&2
  echo "GUARD: (if this fires on a NON-git command, the stdin shape differs on your" >&2
  echo "GUARD:  Claude Code version; adjust the jq path in guard.sh.)" >&2
  exit 2
fi

# --- (A) destructive / main-branch denylist — always blocked ---------------
DANGER='rm[[:space:]]+-rf|git[[:space:]]+push[[:space:]].*--force|git[[:space:]]+push[[:space:]]+.*\bmain\b|git[[:space:]]+checkout[[:space:]]+main|git[[:space:]]+reset[[:space:]]+--hard|git[[:space:]]+branch[[:space:]]+-D|DROP[[:space:]]+TABLE|TRUNCATE[[:space:]]'
if printf '%s' "$CMD" | grep -Eiq "$DANGER"; then
  echo "GUARD: blocked destructive / main-branch command:" >&2
  echo "       $CMD" >&2
  exit 2
fi

# --- classify: only git commit / git push are gated ------------------------
IS_COMMIT=false; IS_PUSH=false
printf '%s' "$CMD" | grep -Eq '\bgit[[:space:]]+commit\b' && IS_COMMIT=true
printf '%s' "$CMD" | grep -Eq '\bgit[[:space:]]+push\b'   && IS_PUSH=true
if [ "$IS_COMMIT" = false ] && [ "$IS_PUSH" = false ]; then
  exit 0
fi

# --- (B) push gate ---------------------------------------------------------
if [ "$IS_PUSH" = true ]; then
  if [ "${ALLOW_PUSH:-0}" = "1" ]; then exit 0; fi
  echo "GUARD: push blocked at this checkpoint (HALT gate)." >&2
  echo "       Review locally; the runner pushes after you approve." >&2
  exit 2
fi

# --- (C) migration gate: never auto-commit a schema migration --------------
STAGED="$(git diff --cached --name-only 2>/dev/null || true)"
if printf '%s' "$STAGED" | grep -Eq '^supabase/migrations/'; then
  echo "GUARD: commit blocked — it stages a schema migration (supabase/migrations/**)." >&2
  echo "       Apply migrations by hand at a HALT gate, then let the build continue." >&2
  exit 2
fi

# --- (D) build gate: block commit on NEW tsc errors ------------------------
# Known pre-existing broken file (project debt, excluded from gates):
EXCLUDE='_cp_n6_verify/render_check.ts'
TSC_OUT="$(npx tsc --noEmit 2>&1 || true)"
NEW_ERRORS="$(printf '%s' "$TSC_OUT" | grep -E 'error TS' | grep -v "$EXCLUDE" || true)"
if [ -n "$NEW_ERRORS" ]; then
  echo "GUARD: commit blocked — new TypeScript errors introduced:" >&2
  printf '%s\n' "$NEW_ERRORS" | head -20 >&2
  exit 2
fi

# --- (D2) lint gate: eslint must be clean on files this commit touches -----
# Full-repo eslint is NOT clean today (153 pre-existing errors / 144 warnings
# in src/**, unrelated to any single fix pass). Scoping to staged files means
# new/edited code is held to the bar without blocking on legacy debt it
# didn't touch.
STAGED_LINT_FILES="$(git diff --cached --name-only --diff-filter=ACMR -- '*.ts' '*.tsx' '*.mts' 2>/dev/null || true)"
if [ -n "$STAGED_LINT_FILES" ]; then
  ESLINT_OUT="$(printf '%s\n' "$STAGED_LINT_FILES" | xargs npx eslint 2>&1)"
  if [ $? -ne 0 ]; then
    echo "GUARD: commit blocked — eslint errors in staged files:" >&2
    printf '%s\n' "$ESLINT_OUT" | head -40 >&2
    exit 2
  fi
fi

# --- (D3) build gate: production build must succeed ------------------------
BUILD_OUT="$(npm run build 2>&1 || true)"
if printf '%s' "$BUILD_OUT" | grep -q 'Failed to compile'; then
  echo "GUARD: commit blocked — production build failed:" >&2
  printf '%s\n' "$BUILD_OUT" | tail -40 >&2
  exit 2
fi

exit 0
