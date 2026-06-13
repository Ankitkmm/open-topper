# Migration Execution Checklist

> Release-captain checklist. Do not cut over DNS until all preview gates pass.
> Last updated: 2026-06-14 · By: Codex

## Part A: Cloudflare Workers/OpenNext Migration

### Current target

- Runtime: Cloudflare Workers via `@opennextjs/cloudflare`.
- Config: `open-next.config.ts` + `wrangler.jsonc`.
- Compatibility: `nodejs_compat` enabled.
- Large app datasets: private R2 runtime-data, not Worker bundle.
- Current Vercel deployment remains rollback until Cloudflare preview is boring.

### Already implemented locally

- OpenNext dev dependency and npm scripts:
  - `cf:prepare-data`
  - `cf:upload-data:preview`
  - `cf:upload-data:prod`
  - `cf:build`
  - `cf:preview`
  - `cf:deploy`
- R2 runtime-data prep/upload scripts under `scripts/cloudflare/`.
- `.open-next/`, `.cloudflare-runtime-data/`, and `.wrangler/` ignored.
- PDF answer-source loader supports async R2 runtime-data with local-file fallback.
- `/api/feedback` writes through Supabase HTTP/RLS instead of direct `pg`.
- `/about` edge-runtime probe removed because OpenNext handles Worker deployment. `src/middleware.ts` is used as a Cloudflare/OpenNext compatibility exception even though Next 16 recommends `proxy.ts`; OpenNext currently rejects Node proxy output.

### Remaining blockers

| Area | Status | Next action |
|---|---|---|
| `/api/search` + subject/detail data | Still uses sync `fs` loaders through `official-pyqs.ts`, `question-bank-runtime.ts`, and related modules | Convert to async runtime-data loaders backed by R2 shards |
| Legacy public data loaders | `data.ts`, `question-bank.ts`, `canonical-syllabus.ts`, `search-spine.ts`, `vault.ts`, `search-status.ts` still use Node `fs` | Keep Node-only if not in Worker route, or migrate as each route needs it |
| Direct `pg` | Still present in `src/lib/db.ts` for rate-limit optional path/offline compatibility | Keep off hot Worker routes; later replace rate-limit persistence with Cloudflare KV/D1/DO if needed |
| Runtime data upload | Requires Cloudflare account + R2 buckets | Create buckets and upload preview data before `wrangler dev/deploy` |
| DNS cutover | Not attempted | Cut over only after preview smoke tests pass |

### Cloudflare setup

Create buckets:

```bash
npx wrangler r2 bucket create upscat-opennext-cache
npx wrangler r2 bucket create upscat-opennext-cache-preview
npx wrangler r2 bucket create upscat-runtime-data
npx wrangler r2 bucket create upscat-runtime-data-preview
```

Preview flow:

```bash
npm run cf:prepare-data
npm run cf:upload-data:preview
npm run cf:preview
```

Production flow after preview passes:

```bash
npm run cf:prepare-data
npm run cf:upload-data:prod
npm run cf:build
npm run cf:deploy
```

### Cloudflare smoke tests

- `/`
- `/browse`
- `/gs1`, `/gs2`, `/gs3`, `/gs4`, `/essay`
- all `/optional/*` pages
- `/api/search?q=goverment&dataset=official&subject=public-administration`
- feedback submit
- progress API unauth/auth states
- PDF open through the in-app `View PDF` button flow

## Part B: Supabase Mumbai Migration

### Decision

Use a fresh Supabase project in Mumbai (`ap-south-1`) and keep the old project as rollback for at least 7 days. Do not delete the old project during cutover.

### Required env vars

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` only if future admin/server-only tasks require it
- `DATABASE_URL` only for optional durable rate limiting / Node fallback paths

### Required migrations

- `supabase/migrations/20260605_user_progress.sql`
- `supabase/migrations/20260615_feedback.sql`

### Cutover steps

1. Create Mumbai Supabase project.
2. Apply both migrations.
3. Configure email/password auth and site URL `https://upscat.click`.
4. Update deployment env vars.
5. Redeploy Vercel/current production first if Cloudflare is not ready.
6. Verify feedback, progress API, auth, and public browsing.
7. Keep old project untouched for 7+ days.
