# Latest handoff

> The single most important file. The next agent (any tool) continues from here.
> Overwrite the sections below after each meaningful chunk of work.

Last updated: 2026-06-09 01:58 IST · By: Codex

## Summary

Production hardening and data-quality stabilization for UPSCat/Open Topper has been implemented and
prepared as a single staged commit candidate on branch `codex/release-hardening-ocr-2026-06-08`.

The staged work covers:

1. Security/auth/PDF boundary hardening.
2. Official PYQ link health checks and shared Essay normalization.
3. Optional fallback cleanup and provenance UI disclosure.
4. Topper-name schema v2/source-override hooks and public DTO normalization.
5. Browse/subject/search/PDF/account UI behavior and accessibility fixes.
6. OCR worker robustness improvements only; no OCR completion is claimed.
7. Build determinism by removing build-time Google Fonts fetching.

No API key is present in repo files. The key previously provided in chat must not be echoed, written
to docs/env/logs, committed, or intentionally wasted.

## Current git state expected after this handoff

Staged for commit:

```text
data/app/public-official-pyq-links.json
data/app/workspace-index.json
data/curation/topper-name-overrides.json
docs/ai-decisions.md
docs/ai-handoff.md
scripts/audit-topper-names.js
scripts/build-mappings.js
scripts/build-official-pyq-links.ts
scripts/build-pyq-app-data.js
scripts/check-official-pyq-link-health.js
scripts/full_openai_ocr.py
src/app/account/page.tsx
src/app/api/answer-source/[answerId]/route.ts
src/app/api/answer-source/route.ts
src/app/api/auth/login/route.ts
src/app/api/auth/logout/route.ts
src/app/api/auth/register/route.ts
src/app/api/official-questions/[questionId]/route.ts
src/app/api/progress/route.ts
src/app/api/search/route.ts
src/app/api/workspace-questions/[questionId]/route.ts
src/app/globals.css
src/app/layout.tsx
src/app/pdf/[answerId]/page.tsx
src/components/BrowsePageClient.tsx
src/components/OfficialQuestionCards.tsx
src/components/OfficialSubjectPageClient.tsx
src/components/OfficialSubjectWorkspace.tsx
src/components/PdfViewerPage.tsx
src/components/auth/AccountPanel.tsx
src/components/auth/AuthControls.tsx
src/lib/__tests__/official-pyqs-boundaries.test.ts
src/lib/__tests__/public-boundary.test.ts
src/lib/__tests__/security-hardening.test.ts
src/lib/essay-normalization.ts
src/lib/official-pyqs.ts
src/lib/pdf-access.ts
src/lib/question-bank-runtime.ts
src/lib/shell-search.ts
src/lib/topper-names.ts
```

Untracked files intentionally left unstaged and should remain out of the commit unless separately
reviewed:

```text
how does one do this, Based on the video transcript, the cre….md
transit_station_collector.py
```

## What changed

### Security/auth/PDF

- Added cheap pre-auth rate limiting to auth/detail/PDF/progress paths where practical.
- Hardened logout with same-origin/body-size/rate-limit checks.
- `GET /api/progress` now filters by `user_id`.
- `PUT /api/progress` now rejects invalid `entries` payloads and safely ignores non-object entries.
- PDF viewer route uses async Next headers and blocks explicit cross-site `Sec-Fetch-Site`, invalid
  `Origin`, and invalid `Referer` before auth/source resolution.
- PDF byte-range validation now rejects open-ended forward ranges such as `bytes=500-` while keeping
  bounded ranges and suffix ranges under the 32 MiB cap.
- Added/fixed security regression tests.

### Official PYQ / Essay / optional data

- Added `scripts/check-official-pyq-link-health.js` with global and per-category floors.
- Regenerated `data/app/public-official-pyq-links.json` and preserved high coverage:
  - `officialQuestionCount`: 958
  - `linkedQuestionCount`: 841
  - `linkedCopyCount`: 18,234
  - `sourceAvailableCount`: 16,513
  - category linked-copy counts: GS1 6,640; GS2 5,421; GS3 5,262; GS4 908; Essay 3.
- Shared Essay prompt normalization between runtime/build code; covered `cannot` vs `can not`,
  decorative quotes, `(CSE 2023, PYQ)` suffixes, and false-positive rejection.
- Added optional fallback text cleanup coverage for `QQue`, leading quotes, empty trailing `()`, and
  duplicate `Q` prefixes.
- Low-confidence loose-topic matches are labeled as possible/needs-review in UI rather than normal
  strong relevance.

### Topper names / public DTOs

- Bumped `data/curation/topper-name-overrides.json` to schema version 2.
- Added source-level, answer-level, and suppressed-source override arrays for future curation.
- Updated `scripts/build-pyq-app-data.js` and `scripts/build-mappings.js` to consume source/answer
  override hooks.
- Normalized workspace public copy names server-side to a real public name or `Topper copy`.
- Added `scripts/audit-topper-names.js`, which currently passes with no known bad public labels.
- Regenerated `data/app/workspace-index.json` so public name fallbacks are normalized on disk.

### UI/page behavior/accessibility

- `/api/search` now supports larger requested limits up to 1000 and returns limit/truncation metadata.
- Browse and subject clients no longer flash stale default results on direct query URLs.
- Invalid deep links show `Linked PYQ could not be found.` instead of silently falling back.
- Optional pages disclose fallback provenance calmly while authoritative optional migration is ongoing.
- Account/auth copy now distinguishes QA-disabled, auth-configured, production-misconfigured, and
  local-unconfigured states.
- Browse copy no longer hardcodes `temporarily open for QA` when auth is enabled.
- PDF mobile fit and loading/error accessibility were improved.
- Added search labels, aria-expanded/aria-controls, aria-live/status/alert states, and deep-link focus
  targets.

### Build determinism / OCR worker

- Removed `next/font/google` imports from `src/app/layout.tsx` and kept CSS font-family stacks in
  `src/app/globals.css` so production builds do not depend on build-time Google Fonts network access.
- `scripts/full_openai_ocr.py` now avoids reclaiming already-done same-fingerprint pages and supports
  `--only-pdf-file` for targeted shard lists.
- OCR completion is not claimed; OCR artifacts/logs remain private and must not be committed.

## Verification completed

Earlier in this implementation pass, these full checks passed:

```bash
npm run lint -- --no-fix
npm run typecheck
npm run test
node scripts/check-official-pyq-link-health.js
node scripts/audit-topper-names.js
node scripts/check-no-public-pdf-url-leaks.js
npm run build
node scripts/check-no-public-pdf-url-leaks.js --include-build
python3 -m py_compile scripts/full_openai_ocr.py
node --check scripts/check-official-pyq-link-health.js
node --check scripts/audit-topper-names.js
```

Final pre-commit checks re-run after staging preparation:

```bash
git diff --check
node scripts/check-official-pyq-link-health.js
node scripts/audit-topper-names.js
node scripts/check-no-public-pdf-url-leaks.js
```

All passed.

Additional safety checks:

- Staged private/generated/media guard passed: no `.pdf`, `.mov`, `.apkg`, root thumbs, `.env`,
  `local-pdfs/`, `extracted_data/`, `vault_merged_docs/`, `public/data/`, `.next/`, `node_modules/`,
  `.venv/`, `.reasonix/`, or `.vscode/` paths are staged.
- Targeted exact OpenAI-style long-hex `sk-*` token scan found no API key in intended staged files.

## Decisions recorded

See `docs/ai-decisions.md` for decisions added this pass:

- Essay link health floor remains 3 until more authoritative Essay mappings exist.
- Public topper-name fallbacks are normalized on disk and audited via `scripts/audit-topper-names.js`.
- PDF byte-range proxying rejects open-ended forward ranges.
- Production builds use offline/deterministic CSS font stacks rather than build-time Google Fonts.

## Caveats / blockers

- No paid OCR completion is claimed. The previous 32-shard OCR launch was stopped because it made the
  Mac lag. Resume only if explicitly requested, using a much smaller shape such as 2 shards x 2 workers
  or 4 shards x 2 workers.
- Optional authoritative source migration is not complete; fallback rows are cleaned and disclosed in
  UI, with parser/source migration left as future data work.
- Public Administration still has 0 named rows in the current audit until real source/answer overrides
  are curated. The public DTO rule still passes because bad labels are suppressed to `Topper copy`.
- Manual browser smoke testing was not repeated after the final staging step in this checkpoint; rely
  on the passed build/tests plus future manual smoke before deploy if desired.

## Exact next step

Commit the staged changes if `git status --short --branch`, staged guard, and final checks still look
clean. Suggested commit message:

```bash
git commit -m "harden security, PYQ data quality, topper names, and study UI"
```

After commit, leave the unrelated untracked files unstaged unless the user explicitly asks to review
them.
