#!/usr/bin/env bash
# run-spec.sh — hardened checkpoint runner for .claude/SPEC.md
# -----------------------------------------------------------------------------
# Each checkpoint runs as a FRESH `claude -p` process => zero accumulated context
# from earlier checkpoints (this is the token/quality win).
# The PreToolUse guard hook (.claude/hooks/guard.sh) enforces the hard gates so
# a wrong "done" cannot commit broken code, a migration, or push on a HALT gate.
#
# Usage:
#   ./run-spec.sh              # run all checkpoints from the start
#   ./run-spec.sh CP-C1        # RESUME: skip everything before CP-C1
# -----------------------------------------------------------------------------
set -uo pipefail

LOG_DIR=".claude/logs"
mkdir -p "$LOG_DIR"

# id | human label | HALT? (yes/no)   -- order matches SPEC §12
CHECKPOINTS=(
  "CP-A1|nextMove.ts pure function + unit tests|no"
  "CP-A2|Rebuild landing page UI (spine)|yes"
  "CP-B1|Searchable/collapsible topic browser (long-scroll fix)|no"
  "CP-C1|Expand fill_code coverage + practiceRecs.ts|yes"
  "CP-D1|JD-targeted rewrite + interviewer-lens pass|no"
  "CP-E1|archetypes.ts + computeSkillGap + skill-map UI|no"
  "CP-F1|Interview bank + mock flow + per-session AI cap|yes"
  "CP-G1|Cohort analytics readiness-lift view|yes"
)

START_FROM="${1:-}"

# ---- preflight --------------------------------------------------------------
command -v jq     >/dev/null || { echo "jq not installed. Install it (brew install jq / sudo apt-get install jq) and retry."; exit 1; }
command -v claude >/dev/null || { echo "claude CLI not found on PATH."; exit 1; }
[ -x ".claude/hooks/guard.sh" ] || { echo "guard hook missing/not executable. Run: chmod +x .claude/hooks/guard.sh"; exit 1; }
[ -f ".claude/settings.json" ]  || { echo ".claude/settings.json missing (registers the hook)."; exit 1; }
[ -f ".claude/SPEC.md" ]        || { echo ".claude/SPEC.md missing."; exit 1; }

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
[ "$BRANCH" = "dev" ] || { echo "Not on dev (on '$BRANCH'). Run: git checkout dev"; exit 1; }
[ -z "$(git status --porcelain)" ] || { echo "Working tree not clean. Commit or stash first."; exit 1; }

echo "Runner ready — branch dev, tree clean, guard hook present."
[ -n "$START_FROM" ] && echo "Resuming from: $START_FROM"

started=false
[ -z "$START_FROM" ] && started=true

for entry in "${CHECKPOINTS[@]}"; do
  IFS='|' read -r CP LABEL HALT <<< "$entry"

  if [ "$started" = false ]; then
    if [ "$CP" = "$START_FROM" ]; then started=true; else
      echo "skip $CP"; continue
    fi
  fi

  echo ""
  echo "=================================================="
  echo "$CP — $LABEL   (HALT: $HALT)"
  echo "=================================================="

  HEAD_BEFORE="$(git rev-parse HEAD)"

  if [ "$HALT" = "yes" ]; then
    export ALLOW_PUSH=0
    PUSH_INSTR="Commit locally with a clear message. DO NOT push — a human reviews and pushes."
  else
    export ALLOW_PUSH=1
    PUSH_INSTR="Commit with a clear message, then push to origin/dev."
  fi

  PROMPT="You are executing ONE checkpoint of a multi-step build.
Read .claude/PROGRESS.md first, then .claude/SPEC.md in full (especially §0 Standing Engineering Rules), then CLAUDE.md.
Execute ONLY the work for checkpoint ${CP}: ${LABEL}. Do not start any other checkpoint.

Constraints:
- Verify actual repo state with git/grep before editing; trust code, not descriptions.
- Every new AI call goes through routeAI with responseSchema, repairGeminiJsonEscapes, and explicit thinkingConfig. No new npm dependencies.
- If this checkpoint needs a schema migration: create the migration file, then STOP and append a note to .claude/PROGRESS.md that a migration awaits manual application. Do not loop trying to commit it (the commit hook will refuse it by design).
- For any UI change, produce screenshots (desktop ~1280px and mobile ~390px; light and dark where the surface supports dark) and a short DESIGN.md conformance note per SPEC §0.
- ${PUSH_INSTR}
- Report unhappy-path verification, not just happy path.
- FINAL action: append a dated entry to .claude/PROGRESS.md (checkpoint id, commit SHA, what you verified incl. unhappy paths, screenshots, migration status, and what the next checkpoint must know).
End with a 3-bullet summary including the commit SHA."

  JSON="$LOG_DIR/${CP}.json"
  LOG="$LOG_DIR/${CP}.log"

  echo "Running $CP … (quiet until it finishes; can take several minutes)"
  claude -p "$PROMPT" --dangerously-skip-permissions --output-format json > "$JSON"
  RC=$?

  if [ -s "$JSON" ]; then
    jq -r '.result // "(no result field in output)"' "$JSON" 2>/dev/null | tee "$LOG"
    COST="$(jq -r '.total_cost_usd // "?"' "$JSON" 2>/dev/null)"
    echo "cost (client estimate): \$$COST"
  else
    echo "WARNING: no JSON output captured for $CP."
  fi

  if [ "$RC" -ne 0 ]; then
    echo "FAILED: $CP exited $RC. Fix the cause, then resume with:  ./run-spec.sh $CP"
    exit "$RC"
  fi

  HEAD_AFTER="$(git rev-parse HEAD)"
  if [ "$HEAD_BEFORE" = "$HEAD_AFTER" ]; then
    echo "NOTE: no new commit landed for $CP."
    echo "      Either it stopped on purpose (e.g. migration pending) or under-delivered."
    echo "      Inspect $LOG and .claude/PROGRESS.md before continuing."
    read -r -p "ENTER to continue anyway, or Ctrl+C to stop and investigate: "
  else
    echo "committed: $HEAD_AFTER"
    git --no-pager show --stat "$HEAD_AFTER" | head -30
  fi

  if [ "$HALT" = "yes" ] && [ "$HEAD_BEFORE" != "$HEAD_AFTER" ]; then
    echo ""
    echo "HALT GATE — $CP  (this checkpoint is committed locally but NOT pushed)"
    echo "  Review:  git show $HEAD_AFTER   and the screenshots this checkpoint produced."
    read -r -p "ENTER to push $CP to dev and continue, or Ctrl+C to stop: "
    git push origin dev && echo "pushed $CP to dev."
  fi
done

echo ""
echo "Run complete. Full ledger: .claude/PROGRESS.md"