# Task brief for Codex: Acer internet + local OCR pipeline

> Active source-of-truth brief for the current OCR/downloader/exporter request. This supersedes
> the transient local-pdfs-only brief and older download-first notes. Read `AGENTS.md` and
> `docs/ai-*.md` first. Parent/lead agent owns `docs/ai-handoff.md`; Worker B must not edit it.

## Active scope

Run the private OCR ingestion workflow over the **Acer internet + local corpus**:

```text
/Volumes/Acer/open-topper/extracted_data/ocr_openai/downloaded-pdfs/**/*.pdf
/Volumes/Acer/open-topper/local-pdfs/**/*.pdf
/Users/ankitkumar/Downloads/open-topper/local-pdfs/**/*.pdf
```

Code remains in the repo:

```text
/Users/ankitkumar/Downloads/open-topper
```

Heavy/private artifacts must stay on the Acer SSD by default:

```text
OCR output root: /Volumes/Acer/open-topper/extracted_data/ocr_openai/
OCR tmp root:    /Volumes/Acer/open-topper/tmp/
```

Repo-local output under `/Users/ankitkumar/Downloads/open-topper/extracted_data/ocr_openai/` is
allowed only for tiny private tests. Production-scale OCR must use the Acer output root.

## Allowed inputs

The active OCR input roots are:

1. Acer downloaded PDFs from the bounded internet discovery/downloader:
   `/Volumes/Acer/open-topper/extracted_data/ocr_openai/downloaded-pdfs/`
2. Acer mirror of the existing local corpus:
   `/Volumes/Acer/open-topper/local-pdfs/`
3. Repo local corpus:
   `/Users/ankitkumar/Downloads/open-topper/local-pdfs/`

`OCR_INPUT_DIRS`/`--input-dir` may include any combination of those roots. The OCR worker must reject
`public/`, app runtime data, random Downloads folders, and non-private roots.

## No accidental paid OCR

Paid/API-backed OCR may run **only** when all of the following are explicit:

1. `OPENAI_API_KEY` is set.
2. `OPENAI_BASE_URL` or `--base-url` is set. The script must not silently default API-backed runs to
   direct `https://api.openai.com`.
3. `OCR_OPENAI_MODEL` or `--model` is set. The script must not auto-select a paid model from
   `/v1/models`.
4. If the base URL host is direct `api.openai.com`, `--allow-direct-openai` or
   `OCR_ALLOW_DIRECT_OPENAI=1` is also required.
5. `--verify-key` has passed and written a persisted `verify-summary.json` matching the current base
   URL host, model, prompt, render settings, max output tokens, prompt fingerprint, and input scope.
6. Non-dry `--pilot`/`--full` must refuse to run if the persisted verification summary does not
   match current settings.

The verification step must run a real Responses API vision smoke test with a generated nonce image and
strict JSON response. Abort immediately on `401`/`403`.

## Worker scripts

Owned scripts for this task:

```text
scripts/full_openai_ocr.py
scripts/discover_topper_pdfs.py
scripts/export_ocr_records.py
```

The OCR worker is additive/offline only. Do not modify Next.js runtime, `/src/app`, `/src/lib`,
`/api/*`, or existing app data pipelines for this v1 OCR task.

## Downloader/discovery policy

Internet discovery is intentionally gated. Use only bounded public-source crawling/downloads that
respect source allow-lists, robots unless explicitly disabled, byte/page/depth limits, retry caps,
and PDF validation. Do not solve captchas, bypass paywalls, create accounts, or use login-only
resources.

The downloader gate is:

```bash
--allow-internet-discovery
# or
ALLOW_INTERNET_DISCOVERY_WORKFLOW=1
```

Outputs belong under `/Volumes/Acer/open-topper/extracted_data/ocr_openai/`, including:

```text
sources/discovered-sources.sqlite
sources/discovered-sources.json
sources/source-pages-manifest.json
sources/discovered-events.jsonl
download-manifest.json
downloaded-pdfs/
manifest.json
```

The downloader should scan both repo `local-pdfs/` and the Acer `local-pdfs/` mirror for dedupe.

## OCR output requirements

All OCR outputs are private ingestion artifacts under the configured OCR output root:

```text
verify-summary.json
manifest.sqlite
manifest.json
events.jsonl
inventory-summary.json
run-summary.json
pilot-summary.json
page-cache/by-sha/<sha-prefix>/<sha256>/page_000001.json
page-cache/<legacy-pdf-id>/page_000001.json  # read fallback for old cache only
pdfs/<pdf_id>.json
pdfs/<pdf_id>.md
images/  # only when save-images is enabled
```

New page cache writes should use SHA-256-primary paths. Reads should fall back to the older
`page-cache/<pdf_id>/...` layout so previous private cache remains usable.

Never place raw OCR, rendered page images, manifests, source PDFs, source URLs, or private PDF URLs
under `public/`, `data/app`, app runtime bundles, or any non-ignored committed location.

## Execution order

1. Optional bounded internet discovery/download only after the explicit internet gate is set.
2. `--estimate` with no API calls over the active Acer internet + local inputs.
3. `--verify-key` with explicit `OPENAI_BASE_URL` and `OCR_OPENAI_MODEL`; inspect
   `verify-summary.json`.
4. Representative non-dry `--pilot`; inspect `pilot-summary.json`, page cache, and aggregate samples.
5. `--full` only after matching verify-summary and passing pilot gates. Use shards if needed.
6. `--rebuild-aggregates` as needed from page cache; no API calls.
7. `scripts/export_ocr_records.py --production-gates acer-internet-local` to emit private JSONL/JSON/XML
   records and fail on aggregate read errors.

## Completion criteria

Do not claim full OCR/export completion unless private manifests under the configured OCR output root prove:

- every selected readable PDF/page is completed in current page cache, or terminally errored;
- one aggregate JSON and Markdown exists per readable PDF unless terminally unreadable;
- `verify-summary.json`, `pilot-summary.json`, run summaries, manifests, and events are internally consistent;
- record export `export-summary.json` passes production gates with zero aggregate read errors;
- no raw private data was written to `public/` or app runtime data.
