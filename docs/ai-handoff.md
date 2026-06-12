# Latest handoff

> The single most important file. The next agent (any tool) continues from here.
> Overwrite the sections below after each meaningful chunk of work.

Last updated: 2026-06-13 20:45 IST · By: Codex

## Option B surgical production rollout

The user chose **Option B**: do not ship the whole 13-commit feature stack to production. I created a clean worktree from the current `origin/main` (`bf1faf0`) and applied only the PDF/mobile/deploy-related fixes in this commit (`Ship PDF mobile and preview deploy fixes`).

### What changed

- `/Users/ankitkumar/Downloads/open-topper-option-b-main/src/components/PdfViewerPage.tsx`
  - Mobile default zoom is now 60%; desktop default zoom is now 100%.
  - Mobile PDF canvas sizing is constrained to the viewport width.
  - Mobile hides the large PDF title/header panel and footer answer-id chrome.
  - Mobile keeps page/status badges in the compact control bar.
  - Viewer pane height is increased on mobile for less wasted vertical space.
  - Added explicit Pages selector (`Auto`, `One page`, `Two page`) and keeps user-selected zoom from being overwritten by responsive layout changes.
- `/Users/ankitkumar/Downloads/open-topper-option-b-main/src/components/OfficialSubjectWorkspace.tsx`
  - Desktop still opens PDFs in a new tab.
  - Mobile now navigates the current tab to the viewer after the token is issued, avoiding unreliable blank popup behavior on mobile browsers.
- `/Users/ankitkumar/Downloads/open-topper-option-b-main/src/app/api/answer-source/route.ts`
  - Added a separate lightweight rate limit for PDF-open/token-issuance requests (`RATE_LIMIT_ANSWER_SOURCE_MAX`, default 30/minute), without pulling in the broader cookie-token/security stack.
  - Added `Allow: POST` on the route's GET 405 response.
- `/Users/ankitkumar/Downloads/open-topper-option-b-main/src/lib/env.ts`
  - Added `getAnswerSourceRateLimitMax()` for the separate PDF-open limiter.
- `/Users/ankitkumar/Downloads/open-topper-option-b-main/scripts/sync-pdf-runtime-data.js`
  - Upgraded runtime PDF data sync to validate committed runtime fallback data and R2 URLs before build.
  - Treats Vercel preview (`VERCEL_ENV=preview` or `NEXT_PUBLIC_VERCEL_ENV=preview`) as non-production-like so preview deploys can validate the known default committed R2 host without production R2 env configuration.
- `/Users/ankitkumar/Downloads/open-topper-option-b-main/.env.example`
  - Documented the PDF/deploy knobs: `PDF_TOKEN_SECRET`, `R2_ALLOWED_PUBLIC_HOSTS`, and `RATE_LIMIT_ANSWER_SOURCE_MAX`.
- `/Users/ankitkumar/Downloads/open-topper-option-b-main/docs/ai-decisions.md`
  - Recorded the separate PDF-open limiter and preview-vs-production R2 validation behavior.

### What was intentionally NOT included

This Option B branch does **not** include the broader feature-stack changes such as OCR pipeline changes, official PYQ data rewrites, topper-name curation, optional PYQ parser changes, package audit/override changes, broad API/security hardening, or general product/data changes from `codex/release-hardening-ocr-2026-06-08`.

### Verification

All commands ran from `/Users/ankitkumar/Downloads/open-topper-option-b-main`:

- `node scripts/sync-pdf-runtime-data.js` → pass
- `npm run lint -- --no-fix` → pass
- `npx tsc --noEmit --pretty false` → pass
- `node --test --import tsx src/lib/__tests__/*.test.ts` → pass (10/10)
- `npm run build` → pass
- `git diff --check` → pass

### Files changed by this pass

- `/Users/ankitkumar/Downloads/open-topper-option-b-main/.env.example`
- `/Users/ankitkumar/Downloads/open-topper-option-b-main/scripts/sync-pdf-runtime-data.js`
- `/Users/ankitkumar/Downloads/open-topper-option-b-main/src/app/api/answer-source/route.ts`
- `/Users/ankitkumar/Downloads/open-topper-option-b-main/src/components/OfficialSubjectWorkspace.tsx`
- `/Users/ankitkumar/Downloads/open-topper-option-b-main/src/components/PdfViewerPage.tsx`
- `/Users/ankitkumar/Downloads/open-topper-option-b-main/src/lib/env.ts`
- `/Users/ankitkumar/Downloads/open-topper-option-b-main/docs/ai-decisions.md`
- `/Users/ankitkumar/Downloads/open-topper-option-b-main/docs/ai-handoff.md`

### Blockers

- None for this surgical rollout.
- Note: `npm ci` in the clean worktree reports existing dependency audit advisories from `origin/main`; I did not apply the separate package-audit/override changes because they were outside Option B's requested PDF/deploy scope.

### Exact next step

Push the current `codex/option-b-pdf-deploy-main` commit to `origin/main` (not the local accidental merge commit on `main`), then monitor the production deployment.
