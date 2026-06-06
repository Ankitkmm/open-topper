# Latest handoff

> The single most important file. The next agent (any tool) continues from here.
> Overwrite the sections below after each meaningful chunk of work.

Last updated: 2026-06-06 · By: Codex

## Summary

Implemented the search relevance ordering fix across both public search stacks:

1. **Official PYQ search**
   - Top-level official search is now relevance-first instead of letting shallow score ties fall through to year ordering too often.
   - Strong/exact question-text matches get explicit priority over syllabus/keyword-only hits.
   - Relevant-answer grouping now ranks each grouped question by its strongest link, not by whichever raw link happened to appear first.

2. **Workspace/question search**
   - Removed `topperCount` from the primary text relevance score in both runtime and non-runtime workspace search.
   - `topperCount` now acts only as a secondary tiebreak after textual relevance, so broader metadata matches no longer outrank exact question hits just because they have more linked copies.

3. **Regression coverage**
   - Added lightweight `node --import tsx --test` tests for official ranking, grouped relevant-question ordering, workspace relevance-first ranking, tie behavior, and runtime/non-runtime parity.

## Files changed by this pass

- `src/lib/official-pyqs.ts`
- `src/lib/question-bank-runtime.ts`
- `src/lib/question-bank.ts`
- `src/lib/__tests__/official-pyqs-ranking.test.ts`
- `src/lib/__tests__/workspace-ranking.test.ts`
- `docs/ai-decisions.md`
- `docs/ai-handoff.md`

## Verification

- `node --import tsx --test src/lib/__tests__/official-pyqs-ranking.test.ts src/lib/__tests__/workspace-ranking.test.ts`
- `npm run lint`
- `npx tsc --noEmit --pretty false`
- `npm run build`
- smoke queries via local server:
  - `GET /api/search?dataset=official&q=carbon+capture+utilization+storage&subject=gs3` returns the CCUS PYQ first
  - `GET /api/search?dataset=workspace&q=westphalia+nation+states+international+law&subject=gs2` returns the Westphalia question first

## Decisions

- Public `/api/search` ranking is now explicitly relevance-first across official and workspace stacks.
- Topper copy count and recency remain useful, but only as tiebreakers after text relevance.

## Blockers / remaining work

- None at the code level.
- Do not stage unrelated untracked local artifacts in the repo root.

## Exact next step

Stage only the ranking-fix files plus docs updates, commit on `main`, and push to `origin/main`.
