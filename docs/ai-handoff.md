# Latest handoff

> The single most important file. The next agent (any tool) continues from here.
> Overwrite the sections below after each meaningful chunk of work.

Last updated: 2026-06-06 · By: Codex

## Summary

Implemented two product changes on top of the pending PDF viewer work:

1. **Temporary global auth-off mode for QA**
   - Added a shared auth-availability helper that currently forces auth unavailable even when Supabase env vars are present.
   - Public detail/PDF flows no longer require sign-in.
   - PDF token verification, same-origin checks, rate limiting, and answer-id validation were left intact.
   - Auth UI now disappears automatically, and `/account` shows QA-disabled messaging instead of sign-in copy.

2. **Landing-page stat relabel**
   - Changed the hero stat from `958 questions` to `958 keywords`.
   - The `958` value is still derived from the existing official PYQ count; only the label changed.

The previously pending scrollable PDF viewer work is still part of the local tracked diff and remains included.

## Files changed by this pass

- `src/lib/auth-availability.ts`
- `src/lib/session-access.ts`
- `src/components/auth/UserDataProvider.tsx`
- `src/app/page.tsx`
- `src/app/account/page.tsx`
- `src/components/auth/AccountPanel.tsx`
- `src/components/OfficialQuestionCards.tsx`
- `src/app/api/auth/login/route.ts`
- `src/app/api/auth/register/route.ts`
- `src/lib/official-pyqs.ts`
- `src/components/PdfViewerPage.tsx`
- `docs/ai-decisions.md`
- `docs/ai-handoff.md`

## Verification

- `npm run lint`
- `npx tsc --noEmit --pretty false` *(passes after a build; before build, local `.next/types/validator.ts` briefly complained about missing `./routes.js`)*
- `npm run build`
- local dev smoke checks via `curl`:
  - `/` shows `keywords`
  - `/account` shows QA-disabled text
  - `POST /api/answer-source` returns a viewer token without sign-in
  - `GET /api/workspace-questions/[questionId]` returns `200` without sign-in
  - tokenized `/pdf/[answerId]?token=...` renders the PDF viewer page
  - raw `/pdf/[answerId]` without token still fails with `Invalid token.`

## Decisions

- QA auth disable is code-controlled and centralized, not env-unset only.
- Public QA mode should keep PDF security controls except for session gating.
- The landing hero keeps the derived `958` number and only relabels it to `keywords`.

## Blockers / remaining work

- None at the code level.
- Local tracked changes still need to be staged, committed, and pushed to `origin/main`.
- Do not include unrelated untracked local artifacts when staging.

## Exact next step

Stage only the intended tracked files, commit the QA-auth + landing-stat + PDF-viewer changes on `main`, and push to `origin/main`.
