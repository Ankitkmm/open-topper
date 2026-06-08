# Active tasks

> Keep this current. Move items between sections as work progresses.
> One agent owns a task at a time — note ownership in `ai-handoff.md`.

## Now

- [ ] Commit the stabilized state — see exact `git add` commands in `docs/ai-handoff.md` Step 1. Do NOT use `git add .`.
- [ ] Add hosted Supabase env vars on the deployment target and apply `supabase/migrations/20260605_user_progress.sql` for production auth/progress.
- [ ] (Codex/product) Add authoritative optional PYQ source files in `PYQS/optional/` and extend `parseOptionalOfficialRows()` in `src/lib/official-pyqs.ts` to read from them, replacing the current `workspace-optional-fallback` approach.
- [ ] (Codex/data) Add curated `driveId/filename → topperName` map for remaining anonymous PDFs, especially Public Administration, Anthropology, and PSIR (starter map already in `data/curation/topper-name-overrides.json`).
- [ ] (Codex/data) OCR: resume local-pdfs-only paid OCR after providing a valid `OPENAI_BASE_URL`, `OCR_OPENAI_MODEL`, and credential smoke-testable key. Keep input restricted to `/Volumes/Acer/open-topper/local-pdfs` or repo `local-pdfs`; keep heavy outputs under `/Volumes/Acer/open-topper/extracted_data/ocr_openai/`; do not use `downloaded-pdfs` unless a future request explicitly restores that workflow.

## Backlog

- [ ] Decide whether PDF delivery should stay viewer-proxied from the app or move to private signed R2 objects later.
- [ ] Real database-backed progress sync (`/api/progress`, Supabase/Postgres/RLS or equivalent) after auth.
- [ ] Move PDFs fully to private R2/S3 with short-lived signed URLs.
- [ ] Add rate limiting to `/api/answer-source`.
- [ ] Personalization: daily frequency, heatmap, bookmarks, notes, streaks.
- [ ] Topper upload/review flow.
- [ ] Tests for filtering, pagination, PDF link extraction, topper-name normalization.

## Done (recent)

- [x] Fixed official PYQ builder subject-card scoring bug and regenerated healthy public official links (841 linked questions / 18,234 linked copies); full tests, typecheck, lint, leak checks, and production build passed.
- [x] OCR local-only estimate completed on Acer mirror (2,541 PDFs / 125,654 pages); paid verification correctly blocked on invalid/missing direct OpenAI OCR config before pilot/full.
- [x] Kiro stabilization pass: fixed TS2540 in security-hardening test, ran full verification (lint, typecheck, 28 tests, public-leak-check, build) — all green. Created 5 steering files + 3 hooks.
- [x] Superseded local-pdfs-only OCR wording for the active Worker B implementation request; current scope is Acer internet+local with bounded discovery/downloads on explicit gate and heavy private OCR/export artifacts on the Acer SSD.
- [x] Private offline OpenAI-compatible vision OCR worker added at `scripts/full_openai_ocr.py` with `.env.local` loading, `--estimate`/`--verify-key`/`--pilot`/`--full`/`--rebuild-aggregates` modes, page-level cache, SQLite/JSON manifests, priority ordering, sharding, retry/backoff, strict cache fingerprint validation, and per-PDF Markdown/JSON outputs under ignored `extracted_data/ocr_openai/` (Acer SSD by default for heavy runs).
- [x] Native Supabase SSR auth migration completed (`@supabase/ssr`, browser/server helpers, `proxy.ts`, auth routes, no NextAuth in main path).
- [x] Runtime answer-source data hardened to R2-only URLs; direct external PDFs are quarantined at build time.
- [x] Public scrape-heavy detail/internal APIs are now auth-gated when Supabase auth is configured.
- [x] Subject/optional pages now lazy-load topper detail payloads via per-question APIs.
- [x] PDF open flow now uses `/pdf/[answerId]` pdf.js viewer URLs instead of exposing the proxy URL as the visible tab.
- [x] Essay official links rebuilt so Essay no longer shows zero linked copies.
- [x] Subject search now has fuzzy fallback (e.g. `goverment` in Public Administration).
- [x] Purple theme, workspace disclaimers, and reliable home-nav behavior added.
- [x] Email/password auth scaffolding (`/account`, `/api/auth/register`, `/api/progress`) added; activation still depends on Supabase env + migration.
- [x] GS/Essay/Browse official-PYQ-first flow: PYQ → relevant topper-answer questions → topper copies → Summary/View PDF.
- [x] Topper-name extraction improved and data rebuilt (33,467 named canonical answer records).
- [x] `/browse` first-search no longer loads local Xenova embeddings on the request path unless explicitly enabled.
- [x] Syllabus cleanup: Geography boundary, Anthropology parser, GS4/Public Admin noise removal.
- [x] Progress simplified to one Done state and centralized in user data context.
- [x] Superseded auth experiment: env-gated Google NextAuth/localStorage progress was replaced by native Supabase SSR auth; public auth is currently QA-disabled in `src/lib/auth-availability.ts`.
- [x] Empty route dirs `src/app/analytics/` and `src/app/hiring/` removed.
- [x] Frontend redesign → calm "study space": unified `StudyNav`, search/subject-first landing,
      removed pricing/hiring/analytics, PDF opens in a new tab, full-width reading, token-based
      `not-found`, deleted dead `Header`/`Sidebar`/`PdfViewer`.
- [x] Design-system foundation in `globals.css` (4 themes) + Newsreader/Inter/IBM Plex Mono fonts.
- [x] MCP config fix (Kiro `disabled: true`; Claude `.mcp.json` emptied + `.mcp.json.example`).
- [x] Multi-agent coordination scaffolding (`docs/ai-*.md`, AGENTS.md protocol).
