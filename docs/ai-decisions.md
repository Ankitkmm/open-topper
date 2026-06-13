# Decisions

> Append-only log of decisions that affect architecture, design, or workflow.
> Newest at the bottom. Include a date and a one-line rationale.

- 2026-06-05: Use shared repo files (`docs/ai-*.md`) as the source of truth across AI tools.
- 2026-06-05: Every agent must update `docs/ai-handoff.md` after meaningful work.
- 2026-06-05: One agent edits a given file at a time; use small commits; Git is the sync layer.
- 2026-06-05: Architectural decisions go here in `docs/ai-decisions.md`, not buried in chat.
- 2026-06-05: Frontend uses a single token-based design system in `src/app/globals.css`
  (4 themes via `data-theme`). Components consume semantic classes/CSS variables — no hardcoded
  hex colors. Typography: Newsreader (serif headings) + Inter (body) + IBM Plex Mono (stats).
- 2026-06-05: MCP servers use identical names across Kiro and Claude Code (`github`, `linear`).
  Placeholder endpoints are checked in disabled/unconfigured; replace with real URLs before use.
- 2026-06-05: MCP placeholders must not be active. Kiro (`.kiro/settings/mcp.json`) keeps servers
  with `disabled: true` + `autoApprove: []`. Claude Code's live `.mcp.json` ships empty; the
  four-server template lives in `.mcp.json.example` (copy → `.mcp.json` once real URLs exist).
- 2026-06-05: Product scope narrowed to a pure study space. Removed Pricing, Hiring, Analytics,
  and waitlist/Plus surfaces. Marketing config (`marketing.ts`) keeps only site identity + About/
  Privacy/Terms footer links.
- 2026-06-05: One unified navigation component (`StudyNav`) is used on every page. Do not reintroduce
  per-page bespoke headers.
- 2026-06-05: Topper-copy PDFs open in a NEW TAB (not an inline panel) so the question list keeps
  full reading width. `PdfViewer.tsx` removed.
- 2026-06-05: Missing topper names are handled in the UI via `normalizePublicTopperName()` → render
  "Topper copy". The data gap itself is a backend/ingestion concern (owned by Codex).
- 2026-06-05: Frontend (Kiro/Claude) and backend/data (Codex) are split. UI work must not change
  data pipelines, `/api/*`, or `lib/` data loaders without noting it here.
- 2026-06-05: Google NextAuth is env-gated for now (`AUTH_GOOGLE_ID` + `AUTH_GOOGLE_SECRET`); progress remains localStorage-only and scoped by normalized email, with no DB added.
- 2026-06-05: Public GS/Essay browsing uses official PYQs as the parent entity; extracted topper-answer questions are nested as relevant matches under each PYQ.
- 2026-06-05: Server-side local Transformers embedding fallback is opt-in (`ENABLE_LOCAL_EMBEDDINGS=true`) to avoid request-time model cold starts and unpaid API dependency surprises.
- 2026-06-05: Progress UI is simplified to a single `Done` state and aggregated as overall progress; notes/copy-level visible progress controls are deferred.
- 2026-06-05: Subject/optional detail payloads are lazy-loaded via per-question APIs so subject pages ship shells first and fetch topper details on expand/deep-link.
- 2026-06-05: PDF opening now resolves to a dedicated `/pdf/[answerId]` pdf.js viewer route; `/api/answer-source` issues short-lived viewer URLs instead of exposing the proxy URL as the visible tab.
- 2026-06-05: Email/password auth and progress sync are env-gated around Supabase. If Supabase env/migration is absent, public browsing still works and progress falls back to local-only behavior.
- 2026-06-05: Auth/session handling now uses native Supabase SSR (`@supabase/ssr` + `proxy.ts`) instead of NextAuth; gated content and progress sync rely on user-session auth with RLS.
- 2026-06-05: Runtime PDF/source datasets are hardened to R2-only URLs. Non-R2 direct PDF sources are quarantined at build time and are not exposed to the viewer.
- 2026-06-05: Unused/internal content APIs (`/api/questions*`, `/api/answers*`, `/api/internal/*`) are auth-gated when Supabase auth is configured to reduce scrapeable surface.
- 2026-06-05: `scripts/sync-pdf-runtime-data.js` must fall back to committed `data/pdf-runtime/*` files when private `data/app/*` runtime sources are absent in CI/deploy builds (for example Vercel with ignored private files).
- 2026-06-06: Public browse/study routes are prerendered as static shells; query-driven result loading moved to client-side `/api/search` fetches so the app fits Vercel free-tier function limits without changing user-facing URLs.
- 2026-06-06: Auth/session refresh no longer runs on all requests. Proxy/middleware is restricted to account, auth, progress, PDF token, and PDF viewer routes, and skips Supabase refresh entirely when auth cookies are absent.
- 2026-06-06: Unused public/internal APIs were deleted from deployment (`/api/questions*`, `/api/answers/[answerId]`, `/api/internal/*`, `/api/subjects/*/syllabus`, `/api/themes`, `/api/summary`, `/api/vault/search`) to keep the server entrypoint count within Vercel free-tier limits.
- 2026-06-06: Public shell/runtime loaders were split from heavy search/build modules so Vercel functions trace only `workspace-index.json` and public official-link data instead of the full vault/raw-ingest dataset.
- 2026-06-06: Deployed `/api/search` now uses lightweight lexical shell search for public browse/study shells; semantic/vault-backed fallback was removed from the deployed path to stay under Vercel’s 250 MB function limit.
- 2026-06-06: The dedicated `/pdf/[answerId]` viewer now uses a constrained internal scroll container with desktop book spreads, mobile single-column fallback, bounded lazy page rendering, and 75%–125% zoom (default 80%).
- 2026-06-06: Auth is temporarily forced off in code for QA so public detail/PDF flows stay open without sign-in while token/origin/rate-limit protections remain in place.
- 2026-06-06: Public `/api/search` ranking is relevance-first; exact/strong question-text matches outrank newer-year or higher-copy-count metadata, which now only breaks ties.
- 2026-06-06: Official subject-page syllabus filters resolve node IDs to syllabus labels and use meaningful topic-term matching instead of fuzzy slug-token matching.
- 2026-06-13: The PDF open/token issuance route (`POST /api/answer-source`) is rate-limited separately from PDF byte-stream fetches so mobile/PDF open bursts can be tuned without weakening stricter `/pdf/*` fetch protections.
- 2026-06-13: PDF runtime-data validation treats Vercel preview deployments as non-production-like so committed fallback R2 data can validate in previews while production still requires configured allowed R2 hosts.
- 2026-06-13: Feedback is implemented as a global in-app bottom-left launcher + modal, not a third-party widget, so every public page keeps the same calm product surface and users can report issues without leaving the site.
- 2026-06-13: Public feedback submissions post to a private no-store `/api/feedback` route with optional reply email, one optional image attachment, conservative rate limiting, and Resend-backed delivery to `founder@upscat.click` when `RESEND_API_KEY` is configured.
