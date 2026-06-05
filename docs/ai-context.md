# Project context

> Shared source of truth for all AI tools working on this repo (Kiro, Claude Code, Codex).
> Read this first, every session. Do not assume memory is shared across tools.

## What this app does

OpenUPSC / **UPSCat** (`upscat.click`) is a calm study workspace for UPSC aspirants. It is a
PYQ (previous year question) search engine + topper-copy aggregator + lightweight progress tracker.

Core user flow:

```
landing → subject page → PYQ list → click PYQ → reveal topper copies → Summary or View PDF
```

It blends keyword + semantic search over PYQs, links each question to relevant topper answer
copies, and tracks study progress (currently in localStorage; auth/DB planned). The product
should feel like a spacious library/reading room, not a tech dashboard.

## Tech stack

- **Framework:** Next.js 16 (App Router, `next dev --webpack`), React 19, TypeScript 5
- **Styling:** Tailwind CSS v4 (`@tailwindcss/postcss`) + a custom design-token system in
  `src/app/globals.css` (4 themes: Library / Sage / Sepia / Night)
- **Fonts:** Newsreader (serif headings), Inter (body/UI), IBM Plex Mono (stats) via `next/font/google`
- **Auth:** `next-auth` v5 beta — currently **disabled** (`authAvailable = false` in `layout.tsx`)
- **Data / search:** Postgres (`pg`) + pgvector spine; local embeddings via `@xenova/transformers`
- **PDF:** `pdfjs-dist` viewer; PDFs served via private lookup, preferring R2/S3 over Google Drive
- **Storage:** `@aws-sdk/client-s3` + `lib-storage` (R2/S3) for answer PDFs
- **Ingestion:** `xlsx` (topper sheets), `tsx` build scripts in `scripts/`
- **UI libs:** `lucide-react`, `clsx`, `tailwind-merge`

## Important constraints

- **`AGENTS.md` rule:** this is a modified Next.js — APIs/conventions may differ from training
  data. Read the relevant guide in `node_modules/next/dist/docs/` before using unfamiliar Next APIs.
- **Security / data handling (from `CONTEXT.md`):**
  - Never put raw source files, raw OCR dumps, or real PDF URLs in `public/`.
  - Client only ever receives an `answerId`. `POST /api/answer-source` maps it to an embed URL/page
    server-side, with `private, no-store`, noindex headers, and same-origin checks.
  - Private/ignored data: `public/data/`, `vault_merged_docs/`, `extracted_data/`,
    `data/mappings/`, `data/app/answer-sources.json`, etc.
- **UX rules to preserve:** don't dump raw OCR/topper text on the page; topper copies reveal only
  after a click; PDF opens only after "View PDF"; keep questions distinct + keyword-highlighted;
  calm spacing and readable fonts for long study sessions.

## Coding standards

- Match existing patterns. Style comes from the shared design system in `globals.css` — use the
  semantic classes (`soft-panel`, `pyq-card`, `study-badge`, `btn-primary/secondary`, `overline`,
  `mono-stat`, `question-title`, `summary-box`) and CSS variables (`--accent`, `--fg-*`, `--bg-*`).
  Do **not** hardcode hex colors in components (legacy `Header.tsx`/`Sidebar.tsx` do this — avoid).
- Server components by default; `"use client"` only when interactivity is needed.
- Keep secrets out of client code and out of `public/`.
- Run verification before handing off: `npm run lint`, `npx tsc --noEmit`, and where data permits
  `npm run build`. For UI changes, smoke-test pages with the dev server (`/`, `/browse`, `/gs1`).

## Environments

- **Dev:** `npm run dev` → http://localhost:3000 (reads `.env.local`)
- **Build:** `npm run build` (runs `scripts/sync-pdf-runtime-data.js` then `next build`)
- **Data builds:** `npm run build-pyqs`, `build-search-spine`, `build-entities`, etc. (see `package.json`)
- Env files: `.env.local` (local), `.env.example` (template)
