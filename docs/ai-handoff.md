# Latest handoff

> The single most important file. The next agent (any tool) continues from here.
> Overwrite the sections below after each meaningful chunk of work.

Last updated: 2026-06-08 23:59 IST · By: Codex

## Summary

**Security/PYQ/OCR hardening state is verified and ready for local commit.** The official-PYQ
builder bug was fixed, generated data was rebuilt, full app verification passed, and the OCR sprint
advanced as far as the configured credentials allow.

Paid OCR did **not** proceed to pilot/full because the API verification gate correctly blocked direct
OpenAI use with the current local credentials/config. No page-level OCR spend occurred.

## What completed this pass

### Code/data fixes

- Fixed `scripts/build-official-pyq-links.ts` subject-scoped fuzzy scoring bug:
  - subject token indexes are now scored against `subjectCards`, not the global card array.
  - regenerated official PYQ links recovered healthy coverage.
- Hardened `scripts/full_openai_ocr.py` active defaults:
  - default OCR inputs are now local-pdfs only: Acer mirror first, repo local corpus second.
  - `downloaded-pdfs` requires explicit `--input-dir` / `OCR_INPUT_DIRS` opt-in.
  - active input scope marker is `local-pdfs-only-v2`.
- Rebuilt PYQ app data and runtime PDF data.
- Confirmed `scripts/check-no-public-pdf-url-leaks.js` is part of the build path and must be committed with `package.json`.

### OCR execution gates

Run root for this pass:

```text
/Volumes/Acer/open-topper/extracted_data/ocr_openai/run_20260608T233641
```

Local-only estimate completed successfully:

```text
Input dirs: /Volumes/Acer/open-topper/local-pdfs
all PDFs/pages:      2541 / 125654
selected PDFs/pages: 2541 / 125654
selected size:       31.494 GiB
cache valid/current: 0
remaining pages:     125654
output dir:          /Volumes/Acer/open-topper/extracted_data/ocr_openai/run_20260608T233641
```

API verification status:

- First direct run refused because direct OpenAI requires explicit `--allow-direct-openai`.
- Rerun with `--allow-direct-openai` previously exposed a stale script guard; the worker now permits `--verify-key` to auto-discover a likely vision model when `OCR_OPENAI_MODEL` is unset. The current blocker is the direct OpenAI key returning 401 `invalid_api_key`.
- A manual `/v1/models` request to `https://api.openai.com` using local `OPENAI_API_KEY` failed with HTTP 401 Unauthorized.
- Therefore pilot/full OCR were correctly **not started**.

Current OCR outputs from this pass:

- no page cache JSON files
- no per-PDF aggregate Markdown/JSON
- no OCR record export
- private estimate/manifest files only under the Acer run root

## Generated data after fix

After `npm run build-pyqs`, public official link coverage is healthy again:

```json
{
  "officialQuestionCount": 958,
  "linkedQuestionCount": 841,
  "linkedCopyCount": 18234,
  "sourceAvailableCount": 16513,
  "bySubject": {
    "gs3": 261,
    "gs1": 272,
    "gs2": 255,
    "gs4": 50,
    "essay": 3
  },
  "byType": {
    "topic-match": 5709,
    "loose-topic-match": 12270,
    "strong": 221,
    "direct": 34
  }
}
```

This resolves the prior broken generated output that had collapsed to ~183 linked questions and no GS4 coverage.

## Verification completed

All verification below passed after the source/data fixes:

```bash
node --test --import tsx src/lib/__tests__/*.test.ts
# 29/29 passed

npx tsc --noEmit --pretty false --incremental false
# passed

npm run lint -- --no-fix
# passed

node scripts/check-no-public-pdf-url-leaks.js
# passed

npm run build
# passed; 27 static pages; dynamic API/PDF routes; post-build leak check passed
```

Standalone/runtime packaging was checked after build:

```text
.next/standalone/data/pdf-runtime/answer-sources.json
.next/standalone/data/pdf-runtime/pdf-r2-map.json
```

Runtime source/target hashes now match after build sync:

```text
data/app/answer-sources.json        == data/pdf-runtime/answer-sources.json
data/app/pdf-r2-map.json            == data/pdf-runtime/pdf-r2-map.json
```

## Current blockers / next steps

### OCR blocker

Paid OCR cannot continue until the user/operator provides a valid OpenAI-compatible OCR config:

```bash
export OPENAI_BASE_URL="https://<valid-openai-compatible-base>"
export OCR_OPENAI_MODEL="<vision-capable-model-from-that-provider>"
```

If direct OpenAI is intended, the key must be valid for `https://api.openai.com`, and runs must include `--allow-direct-openai`.

Resume sequence after credentials are fixed:

```bash
cd /Users/ankitkumar/Downloads/open-topper
source /tmp/open_topper_ocr_run.env  # if still present; otherwise set OCR_INPUT_ROOT/OCR_RUN_ROOT manually

.venv/bin/python scripts/full_openai_ocr.py \
  --verify-key \
  --allow-direct-openai \
  --input-dir "$OCR_INPUT_ROOT" \
  --output-dir "$OCR_RUN_ROOT" \
  --tmp-dir "$OCR_RUN_ROOT/tmp" \
  --model "$OCR_OPENAI_MODEL" \
  --concurrency 1 \
  --rpm-limit 6

.venv/bin/python scripts/full_openai_ocr.py \
  --pilot \
  --pilot-limit 2 \
  --input-dir "$OCR_INPUT_ROOT" \
  --output-dir "$OCR_RUN_ROOT" \
  --tmp-dir "$OCR_RUN_ROOT/tmp" \
  --model "$OCR_OPENAI_MODEL" \
  --concurrency 2 \
  --rpm-limit 30
```

Start `--full` only after `pilot-summary.json` has `gates.pass: true`.

### Git blocker

Do not use `git add .`. Stage only the explicit safe source/data/doc/test files. Exclude:

- root PDFs/JPGs/MOV/APKG
- `.env.local`
- `.next/`
- `node_modules/`
- `local-pdfs/`
- `extracted_data/`
- `.kiro/`, `.reasonix/`, `.vscode/`, `.mcp.json`
- unrelated files such as `transit_station_collector.py` and the long ad-hoc Markdown note

## Files intentionally changed for the commit

Expected commit scope includes:

- security/PDF/auth/public-boundary source and tests
- official PYQ builder/runtime/optional page changes
- topper-name normalization code + curation JSON + tests
- rebuilt tracked public/private app data required by the changed builders
- synced `data/pdf-runtime/answer-sources.json`
- OCR worker/default hardening and OCR task brief
- docs updated with the actual verified status
