#!/usr/bin/env bash
set -euo pipefail

# Reconciliation script: compares the dirty branch against origin/main
# and produces a markdown table of:
#   1. All commits unique to the dirty branch
#   2. All file-level differences (including uncommitted changes in the dirty tree)
#
# Usage: ./scripts/reconcile-branch.sh
# Output: docs/reconciliation-table.md
#
# IMPORTANT: This script never uses `git add .`

DIRTY_BRANCH="codex/release-hardening-ocr-2026-06-08"
CLEAN_BASE="origin/main"
OUTPUT_FILE="docs/reconciliation-table.md"

# Ensure we're at repo root
if [ ! -d ".git" ]; then
  echo "Error: must be run from repository root"
  exit 1
fi

# Ensure docs directory exists
mkdir -p docs

# Fetch latest refs (non-destructive)
echo "Fetching latest refs..."
git fetch origin --quiet 2>/dev/null || true

# Verify branches exist
if ! git rev-parse --verify "$CLEAN_BASE" >/dev/null 2>&1; then
  echo "Error: branch '$CLEAN_BASE' not found"
  exit 1
fi

if ! git rev-parse --verify "$DIRTY_BRANCH" >/dev/null 2>&1; then
  echo "Error: branch '$DIRTY_BRANCH' not found"
  exit 1
fi

# Count commits unique to dirty branch
COMMIT_COUNT=$(git log --oneline "$CLEAN_BASE".."$DIRTY_BRANCH" | wc -l | tr -d ' ')
echo "Found $COMMIT_COUNT commits on '$DIRTY_BRANCH' not in '$CLEAN_BASE'"

# --- Verdict logic ---
# Patterns that indicate junk/dangerous files to discard
is_discard_pattern() {
  local filepath="$1"
  # Matches: new/, untitled folder/, attachments, .md files with attachments patterns,
  # scrap files, random root-level media, collector scripts
  # Also handles quoted paths from git (e.g. "how does one do this...")
  if echo "$filepath" | grep -qiE '^"?new/|^"?untitled folder/|^"?attachments/|\.md/|^"?scrap_|^"?sociology\.md/|^"?optional scraping\.md/|^"?how does one do this|transit_station_collector'; then
    return 0
  fi
  return 1
}

# Patterns indicating valuable changes worth reviewing
is_needs_review_pattern() {
  local filepath="$1"
  # Feedback widget, optional PYQ files, docs, src code, scripts, config
  if echo "$filepath" | grep -qiE '^src/|^scripts/|^docs/|^data/|^supabase/|^\.github/|^PYQS/optional/|package\.json|Dockerfile|docker-compose|eslint|README'; then
    return 0
  fi
  return 1
}

classify_file() {
  local filepath="$1"
  if is_discard_pattern "$filepath"; then
    echo "discard"
  elif is_needs_review_pattern "$filepath"; then
    echo "needs-review"
  else
    echo "needs-review"
  fi
}

# --- Generate output ---
{
  echo "# Reconciliation Table"
  echo ""
  echo "Comparison: \`$DIRTY_BRANCH\` vs \`$CLEAN_BASE\`"
  echo ""
  echo "Generated: $(date -u +"%Y-%m-%d %H:%M:%S UTC")"
  echo ""
  echo "---"
  echo ""
  echo "## Part 1: Commits Unique to Dirty Branch"
  echo ""
  echo "| Hash | Summary | Files Changed | Verdict |"
  echo "|------|---------|---------------|---------|"
} > "$OUTPUT_FILE"

# Process each commit unique to the dirty branch
while IFS= read -r line; do
  hash=$(echo "$line" | cut -d'|' -f1)
  summary=$(echo "$line" | cut -d'|' -f2)

  # Get files changed count
  files_changed=$(git diff-tree --no-commit-id --name-only -r "$hash" 2>/dev/null | wc -l | tr -d ' ')

  # Get abbreviated file list (up to 5 files)
  file_list=$(git diff-tree --no-commit-id --name-only -r "$hash" 2>/dev/null | head -5 | tr '\n' ', ' | sed 's/,$//')

  # Build files column
  if [ "$files_changed" -gt 5 ]; then
    files_col="$files_changed files: $file_list ..."
  else
    files_col="$files_changed files: $file_list"
  fi

  # Escape pipe characters in summary and file list for markdown table
  summary_escaped=$(echo "$summary" | sed 's/|/\\|/g')
  files_col_escaped=$(echo "$files_col" | sed 's/|/\\|/g')

  # Determine verdict based on commit content
  verdict="needs-review"

  echo "| ${hash:0:7} | $summary_escaped | $files_col_escaped | $verdict |" >> "$OUTPUT_FILE"
done < <(git log "$CLEAN_BASE".."$DIRTY_BRANCH" --format="%H|%s")

# --- Part 2: File-level diff between dirty tree and origin/main ---
# This captures ALL differences including uncommitted working tree changes
{
  echo ""
  echo "---"
  echo ""
  echo "## Part 2: File-Level Differences (Dirty Tree vs origin/main)"
  echo ""
  echo "This section shows all files that differ between the current working tree"
  echo "(on branch \`$DIRTY_BRANCH\`) and \`$CLEAN_BASE\`, including uncommitted changes."
  echo ""
  echo "| Status | File Path | Verdict |"
  echo "|--------|-----------|---------|"
} >> "$OUTPUT_FILE"

FILE_COUNT=0

# Use git diff to compare working tree against origin/main
# --name-status gives us M (modified), A (added), D (deleted)
while IFS=$'\t' read -r status filepath; do
  # Skip empty lines
  [ -z "$status" ] && continue
  [ -z "$filepath" ] && continue

  # Map git status codes to human-readable labels
  case "$status" in
    M) status_label="Modified" ;;
    A) status_label="Added" ;;
    D) status_label="Deleted" ;;
    R*) status_label="Renamed" ;;
    C*) status_label="Copied" ;;
    *) status_label="$status" ;;
  esac

  # Classify the file
  verdict=$(classify_file "$filepath")

  # Escape pipes for markdown
  filepath_escaped=$(echo "$filepath" | sed 's/|/\\|/g')

  echo "| $status_label | $filepath_escaped | $verdict |" >> "$OUTPUT_FILE"
  FILE_COUNT=$((FILE_COUNT + 1))
done < <(git diff --name-status "$CLEAN_BASE" 2>/dev/null)

# Also include untracked files (these are in the dirty tree but not in origin/main)
while IFS= read -r filepath; do
  [ -z "$filepath" ] && continue

  verdict=$(classify_file "$filepath")
  filepath_escaped=$(echo "$filepath" | sed 's/|/\\|/g')

  echo "| Untracked | $filepath_escaped | $verdict |" >> "$OUTPUT_FILE"
  FILE_COUNT=$((FILE_COUNT + 1))
done < <(git ls-files --others --exclude-standard 2>/dev/null)

# --- Summary ---
{
  echo ""
  echo "---"
  echo ""
  echo "## Summary"
  echo ""
  echo "- **Commits unique to dirty branch:** $COMMIT_COUNT"
  echo "- **Files differing from origin/main:** $FILE_COUNT"
  echo "- **Verdict key:**"
  echo "  - \`discard\` — junk, experimental, or dangerous files (new/, untitled folder/, attachments, scraps)"
  echo "  - \`needs-review\` — potentially valuable changes that require manual review before cherry-pick"
  echo ""
  echo "## Next Steps"
  echo ""
  echo "1. Review items marked \`needs-review\` and update verdict to \`cherry-pick\` or \`discard\`"
  echo "2. Run \`scripts/verify-cherry-picks.sh\` to verify commits marked for cherry-pick"
  echo "3. Create clean baseline branch with verified commits only"
} >> "$OUTPUT_FILE"

echo ""
echo "Reconciliation table written to: $OUTPUT_FILE"
echo "  Commits: $COMMIT_COUNT"
echo "  Files:   $FILE_COUNT"
echo "All verdicts auto-classified. Review and update manually or with verify-cherry-picks.sh"
