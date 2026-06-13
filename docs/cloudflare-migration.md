# Cloudflare Workers Migration Guide

> **Status**: Planning & Preparation
> **Current Platform**: Vercel (Next.js 16 App Router)
> **Target Platform**: Cloudflare Pages/Workers
> **Last Updated**: 2025-07-05 (sections 7–11 added with route portability, effort estimates, and migration order)

---

## Table of Contents

1. [Incompatible API Inventory](#1-incompatible-api-inventory)
2. [Adapter Strategy Comparison](#2-adapter-strategy-comparison)
3. [Data Loading Migration Strategy](#3-data-loading-migration-strategy)
4. [Step-by-Step Migration Checklist](#4-step-by-step-migration-checklist)
5. [Known Incompatible Dependencies](#5-known-incompatible-dependencies)
6. [Recommended Migration Path (Phased Approach)](#6-recommended-migration-path-phased-approach)
7. [Known Blockers for Cloudflare Compatibility](#7-known-blockers-for-cloudflare-compatibility)
8. [Replacement Strategies (Quick Reference)](#8-replacement-strategies-quick-reference)
9. [Route Portability Assessment](#9-route-portability-assessment)
10. [Effort Estimates](#10-effort-estimates)
11. [Migration Order](#11-migration-order)

---

## 1. Incompatible API Inventory

### 1.1 `fs` Module Usage

| # | File | Line | API | Recommended Replacement | Edge-Reachable? |
|---|------|------|-----|------------------------|-----------------|
| 1 | `src/lib/official-pyqs.ts` | 1 | `existsSync`, `readFileSync` | Pre-bundle JSON at build time via import or KV | Yes — `/api/search`, `/api/official-questions/[questionId]` |
| 2 | `src/lib/question-bank-runtime.ts` | 1 | `existsSync`, `readFileSync` | Pre-bundle JSON at build time via import or KV | Yes — `/api/workspace-questions/[questionId]`, `/api/search` |
| 3 | `src/lib/canonical-syllabus.ts` | 1 | `existsSync`, `readFileSync` | Pre-bundle JSON at build time via import or KV | Yes — imported by `official-pyqs.ts` |
| 4 | `src/lib/answer-sources.ts` | 1 | `readFileSync` | Pre-bundle JSON at build time via import or KV | Yes — `/api/answer-source` |
| 5 | `src/lib/data.ts` | 8 | `readFileSync` | Pre-bundle JSON at build time via import or KV | Yes — page server components, API routes |
| 6 | `src/lib/search-spine.ts` | 1 | `readFileSync` | Pre-bundle JSON at build time via import or KV | Yes — `/api/search` |
| 7 | `src/lib/vault.ts` | 1 | `readFileSync` | Pre-bundle JSON at build time via import or KV | Server-only (SSR data loading) |
| 8 | `src/lib/search-status.ts` | 1 | `readFileSync` | Pre-bundle JSON at build time via import or KV | Yes — search infrastructure |
| 9 | `src/lib/question-bank.ts` | 1 | `existsSync`, `readFileSync` | Pre-bundle JSON at build time via import or KV | Yes — `study-page-data` → page components |

### 1.2 `path` Module Usage

| # | File | Line | API | Recommended Replacement | Edge-Reachable? |
|---|------|------|-----|------------------------|-----------------|
| 1 | `src/lib/paths.ts` | 1 | `join` | Remove (not needed when data is bundled) | Yes — imported by most data loaders |
| 2 | `src/lib/official-pyqs.ts` | 2 | `join` | Remove | Yes |
| 3 | `src/lib/question-bank-runtime.ts` | 2 | `join` | Remove | Yes |
| 4 | `src/lib/canonical-syllabus.ts` | 2 | `join` | Remove | Yes |
| 5 | `src/lib/answer-sources.ts` | 2 | `join` | Remove | Yes |
| 6 | `src/lib/data.ts` | 9 | `join` | Remove | Yes |
| 7 | `src/lib/search-spine.ts` | 2 | `join` | Remove | Yes |
| 8 | `src/lib/vault.ts` | 2 | `join` | Remove | Server-only |
| 9 | `src/lib/search-status.ts` | 2 | `join` | Remove | Yes |
| 10 | `src/lib/question-bank.ts` | 2 | `join` | Remove | Yes |

### 1.3 `crypto` Module Usage

| # | File | Line | API | Recommended Replacement | Edge-Reachable? |
|---|------|------|-----|------------------------|-----------------|
| 1 | `src/lib/rate-limit.ts` | 1 | `createHash` | `crypto.subtle.digest("SHA-256", ...)` (Web Crypto) or use `nodejs_compat` flag | Yes — all rate-limited API routes |
| 2 | `src/lib/env.ts` | 1 | `createHmac`, `timingSafeEqual` | `crypto.subtle.sign("HMAC", ...)` + `crypto.subtle.verify()` or `nodejs_compat` flag | Yes — `secureEquals()` in answer-source route |
| 3 | `src/lib/pdf-access.ts` | 1 | `randomBytes` | `crypto.getRandomValues()` (Web Crypto) or `nodejs_compat` flag | Yes — PDF token generation |

### 1.4 `process.cwd()` Usage

| # | File | Line | Context | Recommended Replacement | Edge-Reachable? |
|---|------|------|---------|------------------------|-----------------|
| 1 | `src/lib/paths.ts` | 4 | `APP_DATA_DIR = join(process.cwd(), "data", "app")` | Remove — data bundled as imports | Yes |
| 2 | `src/lib/official-pyqs.ts` | 72–74 | `PYQ_DIR`, path construction | Remove — data bundled as imports | Yes |
| 3 | `src/lib/canonical-syllabus.ts` | 30 | `ROOT = process.cwd()` | Remove — data bundled as imports | Yes |
| 4 | `src/lib/question-bank-runtime.ts` | 76 | `WORKSPACE_INDEX_FILE` path | Remove — data bundled as imports | Yes |
| 5 | `src/lib/answer-sources.ts` | 47 | `PDF_RUNTIME_DIR` path | Remove — data bundled as imports | Yes |
| 6 | `src/lib/question-bank.ts` | 135 | `ROOT = process.cwd()` | Remove — data bundled as imports | Yes |

### 1.5 `Buffer` Usage

| # | File | Line | API | Recommended Replacement | Edge-Reachable? |
|---|------|------|-----|------------------------|-----------------|
| 1 | `src/lib/env.ts` | 174 | `Buffer.from(a)` | Available with `nodejs_compat` flag; or use `TextEncoder`/`Uint8Array` | Yes |
| 2 | `src/lib/pdf-access.ts` | 58, 78 | `Buffer.from(...)` base64url | Available with `nodejs_compat` flag; or use `btoa()`/`atob()` | Yes |

### 1.6 `pg` Driver (TCP Sockets)

| # | File | Line | API | Recommended Replacement | Edge-Reachable? |
|---|------|------|-----|------------------------|-----------------|
| 1 | `src/lib/db.ts` | 1 | `Pool`, `PoolClient`, `QueryResult` from `pg` | `@neondatabase/serverless`, `postgres` (HTTP mode), or Hyperdrive | Yes — rate-limit, progress, search |
| 2 | `src/lib/db-search.ts` | 1 | `PoolClient`, `QueryResultRow` from `pg` | Same as above | Yes — `/api/search` |

### 1.7 `@xenova/transformers` + `onnxruntime-node`

| # | File | Line | Context | Edge-Reachable? |
|---|------|------|---------|-----------------|
| 1 | `src/lib/embeddings.ts` | 105 | Dynamic `import("@xenova/transformers")` | Opt-in only (gated by `ENABLE_LOCAL_EMBEDDINGS`) |
| 2 | `src/workers/semantic-rerank.worker.ts` | 97 | Dynamic `import("@xenova/transformers")` | Browser web worker only (not edge) |

### 1.8 `node:*` Specifiers (Test Files Only)

| # | File | Lines | Status |
|---|------|-------|--------|
| 1–8 | `src/lib/__tests__/*.test.ts` | 1–3 | **No migration risk** — test-only, never bundled for production |

---

## 2. Adapter Strategy Comparison

### Option A: `@cloudflare/next-on-pages`

| Aspect | Assessment |
|--------|-----------|
| **What it does** | Compiles Next.js App Router output into Cloudflare Pages Functions using the Edge Runtime |
| **Pros** | • Minimal code changes — stays Next.js<br>• Supports App Router, Server Components, API routes<br>• Automatic static asset hosting on Pages CDN<br>• Community-maintained with active Cloudflare backing |
| **Cons** | • All server-side code runs in Workers (edge) — must be Workers-compatible<br>• `fs`/`path`/`process.cwd()` calls break at runtime even with `nodejs_compat`<br>• Large JSON bundles may hit the 25MB Worker size limit<br>• Some Next.js features unsupported (ISR timers, middleware edge cases) |
| **Fit for this app** | **Medium** — Requires migrating all `readFileSync` calls first. Data files are ~2–5MB total which fits within bundle limits. The `pg` driver must be replaced. Once data loading is refactored, this is the lowest-friction option. |

### Option B: Next.js Edge Runtime (per-route `export const runtime = "edge"`)

| Aspect | Assessment |
|--------|-----------|
| **What it does** | Marks individual routes to run in the edge runtime while keeping others on Node.js |
| **Pros** | • Incremental migration — one route at a time<br>• Routes without `runtime = "edge"` stay on Node.js<br>• Built into Next.js, no third-party adapter |
| **Cons** | • Requires a platform that supports mixed runtimes (Vercel does, Cloudflare Pages does not natively)<br>• Does not actually deploy to Cloudflare — still needs a hosting layer<br>• Each edge route independently must avoid Node.js APIs |
| **Fit for this app** | **Low as standalone strategy** — Useful for testing individual routes but doesn't solve the "deploy to Cloudflare" problem on its own. Can be combined with Option A or C. |

### Option C: Standalone Cloudflare Worker with Fetch Forwarding

| Aspect | Assessment |
|--------|-----------|
| **What it does** | Deploy a Cloudflare Worker that handles routing, static assets, and forwards dynamic requests to a Node.js origin (e.g. Fly.io, Railway) or handles them directly |
| **Pros** | • Full control over what runs at the edge vs origin<br>• Can keep `readFileSync` on the origin server<br>• No Worker bundle size concerns for origin routes<br>• Can progressively move routes from origin to edge |
| **Cons** | • Two deployments to manage (Worker + origin)<br>• Added latency for origin-forwarded requests<br>• More complex CI/CD pipeline<br>• Static assets need explicit configuration |
| **Fit for this app** | **High for phased migration** — Allows deploying static pages and simple API routes at the edge immediately while keeping data-heavy routes on a Node.js container. Best if you want to leave Vercel now without a full rewrite. |

### Recommendation for This App

**Option C (Worker + Origin) for Phase 1, migrating to Option A long-term.**

Rationale:
- This app's data loading pattern (`readFileSync` of pre-built JSON) is pervasive (9 files). Refactoring all at once is risky.
- A Worker can serve static pages at the edge immediately (study pages, subject pages) while forwarding `/api/*` calls to a Node.js origin.
- Once data loading is refactored to use bundled imports or KV, routes can be migrated to run fully at the edge.
- The `pg` driver replacement can happen independently of the fs refactoring.

### Trade-Offs Specific to This App's `fs`-Based Data Loading

This app uses `readFileSync(join(process.cwd(), "data/app/..."))` exclusively for **pre-built JSON files** — not dynamic filesystem access. This means:

1. **The data is static at deploy time** — it changes only when `npm run build-pyqs` is re-run. This makes it an ideal candidate for bundling.
2. **No runtime file discovery** — the set of files is known at build time (pyqs.json, public-official-pyq-links.json, workspace-index.json, vault files, etc.).
3. **The files are relatively small** — total ~2–5MB, well within Worker bundle limits.
4. **`existsSync` is used for conditional loading** — some files may or may not exist (e.g. per-subject files). This requires build-time resolution or try/catch imports.

This pattern is uniquely well-suited to the "pre-bundle at build time" approach because the data is deterministic and static.

---

## 3. Data Loading Migration Strategy

### Current Pattern (Incompatible with Workers)

```typescript
// src/lib/paths.ts
import { join } from "path";
export const APP_DATA_DIR = join(process.cwd(), "data", "app");

// src/lib/data.ts
import { readFileSync } from "fs";
import { join } from "path";
const raw = readFileSync(join(APP_DATA_DIR, "pyqs.json"), "utf-8");
export const pyqs = JSON.parse(raw);
```

This pattern fails on Workers because:
1. `fs` module doesn't exist in Workers
2. `process.cwd()` returns nothing useful in Workers
3. Workers have no filesystem

### Strategy A: Pre-Bundle JSON at Build Time (Recommended)

Convert `readFileSync` calls to static `import` statements. Since all data files are pre-built JSON that doesn't change at runtime, they can be bundled directly into the Worker.

```typescript
// AFTER: src/lib/data.ts
import pyqsData from "../../data/app/pyqs.json";
export const pyqs = pyqsData;
```

**Pros:**
- Zero runtime overhead — data is in the bundle
- Works identically on Vercel and Cloudflare
- Type-safe with `resolveJsonModule: true` in tsconfig
- No infrastructure changes needed

**Cons:**
- Increases Worker bundle size (25MB limit)
- All data must fit in memory at once
- Changes to data require rebuild + redeploy

**Estimated bundle impact:** The `data/app/` JSON files total approximately 2–5MB compressed. Well within the 25MB Worker limit.

### Strategy B: Cloudflare KV Storage

Store JSON data in Cloudflare KV and fetch at runtime.

```typescript
// AFTER: src/lib/data.ts
export async function getPyqs(env: { DATA_KV: KVNamespace }) {
  const raw = await env.DATA_KV.get("pyqs.json", "json");
  return raw;
}
```

**Pros:**
- No bundle size concerns
- Data can be updated without redeploy (via KV write)
- Scales to arbitrarily large datasets

**Cons:**
- Requires async refactoring of all data accessors (currently synchronous)
- KV has eventual consistency (60s propagation)
- Additional infrastructure to manage
- KV reads add latency (~10–50ms per read)
- Requires binding configuration in `wrangler.toml`

### Strategy C: Fetch-Based Loading from R2/Origin

Store data in R2 (Cloudflare's object storage) and fetch via the Service Worker fetch API.

```typescript
// AFTER: src/lib/data.ts
export async function getPyqs(env: { DATA_BUCKET: R2Bucket }) {
  const obj = await env.DATA_BUCKET.get("pyqs.json");
  return obj ? await obj.json() : null;
}
```

**Pros:**
- Works for very large files
- R2 is free for reads within Cloudflare network
- Strong consistency

**Cons:**
- Same async refactoring required
- More complex than KV for small JSON files
- R2 binding configuration needed

### Recommendation

**Use Strategy A (pre-bundle JSON) for initial migration.** The data files are small enough to fit in the Worker bundle. This avoids async refactoring and works on both Vercel and Cloudflare with no runtime differences.

If data grows beyond ~10MB, migrate specific large files to KV (Strategy B) while keeping small lookup tables as bundled imports.

**Migration pattern for each file:**

```typescript
// Step 1: Replace readFileSync with import (works on both platforms)
// Before:
import { readFileSync } from "fs";
import { join } from "path";
const raw = readFileSync(join(process.cwd(), "data/app/pyqs.json"), "utf-8");
export const data = JSON.parse(raw);

// After:
import data from "../../data/app/pyqs.json" with { type: "json" };
export { data };
```

For `existsSync` checks (conditional loading):

```typescript
// Before:
import { existsSync, readFileSync } from "fs";
if (existsSync(filePath)) {
  const data = JSON.parse(readFileSync(filePath, "utf-8"));
}

// After: Use try/catch with dynamic import or pre-validate at build time
let data: DataType | null = null;
try {
  data = (await import("../../data/app/optional-file.json", { with: { type: "json" } })).default;
} catch {
  data = null; // File doesn't exist at build time
}
```

---

## 4. Step-by-Step Migration Checklist

### Phase 0: Pre-Migration Preparation

- [ ] **Verify build passes on current platform**: `npm run build` succeeds on Vercel
- [ ] **Document all environment variables** needed in Workers (from `.env.example`)
- [ ] **Identify route criticality**: which routes must work first, which can be deferred
- [ ] **Set up Cloudflare account** with Pages project and Workers KV namespace (optional)

### Phase 1: Runtime Adapter Selection

- [ ] **Choose initial adapter**: Standalone Worker (Option C) for phased migration
- [ ] **Install `wrangler`** for local development: `npm install -D wrangler`
- [ ] **Create `wrangler.toml`** with basic configuration:
  ```toml
  name = "open-topper"
  compatibility_date = "2024-12-01"
  compatibility_flags = ["nodejs_compat"]
  pages_build_output_dir = ".vercel/output/static"
  ```
- [ ] **For Option A (later)**: Install `@cloudflare/next-on-pages`:
  ```bash
  npm install -D @cloudflare/next-on-pages
  ```

### Phase 2: Node.js Compatibility Flags

- [ ] **Enable `nodejs_compat`** in `wrangler.toml`:
  ```toml
  compatibility_flags = ["nodejs_compat"]
  ```
- [ ] **What this provides**: `Buffer`, `crypto` (createHash, createHmac, randomBytes, timingSafeEqual), `process.env`, `util`, `events`, `stream`
- [ ] **What this does NOT provide**: `fs`, `path.join` (partial support), `child_process`, `net`
- [ ] **Verify crypto usage works**: With `nodejs_compat`, all three crypto files (`rate-limit.ts`, `env.ts`, `pdf-access.ts`) should work without changes
- [ ] **Verify Buffer usage works**: `env.ts` and `pdf-access.ts` Buffer usage should work with `nodejs_compat`

### Phase 3: `pg` Driver Compatibility

The `pg` package uses raw TCP sockets, which are not available in Cloudflare Workers. Workers require either an HTTP-based driver or a TCP proxy.

**Options (choose one):**

#### Option 3A: `@neondatabase/serverless` (Recommended if using Neon or Supabase)

```bash
npm install @neondatabase/serverless
```

```typescript
// src/lib/db.ts — replacement
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!);

export async function queryDb<T>(text: string, params?: unknown[]): Promise<T[]> {
  const rows = await sql(text, params);
  return rows as T[];
}
```

- Works over HTTP/WebSocket — no TCP required
- Compatible with Supabase Postgres (use the connection pooler URL with `?pgbouncer=true`)
- Supports transactions via WebSocket mode

#### Option 3B: Cloudflare Hyperdrive

```toml
# wrangler.toml
[[hyperdrive]]
binding = "DB"
id = "<hyperdrive-config-id>"
```

```typescript
// src/lib/db.ts — replacement
import { Pool } from "pg"; // pg works through Hyperdrive's TCP proxy

export function getPool(env: { DB: Hyperdrive }) {
  return new Pool({ connectionString: env.DB.connectionString });
}
```

- Keeps the `pg` driver — minimal code changes
- Hyperdrive handles TCP→HTTP translation
- Adds connection pooling and caching automatically
- Requires Cloudflare paid plan for Hyperdrive

#### Option 3C: Supabase JS Client (HTTP-based)

```bash
npm install @supabase/supabase-js
```

```typescript
// Use Supabase client instead of raw pg queries
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Replace queryDb calls with supabase.from("table").select/insert/etc.
```

- No TCP sockets needed — pure HTTP
- Already using Supabase for auth
- Major refactor: must rewrite all raw SQL queries to Supabase query builder
- Less flexible for complex queries (pgvector similarity search)

**Recommendation**: Use **Option 3A (`@neondatabase/serverless`)** for the cleanest migration path. It supports raw SQL (minimal query changes), works over HTTP, and is compatible with Supabase's Postgres pooler endpoint. If budget allows, **Option 3B (Hyperdrive)** requires the fewest code changes.

#### Migration steps for `pg` → `@neondatabase/serverless`:

1. Install: `npm install @neondatabase/serverless`
2. Update `src/lib/db.ts`:
   - Replace `import { Pool } from "pg"` with `import { neon } from "@neondatabase/serverless"`
   - Refactor `queryDb()` to use the `neon()` SQL tagged template or function call
3. Update `src/lib/db-search.ts`:
   - Replace pg type imports with `@neondatabase/serverless` equivalents
4. Update `DATABASE_URL` to use the Supabase pooler connection string (port 6543, `?pgbouncer=true`)
5. Test all database-dependent routes:
   - `/api/feedback` (rate limiting + feedback insert)
   - `/api/search` (pgvector similarity)
   - Progress tracking routes

### Phase 4: Supabase SSR Cookie Handling in Workers

The `@supabase/ssr` package uses cookie-based session management. On Cloudflare Workers, cookie handling differs from Node.js/Vercel.

**Key considerations:**

- [ ] **Workers `Request`/`Response` objects are Web Standards** — `@supabase/ssr` already supports this via `createServerClient` with custom cookie adapters
- [ ] **Verify cookie adapter works**: The existing `createServerClient` setup in middleware/route handlers uses `cookies()` from Next.js — this should work with `@cloudflare/next-on-pages` since it emulates the Next.js API
- [ ] **If using standalone Worker (Option C)**: Must implement cookie get/set manually:
  ```typescript
  import { createServerClient } from "@supabase/ssr";

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        // Parse cookies from the Worker Request
        const cookieHeader = request.headers.get("Cookie") || "";
        return parseCookies(cookieHeader);
      },
      setAll(cookiesToSet) {
        // Set cookies on the Worker Response
        cookiesToSet.forEach(({ name, value, options }) => {
          response.headers.append("Set-Cookie", serializeCookie(name, value, options));
        });
      },
    },
  });
  ```
- [ ] **Auth middleware routing**: Ensure the Supabase auth refresh logic runs only on relevant routes (account, auth, progress, PDF viewer) — not on every Worker request
- [ ] **Session token size**: Supabase JWTs can be large (~1KB). Cloudflare Workers have no issue with this, but ensure cookies aren't split incorrectly across multiple `Set-Cookie` headers
- [ ] **Test with `TEMPORARY_QA_AUTH_DISABLED = true`** first (current state) — then test with auth enabled

### Phase 5: `pdfjs-dist` Viewer Route

The `/pdf/[answerId]` route serves a PDF viewer using `pdfjs-dist`.

**Current architecture:**
1. Client navigates to `/pdf/[answerId]`
2. Page fetches PDF URL from `/api/answer-source` (server-side)
3. `pdfjs-dist` renders the PDF in the browser

**Migration considerations:**

- [ ] **`pdfjs-dist` itself runs client-side** — it's a browser library, not a server dependency. No Workers incompatibility for the rendering itself.
- [ ] **The PDF viewer page is a client component** — it should deploy as a static page on Cloudflare Pages with no issues.
- [ ] **The `/api/answer-source` route** is the concern — it uses `readFileSync` to load `answer-sources.json` and `pdf-map.json`. These must be migrated per the data loading strategy (Section 3).
- [ ] **Static assets** (`pdfjs-dist/build/pdf.worker.min.mjs`) must be served correctly — ensure `public/` assets deploy to Cloudflare Pages static hosting.
- [ ] **Cache headers**: The `/pdf/[answerId]` route sets `Cache-Control: no-store` and `X-Robots-Tag: noindex`. Verify these headers propagate correctly through the Worker.
- [ ] **Same-origin checks**: The `/api/answer-source` route validates Origin/Referer headers. Ensure the Worker doesn't strip these during forwarding.

### Phase 6: Environment Variables & Secrets

- [ ] **Migrate all env vars** from Vercel to Cloudflare:
  ```
  DATABASE_URL → Cloudflare secret (use pooler URL)
  NEXT_PUBLIC_SUPABASE_URL → Pages env var
  NEXT_PUBLIC_SUPABASE_ANON_KEY → Pages env var
  SUPABASE_SERVICE_ROLE_KEY → Cloudflare secret
  NEXTAUTH_SECRET → Cloudflare secret
  JWT_SECRET → Cloudflare secret
  AWS_ACCESS_KEY_ID → Cloudflare secret (for R2/S3)
  AWS_SECRET_ACCESS_KEY → Cloudflare secret
  S3_BUCKET_NAME → Pages env var
  S3_ENDPOINT → Pages env var
  ```
- [ ] **Do NOT set `ENABLE_LOCAL_EMBEDDINGS=true`** in Workers (see Section 5)
- [ ] **Set `TEMPORARY_QA_AUTH_DISABLED=true`** for initial testing, then switch to `false`

### Phase 7: Build & Deploy Configuration

- [ ] **For `@cloudflare/next-on-pages`**:
  ```json
  {
    "scripts": {
      "pages:build": "npx @cloudflare/next-on-pages",
      "pages:dev": "npx wrangler pages dev .vercel/output/static --compatibility-flags nodejs_compat",
      "pages:deploy": "npx wrangler pages deploy .vercel/output/static"
    }
  }
  ```
- [ ] **For standalone Worker**: Create `worker/index.ts` entry point with routing logic
- [ ] **Verify bundle size** stays under 25MB (compressed) after including JSON data files
- [ ] **Configure `_routes.json`** to exclude static assets from Worker invocation

---

## 5. Known Incompatible Dependencies

### 5.1 `@xenova/transformers` + `onnxruntime-node` — HARD INCOMPATIBILITY

**Status: Cannot run on Cloudflare Workers. Period.**

`@xenova/transformers` depends on ONNX Runtime which requires:
- Native Node.js addons (`onnxruntime-node`) — compiled C++ binaries
- Large model files (50MB+) loaded from disk
- Long-running inference (may exceed Workers CPU time limits of 30s on free plan)

**Current safeguard:** The import is gated behind `ENABLE_LOCAL_EMBEDDINGS` environment variable in `src/lib/embeddings.ts`:

```typescript
// src/lib/embeddings.ts line 105
if (process.env.ENABLE_LOCAL_EMBEDDINGS === "true") {
  const { pipeline } = await import("@xenova/transformers");
  // ...
}
```

> **CRITICAL RULE:** `ENABLE_LOCAL_EMBEDDINGS=true` **MUST NOT** be set in any Cloudflare Workers environment. The Worker will crash immediately at runtime if this codepath is triggered.

**Alternatives for embeddings on Workers:**
1. **Cloudflare Workers AI** — Built-in embedding models via `env.AI.run("@cf/baai/bge-base-en-v1.5", { text: [...] })`
2. **External API** — Call OpenAI/Cohere embeddings API over HTTP
3. **Pre-compute only** — Generate embeddings at build time, store in the database, never compute at the edge

**Action items:**
- [ ] Add runtime guard that throws a clear error if `ENABLE_LOCAL_EMBEDDINGS=true` is set and the environment is detected as Workers
- [ ] Document in `.env.example` that this flag is Node.js-only
- [ ] For search, rely on pre-computed embeddings in the database + pgvector similarity search

### 5.2 `onnxruntime-web` (Browser Worker)

The `src/workers/semantic-rerank.worker.ts` uses `@xenova/transformers` in a **browser** Web Worker context — not a Cloudflare Worker. This is fine because:
- Browser Web Workers have different APIs than Cloudflare Workers
- `onnxruntime-web` uses WASM in the browser — no native addons needed
- This code never runs server-side

**No action needed** for `semantic-rerank.worker.ts`.

---

## 6. Recommended Migration Path (Phased Approach)

### Phase 1: Worker Proxy + Node.js Origin (Week 1–2)

**Goal:** Leave Vercel, deploy to Cloudflare Pages + a Node.js container, with zero code changes.

```
┌──────────────────┐     ┌─────────────────────┐     ┌──────────────────┐
│  Cloudflare CDN  │────▶│  Cloudflare Worker   │────▶│  Node.js Origin  │
│  (static assets) │     │  (routing + cache)   │     │  (Fly.io/Railway)│
└──────────────────┘     └─────────────────────┘     └──────────────────┘
```

**Steps:**
1. Deploy Next.js app to a Node.js container (Fly.io, Railway, or Docker on any VPS)
2. Create a Cloudflare Worker that:
   - Serves static assets from Pages (CSS, JS, fonts, images)
   - Forwards all dynamic requests (`/api/*`, server components) to the origin
   - Adds cache headers for static content
3. Point domain DNS to Cloudflare
4. Verify everything works identically to Vercel

**Benefits:**
- No code changes required
- Immediate escape from Vercel limits
- Static assets cached at Cloudflare edge (free bandwidth)
- Origin can be on any cheap VPS ($5–15/month)

### Phase 2: Refactor Data Loading (Week 3–4)

**Goal:** Eliminate `fs`/`path`/`process.cwd()` dependencies so routes can run at the edge.

**Steps:**
1. Create a build script that validates all JSON data files can be imported
2. Refactor each data-loading module (9 files) to use static imports:
   - `src/lib/data.ts` → `import pyqs from "../../data/app/pyqs.json"`
   - `src/lib/official-pyqs.ts` → import link datasets directly
   - `src/lib/answer-sources.ts` → import answer source map
   - `src/lib/canonical-syllabus.ts` → import syllabus data
   - `src/lib/question-bank.ts` → import question bank data
   - `src/lib/question-bank-runtime.ts` → import workspace index
   - `src/lib/search-spine.ts` → import search spine
   - `src/lib/search-status.ts` → import search status
   - `src/lib/vault.ts` → import vault data
3. Update `src/lib/paths.ts` to export empty constants or remove entirely
4. Remove `fs`, `path` imports from all production files
5. Verify `npm run build` still passes on both platforms
6. Run full test suite

**Key decision:** If any JSON file exceeds ~5MB, consider Cloudflare KV for that specific file instead of bundling.

### Phase 3: Replace `pg` Driver (Week 4–5)

**Goal:** Database queries work on Cloudflare Workers.

**Steps:**
1. Install `@neondatabase/serverless`
2. Create an adapter layer in `src/lib/db.ts` that works on both Node.js and Workers:
   ```typescript
   import { neon } from "@neondatabase/serverless";

   const sql = neon(process.env.DATABASE_URL!);

   export async function queryDb<T>(text: string, params?: unknown[]): Promise<T[]> {
     const rows = await sql(text, params);
     return rows as T[];
   }
   ```
3. Update `DATABASE_URL` to use the Supabase pooler connection string
4. Test all database routes: rate limiting, feedback, search, progress

### Phase 4: Migrate to `@cloudflare/next-on-pages` (Week 5–7)

**Goal:** Full edge deployment — no Node.js origin needed.

**Steps:**
1. Install `@cloudflare/next-on-pages`
2. Add `nodejs_compat` flag in `wrangler.toml`
3. Build with `npx @cloudflare/next-on-pages`
4. Fix any remaining incompatibilities surfaced during build
5. Deploy to Cloudflare Pages
6. Verify all routes work:
   - Study pages (data loading)
   - `/api/search` (database + search spine)
   - `/api/feedback` (database + rate limiting)
   - `/api/answer-source` (PDF access)
   - `/pdf/[answerId]` (PDF viewer)
   - Auth flows (Supabase SSR)
7. Tear down the Node.js origin
8. Monitor for edge cases (cold starts, CPU time limits)

### Phase 5: Optimization (Week 7+)

**Goal:** Take advantage of Cloudflare-native features.

**Steps:**
1. Move large data files to KV if bundle size is a concern
2. Evaluate Cloudflare Workers AI for embeddings (replace external API calls)
3. Add Cloudflare Cache API for frequently accessed data
4. Consider Hyperdrive for database connection pooling
5. Evaluate Durable Objects for rate limiting (more accurate than in-memory)
6. Add Cloudflare Analytics / Web Analytics

---

## Summary of Risk Areas

| Risk | Severity | Mitigation |
|------|----------|-----------|
| `readFileSync` in 9 files | **High** | Phase 2: refactor to static imports |
| `pg` TCP sockets in 2 files | **High** | Phase 3: replace with `@neondatabase/serverless` |
| `@xenova/transformers` | **Medium** | Already gated; document and enforce `ENABLE_LOCAL_EMBEDDINGS=false` |
| `crypto` Node.js APIs in 3 files | **Low** | `nodejs_compat` flag covers these |
| `Buffer` in 2 files | **Low** | `nodejs_compat` flag covers these |
| Worker bundle size (25MB limit) | **Low** | Data files total ~2–5MB; monitor during Phase 4 |
| Supabase cookie handling | **Low** | `@supabase/ssr` supports Web Standard Request/Response |
| `pdfjs-dist` viewer | **Low** | Client-side only; static page deployment |
| CPU time limits (30s free, 50ms on free unbound) | **Medium** | Monitor cold starts; upgrade to Workers Paid ($5/mo) for 30s limit |

---

## 7. Known Blockers for Cloudflare Compatibility

A concise summary of all blockers discovered in the `src/` codebase, grouped by API category.

### `fs` module (readFileSync, existsSync)

| File | API Used | Replacement Strategy |
|------|----------|---------------------|
| `src/lib/official-pyqs.ts` | `existsSync`, `readFileSync` | Bundle JSON at build time (`import ... from "*.json"`) |
| `src/lib/question-bank-runtime.ts` | `existsSync`, `readFileSync` | Bundle JSON at build time |
| `src/lib/canonical-syllabus.ts` | `existsSync`, `readFileSync` | Bundle JSON at build time |
| `src/lib/answer-sources.ts` | `readFileSync` | Bundle JSON at build time |
| `src/lib/data.ts` | `readFileSync` | Bundle JSON at build time |
| `src/lib/search-spine.ts` | `readFileSync` | Bundle JSON at build time |
| `src/lib/vault.ts` | `readFileSync` | Bundle JSON at build time |
| `src/lib/search-status.ts` | `readFileSync` | Bundle JSON at build time |
| `src/lib/question-bank.ts` | `existsSync`, `readFileSync` | Bundle JSON at build time |

### `pg` driver (TCP sockets)

| File | API Used | Replacement Strategy |
|------|----------|---------------------|
| `src/lib/db.ts` | `Pool`, `PoolClient`, `QueryResult` | Hyperdrive (Cloudflare TCP proxy) or `@neondatabase/serverless` (HTTP) |
| `src/lib/db-search.ts` | `PoolClient`, `QueryResultRow` | Same — HTTP-based Postgres driver |

### Node `crypto` module

| File | API Used | Replacement Strategy |
|------|----------|---------------------|
| `src/lib/rate-limit.ts` | `createHash` | WebCrypto `crypto.subtle.digest("SHA-256", ...)` or `nodejs_compat` flag |
| `src/lib/env.ts` | `createHmac`, `timingSafeEqual` | WebCrypto `crypto.subtle.sign("HMAC", ...)` / `crypto.subtle.verify()` or `nodejs_compat` flag |
| `src/lib/pdf-access.ts` | `randomBytes` | WebCrypto `crypto.getRandomValues()` or `nodejs_compat` flag |

### `process.cwd()` usage

| File | Context | Replacement Strategy |
|------|---------|---------------------|
| `src/lib/paths.ts` | `APP_DATA_DIR` base path | Remove; use bundled imports |
| `src/lib/official-pyqs.ts` | `PYQ_DIR`, `OFFICIAL_LINK_FILE`, `WORKSPACE_INDEX_FILE` | Remove; use bundled imports |
| `src/lib/canonical-syllabus.ts` | `ROOT` constant | Remove; use bundled imports |
| `src/lib/question-bank-runtime.ts` | `WORKSPACE_INDEX_FILE` | Remove; use bundled imports |
| `src/lib/answer-sources.ts` | `PDF_RUNTIME_DIR` | Remove; use bundled imports |
| `src/lib/question-bank.ts` | `ROOT`, `APP_DATA_DIR` | Remove; use bundled imports |

### `@xenova/transformers` + `onnxruntime-node`

| File | Context | Replacement Strategy |
|------|---------|---------------------|
| `src/lib/embeddings.ts` | Dynamic import for local embeddings | Keep disabled (`ENABLE_LOCAL_EMBEDDINGS=false`); use Cloudflare Workers AI or pre-computed embeddings |
| `src/workers/semantic-rerank.worker.ts` | Browser Web Worker (not server) | No action — client-side only |

---

## 8. Replacement Strategies (Quick Reference)

| Blocker | Current | Replacement |
|---------|---------|-------------|
| `fs.readFileSync` | Static JSON loading at runtime via `readFileSync(join(process.cwd(), ...))` | Bundle JSON at build time (`import data from "../../data/app/pyqs.json"`) |
| `fs.existsSync` | Conditional file loading at runtime | Try/catch dynamic import or build-time validation script |
| `pg` driver | TCP socket PostgreSQL via `Pool` from `pg` | Hyperdrive (Cloudflare TCP proxy) or `@neondatabase/serverless` (HTTP-based) |
| Node `crypto` | `createHash`, `createHmac`, `randomBytes`, `timingSafeEqual` | WebCrypto API (`crypto.subtle`) or enable `nodejs_compat` flag (covers all three) |
| `process.cwd()` | File path resolution for data directory | Remove entirely; use bundled imports (data is static at deploy time) |
| `path.join` | Constructing file paths for `readFileSync` | Remove; unnecessary when data is imported directly |
| `Buffer` | Base64 encoding in `pdf-access.ts` and `env.ts` | Available with `nodejs_compat`; or use `btoa()`/`atob()`/`TextEncoder` |
| `@xenova/transformers` | Local ONNX embeddings (opt-in only) | Keep disabled (`ENABLE_LOCAL_EMBEDDINGS=false`); use Workers AI or pre-computed embeddings |

---

## 9. Route Portability Assessment

### Immediately Portable (no Node-specific deps in route handler)

These routes can run on Cloudflare Workers edge runtime today (with `nodejs_compat` for crypto):

| Route | Notes |
|-------|-------|
| `/about` | Static marketing page — already has `export const runtime = "edge"` as proof-of-concept |
| `/api/auth/login` | Uses Supabase client (HTTP) + `checkRateLimit` (needs `nodejs_compat` for crypto) |
| `/api/auth/logout` | Uses Supabase client (HTTP) only |
| `/api/auth/register` | Uses Supabase client (HTTP) + `checkRateLimit` |
| `/api/progress` | Uses Supabase client (HTTP) + `checkRateLimit` — no `fs` or `pg` direct usage |
| `/api/feedback` | Uses `queryDb` from `db.ts` (needs `pg` replacement), but logic itself is edge-compatible |

### Needs Refactoring (uses `fs`, `pg`, or `crypto` without `nodejs_compat`)

| Route | Blocker(s) | Required Work |
|-------|-----------|---------------|
| `/api/search` | `official-pyqs.ts` → `fs`/`process.cwd()`; `question-bank-runtime.ts` → `fs`; `rate-limit.ts` → `crypto` | Bundle JSON data; enable `nodejs_compat` |
| `/api/answer-source` | `answer-sources.ts` → `fs`/`process.cwd()`; `pdf-access.ts` → `crypto`; `rate-limit.ts` → `crypto` | Bundle JSON data; enable `nodejs_compat` |
| `/api/answer-source/[answerId]` | Same as above + `env.ts` → `crypto` | Bundle JSON data; enable `nodejs_compat` |
| `/api/official-questions/[questionId]` | `official-pyqs.ts` → `fs`/`process.cwd()` | Bundle JSON data |
| `/api/workspace-questions/[questionId]` | `question-bank-runtime.ts` → `fs`/`process.cwd()` | Bundle JSON data |
| `/pdf/[answerId]` (page) | `pdfjs-dist` is client-side (OK), but server component imports `answer-sources.ts` → `fs` | Bundle answer-source JSON |
| Subject pages (`/gs1`, `/sociology`, etc.) | `official-pyqs.ts` → `fs`; `data.ts` → `fs`; `question-bank.ts` → `fs` | Bundle all JSON data files |

### Static Pages (no server-side deps — always portable)

| Route | Notes |
|-------|-------|
| All client components in `/pdf/[answerId]` viewer | `pdfjs-dist` runs entirely in the browser |
| Static assets in `public/` | Served directly by Cloudflare CDN |

---

## 10. Effort Estimates

| # | Migration Task | Effort (person-days) | Dependencies |
|---|---------------|---------------------|--------------|
| 1 | Bundle static JSON imports (replace 9 `readFileSync` files) | 2 days | None |
| 2 | Replace Node `crypto` with WebCrypto (or enable `nodejs_compat` flag) | 0.5–1 day | None (just flag) or 1 day (full WebCrypto rewrite) |
| 3 | Replace `pg` with HTTP-compatible driver (`@neondatabase/serverless`) | 2 days | Supabase pooler URL setup |
| 4 | Enable `nodejs_compat` flag and test all routes | 0.5 days | Items 1–3 |
| 5 | Set up `wrangler.toml` + build pipeline for `@cloudflare/next-on-pages` | 1 day | Items 1–4 |
| 6 | Deploy preview on Cloudflare Pages (non-production) | 1 day | Item 5 |
| 7 | Full migration + regression testing + DNS cutover | 3 days | Items 1–6 |
| | **Total estimated effort** | **~8–10 person-days** | |

### Notes on estimates:
- Item 1 is the largest single task: 9 files must be refactored from `readFileSync` to static imports, including handling `existsSync` conditional logic
- Item 2 can be nearly zero effort if `nodejs_compat` is acceptable (just a flag); full WebCrypto rewrite is 1 day
- Item 3 requires updating `db.ts` and `db-search.ts` + testing all DB-dependent routes (feedback, rate-limit, search, progress)
- Item 7 includes verifying PDF viewer, auth flows, search, and all subject pages work correctly on the new platform

---

## 11. Migration Order

Recommended sequence to minimize risk and maintain production stability:

1. **Keep `ENABLE_LOCAL_EMBEDDINGS` disabled** — This is already the default. Never enable in a Workers environment.

2. **Bundle static JSON imports instead of runtime `fs`** — Refactor the 9 data-loading files to use `import ... from "*.json"`. This is the highest-impact change and enables all other steps.

3. **Replace Node `crypto` usage or enable `nodejs_compat`** — Enabling `nodejs_compat` in `wrangler.toml` covers `crypto`, `Buffer`, and `process.env` with zero code changes. Only do a full WebCrypto rewrite if you need to avoid the compat layer.

4. **Replace `pg` with HTTP-compatible database access or Hyperdrive** — Install `@neondatabase/serverless` and update `src/lib/db.ts` + `src/lib/db-search.ts`. Update `DATABASE_URL` to use Supabase's connection pooler endpoint.

5. **Test `/about` edge POC** — The `/about` page already has `export const runtime = "edge"`. Verify it builds and runs correctly with `@cloudflare/next-on-pages` as a smoke test.

6. **Deploy preview on Cloudflare Pages only after current Vercel production is stable** — Do not cut over DNS until all routes are verified. Run both platforms in parallel during testing.

---

## References

- [Cloudflare Pages with Next.js](https://developers.cloudflare.com/pages/framework-guides/nextjs/)
- [`@cloudflare/next-on-pages` docs](https://github.com/cloudflare/next-on-pages)
- [Workers Node.js Compatibility](https://developers.cloudflare.com/workers/runtime-apis/nodejs/)
- [`@neondatabase/serverless`](https://github.com/neondatabase/serverless)
- [Cloudflare Hyperdrive](https://developers.cloudflare.com/hyperdrive/)
- [Workers AI Embeddings](https://developers.cloudflare.com/workers-ai/models/text-embeddings/)
- Audit findings: `docs/cloudflare-audit-findings.md`
