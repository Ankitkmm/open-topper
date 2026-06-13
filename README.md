# UPSCat / OpenUPSC

UPSCat (`upscat.click`) is a calm UPSC Mains study workspace. It combines official previous-year questions, relevant topper-copy signals, PDF viewing, search, and lightweight progress tracking without exposing private source files or raw PDF URLs to the browser.

Core flow:

```text
landing → subject/optional page → official PYQ shell → relevant topper-answer groups → Summary or View PDF
```

The app is intentionally a study space, not a marketing dashboard: wide reading surfaces, restrained themes, lazy-loaded topper details, and explicit user action before any PDF opens.

## Tech stack

- Next.js 16 App Router (`npm run dev` uses `next dev --webpack`)
- React 19 and TypeScript 5
- Tailwind CSS v4 plus the tokenized design system in `src/app/globals.css`
- Supabase SSR auth (`@supabase/ssr`) and the `public.user_progress` migration
- R2/S3-backed PDF runtime data; browser-visible routes use answer IDs and short-lived cookies
- Node/TS data builders in `scripts/`
- Private OCR tooling in `scripts/full_openai_ocr.py` for offline ingestion only

> **Next.js note:** this repository uses a newer/breaking Next.js version. Before changing route handlers, proxy behavior, or other framework APIs, read the relevant local docs in `node_modules/next/dist/docs/` and follow the repo's `AGENTS.md` instructions.

## Local development

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Useful local pages:

- `/`
- `/browse`
- `/gs1`, `/gs2`, `/gs3`, `/gs4`, `/essay`
- `/optional/anthropology`
- `/optional/geography`
- `/optional/history`
- `/optional/psir`
- `/optional/public-administration`
- `/optional/sociology`
- `/account`

## Verification commands

Run these before handoff or commit:

```bash
npm run lint -- --no-fix
npm run typecheck
npm run test
node scripts/check-official-pyq-link-health.js
node scripts/audit-topper-names.js
node scripts/check-no-public-pdf-url-leaks.js
python3 -m py_compile scripts/full_openai_ocr.py scripts/discover_topper_pdfs.py scripts/export_ocr_records.py
```

When generated runtime data is intentionally synchronized, also run:

```bash
npm run build
node scripts/check-no-public-pdf-url-leaks.js --include-build
```

## Data build commands

```bash
npm run build-pyqs              # build public PYQ app data and official links
npm run build-official-links    # rebuild data/app/public-official-pyq-links.json
npm run build-workspace-index   # rebuild workspace shell/detail data when private inputs are available
npm run sync-pdf-runtime        # sync committed PDF runtime fallbacks for deploy builds
```

Committed optional PYQ source files live under `PYQS/optional/*.md` using the safe TSV interface:

```text
year<TAB>paper<TAB>questionNo<TAB>topic<TAB>question<TAB>tags<TAB>marks<TAB>source
```

Only cleaned text rows belong there. Do not commit raw UPSC PDFs, rendered page images, OCR text caches, extraction scripts, or source URLs.

## Public/private data boundary

Keep the following invariants intact:

- Client DTOs receive `answerId`, never raw PDF URLs.
- `POST /api/answer-source` maps `answerId` to a short-lived PDF viewer URL server-side.
- The PDF token is stored in an HttpOnly cookie and is not accepted from query strings.
- `/pdf/[answerId]` and `/api/answer-source/[answerId]` validate token, origin/fetch metadata, byte ranges, and upstream PDF metadata.
- Public JSON leak checks cover `data/app/public-pyqs.json`, `data/app/public-official-pyq-links.json`, `public/`, and optionally `.next/`.
- Private inputs and heavy artifacts stay ignored: `local-pdfs/`, `vault_merged_docs/`, `extracted_data/`, raw spreadsheets/PDFs, and private `data/app/*` runtime sources.

## Supabase auth and progress

Production auth/progress needs:

1. A Supabase project with email/password auth enabled.
2. The migration in `supabase/migrations/20260605_user_progress.sql` applied to the hosted database.
3. Environment variables:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   - `AUTH_SECRET`

The migration enables row-level security so each authenticated user can only read/write their own `user_progress` rows. In development/QA, auth can be temporarily disabled outside production; in production-like runtimes, missing or misconfigured Supabase env fails closed.

## PDF/R2 runtime requirements

Set these for PDF viewing in deployed environments:

- `PDF_TOKEN_SECRET` — long random secret distinct from `AUTH_SECRET`
- `R2_PUBLIC_URL` — public base URL for the R2/S3 PDF objects used by runtime data
- `R2_ALLOWED_PUBLIC_HOSTS` — comma-separated HTTPS hosts that the runtime may proxy
- `RATE_LIMIT_WINDOW_MS`
- `RATE_LIMIT_SEARCH_MAX`
- `RATE_LIMIT_ANSWER_SOURCE_MAX`
- `RATE_LIMIT_PDF_MAX`
- `RATE_LIMIT_AUTH_MAX`
- `RATE_LIMIT_PROGRESS_MAX`
- `DATABASE_URL` when durable/distributed rate limiting is required

The build/runtime hardening rejects unexpected public PDF hosts and direct external PDF leaks.

## OCR warning

The OCR pipeline is private ingestion infrastructure. Raw page OCR, rendered images, SQLite manifests, logs, source PDFs, page caches, and per-PDF aggregates must remain under ignored private roots such as `extracted_data/ocr_openai/` or the Acer external-drive OCR root. OCR output is not public runtime truth until separately reviewed and promoted through safe app data.

Do not start duplicate paid OCR runs in a different output root. Resume or monitor the existing manifest-backed run instead.

## Multi-agent handoff protocol

This repository is shared across Codex, Claude Code, Kiro, and other AI tools. Memory is not shared between tools; the repo is the shared state.

Before work:

1. Read `AGENTS.md`.
2. Read `docs/ai-context.md`, `docs/ai-tasks.md`, `docs/ai-decisions.md`, and `docs/ai-handoff.md`.
3. Continue from the latest handoff.

After meaningful work:

1. Update `docs/ai-handoff.md` with summary, files changed, decisions, blockers, verification, and exact next step.
2. Record durable architecture decisions in `docs/ai-decisions.md`.
3. Use explicit `git add` paths only; never use `git add .`.
4. Leave unrelated local artifacts unstaged.
