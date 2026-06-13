#!/usr/bin/env bash
# verify-cherry-picks.sh
#
# Verifies commits marked "needs-review" or "cherry-pick" in docs/reconciliation-table.md
# by cherry-picking each into a temporary worktree and running lint, typecheck, and build.
#
# Commits that pass verification are marked "verified".
# Commits that fail are aborted and marked "discard" with the failure reason.
#
# Usage: bash scripts/verify-cherry-picks.sh
#
# IMPORTANT: This script never uses `git add .`

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RECONCILIATION_TABLE="$REPO_ROOT/docs/reconciliation-table.md"
CLEAN_BASE_COMMIT="2406307"
WORKTREE_DIR="/tmp/verify-cherry-picks-$$"
WORKTREE_BRANCH="verify-cherry-picks-temp-$$"
LOG_FILE="/tmp/verify-cherry-picks-$$.log"

# ─── Cleanup on any exit ─────────────────────────────────────────────────────
cleanup() {
  echo ""
  echo "=== Cleaning up ==="
  # Remove the worktree if it exists
  if [ -d "$WORKTREE_DIR" ]; then
    cd "$REPO_ROOT"
    git worktree remove --force "$WORKTREE_DIR" 2>/dev/null || true
  fi
  # Delete the temporary branch
  git branch -D "$WORKTREE_BRANCH" 2>/dev/null || true
  # Remove the log file
  rm -f "$LOG_FILE"
  echo "Cleanup complete."
}
trap cleanup EXIT INT TERM

# ─── Validate prerequisites ──────────────────────────────────────────────────
if [ ! -f "$RECONCILIATION_TABLE" ]; then
  echo "ERROR: Reconciliation table not found at $RECONCILIATION_TABLE"
  echo "Run scripts/reconcile-branch.sh first."
  exit 1
fi

# Ensure we have the base commit
if ! git cat-file -t "$CLEAN_BASE_COMMIT" >/dev/null 2>&1; then
  echo "ERROR: Base commit $CLEAN_BASE_COMMIT not found. Ensure origin/main is fetched."
  exit 1
fi

# ─── Extract commits to verify ───────────────────────────────────────────────
# Parse Part 1 of the reconciliation table for commits with verdict "needs-review" or "cherry-pick"
# Table format: | Hash | Summary | Files Changed | Verdict |
echo "=== Extracting commits to verify from reconciliation table ==="

declare -a COMMITS_TO_VERIFY=()
declare -a COMMIT_SUMMARIES=()

while IFS= read -r line; do
  # Skip header rows, separator rows, and empty lines
  if [[ "$line" =~ ^\|[[:space:]]*Hash ]] || [[ "$line" =~ ^\|[-]+\| ]] || [[ -z "$line" ]]; then
    continue
  fi

  # Extract fields from table row: | hash | summary | files | verdict |
  hash=$(echo "$line" | awk -F'|' '{print $2}' | xargs)
  summary=$(echo "$line" | awk -F'|' '{print $3}' | xargs)
  verdict=$(echo "$line" | awk -F'|' '{print $5}' | xargs)

  # Only process "needs-review" or "cherry-pick" verdicts
  if [[ "$verdict" == "needs-review" ]] || [[ "$verdict" == "cherry-pick" ]]; then
    COMMITS_TO_VERIFY+=("$hash")
    COMMIT_SUMMARIES+=("$summary")
  fi
done < <(sed -n '/^| Hash /,/^$/p' "$RECONCILIATION_TABLE" | grep '^\|')

TOTAL=${#COMMITS_TO_VERIFY[@]}
if [ "$TOTAL" -eq 0 ]; then
  echo "No commits marked 'needs-review' or 'cherry-pick' found in the table."
  echo "Nothing to verify."
  exit 0
fi

echo "Found $TOTAL commit(s) to verify."
echo ""

# ─── Create temporary worktree ───────────────────────────────────────────────
echo "=== Creating temporary worktree at $WORKTREE_DIR ==="
git worktree add "$WORKTREE_DIR" -b "$WORKTREE_BRANCH" "$CLEAN_BASE_COMMIT"
echo "Worktree created from commit $CLEAN_BASE_COMMIT"
echo ""

# ─── Install dependencies in worktree ────────────────────────────────────────
echo "=== Installing dependencies in worktree ==="
cd "$WORKTREE_DIR"
npm ci --prefer-offline 2>&1 | tail -5
echo "Dependencies installed."
echo ""

# ─── Verify each commit ──────────────────────────────────────────────────────
declare -a VERIFIED_HASHES=()
declare -a DISCARDED_HASHES=()
declare -a DISCARD_REASONS=()

for i in "${!COMMITS_TO_VERIFY[@]}"; do
  hash="${COMMITS_TO_VERIFY[$i]}"
  summary="${COMMIT_SUMMARIES[$i]}"
  idx=$((i + 1))

  echo "─────────────────────────────────────────────────────────────────"
  echo "[$idx/$TOTAL] Verifying: $hash — $summary"
  echo "─────────────────────────────────────────────────────────────────"

  cd "$WORKTREE_DIR"

  # Attempt cherry-pick
  if ! git cherry-pick "$hash" 2>"$LOG_FILE"; then
    reason="cherry-pick failed (merge conflict)"
    if [ -f "$LOG_FILE" ]; then
      reason="$reason: $(head -3 "$LOG_FILE" | tr '\n' ' ')"
    fi
    echo "  ✗ Cherry-pick failed. Aborting."
    git cherry-pick --abort 2>/dev/null || true
    DISCARDED_HASHES+=("$hash")
    DISCARD_REASONS+=("$reason")
    echo ""
    continue
  fi

  # Run verification: lint
  echo "  Running: npm run lint"
  if ! npm run lint >"$LOG_FILE" 2>&1; then
    reason="lint failed: $(tail -5 "$LOG_FILE" | tr '\n' ' ')"
    echo "  ✗ Lint failed. Reverting cherry-pick."
    git reset --hard HEAD~1
    DISCARDED_HASHES+=("$hash")
    DISCARD_REASONS+=("$reason")
    echo ""
    continue
  fi

  # Run verification: typecheck
  echo "  Running: npx tsc --noEmit"
  if ! npx tsc --noEmit >"$LOG_FILE" 2>&1; then
    reason="typecheck failed: $(tail -5 "$LOG_FILE" | tr '\n' ' ')"
    echo "  ✗ Typecheck failed. Reverting cherry-pick."
    git reset --hard HEAD~1
    DISCARDED_HASHES+=("$hash")
    DISCARD_REASONS+=("$reason")
    echo ""
    continue
  fi

  # Run verification: build
  echo "  Running: npm run build"
  if ! npm run build >"$LOG_FILE" 2>&1; then
    reason="build failed: $(tail -5 "$LOG_FILE" | tr '\n' ' ')"
    echo "  ✗ Build failed. Reverting cherry-pick."
    git reset --hard HEAD~1
    DISCARDED_HASHES+=("$hash")
    DISCARD_REASONS+=("$reason")
    echo ""
    continue
  fi

  # All checks passed
  echo "  ✓ All checks passed — verified."
  VERIFIED_HASHES+=("$hash")
  echo ""
done

# ─── Update reconciliation table with verdicts ───────────────────────────────
echo "=== Updating reconciliation table with verdicts ==="
cd "$REPO_ROOT"

# Update verified commits
for hash in "${VERIFIED_HASHES[@]}"; do
  # Escape hash for sed (short hashes are safe but be cautious)
  sed -i.bak "s/| ${hash} |\\(.*\\)| needs-review |/| ${hash} |\\1| verified |/" "$RECONCILIATION_TABLE"
  sed -i.bak "s/| ${hash} |\\(.*\\)| cherry-pick |/| ${hash} |\\1| verified |/" "$RECONCILIATION_TABLE"
done

# Update discarded commits with reasons
for i in "${!DISCARDED_HASHES[@]}"; do
  hash="${DISCARDED_HASHES[$i]}"
  # Truncate reason to fit in table cell (max 80 chars)
  reason="${DISCARD_REASONS[$i]:0:80}"
  # Escape special characters for sed
  reason_escaped=$(printf '%s\n' "$reason" | sed 's/[&/\]/\\&/g' | tr -d '\n')
  sed -i.bak "s/| ${hash} |\\(.*\\)| needs-review |/| ${hash} |\\1| discard: ${reason_escaped} |/" "$RECONCILIATION_TABLE"
  sed -i.bak "s/| ${hash} |\\(.*\\)| cherry-pick |/| ${hash} |\\1| discard: ${reason_escaped} |/" "$RECONCILIATION_TABLE"
done

# Remove sed backup files
rm -f "${RECONCILIATION_TABLE}.bak"

# ─── Print summary ───────────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════════════════════"
echo "  VERIFICATION SUMMARY"
echo "═══════════════════════════════════════════════════════════════════"
echo ""
echo "  Total commits tested:  $TOTAL"
echo "  Verified (passed):     ${#VERIFIED_HASHES[@]}"
echo "  Discarded (failed):    ${#DISCARDED_HASHES[@]}"
echo ""

if [ ${#VERIFIED_HASHES[@]} -gt 0 ]; then
  echo "  ✓ Verified commits:"
  for hash in "${VERIFIED_HASHES[@]}"; do
    echo "    - $hash"
  done
  echo ""
fi

if [ ${#DISCARDED_HASHES[@]} -gt 0 ]; then
  echo "  ✗ Discarded commits:"
  for i in "${!DISCARDED_HASHES[@]}"; do
    echo "    - ${DISCARDED_HASHES[$i]}: ${DISCARD_REASONS[$i]:0:60}"
  done
  echo ""
fi

echo "  Reconciliation table updated: $RECONCILIATION_TABLE"
echo "═══════════════════════════════════════════════════════════════════"
