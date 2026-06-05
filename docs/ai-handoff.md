# Latest handoff

> The single most important file. The next agent (any tool) continues from here.
> Overwrite the sections below after each meaningful chunk of work.

Last updated: 2026-06-06 · By: Codex

## Summary

Implemented the Vercel-free refactor to preserve current UX while cutting the server surface down to a free-tier-safe shape.

Key outcomes:

- **Public browse/study routes are now static**: `/browse`, `/essay`, `/gs1`-`/gs4`, `/optional/*`, and `/account` all prerender as static routes.
- **Server entrypoints were cut to 11 total**:
  - dynamic page: `/pdf/[answerId]`
  - APIs: `/api/search`, `/api/progress`, `/api/auth/login`, `/api/auth/register`, `/api/auth/logout`, `/api/answer-source`, `/api/answer-source/[answerId]`, `/api/official-questions/[questionId]`, `/api/workspace-questions/[questionId]`
  - proxy/middleware: `src/proxy.ts`
- **Client-side search shell loading** now powers public query/filter flows through `/api/search`, preserving current URLs and lazy detail/PDF behavior.
- **Global auth provider was removed**. Theme remains global; auth/progress context is opt-in via `AuthProviderBoundary`.
- **Auth middleware is narrowed** to account/auth/progress/PDF routes only and skips Supabase refresh when no auth cookies are present.
- **Unused APIs were deleted** to keep deployment count within the Vercel free-tier limit.

## Files changed by this pass

- `src/app/browse/page.tsx`
- `src/app/essay/page.tsx`
- `src/app/gs1/page.tsx`
- `src/app/gs2/page.tsx`
- `src/app/gs3/page.tsx`
- `src/app/gs4/page.tsx`
- `src/app/optional/*/page.tsx`
- `src/app/account/page.tsx`
- `src/app/api/search/route.ts`
- `src/proxy.ts`
- `src/utils/supabase/middleware.ts`
- `src/components/SubjectWorkspace.tsx`
- `src/components/BrowsePageClient.tsx`
- `src/components/OfficialSubjectPageClient.tsx`
- `src/components/AppShell.tsx`
- `src/components/auth/AuthProviderBoundary.tsx`
- `src/components/auth/AccountPanel.tsx`
- `src/components/auth/AuthControls.tsx`
- `src/components/auth/UserDataProvider.tsx`
- `src/lib/static-shell-data.ts`
- `src/lib/shell-search.ts`
- `src/lib/official-pyqs.ts`
- `src/lib/pyq.ts`
- `docs/ai-decisions.md`
- `docs/ai-handoff.md`

Deleted:

- `src/app/api/questions/route.ts`
- `src/app/api/questions/[questionId]/route.ts`
- `src/app/api/answers/[answerId]/route.ts`
- `src/app/api/internal/duplicate-review/route.ts`
- `src/app/api/internal/search-status/route.ts`
- `src/app/api/subjects/[subjectKey]/syllabus/route.ts`
- `src/app/api/themes/route.ts`
- `src/app/api/summary/route.ts`
- `src/app/api/vault/search/route.ts`

## Verification

- `npx tsc --noEmit --pretty false`
- targeted `eslint` on the refactored page/auth/API files
- `npm run build`

Final build output now shows:

- static pages: `/browse`, `/essay`, `/gs1`-`/gs4`, `/optional/*`, `/account`
- dynamic page: `/pdf/[answerId]`
- kept APIs only: `/api/search`, `/api/progress`, `/api/auth/*`, `/api/answer-source*`, `/api/official-questions/[questionId]`, `/api/workspace-questions/[questionId]`

That leaves **11 server entrypoints total**, which is the intended Vercel free-tier fit.

## Decisions

- Preserve current public URLs and current public/gated UX; move query-driven result loading client-side instead of changing route structure.
- Prefer static shell prerendering over reducing visible feature scope.
- Keep `/pdf/[answerId]` and the existing protected PDF flow dynamic; everything else public becomes a prerendered shell where possible.

## Blockers / remaining work

- A real Vercel deploy still needs to be triggered against the updated branch to confirm the hosted project picks up this refactor.
- Runtime smoke over a long-lived local `next start`/standalone server could not be retained in this shell environment after command exit, so verification here relies on successful build/type/lint plus route classification.
- The previously noted production Supabase env / migration setup work still applies if not already completed on the hosted project.

## Exact next step

Push this refactor to the branch Vercel deploys from, then trigger a fresh deployment and confirm the hosted build succeeds with the new 11-entrypoint route shape.
