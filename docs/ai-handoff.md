# Latest handoff

> The single most important file. The next agent (any tool) continues from here.
> Overwrite the sections below after each meaningful chunk of work.

Last updated: 2026-06-06 · By: Codex

## Summary

Diagnosed and fixed the Vercel deploy blocker for commit `2f315c8` (`Refactor public shells for Vercel free`).

Root cause was **function tracing bloat**, not the local folder move:

- `/api/search` traced ~**1.5 GB**
- `/api/workspace-questions/[questionId]` traced ~**1.48 GB**
- official/page shells also traced the vault/raw-ingest graph

Main fixes shipped locally:

- Split public runtime reads away from heavy build/search modules.
- Added a lightweight `question-bank-runtime` module that only reads `data/app/workspace-index.json`.
- Stopped public page/shell entrypoints from importing `pyq.ts` / `db-search.ts` transitively.
- Removed db-backed/semantic fallback from deployed `/api/search`; public shell search is now lightweight lexical search over the prebuilt shell datasets.
- Kept current public URLs and public shell UX intact.

Post-fix local trace sizes are now:

- `/api/search` → **135.2 MB**
- `/api/workspace-questions/[questionId]` → **96.2 MB**
- `/api/official-questions/[questionId]` → **41.2 MB**
- `/` and `/browse` shell traces → **~135.5 MB**

This is below Vercel’s 250 MB unzipped function limit.

## Files changed by this pass

- `scripts/build-workspace-index.ts`
- `src/app/api/search/route.ts`
- `src/app/api/workspace-questions/[questionId]/route.ts`
- `src/app/page.tsx`
- `src/app/essay/page.tsx`
- `src/app/gs1/page.tsx`
- `src/app/gs2/page.tsx`
- `src/app/gs3/page.tsx`
- `src/app/gs4/page.tsx`
- `src/app/optional/anthropology/page.tsx`
- `src/app/optional/geography/page.tsx`
- `src/app/optional/history/page.tsx`
- `src/app/optional/psir/page.tsx`
- `src/app/optional/public-administration/page.tsx`
- `src/app/optional/sociology/page.tsx`
- `src/components/OfficialSubjectPageClient.tsx`
- `src/components/OfficialSubjectWorkspace.tsx`
- `src/components/QuestionCards.tsx`
- `src/components/SubjectWorkspace.tsx`
- `src/lib/official-pyqs.ts`
- `src/lib/shell-search.ts`
- `src/lib/static-shell-data.ts`
- `src/lib/build-workspace-index.ts`
- `src/lib/question-bank-runtime.ts`
- `src/lib/study-page-data.ts`
- `docs/ai-decisions.md`
- `docs/ai-handoff.md`

## Verification

- `npx tsc --noEmit --pretty false`
- `npm run build`
- inspected `.next/server/app/**/*.nft.json` traced sizes after build
- confirmed the oversized routes dropped from ~1.5 GB traces to 41–135 MB traces

## Decisions

- Public shell search now prioritizes deployability over semantic ranking on the hosted free-tier path.
- Runtime loaders must stay separate from raw rebuild/search modules to keep Vercel function bundles bounded.

## Blockers / remaining work

- Local fix is complete, but it still must be committed/pushed so Vercel can redeploy `main`.
- After push, Vercel production should be rechecked once the new deployment finishes.

## Exact next step

Commit and push this trace-size fix to `main`, wait for Vercel to redeploy, then confirm `upscat.click` is serving the new build instead of the old `20e0632` production deploy.
