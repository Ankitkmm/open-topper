# OpenUPSC Current Context

Updated: 2026-06-01

## Goal
Build a calm UPSC study/search website for aspirants, not a tech dashboard.

Core flow:
`landing/dashboard -> subject page -> PYQ list -> click PYQ -> reveal topper copies -> Summary or View PDF`.

The UI should feel like a spacious library/study room: soft, readable, low-clutter, useful for long sessions.

## Current Product Direction
- Position as a UPSC PYQ search engine / aggregator.
- Landing page should be long, spacious, and subject-first.
- Multiple themes are required.
- Show progress: done PYQs now in localStorage; later Google auth + database.
- Future personalization: solved count, daily frequency, GitHub-style heatmap, bookmarks, notes, streaks.
- Footer/disclaimer: OpenUPSC references publicly available topper-copy material for educational discovery; it does not claim ownership; valid takedown requests will be honored.

## Security Model
Do not put raw source files, raw OCR dumps, or PDF URLs in `public/`.

Current safer split:
- Public/safe app data: `data/app/pyqs.json`, `data/app/vault/*.json`
- Private/server-only PDF map: `data/app/answer-sources.json`
- Ignored raw/private data: `public/data/`, `vault_merged_docs/`, `extracted_data/`, `data/mappings/`, `data/app/questions.json`, `data/app/ocr-summaries.json`, `data/app/pdf-map.json`, `data/app/pdf-r2-map.json`, `data/app/answer-sources.json`

PDF access:
- Client only receives an `answerId`.
- `POST /api/answer-source` maps `answerId -> embedUrl/page` server-side.
- API uses `private, no-store`, noindex headers, and same-origin origin/referer check.
- This is only a basic layer. Real production security needs auth, rate limits, private R2/S3, short-lived signed URLs, audit logs, and ideally a same-origin PDF proxy/viewer.
- Browser/Drive PDF toolbars cannot be truly controlled. Google Drive may still show download controls if preview fails. Prefer R2 URLs when available.

## Important Files
- `src/app/page.tsx` - soft library landing page, YouTube background, subject cards, disclaimer.
- `src/components/SubjectWorkspace.tsx` - progressive PYQ -> topper copies -> summary/PDF UI.
- `src/components/ThemeProvider.tsx` - Library/Sage/Sepia/Night theme switcher.
- `src/components/ProgressToggle.tsx` - local mark-done button.
- `src/components/SubjectProgress.tsx` - local progress meter.
- `src/app/api/answer-source/route.ts` - private PDF embed lookup.
- `src/lib/pyq.ts` - loads safe PYQ data and related vault snippets.
- `scripts/build-pyq-app-data.js` - builds safe `pyqs.json` plus private `answer-sources.json`.
- `next.config.ts` - security headers, noindex, CSP, `/data` redirect.

## Data Build
Run after mapping changes:
```bash
npm run build-pyqs
```

This creates:
- `data/app/pyqs.json` safe client data with `answerId`, safe topper metadata, summaries/value additions.
- `data/app/answer-sources.json` private server map with real PDF URLs and page numbers.

R2 is preferred over Google Drive when `data/app/pdf-r2-map.json` has a matching Drive ID.

## Verification Commands
```bash
npm run lint
npx tsc --noEmit
npm run build
```

Recent status: all passed after the soft-library redesign and PDF viewer restoration.

## Known Gaps / Next Best Work
- Add real Google auth and DB. Recommended: Supabase Auth + Postgres + RLS.
- Suggested tables: `profiles`, `question_progress`, `daily_activity`, `bookmarks`, `notes`, `answer_views`, `takedown_requests`, `topper_uploads`.
- Move PDFs to private R2/S3 and generate short-lived signed URLs.
- Add rate limiting to `/api/answer-source`.
- Build proper same-origin PDF viewer/proxy if hiding browser/Drive controls matters.
- Add upload/review flow for toppers later.
- The browse/vault pages may still use older styling; main journey has been redesigned first.

## UX Rules To Preserve
- Do not dump all topper text on the page.
- Do not show “not extracted” placeholders.
- Summaries should be our interpretation: intro strategy, value additions, remarks/patterns.
- Raw OCR/extracted answer text should not be exposed as page content.
- Topper copies should reveal only after user clicks.
- PDF viewer should open only after user clicks `View PDF`.
- Keep `Load more`.
- Keep questions visually distinct and keyword-highlighted.
- Design for aspirants studying for hours: calm spacing, readable fonts, soft controls.
