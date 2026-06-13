# Migration Execution Checklist

> For release captain use. Do NOT execute cutover without all pre-conditions met.
> Last updated: 2026-06-14 · By: Kiro

---

## Part A: Cloudflare Workers/Pages Migration

### Current Blockers (must resolve before migration)

#### 1. Runtime `fs` usage (9 files)

All use `readFileSync`/`existsSync` to load pre-built JSON at runtime. Workers have no filesystem.

| File | APIs | Routes affected |
|------|------|-----------------|
| `src/lib/official-pyqs.ts` | `existsSync`, `readFileSync` | `/api/search`, `/api/official-questions/[questionId]`, subject pages |
| `src/lib/question-bank-runtime.ts` | `existsSync`, `readFileSync` | `/api/workspace-questions/[questionId]`, `/api/search` |
| `src/lib/canonical-syllabus.ts` | `existsSync`, `readFileSync` | Imported by `official-pyqs.ts` |
| `src/lib/answer-sources.ts` | `readFileSync` | `/api/answer-source`, `/api/answer-source/[answerId]` |
| `src/lib/data.ts` | `readFileSync` | Page server components, all subject pages |
| `src/lib/search-spine.ts` | `readFileSync` | `/api/search` |
| `src/lib/vault.ts` | `readFileSync` | Vault data loading |
| `src/lib/search-status.ts` | `readFileSync` | Search infrastructure |
| `src/lib/question-bank.ts` | `existsSync`, `readFileSync` | Study page data |

**Fix:** Replace with `import data from "../../data/app/file.json"` (static bundling). All data is deterministic at build time.

#### 2. `process.cwd()` usage (6 files)

| File | Usage |
|------|-------|
| `src/lib/paths.ts` | `APP_DATA_DIR = join(process.cwd(), "data", "app")` |
| `src/lib/official-pyqs.ts` | `PYQ_DIR`, `OFFICIAL_LINK_FILE`, `WORKSPACE_INDEX_FILE` |
| `src/lib/canonical-syllabus.ts` | `ROOT = process.cwd()` |
| `src/lib/question-bank-runtime.ts` | `WORKSPACE_INDEX_FILE` path |
| `src/lib/answer-sources.ts` | `PDF_RUNTIME_DIR` path |
| `src/lib/question-bank.ts` | `ROOT = process.cwd()` |

**Fix:** Remove entirely once `fs` is replaced with static imports.

#### 3. Node `crypto` module (3 files)

| File | APIs | Used by |
|------|------|---------|
| `src/lib/rate-limit.ts` | `createHash` | All rate-limited API routes (7 routes) |
| `src/lib/env.ts` | `createHmac`, `timingSafeEqual` | PDF token verification |
| `src/lib/pdf-access.ts` | `randomBytes` | PDF token generation |

**Fix:** Enable `nodejs_compat` flag in `wrangler.toml` (zero code changes). Or rewrite to WebCrypto API.

#### 4. `pg` driver (TCP sockets) — 2 files

| File | APIs | Used by |
|------|------|---------|
| `src/lib/db.ts` | `Pool`, `PoolClient`, `QueryResult` | Rate limiting (when DB available), feedback insert |
| `src/lib/db-search.ts` | `PoolClient`, `QueryResultRow` | Semantic search (pgvector similarity) |

**Fix:** Replace with `@neondatabase/serverless` (HTTP-based, works on Workers) or use Cloudflare Hyperdrive.

#### 5. `@xenova/transformers` (HARD BLOCK — cannot run on Workers)

| File | Context |
|------|---------|
| `src/lib/embeddings.ts` | Dynamic import, gated by `ENABLE_LOCAL_EMBEDDINGS` env var |
| `src/workers/semantic-rerank.worker.ts` | Browser Web Worker only (not server) — no action needed |

**Fix:** Keep `ENABLE_LOCAL_EMBEDDINGS=false` always. No code change needed — it's already gated.

---

### Route Portability Assessment

#### Safe for early migration (no fs/pg deps in handler logic)

| Route | Notes |
|-------|-------|
| `/about` | Already has `export const runtime = "edge"` POC |
| `/api/auth/login` | Supabase HTTP client only + in-memory rate-limit fallback |
| `/api/auth/logout` | Supabase HTTP client only |
| `/api/auth/register` | Supabase HTTP client only |
| `/api/progress` | Supabase HTTP client only |
| `/api/feedback` | Uses `queryDb` (pg) — needs pg replacement first |

#### Blocked until fs refactoring complete

| Route | Blocker |
|-------|---------|
| `/api/search` | `official-pyqs.ts`, `question-bank-runtime.ts`, `search-spine.ts` all use `fs` |
| `/api/answer-source` | `answer-sources.ts` uses `fs` |
| `/api/answer-source/[answerId]` | Same |
| `/api/official-questions/[questionId]` | `official-pyqs.ts` uses `fs` |
| `/api/workspace-questions/[questionId]` | `question-bank-runtime.ts` uses `fs` |
| `/pdf/[answerId]` page | Server component imports `answer-sources.ts` |
| All subject pages (`/gs1`, `/optional/*`, etc.) | `data.ts`, `official-pyqs.ts`, `question-bank.ts` use `fs` |

#### Database coupling map

| Route | DB dependency | Type |
|-------|--------------|------|
| `/api/feedback` | `queryDb()` direct — INSERT | Hard (requires pg or replacement) |
| `/api/search` | `queryDb()` via rate-limit (optional — falls back to memory) | Soft |
| `/api/answer-source` | `queryDb()` via rate-limit (optional) | Soft |
| `/api/auth/*` | `queryDb()` via rate-limit (optional) | Soft |
| `/api/progress` | `queryDb()` via rate-limit (optional) | Soft |
| `/api/official-questions/*` | `queryDb()` via rate-limit (optional) | Soft |
| `/api/workspace-questions/*` | `queryDb()` via rate-limit (optional) | Soft |

**Key insight:** Rate limiting falls back to in-memory when `DATABASE_URL` is not set. Only `/api/feedback` has a hard database dependency for its core function.

---

### Cloudflare Migration Phases

#### Phase 1: Enable `nodejs_compat` + test early routes
- [ ] Add `wrangler.toml` with `nodejs_compat` flag
- [ ] Verify `/about` edge POC builds on Cloudflare Pages
- [ ] Verify crypto-dependent code works with compat layer
- [ ] Do NOT deploy to production yet

#### Phase 2: Bundle static JSON (biggest work item — ~2 days)
- [ ] Replace all 9 `readFileSync` calls with static `import ... from "*.json"`
- [ ] Remove `process.cwd()` and `path.join` usage
- [ ] Remove or stub `src/lib/paths.ts`
- [ ] Verify bundle size stays under 25 MB
- [ ] Run full test suite + build

#### Phase 3: Replace `pg` driver (~2 days)
- [ ] Install `@neondatabase/serverless`
- [ ] Rewrite `src/lib/db.ts` to use HTTP-based driver
- [ ] Update `DATABASE_URL` to Supabase pooler endpoint
- [ ] Test: feedback insert, rate limiting, search

#### Phase 4: Deploy preview on Cloudflare Pages
- [ ] Build with `@cloudflare/next-on-pages`
- [ ] Deploy to preview URL (not production)
- [ ] Smoke test all routes
- [ ] Compare response correctness against Vercel production

#### Phase 5: Cutover (only after all above verified)
- [ ] Point DNS to Cloudflare
- [ ] Monitor error rates for 24h
- [ ] Keep Vercel deployment as instant rollback
- [ ] Tear down Vercel after 1 week stable

---

## Part B: Supabase Mumbai Migration

### Readiness Audit

#### Required env vars (must be set in Vercel after migration)

| Variable | Current | New (Mumbai) |
|----------|---------|--------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Existing project URL | New Mumbai project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Existing anon key | New Mumbai anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Existing (if used) | New Mumbai service role key |
| `DATABASE_URL` | Existing pooler URL | New Mumbai pooler URL |

#### Migrations that must be applied to new project

| Migration | Table | Status on current project |
|-----------|-------|--------------------------|
| `supabase/migrations/20260605_user_progress.sql` | `user_progress` | Applied (assumed) |
| `supabase/migrations/20260615_feedback.sql` | `feedback` | Not yet applied (new) |

#### Dependencies by feature

| Feature | Supabase dependency | Impact if misconfigured |
|---------|--------------------|-----------------------|
| Auth (login/register/logout) | Supabase Auth + `auth.users` | 503 on all auth routes |
| Progress sync | `user_progress` table + RLS | 500 on PUT/GET `/api/progress` |
| Feedback | `feedback` table + RLS | 500 on POST `/api/feedback` |
| Rate limiting | `api_rate_limits` table (auto-created) | Falls back to in-memory (safe) |
| Public browsing | None | Unaffected — works without Supabase |

**Key insight:** Public browsing (the primary user flow) does NOT depend on Supabase. Auth is QA-disabled. Only progress + feedback write to the DB.

#### Rollback plan

1. Revert Vercel env vars to old project values
2. Trigger redeploy (~2 min)
3. Old project is untouched — zero data loss
4. Do NOT delete old project for at least 1 week

---

### Supabase Mumbai Execution Steps

#### Pre-migration
- [ ] Confirm auth is still QA-disabled in production (`TEMPORARY_QA_AUTH_DISABLED`)
- [ ] Check if any real users exist in current Supabase project
- [ ] Check if any feedback rows exist in current project
- [ ] Export data if needed (likely: none or negligible)

#### Canary
- [ ] Create new Supabase project in Mumbai (ap-south-1)
- [ ] Apply both migrations via SQL Editor
- [ ] Verify tables + RLS policies exist
- [ ] Configure email/password auth
- [ ] Set site URL to `https://upscat.click`
- [ ] Test auth flow against new project from a local dev environment

#### Cutover
- [ ] Update Vercel env vars to new Mumbai project
- [ ] Trigger production redeploy
- [ ] Run smoke test: `BASE_URL=https://upscat.click node scripts/smoke-test.js`
- [ ] Verify: feedback submission works
- [ ] Verify: progress API responds (even if auth-disabled, should not 500)
- [ ] Verify: public browsing unaffected

#### Post-cutover monitoring
- [ ] Monitor for 500s on `/api/feedback` and `/api/progress` for 24h
- [ ] Check Supabase dashboard for successful inserts
- [ ] If any issue: rollback env vars immediately

---

## Effort Summary

| Migration | Effort | Risk | Priority |
|-----------|--------|------|----------|
| Supabase Mumbai | 0.5 days | Low (instant rollback) | High (latency improvement for all Indian users) |
| Cloudflare Phase 1 (compat flag + POC) | 0.5 days | Low | Medium |
| Cloudflare Phase 2 (fs refactor) | 2 days | Medium (touches core data loading) | Medium |
| Cloudflare Phase 3 (pg replacement) | 2 days | Medium (database layer) | Medium |
| Cloudflare Phase 4-5 (deploy + cutover) | 3 days | High (production change) | Low (do last) |

**Recommended order:** Supabase Mumbai first (quick win, low risk), then Cloudflare phases sequentially.

---

## Decision Required from Release Captain

1. **Supabase Mumbai:** Ready to execute? If yes, just needs new project creation + env var swap.
2. **Cloudflare Phase 1:** Approve adding `wrangler.toml` to repo?
3. **About page edge POC:** Keep or revert `export const runtime = "edge"`?
4. **`@neondatabase/serverless`:** Approve adding this dependency for pg replacement?
