#!/usr/bin/env bash
set -euo pipefail

TARGET="${UPSCAT_RUNTIME_DATA_TARGET:-${1:-preview}}"
ROOT="${UPSCAT_RUNTIME_DATA_DIR:-.cloudflare-runtime-data}"
PREFIX="${UPSCAT_RUNTIME_DATA_PREFIX:-runtime/v1}"

case "$TARGET" in
  preview)
    BUCKET="${UPSCAT_RUNTIME_DATA_BUCKET:-upscat-runtime-data-preview}"
    ;;
  production|prod)
    BUCKET="${UPSCAT_RUNTIME_DATA_BUCKET:-upscat-runtime-data}"
    ;;
  *)
    BUCKET="${UPSCAT_RUNTIME_DATA_BUCKET:-$TARGET}"
    ;;
esac

if [[ ! -d "$ROOT" ]]; then
  echo "Runtime data directory not found: $ROOT" >&2
  echo "Run: npm run cf:prepare-data" >&2
  exit 1
fi

if [[ ! -f "$ROOT/manifest.json" ]]; then
  echo "Runtime data manifest not found: $ROOT/manifest.json" >&2
  exit 1
fi

echo "Uploading $ROOT to r2://$BUCKET/$PREFIX"
echo "Target: $TARGET"

find "$ROOT" -type f -name '*.json' | sort | while read -r file; do
  rel="${file#${ROOT}/}"
  key="${PREFIX}/${rel}"
  echo "put r2://${BUCKET}/${key}"
  npx wrangler r2 object put "${BUCKET}/${key}" --file "$file" --content-type application/json
done
