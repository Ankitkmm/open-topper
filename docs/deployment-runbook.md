# Deployment Runbook

This runbook covers production deployment of UPSCat/OpenUPSC with Supabase auth/progress and private PDF delivery.

---

## 1. Production Hotfix Deploy Checklist

### Pre-deploy verification

```bash
# Verify you're on the correct branch
git branch --show-current

# Verify latest origin/main
git log --oneline origin/main -3

# Run lint, typecheck, build
npm run lint && npx tsc --noEmit && npm run build

# Run leak check (must pass — blocks deploy if any raw PDF/Drive URLs found)
node scripts/check-no-public-pdf-url-leaks.js
```

### Manual PDF flow verification

1. Start local dev server (`npm run dev`)
2. Navigate to any subject page (e.g., `/gs1`)
3. Expand a PYQ and click "View PDF" on a topper copy
4. Confirm the browser URL is `/pdf/[answerId]` — NOT a raw PDF/R2/Drive URL
5. Confirm the PDF renders correctly in Chrome and Safari
6. Open DevTools → Application → Cookies: confirm `upscat_pdf_*` cookie is HttpOnly
7. Confirm no `?token=` appears in the URL bar

### Confirm no staged private files

```bash
# Ensure no raw PDFs, OCR, manifests, or local paths are staged
git status --short
# Only expected application source files should be staged
```

### Rollback instruction

If deploy smoke fails or a critical issue is discovered post-deploy:

1. Open Vercel dashboard → Deployments
2. Find the last known-good deployment (previous to the broken one)
3. Click the three-dot menu → "Promote to Production"
4. The previous deployment is instantly restored (zero-downtime rollback)
5. Keep Supabase migrations in place unless proven to be the issue (they are additive/RLS-protected)
6. Document the incident in `docs/ai-handoff.md`

---

## 2. Post-Deploy Smoke Test

### Automated smoke

```bash
BASE_URL=https://upscat.click node scripts/smoke-test.js
```

This script checks all public routes for HTTP 200, verifies cross-origin POST to `/api/answer-source` is blocked (403), confirms `/api/search` responds, and verifies `/pdf/[answerId]` returns a page (not a redirect).

### Manual PDF smoke test

1. Open `https://upscat.click/gs1` in a fresh browser session
2. Expand any PYQ with topper copies
3. Click "View PDF" on a topper copy
4. Confirm the URL is `/pdf/[answerId]` (no raw PDF URL visible)
5. **Test in Safari** — confirm PDF.js renders without errors (validates the legacy build fix)
6. Open DevTools Network tab: confirm `/api/answer-source` POST returns 200 with `private, no-store` cache headers
7. Attempt opening the `/api/answer-source` POST from a different origin (e.g., `curl -H "Origin: https://evil.com"`) — should return 403

### Auth/progress smoke (when auth is enabled)

1. Register a test account
2. Log in
3. Mark at least one question done
4. Refresh and confirm `GET /api/progress` returns only the signed-in user's progress
5. Log out and confirm authenticated progress writes fail

---

## 3. PDF.js Safari Legacy Build Fix

**Commit:** `2406307`

### Rationale

`pdfjs-dist@6.0.227` standard build calls `URL.parse()` which is not available in Safari versions prior to 17.0. This caused PDF rendering to fail silently or throw runtime errors on Safari/iOS.

### Fix applied

Switched import paths from the standard build to the legacy build:

- **Viewer:** `pdfjs-dist/legacy/build/pdf.mjs` (instead of `pdfjs-dist/build/pdf.mjs`)
- **Worker:** `pdfjs-dist/legacy/build/pdf.worker.mjs` (instead of `pdfjs-dist/build/pdf.worker.mjs`)

The legacy build polyfills `URL.parse()` and other modern APIs, ensuring compatibility with Safari 14+.

### Status

Deployed and verified. PDF rendering works across Chrome, Firefox, Safari (macOS + iOS), and Edge.

### If upgrading pdfjs-dist in the future

- Check the changelog for removal of legacy builds
- Test explicitly in Safari (macOS) and iOS Safari before merging
- If `URL.parse()` becomes universally available, the standard build can be restored

---

## 4. Reconciliation Checklist

Reference: [`docs/reconciliation-table.md`](./reconciliation-table.md)

### Steps

```bash
# 1. Fetch latest remote state
git fetch origin

# 2. Run reconcile script to generate/update the table
bash scripts/reconcile-branch.sh

# 3. Review the generated table
cat docs/reconciliation-table.md
# Examine each commit verdict (cherry-pick, discard, needs-review)

# 4. Stage ONLY specific files — never git add .
git add docs/reconciliation-table.md
git add <other-specific-files>

# 5. Commit with descriptive message
git commit -m "reconcile: update table with cherry-pick verdicts"
```

### Rules

- **NEVER** use `git add .` — untracked media/PDF files at repo root will be committed
- Stage individual files explicitly
- Review `git status --short` before every commit
- If cherry-picking commits, verify each one passes `npm run lint && npx tsc --noEmit && npm run build` before keeping

---

## 5. Traffic Tuning Knobs

All rate-limit configuration is done via environment variables. The system uses in-memory rate limiting by default; if `DATABASE_URL` is set, it uses a Postgres-backed distributed rate limiter.

### Environment Variables

| Variable | Purpose | Default | Recommended Production |
|----------|---------|---------|----------------------|
| `RATE_LIMIT_WINDOW_MS` | Sliding window duration (ms) for all rate-limit scopes | `60000` (1 min) | `60000` |
| `RATE_LIMIT_SEARCH_MAX` | Max search requests (`/api/search`) per window per client | `120` | `120` |
| `RATE_LIMIT_ANSWER_SOURCE_MAX` | Max answer-source requests (`POST /api/answer-source`) per window per client | `30` | `30` |
| `RATE_LIMIT_PDF_MAX` | Max PDF fetch requests (pdf-access enforcement) per window per client | `45` | `45` |
| `RATE_LIMIT_AUTH_MAX` | Max auth-related requests per window per client | `12` | `12` |
| `RATE_LIMIT_PROGRESS_MAX` | Max progress-sync requests per window per client | `180` | `180` |
| `PDF_TOKEN_TTL_SECONDS` | Lifetime of PDF access tokens (max 300s) | `300` | `300` |
| `PDF_UPSTREAM_TIMEOUT_MS` | Timeout for upstream PDF fetch from R2/S3 (max 30000ms) | `15000` | `15000` |

### When users complain about rate limiting

| Symptom | Which knob to adjust |
|---------|---------------------|
| "I can't open PDFs fast enough" | Raise `RATE_LIMIT_PDF_MAX` (e.g., 45 → 60) and/or `RATE_LIMIT_ANSWER_SOURCE_MAX` (30 → 45) |
| "Search stops working after a few queries" | Raise `RATE_LIMIT_SEARCH_MAX` (e.g., 120 → 200) |
| "Progress isn't saving" | Raise `RATE_LIMIT_PROGRESS_MAX` (e.g., 180 → 300) |
| "Everything is slow" | Check if window is too narrow — raise `RATE_LIMIT_WINDOW_MS` to 120000 (2 min) for a wider bucket |
| "PDFs time out" | Raise `PDF_UPSTREAM_TIMEOUT_MS` (15000 → 25000) — max is 30000 |
| "PDF links expire too quickly" | `PDF_TOKEN_TTL_SECONDS` is capped at 300 (5 min) for security — cannot raise further |

### Lowering limits (abuse mitigation)

If you observe scraping or abuse:

- Lower `RATE_LIMIT_SEARCH_MAX` to 30–60
- Lower `RATE_LIMIT_ANSWER_SOURCE_MAX` to 10–15
- Lower `RATE_LIMIT_PDF_MAX` to 15–20
- Narrow `RATE_LIMIT_WINDOW_MS` to 30000 (30s window = stricter short bursts)

### Distributed rate limiting

Set `DATABASE_URL` to enable Postgres-backed rate limiting (table: `api_rate_limits`, auto-created). This is required for horizontally scaled deployments (multiple Vercel instances) where in-memory counters don't share state.

---

## 6. Deployment Environment Variables

Required:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `AUTH_SECRET` — must be cryptographically random, 32+ chars, unique
- `PDF_TOKEN_SECRET` — must be cryptographically random, 32+ chars, must not match `AUTH_SECRET`
- `R2_PUBLIC_URL`
- `R2_ALLOWED_PUBLIC_HOSTS`
- All `RATE_LIMIT_*` variables (see section 5 above)

Optional:

- `DATABASE_URL` — enables distributed rate limiting and durable counters

Secret guidance:

- `AUTH_SECRET` and `PDF_TOKEN_SECRET` must be long random values and must not match each other
- Do not use Supabase service-role keys in public env vars
- Production Supabase URLs must use HTTPS
- Known weak values (`changeme`, `secret`, `dev-secret`, etc.) are rejected at startup in production

---

## 7. Supabase Migration

Apply `supabase/migrations/20260605_user_progress.sql` to the hosted Supabase database.

Expected database state:

- `public.user_progress` exists
- Row Level Security is enabled
- Authenticated users can select/insert/update only rows where `auth.uid() = user_id`

Smoke SQL after migration:

```sql
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public' AND tablename = 'user_progress';

SELECT policyname, cmd
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'user_progress'
ORDER BY policyname;
```

---

## 8. R2/PDF Allowlist

Set `R2_ALLOWED_PUBLIC_HOSTS` to only the exact HTTPS hosts that may serve PDF objects, for example:

```text
your-account.r2.dev,cdn.example.com
```

Do not add Google Drive, arbitrary domains, or wildcard-style entries. Runtime answer-source data should already be hardened to R2-only URLs; `scripts/check-no-public-pdf-url-leaks.js` must stay green.

---

## 9. Vercel / Function-Size Notes

Do not reintroduce heavy raw data, raw PDFs, OCR artifacts, local embedding models, or private ingestion datasets into route traces. The app is structured so public routes rely on lightweight public shells and generated public official-link data.

After build, run the function-size checker:

```bash
node scripts/check-function-sizes.js
```

Any route bundle exceeding 50 MB (Vercel Hobby limit) will be flagged with the top 5 largest files.
