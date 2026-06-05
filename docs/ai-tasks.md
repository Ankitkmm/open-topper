# Active tasks

> Keep this current. Move items between sections as work progresses.
> One agent owns a task at a time — note ownership in `ai-handoff.md`.

## Now

- [ ] Add hosted Supabase env vars on the deployment target and apply `supabase/migrations/20260605_user_progress.sql` for production auth/progress.
- [ ] (Codex/data) Add curated `driveId/filename → topperName` map for remaining anonymous PDFs, especially Public Administration, Anthropology, and PSIR.
- [ ] (Codex/product) Add official optional PYQ sources/mapping if optional pages must use the same PYQ-first hierarchy.

## Backlog

- [ ] Decide whether PDF delivery should stay viewer-proxied from the app or move to private signed R2 objects later.
- [ ] Real database-backed progress sync (`/api/progress`, Supabase/Postgres/RLS or equivalent) after auth.
- [ ] Move PDFs fully to private R2/S3 with short-lived signed URLs.
- [ ] Add rate limiting to `/api/answer-source`.
- [ ] Personalization: daily frequency, heatmap, bookmarks, notes, streaks.
- [ ] Topper upload/review flow.
- [ ] Tests for filtering, pagination, PDF link extraction, topper-name normalization.

## Done (recent)

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
- [x] Env-gated Google NextAuth UI with localStorage progress scoped by email.
- [x] Empty route dirs `src/app/analytics/` and `src/app/hiring/` removed.
- [x] Frontend redesign → calm "study space": unified `StudyNav`, search/subject-first landing,
      removed pricing/hiring/analytics, PDF opens in a new tab, full-width reading, token-based
      `not-found`, deleted dead `Header`/`Sidebar`/`PdfViewer`.
- [x] Design-system foundation in `globals.css` (4 themes) + Newsreader/Inter/IBM Plex Mono fonts.
- [x] MCP config fix (Kiro `disabled: true`; Claude `.mcp.json` emptied + `.mcp.json.example`).
- [x] Multi-agent coordination scaffolding (`docs/ai-*.md`, AGENTS.md protocol).
