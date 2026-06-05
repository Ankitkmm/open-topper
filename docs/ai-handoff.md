# Latest handoff

> The single most important file. The next agent (any tool) continues from here.
> Overwrite the sections below after each meaningful chunk of work.

Last updated: 2026-06-05 · By: Codex

## Summary

The Supabase SSR auth + PDF hardening pass is now **pushed to `origin/main`**.

This includes:

- **Native Supabase SSR auth/session handling** via `@supabase/ssr` helpers plus `src/proxy.ts`; NextAuth is removed from the main auth path.
- **Supabase-native account routes**: `/api/auth/login`, `/api/auth/register`, `/api/auth/logout`, with `/account` as the email/password entry page.
- **RLS-only progress sync** through `/api/progress` using the signed-in Supabase user session.
- **R2-only runtime PDF/source data**. Non-R2 direct PDF URLs are quarantined at build time and no longer ship in `data/pdf-runtime/answer-sources.json`.
- **Viewer flow hardening** so `/pdf/[answerId]` no longer exposes raw public object URLs in the main client flow.
- **Reduced scrape surface** by auth-gating scrape-heavy detail/internal APIs when Supabase auth is configured and removing `source_drive_id` from duplicate-review output.
- **Public legal/product cleanup**: no pricing/commercial positioning; educational-use / no-commercial-interest / rights-holder / takedown messaging added.
- **Dark purple theme fix**: `amethyst` is now a proper dark theme.
- **Public-to-gated messaging improvement** on landing/browse/subject pages so users know PYQ discovery is public while copies/summaries/PDFs require sign-in.

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

Earlier full verification already passed:

- `node scripts/build-pyq-app-data.js`
- `npx tsx scripts/build-official-pyq-links.ts`
- `npx tsx scripts/build-workspace-index.ts`
- `node scripts/sync-pdf-runtime-data.js`
- `npx tsc --noEmit --pretty false`
- `npm run lint`
- `npm run build`

Additional final smoke test on 2026-06-05 after restarting `next dev` on **http://localhost:3002**:

- `GET /` → `200`
- `GET /browse?q=federalism` → `200`, includes `Open PYQ` and the sign-in disclosure.
- `GET /account` → `200`, shows the create-account / sign-in UI.
- unauthenticated requests return `401` for:
  - `/api/progress`
  - `/api/official-questions/official_gs2_2025_14`
  - `/api/questions/official_gs2_2025_14`
  - `/api/answers/topper_answer_1`
  - `POST /api/answer-source`
- `data/pdf-runtime/answer-sources.json` currently contains **31,426** runtime sources and **0 non-R2 URLs**.

## Decisions

- Native Supabase SSR remains the auth/session source of truth.
- Public browsing stays open, but detail payloads, summaries, PDFs, progress, and internal review endpoints stay gated behind authenticated Supabase sessions whenever auth env is present.
- Viewer PDF fetching stays app-proxied so raw object URLs are not the main user-visible flow.
- Runtime PDF datasets must remain R2-only; external direct-PDF sources are treated as unavailable until uploaded/mapped into R2.

## Blockers / remaining work

- **Production still needs the hosted Supabase env vars set** so the deployed site can actually enforce/authenticate with the new flow:
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- **The Supabase progress table migration must exist in the real project**: `supabase/migrations/20260605_user_progress.sql`.
- **Authenticated browser QA is still partial** because no dedicated test account credentials were available here and prior sign-up attempts hit a Supabase email rate limit.
- **Workspace-local secrets still exist in `.env.local`**. They are not committed, but if they were shared widely they should be rotated.
- Optional follow-up polish still open:
  - resume intended gated action after sign-in
  - forgot-password / resend-verification flows
  - remove the placeholder blank-tab pattern before PDF open if popup-safe behavior can be preserved

## Exact next step

Confirm the deployment target for `upscat.click` has the new Supabase env vars plus the progress migration applied, then do one live authenticated verification pass on production (`/account`, gated topper expand, `/api/progress`, and `/pdf/[answerId]`).
