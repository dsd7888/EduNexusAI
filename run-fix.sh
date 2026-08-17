#!/usr/bin/env bash
# run-fix.sh — hardened checkpoint runner for .claude/FIX_SPEC.md
# -----------------------------------------------------------------------------
# Sibling to run-spec.sh, NOT a modification of it. Same shape: each checkpoint
# runs as a FRESH `claude -p` process (zero accumulated context from earlier
# checkpoints). The PreToolUse guard hook (.claude/hooks/guard.sh) enforces the
# hard gates so a wrong "done" cannot commit broken code, a migration, or push
# on a HALT gate.
#
# Differences from run-spec.sh:
#   - Checkpoint list is CP-01..CP-38, transcribed from FIX_SPEC.md.
#   - Supports --one <CP-id> (matches run-audit.sh's flag): run exactly one
#     checkpoint, then stop.
#   - Consults .claude/FIX_LEDGER.md before each checkpoint: skips a "done"
#     row, refuses (does not silently skip) a "blocked" row.
#   - Updates FIX_LEDGER.md's row for the checkpoint (status/SHA/date) itself,
#     right after that checkpoint's claude -p process exits — does not rely on
#     the spawned session to self-report this.
#
# Usage:
#   ./run-fix.sh                  # run all checkpoints from the start
#   ./run-fix.sh CP-12            # RESUME: skip everything before CP-12
#   ./run-fix.sh --one CP-12      # run EXACTLY CP-12, then stop
#   ./run-fix.sh --yes            # skip the ENTER-to-continue prompt between checkpoints
#   ./run-fix.sh --allow-push     # let non-HALT checkpoints push after commit (see below)
#
# After EVERY checkpoint (not just HALT ones), the runner prints a short summary
# (status, SHA if committed) and waits for ENTER before starting the next one,
# unless --yes is passed. --yes may be combined with --one or a resume CP-id.
#
# PUSH POLICY (default: nothing auto-pushes, ever):
#   Every checkpoint — HALT or not — commits locally and stops there by default.
#   The PreToolUse guard hook physically denies `git push` unless the runner
#   exported ALLOW_PUSH=1 for that checkpoint's claude -p process, so this is
#   enforced, not just requested in the prompt. Mirrors run-audit.sh's own
#   convention: commit locally, report the SHA, human reviews and pushes.
#   --allow-push is an explicit, run-scoped opt-in: pass it and non-HALT
#   checkpoints push automatically after commit, same as pre-this-change
#   behavior. It is NEVER the default and is NOT a per-checkpoint property —
#   a human must pass it for that specific invocation. HALT checkpoints are
#   unaffected either way: they always commit-and-stop, then separately ask
#   ENTER-to-push regardless of --allow-push (unchanged mechanism).
# -----------------------------------------------------------------------------
set -uo pipefail

LOG_DIR=".claude/logs-fix"
LEDGER=".claude/FIX_LEDGER.md"
mkdir -p "$LOG_DIR"

# id | human label | HALT? (yes/no)   -- order + HALT flags match FIX_SPEC.md
CHECKPOINTS=(
  "CP-01|profiles.role privilege escalation (RLS WITH CHECK / trigger)|yes"
  "CP-02|Atomic checkRateLimit (fixes chat/research/hint/quiz/examSim/notes_view/notes_export)|no"
  "CP-03|Notes concurrent-generation race + raw error leak|no"
  "CP-04|Assessment /submit: timer enforcement + atomic completion|no"
  "CP-05|Placement prep/submit mastery: atomic upsert|no"
  "CP-06|interview/mock/follow-up atomic cap|no"
  "CP-07|Placement AI routes: add rate limiting (depends on CP-02)|no"
  "CP-08|Placement client-trusted grading (prep/submit, prep/generate, practice/submit)|yes"
  "CP-09|Missing distress/safety clause (tutor + interview prompts)|no"
  "CP-10|Assessment engine: subject-scope check|no"
  "CP-11|Notes v2 cold-start generation path|no"
  "CP-12|Quiz export + dashboard dead-table cleanup|no"
  "CP-13|Delete legacy placement test/practice subsystem|no"
  "CP-14|Dashboard placement-readiness widget|no"
  "CP-15|Resume autosave: upsert + validation (+ CP-35 array caps)|no"
  "CP-16|PPT SVG fallback + Notes PDF Unicode deletion|no"
  "CP-17|true_false renders zero answer controls|no"
  "CP-18|Chat composer height gap|no"
  "CP-19|Desktop sidebar collapse (student shell)|no"
  "CP-20|Touch-target floor (shared component)|no"
  "CP-21|Resume PDF/DOCX export null-guard|no"
  "CP-22|setup_complete without CGPA|no"
  "CP-23|Empty Next-Move queue for a ready student|no"
  "CP-24|SQL-injection-shaped input -> raw HTML in logs|no"
  "CP-25|Notes PDF worked-example markdown tables|no"
  "CP-26|Q Paper PDF page-break orphaning|no"
  "CP-27|DESIGN.md tokens for shell chrome|no"
  "CP-28|Chat PDF markdown tables garbled|no"
  "CP-29|Dark mode unreachable app-wide|no"
  "CP-30|No chat double-submit guard|no"
  "CP-31|Generic PDF branding (Tailwind-blue/Helvetica)|no"
  "CP-32|Formula symbol field holds full phrases|no"
  "CP-33|fill_code+MCQ not interleaved|no"
  "CP-34|Stage strip has no scroll affordance|no"
  "CP-35|Resume unbounded array sizes (bundle into CP-15)|no"
  "CP-36|Duplicate ResumeProject/etc. type declarations|no"
  "CP-37|No prefers-reduced-motion handling|no"
  "CP-38|Design migration: Resume/JD/Interview-bank/Projects pages|no"
)

# ---- arg parsing --------------------------------------------------------------
ONE_MODE=false
YES_MODE=false
ALLOW_PUSH_FLAG=false
POSITIONAL=()
for arg in "$@"; do
  case "$arg" in
    --one) ONE_MODE=true ;;
    --yes) YES_MODE=true ;;
    --allow-push) ALLOW_PUSH_FLAG=true ;;
    *) POSITIONAL+=("$arg") ;;
  esac
done
START_FROM="${POSITIONAL[0]:-}"
if [ "$ONE_MODE" = true ] && [ -z "$START_FROM" ]; then
  echo "--one requires a CP-id, e.g. ./run-fix.sh --one CP-12"; exit 1
fi
if [ "$ALLOW_PUSH_FLAG" = true ]; then
  echo "NOTE: --allow-push is set — non-HALT checkpoints will push to origin/dev after commit."
else
  echo "Push policy: no auto-push (default). Every checkpoint commits locally and stops; push yourself when ready. Pass --allow-push to change this for this run."
fi

# ---- preflight --------------------------------------------------------------
command -v jq     >/dev/null || { echo "jq not installed. Install it (brew install jq / sudo apt-get install jq) and retry."; exit 1; }
command -v claude >/dev/null || { echo "claude CLI not found on PATH."; exit 1; }
[ -x ".claude/hooks/guard.sh" ] || { echo "guard hook missing/not executable. Run: chmod +x .claude/hooks/guard.sh"; exit 1; }
[ -f ".claude/settings.json" ]  || { echo ".claude/settings.json missing (registers the hook)."; exit 1; }
[ -f ".claude/FIX_SPEC.md" ]    || { echo ".claude/FIX_SPEC.md missing."; exit 1; }
[ -f "$LEDGER" ]                || { echo "$LEDGER missing."; exit 1; }

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
[ "$BRANCH" = "dev" ] || { echo "Not on dev (on '$BRANCH'). Run: git checkout dev"; exit 1; }
[ -z "$(git status --porcelain)" ] || { echo "Working tree not clean. Commit or stash first."; exit 1; }

echo "Fix runner ready — branch dev, tree clean, guard hook present."
[ -n "$START_FROM" ] && echo "Starting from: $START_FROM  (one-shot: $ONE_MODE)"

# ---- ledger helpers -----------------------------------------------------------
# Row shape: | CP-id | status | commit SHA | date | note |
ledger_status() {
  local cp="$1"
  awk -F'|' -v cp="$cp" '
    { gsub(/^[ \t]+|[ \t]+$/, "", $2) }
    $2 == cp { gsub(/^[ \t]+|[ \t]+$/, "", $3); print $3; found=1; exit }
    END { if (!found) print "" }
  ' "$LEDGER"
}

# Replace the row for $1 with status=$2, sha=$3, date=$4, note=$5 (note optional -> keep existing if blank)
ledger_update() {
  local cp="$1" status="$2" sha="$3" date="$4" note="${5:-}"
  local tmp
  tmp="$(mktemp)"
  awk -F'|' -v cp="$cp" -v status="$status" -v sha="$sha" -v d="$date" -v note="$note" '
    BEGIN { OFS = "|" }
    {
      line = $0
      col2 = $2; gsub(/^[ \t]+|[ \t]+$/, "", col2)
      if (col2 == cp) {
        existing_note = $6
        gsub(/^[ \t]+|[ \t]+$/, "", existing_note)
        use_note = (note == "") ? existing_note : note
        printf "| %s | %s | %s | %s | %s |\n", cp, status, sha, d, use_note
      } else {
        print line
      }
    }
  ' "$LEDGER" > "$tmp" && mv "$tmp" "$LEDGER"
}

# Commits any pending FIX_LEDGER.md/PROGRESS.md edit from ledger_update() itself.
# Without this, the runner's own post-checkpoint ledger correction (it runs
# after the checkpoint's own commit, so it can't be folded into it) is left
# uncommitted — which then trips the clean-tree gate on the *next* invocation.
commit_ledger() {
  local cp="$1" note="$2"
  git add "$LEDGER" .claude/PROGRESS.md 2>/dev/null
  if ! git diff --cached --quiet -- "$LEDGER" .claude/PROGRESS.md 2>/dev/null; then
    git commit -q -m "$cp: $note" -- "$LEDGER" .claude/PROGRESS.md
  fi
}

started=false
[ -z "$START_FROM" ] && started=true

for entry in "${CHECKPOINTS[@]}"; do
  IFS='|' read -r CP LABEL HALT <<< "$entry"

  if [ "$started" = false ]; then
    if [ "$CP" = "$START_FROM" ]; then started=true; else
      echo "skip $CP"; continue
    fi
  fi

  STATUS="$(ledger_status "$CP")"

  if [ "$STATUS" = "done" ]; then
    echo "skip $CP — already done per $LEDGER"
    [ "$ONE_MODE" = true ] && { echo "One-shot mode requested a done checkpoint; nothing to run."; exit 0; }
    continue
  fi

  if [ "$STATUS" = "blocked" ]; then
    echo ""
    echo "REFUSING to run $CP — status is 'blocked' in $LEDGER."
    echo "Blocked means a human product decision is needed first (see the note column)."
    echo "This is not a skip: fix cannot silently proceed past a blocked checkpoint."
    exit 1
  fi

  echo ""
  echo "=================================================="
  echo "$CP — $LABEL   (HALT: $HALT)"
  echo "=================================================="

  ledger_update "$CP" "in-progress" "" "$(date +%Y-%m-%d)"

  HEAD_BEFORE="$(git rev-parse HEAD)"

  if [ "$HALT" = "yes" ]; then
    export ALLOW_PUSH=0
    PUSH_INSTR="Commit locally with a clear message. DO NOT push — a human reviews and pushes."
  elif [ "$ALLOW_PUSH_FLAG" = true ]; then
    export ALLOW_PUSH=1
    PUSH_INSTR="Commit with a clear message, then push to origin/dev."
  else
    export ALLOW_PUSH=0
    PUSH_INSTR="Commit locally with a clear message. DO NOT push — this run has no auto-push (default); a human reviews and pushes when ready. (Re-run with --allow-push to change this.)"
  fi

  PROMPT="You are executing ONE checkpoint of the fix pass. Read CLAUDE_CONTEXT.md first,
then .claude/FIX_SPEC.md in full (find checkpoint ${CP}'s entry for the finding, files,
fix, and verify steps — use its copy-paste prompt if FIX_SPEC.md gives one), then CLAUDE.md.
Execute ONLY the work for checkpoint ${CP}: ${LABEL}. Do not start any other checkpoint.

Constraints:
- Verify actual repo state with git/grep before editing; trust code, not descriptions.
- Every new AI call goes through routeAI with responseSchema, repairGeminiJsonEscapes, and explicit thinkingConfig. No new npm dependencies without a note asking for approval.
- If this checkpoint needs a schema migration: create the migration file, then STOP. Append a note to .claude/PROGRESS.md that a migration awaits manual application. Do not loop trying to commit it (the commit hook will refuse it by design).
- If this checkpoint is HALT-gated (${CP}): show the diff/SQL and STOP for explicit approval before applying, per FIX_SPEC.md's HALT instructions for this checkpoint.
- ${PUSH_INSTR}
- Report unhappy-path verification (interrupted flow, concurrent action), not just happy path, per FIX_SPEC.md's verify steps for ${CP}.
- FINAL action: append a dated entry to .claude/PROGRESS.md (checkpoint id, commit SHA, what you verified incl. unhappy paths, migration status, and what the next checkpoint must know).
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

  TODAY="$(date +%Y-%m-%d)"

  if [ "$RC" -ne 0 ]; then
    echo "FAILED: $CP exited $RC. Fix the cause, then resume with:  ./run-fix.sh $CP"
    ledger_update "$CP" "pending" "" "$TODAY" "runner exited $RC — see $LOG"
    commit_ledger "$CP" "runner exited $RC, record failure in ledger"
    exit "$RC"
  fi

  HEAD_AFTER="$(git rev-parse HEAD)"
  RESULT_SHA="(none)"
  if [ "$HEAD_BEFORE" = "$HEAD_AFTER" ]; then
    echo "NOTE: no new commit landed for $CP."
    echo "      Either it stopped on purpose (e.g. migration pending, HALT awaiting approval) or under-delivered."
    echo "      Inspect $LOG and .claude/PROGRESS.md before continuing."
    ledger_update "$CP" "pending" "" "$TODAY" "no commit landed — see $LOG and PROGRESS.md"
    commit_ledger "$CP" "no commit landed, record status in ledger"
    RESULT_STATUS="pending"
    if [ "$YES_MODE" = false ]; then
      read -r -p "ENTER to continue anyway, or Ctrl+C to stop and investigate: "
    fi
  else
    echo "committed: $HEAD_AFTER"
    git --no-pager show --stat "$HEAD_AFTER" | head -30
    RESULT_SHA="$HEAD_AFTER"
    if [ "$HALT" = "yes" ]; then
      ledger_update "$CP" "halted-review" "$HEAD_AFTER" "$TODAY"
      commit_ledger "$CP" "record halted-review status + SHA in ledger"
      RESULT_STATUS="halted-review"
    else
      ledger_update "$CP" "done" "$HEAD_AFTER" "$TODAY"
      commit_ledger "$CP" "record done status + SHA in ledger"
      RESULT_STATUS="done"
    fi
  fi

  if [ "$HALT" = "yes" ] && [ "$HEAD_BEFORE" != "$HEAD_AFTER" ]; then
    echo ""
    echo "HALT GATE — $CP  (this checkpoint is committed locally but NOT pushed)"
    echo "  Review:  git show $HEAD_AFTER   and .claude/PROGRESS.md's entry for this checkpoint."
    if [ "$YES_MODE" = false ]; then
      read -r -p "ENTER to push $CP to dev and continue, or Ctrl+C to stop: "
      git push origin dev && { echo "pushed $CP to dev."; ledger_update "$CP" "done" "$HEAD_AFTER" "$(date +%Y-%m-%d)"; commit_ledger "$CP" "record pushed/done status in ledger"; RESULT_STATUS="done"; }
    else
      echo "  --yes run: leaving this HALT gate for manual review — not pushing unattended. Status stays 'halted-review'."
    fi
  fi

  PUSH_NOTE="not pushed — commit is local only"
  if [ "$RESULT_SHA" != "(none)" ]; then
    if git branch -r --contains "$RESULT_SHA" 2>/dev/null | grep -q 'origin/dev'; then
      PUSH_NOTE="pushed to origin/dev"
    fi
  fi
  echo ""
  echo "---- $CP finished: status=$RESULT_STATUS sha=$RESULT_SHA ($PUSH_NOTE) ----"

  if [ "$ONE_MODE" = true ]; then
    echo "One-shot mode: stopping after $CP."
    break
  fi

  if [ "$YES_MODE" = false ]; then
    read -r -p "ENTER to continue to the next checkpoint, or Ctrl+C to stop: "
  fi
done

echo ""
echo "Run complete. Full ledger: $LEDGER   Per-checkpoint detail: .claude/PROGRESS.md"
if [ "$ALLOW_PUSH_FLAG" = false ]; then
  echo "Non-HALT checkpoints were committed locally, NOT pushed (default). Review, then push yourself."
fi
