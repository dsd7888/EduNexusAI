#!/usr/bin/env bash
# run-audit.sh — student-facing feature audit runner
# -----------------------------------------------------------------------------
# One fresh `claude -p` process per feature (zero cross-feature context bloat).
# The audit INSPECTS and REPORTS; the audit-guard hook blocks any edit to app
# code, so a session physically cannot "fix while auditing".
#
# Prereq for real (non-speculative) findings: a working .env.local (Supabase +
# Gemini keys) and a seeded test student, so the session can actually exercise
# features. Without them, findings degrade to [STATIC] and the audit is weak.
#
# Usage:
#   ./run-audit.sh            # audit all features
#   ./run-audit.sh AU-QUIZ    # resume/run from a specific feature
#   ./run-audit.sh --one AU-CHAT   # audit EXACTLY one feature, then stop
# -----------------------------------------------------------------------------
set -uo pipefail

LOG_DIR=".claude/logs-audit"
mkdir -p "$LOG_DIR" ".claude/findings"

# id | human label
FEATURES=(
  "AU-CHAT|Student AI chat (+visualize/export/suggestions) — adversarial + the 2 UI bugs"
  "AU-NOTES|Notes v2 generation + web math/diagrams + PDF export"
  "AU-FLASH|Flashcards generation + dark-surface layering + reveal"
  "AU-QUIZ|Quiz/Assessment sessions, timer, mastery rules, NAT, export"
  "AU-PLACE-CORE|Placement spine + prep + practice (fill_code, Next-Move edges)"
  "AU-PLACE-TOOLS|Resume/JD/interview/skill-map/projects + resume PDF+DOCX + follow-up cap"
  "AU-EXPORTS|Cross-engine export pass: 5 math/render engines + PPT diagrams/SVG"
  "AU-SHELL|Dashboard/subjects/profile/history + global nav + auth edges + mobile"
)

ONE_MODE=false
if [ "${1:-}" = "--one" ]; then ONE_MODE=true; START_FROM="${2:-}"; else START_FROM="${1:-}"; fi

# ---- preflight --------------------------------------------------------------
command -v jq     >/dev/null || { echo "jq not installed (brew install jq / sudo apt-get install jq)."; exit 1; }
command -v claude >/dev/null || { echo "claude CLI not on PATH."; exit 1; }
[ -x ".claude/hooks/audit-guard.sh" ] || { echo "audit-guard hook missing/not executable: chmod +x .claude/hooks/audit-guard.sh"; exit 1; }
[ -f ".claude/settings.json" ] || { echo ".claude/settings.json missing."; exit 1; }
[ -f ".claude/AUDIT_SPEC.md" ] || { echo ".claude/AUDIT_SPEC.md missing."; exit 1; }

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
[ "$BRANCH" = "dev" ] || echo "WARNING: on '$BRANCH', not dev. Auditing whatever is checked out."
if [ ! -f ".env.local" ]; then
  echo "WARNING: no .env.local found — dynamic tests (real routes/AI/exports) will fail and"
  echo "         findings will be STATIC-only (weak). Strongly recommended to run with env present."
  read -r -p "ENTER to continue static-only, or Ctrl+C to stop and add .env.local: "
fi

echo "Audit runner ready."
[ -n "$START_FROM" ] && echo "Starting from: $START_FROM  (one-shot: $ONE_MODE)"

started=false
[ -z "$START_FROM" ] && started=true

for entry in "${FEATURES[@]}"; do
  IFS='|' read -r AU LABEL <<< "$entry"

  if [ "$started" = false ]; then
    if [ "$AU" = "$START_FROM" ]; then started=true; else echo "skip $AU"; continue; fi
  fi

  echo ""
  echo "=================================================="
  echo "$AU — $LABEL"
  echo "=================================================="

  # Findings + ledger are the ONLY writes allowed; push after human review.
  export ALLOW_PUSH=0

  PROMPT="You are running ONE feature audit. This is an INSPECTION — you find and report, you do
NOT fix. Editing application code is forbidden and the guard hook will block it.

Read .claude/AUDIT_LEDGER.md (prior cross-cutting findings), then .claude/AUDIT_SPEC.md in full
(§1 evidence bar, §2 how to exercise features, §3 universal checklist, §5 feature-specific cases,
§7 severity), then DESIGN.md and CLAUDE.md.

Audit ONLY: ${AU} — ${LABEL}.

Method (per AUDIT_SPEC):
- Exercise the feature for real. Use src/lib/testing/httpHarness.ts to hit routes as a real
  authenticated student; run npm run dev where full-server behavior is needed; generate real
  export artifacts and inspect their CONTENT (extract PDF text, count images, unzip DOCX/PPTX).
- Tag every finding [RUNTIME]/[EXPORT]/[UI]/[STATIC]. A report that is all [STATIC] is a failed
  audit unless the env genuinely prevented dynamic testing (say so explicitly).
- Run the FULL universal checklist §3 (happy path; adversarial: off-syllabus / vulgar / injection /
  integrity-abuse / safety; malformed+boundary; state+concurrency; authorization; errors+logs;
  cost/logging; UI/UX per DESIGN.md) PLUS the §5 feature-specific cases for ${AU}.
- For UI, produce desktop(~1280) + mobile(~390) screenshots, light and dark where supported.
- Respect the per-feature AI-call cap (§6); clean up any junk rows/artifacts you generate; note
  actual AI spend.

Output:
- Write findings to .claude/findings/${AU}.md (feature summary; checklist results; every finding as
  '[Sn] [TAG] — what, evidence/repro, file/route, recommendation'; screenshot+artifact paths; spend).
- Append the severity roll-up to .claude/AUDIT_LEDGER.md.
- Commit ONLY those two files (the guard blocks anything else). Do NOT push.
End with a 3-bullet summary: S1 count, S2 count, single most important finding."

  JSON="$LOG_DIR/${AU}.json"; LOG="$LOG_DIR/${AU}.log"
  echo "Running $AU … (quiet until it finishes; adversarial + export tests take time)"
  claude -p "$PROMPT" --dangerously-skip-permissions --output-format json > "$JSON"
  RC=$?

  if [ -s "$JSON" ]; then
    jq -r '.result // "(no result field)"' "$JSON" 2>/dev/null | tee "$LOG"
    echo "cost (client estimate): \$$(jq -r '.total_cost_usd // "?"' "$JSON" 2>/dev/null)"
  else
    echo "WARNING: no JSON output for $AU."
  fi

  if [ "$RC" -ne 0 ]; then
    echo "FAILED: $AU exited $RC. Resume with:  ./run-audit.sh $AU"
    exit "$RC"
  fi

  if [ -f ".claude/findings/${AU}.md" ]; then
    echo "findings written: .claude/findings/${AU}.md"
  else
    echo "WARNING: no findings file produced for $AU — inspect $LOG before trusting this run."
  fi

  # A short human beat between features: glance at findings, decide to continue.
  echo ""
  echo "---- $AU audited. Review .claude/findings/${AU}.md when ready. ----"
  if [ "$ONE_MODE" = true ]; then echo "One-shot mode: stopping."; break; fi
  read -r -p "ENTER for next feature, or Ctrl+C to stop and review: "
done

echo ""
echo "Audit run done. Master punch-list: .claude/AUDIT_LEDGER.md"
echo "Findings are committed locally, NOT pushed. Review, then push the findings/ledger yourself."
