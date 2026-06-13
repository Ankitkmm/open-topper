# Cloudflare OpenNext Migration Runbook

> Current target: Cloudflare Workers via `@opennextjs/cloudflare`, not legacy `@cloudflare/next-on-pages`.

## Current status

- OpenNext config is in `open-next.config.ts`.
- Worker config is in `wrangler.jsonc`.
- `nodejs_compat` is enabled for crypto/Buffer compatibility.
- OpenNext incremental cache uses R2 binding `NEXT_INC_CACHE_R2_BUCKET`.
- UPSCat app runtime data uses R2 binding `UPSCAT_RUNTIME_DATA` with prefix `UPSCAT_RUNTIME_DATA_PREFIX`.
- PDF answer-source data is on the new async runtime-data abstraction with local-file fallback.
- Large search/study datasets are prepared as R2 shards, but some app loaders still need async migration before full Cloudflare cutover.

## One-time Cloudflare setup

Create these buckets before preview/deploy:

```bash
npx wrangler r2 bucket create upscat-opennext-cache
npx wrangler r2 bucket create upscat-opennext-cache-preview
npx wrangler r2 bucket create upscat-runtime-data
npx wrangler r2 bucket create upscat-runtime-data-preview
```

Authenticate using `wrangler login` locally, or set a scoped `CLOUDFLARE_API_TOKEN` in CI. Token needs Workers edit, R2 edit, Account read, and DNS edit only for final cutover.

## Runtime data flow

Do not bundle the large JSON files into the Worker. Current generated runtime data is hundreds of MB and must stay in R2.

```bash
npm run cf:prepare-data
npm run cf:upload-data:preview
```

For production upload after preview passes:

```bash
npm run cf:upload-data:prod
```

The upload path must match `UPSCAT_RUNTIME_DATA_PREFIX` in `wrangler.jsonc` (`runtime/v1` by default). Private datasets such as `answer-sources` and `pdf-r2-map` stay in private R2 buckets and must never be copied to `public/`.

## Preview sequence

```bash
npm run cf:prepare-data
npm run cf:upload-data:preview
npm run cf:preview
```

`cf:preview` runs `cf:build` first, which syncs PDF runtime data, prepares runtime shards, and builds the OpenNext Worker. `cf:build` intentionally blanks `DATABASE_URL` so direct Postgres is not bundled into the Worker; runtime writes use Supabase HTTP/RLS or in-memory fallback paths.

## Deploy sequence

```bash
npm run cf:prepare-data
npm run cf:upload-data:prod
npm run cf:build
npm run cf:deploy
```

Do not point DNS at Cloudflare until preview smoke tests pass.

## Remaining blockers before cutover

- Convert `/api/search` and subject/detail loaders from synchronous `fs` reads to async runtime-data/R2 reads.
- Keep direct `pg` limited to Node/offline paths; `cf:build` blanks `DATABASE_URL` and disables the `pg` workerd socket condition so Worker runtime uses Supabase HTTP clients or in-memory fallback paths.
- Verify PDF open flow through the app button on Cloudflare preview.
- Run smoke tests against preview and compare with Vercel production.
