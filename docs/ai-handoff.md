# Latest handoff

> The single most important file. The next agent (any tool) continues from here.
> Overwrite the sections below after each meaningful chunk of work.

Last updated: 2026-06-05 · By: Codex

## Summary

Completed the second-pass hardening/product pass requested after the earlier lazy-PDF/progress work:

- **Auth/session stack migrated to native Supabase SSR.** The app now uses `@supabase/ssr` browser/server helpers plus `src/proxy.ts` to refresh sessions. NextAuth has been removed from the main auth path.
- **Auth routes switched to app-owned Supabase routes.** Added `/api/auth/login`, `/api/auth/register`, and `/api/auth/logout`; `/account` is now a Supabase-native email/password entry point.
- **Progress sync is now RLS-only by design.** `/api/progress` uses the signed-in Supabase user session, not a service-role key.
- **PDF source hardening completed.** Runtime answer-source data is now **R2-only**. Non-R2 direct PDF URLs are quarantined at build time and no longer ship in `data/pdf-runtime/answer-sources.json`.
- **Viewer no longer exposes raw public R2 URLs in the client flow.** `/pdf/[answerId]` now loads the document via the internal proxied file route instead of handing the client a raw R2 object URL.
- **Scraping surface reduced.** `/api/questions*`, `/api/answers*`, and `/api/internal/*` are auth-gated when Supabase auth is configured; the duplicate-review route no longer returns `source_drive_id`.
- **Legal/product copy cleaned up.** Removed pricing/waitlist/future-paid language from public pages and replaced it with educational-use / no-commercial-interest / rights-holder / takedown messaging.
- **Dark purple theme fixed.** `amethyst` is now an actual dark theme, not a light variant.
- **Public-to-gated transition copy improved.** Browse/landing/subject pages now state that PYQ discovery is public while copies/summaries/PDFs require sign-in.

## Files changed by this pass

Primary new files:

- `src/utils/supabase/schema.ts`
- `src/utils/supabase/client.ts`
- `src/utils/supabase/server.ts`
- `src/utils/supabase/middleware.ts`
- `src/proxy.ts`
- `src/app/api/auth/login/route.ts`
- `src/app/api/auth/logout/route.ts`

Primary edited files:

- `src/app/layout.tsx`
- `src/components/auth/UserDataProvider.tsx`
- `src/components/auth/AuthControls.tsx`
- `src/components/auth/AccountPanel.tsx`
- `src/app/api/auth/register/route.ts`
- `src/app/api/progress/route.ts`
- `src/lib/session-access.ts`
- `src/lib/env.ts`
- `src/lib/answer-sources.ts`
- `src/lib/pdf-access.ts`
- `src/components/PdfViewerPage.tsx`
- `src/app/pdf/[answerId]/page.tsx`
- `scripts/build-pyq-app-data.js`
- `src/app/api/questions/route.ts`
- `src/app/api/questions/[questionId]/route.ts`
- `src/app/api/answers/[answerId]/route.ts`
- `src/app/api/internal/duplicate-review/route.ts`
- `src/app/api/internal/search-status/route.ts`
- `src/components/OfficialQuestionCards.tsx`
- `src/components/OfficialSubjectWorkspace.tsx`
- `src/components/SubjectWorkspace.tsx`
- `src/components/SubjectProgress.tsx`
- `src/components/StudyNav.tsx`
- `src/app/page.tsx`
- `src/app/globals.css`
- `src/app/about/page.tsx`
- `src/app/privacy/page.tsx`
- `src/app/terms/page.tsx`
- `src/lib/marketing.ts`
- `next.config.ts`
- `.env.example`
- regenerated: `data/app/answer-sources.json`, `data/app/public-pyqs.json`, `data/app/topper-answer-canonical.json`, `data/app/public-official-pyq-links.json`, `data/app/workspace-index.json`, `data/pdf-runtime/*`

Removed:

- `src/auth.ts`
- `src/app/api/auth/[...nextauth]/route.ts`
- `src/types/next-auth.d.ts`
- `src/lib/supabase.ts`
- `src/lib/supabase-auth.ts`

## Verification

- `node scripts/build-pyq-app-data.js` → success.
- `npx tsx scripts/build-official-pyq-links.ts` → success.
- `npx tsx scripts/build-workspace-index.ts` → success.
- `node scripts/sync-pdf-runtime-data.js` → success.
- `npx tsc --noEmit --pretty false` → clean.
- `npm run lint` → clean.
- `npm run build` → clean.
- HTTP smoke on `http://localhost:3002` after restart:
  - `/browse?q=federalism` includes the new sign-in disclosure and `Open PYQ` CTA.
  - `/gs2?question=official_gs2_2025_14` includes the new sign-in disclosure.
  - `/account` renders the Supabase-native account page.
  - unauthenticated requests now return `401` for:
    - `/api/official-questions/[questionId]`
    - `/api/workspace-questions/[questionId]`
    - `/api/progress`
    - `/api/answer-source`
    - `/api/questions/[questionId]`
    - `/api/answers/[answerId]`
    - `/api/internal/duplicate-review`
    - `/api/internal/search-status`
  - `data/pdf-runtime/answer-sources.json` now has **0 non-R2 URLs**.
- QA swarm results captured:
  - UI/UX reviewer flagged gated-flow messaging, dark-purple contrast, signed-in account discoverability, and PDF UX gaps.
  - Aspirant reviewer flagged late gate disclosure and browse jargon.
  - Security reviewer flagged raw public-R2 exposure and internal/public scrape endpoints; these were addressed in this pass except local workspace secret presence.

## Decisions

- Native Supabase SSR is now the auth/session source of truth. Do not reintroduce NextAuth unless there is a compelling product reason.
- Public browsing stays open, but detail payloads, summaries, PDFs, progress, and internal review endpoints are gated behind authenticated Supabase sessions whenever auth env is present.
- Viewer PDF fetching is now proxied through the app so the client flow does not expose raw object URLs.
- Runtime PDF datasets must stay R2-only; external direct-PDF sources are treated as unavailable until uploaded/mapped into R2.

## Blockers / remaining work

- **Local/hosted Supabase auth testing is only partial.** Supabase returned `email rate limit exceeded` while testing sign-up, so a full end-to-end authenticated browser verification still needs either:
  - a pre-existing test account, or
  - waiting for rate limits/reset / using a different address under your control.
- **Workspace-local secrets still exist in `.env.local`.** They are ignored by git, but the security reviewer correctly flagged that anyone with local filesystem access can read them. If these were shared broadly, rotate them.
- **Auth on production still depends on deployment envs.** The repo now expects:
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
  - plus existing non-public envs already used by the app.
- **Progress table migration still must exist in the real Supabase project.** Ensure `supabase/migrations/20260605_user_progress.sql` has been applied on the production project.

## Exact next step

Log in with a real Supabase-backed test account on `http://localhost:3002/account`, verify `/api/progress` sync plus gated topper/PDF flow end-to-end, then stage the intended files, commit, and push to the deployment branch/remote that serves `upscat.click`.
