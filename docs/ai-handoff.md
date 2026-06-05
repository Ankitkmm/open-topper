# Latest handoff

> The single most important file. The next agent (any tool) continues from here.
> Overwrite the sections below after each meaningful chunk of work.

Last updated: 2026-06-05 · By: Codex

## Summary

Fixed the Vercel/CI build failure caused by `scripts/sync-pdf-runtime-data.js` requiring the private ignored source file `data/app/pdf-r2-map.json`.

The sync script now:

- copies from `data/app/*` when the private source file exists locally
- falls back to the committed `data/pdf-runtime/*` artifact when that private source is absent in CI/deploy
- still fails loudly if neither source nor committed runtime fallback exists

This preserves the local data-refresh workflow while allowing deploy builds to succeed with the checked-in runtime artifact set.

## Files changed by this pass

- `scripts/sync-pdf-runtime-data.js`
- `docs/ai-decisions.md`
- `docs/ai-handoff.md`

## Verification

- Simulated the deploy failure by temporarily removing `data/app/pdf-r2-map.json`; `node scripts/sync-pdf-runtime-data.js` now logs a fallback warning and succeeds using `data/pdf-runtime/pdf-r2-map.json`.
- `npm run build` now completes successfully locally after the script change.

## Decisions

- Keep private `data/app/*` runtime sources ignored/untracked.
- Treat committed `data/pdf-runtime/*` as the deploy-safe fallback artifact set for CI/Vercel builds.

## Blockers / remaining work

- Redeploy/trigger a fresh Vercel build to confirm the same missing-source scenario is fixed in the hosted environment.
- The broader Supabase production env + migration work from the previous pass is still pending.

## Exact next step

Trigger a fresh Vercel deployment and confirm `npm run build` no longer fails when `data/app/pdf-r2-map.json` is absent from the deploy context.
