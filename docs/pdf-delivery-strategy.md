# PDF Delivery Strategy

> Last updated: 2025-01-01
> Status: Active — Phase 1 (proxy) in production

---

## Current Architecture

The PDF delivery system uses a **server-side proxy** pattern to keep all storage URLs private. The client never sees or receives a direct URL to the PDF object in R2/S3.

### Flow

```
┌─────────┐   POST /api/answer-source     ┌──────────────────┐
│  Client │ ──────────────────────────────▶│  API Route       │
│  (View  │   { answerId }                 │  (answer-source) │
│   PDF)  │ ◀──────────────────────────────│                  │
│         │   Set-Cookie: pdf token        │  Issues HMAC     │
│         │   { viewerUrl, page, ... }     │  token, stores   │
│         │                                │  in HttpOnly     │
└────┬────┘                                │  cookie          │
     │                                     └──────────────────┘
     │ Navigate to /pdf/[answerId]
     ▼
┌──────────────────────────┐
│  /pdf/[answerId] (SSR)   │
│  - Validates cookie token│
│  - Resolves source record│
│  - Renders PdfViewerPage │
└──────────┬───────────────┘
           │
           │ pdf.js fetches /api/answer-source/[answerId]
           ▼
┌──────────────────────────┐        fetch()       ┌───────────┐
│  GET /api/answer-source  │ ────────────────────▶ │  R2 / S3  │
│  /[answerId]             │ ◀──────────────────── │  (private │
│  - Verifies cookie token │    PDF byte stream    │   bucket) │
│  - Same-origin check     │                       └───────────┘
│  - Rate limit check      │
│  - Streams bytes back    │
│    to client             │
└──────────────────────────┘
```

### Security Properties (Current)

| Control | Implementation |
|---------|---------------|
| Token delivery | HttpOnly, SameSite=Lax, Secure cookie (per answerId) |
| Token format | HMAC-signed JSON payload with expiry, nonce, purpose |
| Token lifetime | Configurable TTL (default short-lived, e.g. 10 minutes) |
| Origin validation | `sec-fetch-site`, `Origin`, `Referer` checks on all routes |
| Cache control | `private, no-store` on all PDF responses |
| Indexing prevention | `X-Robots-Tag: noindex, nofollow` on PDF routes |
| Rate limiting | Per-IP rate limit on both token issuance and byte streaming |
| Content validation | Upstream content-type and range header validation |
| Navigation guard | `/pdf/[answerId]` rejects cross-site navigations |

---

## Option A: Keep Current Proxy (Status Quo)

### Pros

- **Simple and secure** — all PDF bytes flow through our server; client never touches storage URLs
- **Already implemented and tested** — battle-tested in production with full security hardening
- **No URL leakage risk** — no temporary URLs in browser history, DevTools, or referrer headers
- **Works with any browser** — standard HTTP with cookies, no special client-side logic needed
- **Full control** — can log access, watermark, throttle, or revoke at the proxy layer

### Cons

- **Vercel function invocation per PDF page view** — each byte-range request from pdf.js triggers a serverless function
- **Bandwidth costs** — all PDF bytes transit Vercel's function egress (typically more expensive per GB than CDN)
- **Increased latency** — extra network hop: client → Vercel function → R2 → Vercel function → client
- **Function timeout risk** — large PDFs (50+ MB) may hit Vercel's function duration limits on slow connections
- **No CDN caching** — `no-store` headers prevent edge caching, so every request is a full round-trip

### Cost Profile

- ~$0.60/million function invocations (Vercel Pro)
- Egress bandwidth at function tier pricing
- Each PDF view = 1 POST (token) + N GET requests (pdf.js range requests)

---

## Option B: Short-Lived Signed R2 URLs

Generate pre-signed URLs server-side and hand them to the client. PDF bytes flow directly from R2/Cloudflare CDN to the browser.

### Pros

- **Bytes served directly from R2/Cloudflare CDN** — no function egress for PDF content
- **Lower Vercel function cost** — only token generation hits the function, not streaming
- **Better latency** — CDN edge delivery, single hop from R2 to client
- **Reduced function timeout risk** — functions only do auth + URL generation (fast)
- **Cloudflare R2 has zero egress fees** — significant cost advantage at scale

### Cons

- **Browser sees temporary R2 URL** — visible in DevTools Network tab, potentially leakable via screenshot/sharing
- **Must manage expiry** — too short breaks slow connections; too long increases leak window
- **Referrer header may leak URL** — if user navigates away from the viewer tab
- **URL in browser history** — pdf.js may store the signed URL in memory
- **No server-side access logging per byte** — lose granular request-level analytics
- **Pre-signed URL generation requires S3 credentials in the function** — already present, but widens the attack surface slightly

### Implementation Sketch

```
1. Client clicks "View PDF"
   → POST /api/answer-source { answerId }

2. Server validates auth, generates pre-signed R2 URL (5 min TTL)
   → Returns { signedUrl, page, ... }

3. Client-side pdf.js loads document from the signed URL directly
   → GET <signed-url> (bytes from CDN)

4. URL expires after 5 minutes
   → Subsequent loads require a new token request
```

### Mitigation for URL Leakage

- Set `Referrer-Policy: no-referrer` on the viewer page
- Use `rel="noreferrer"` if any links exist on the viewer page
- Keep TTL at 5 minutes maximum
- Monitor access logs on R2 for unusual patterns

---

## Option C: Cloudflare Worker-Gated R2

Deploy a Cloudflare Worker that sits in front of the R2 bucket. The app generates short-lived tokens; the Worker validates them and streams bytes from R2 at the edge.

### Pros

- **Best long-term control** — custom auth, caching, analytics, watermarking all at edge
- **Stable app URL** — no temporary URLs exposed to the browser (Worker has a fixed URL)
- **Can enforce cookies/tokens at edge** — same security model as current proxy but at CDN speed
- **Zero Vercel bandwidth for PDF bytes** — all streaming happens within Cloudflare's network
- **Can add per-user watermarking** — inject user identifier into PDF stream at edge
- **Can cache hot PDFs at edge** — Worker can cache-after-auth for repeat views
- **R2 binding is internal** — Worker accesses R2 via binding, not over public internet

### Cons

- **More infrastructure** — requires Cloudflare Worker + R2 binding deployment
- **Requires Cloudflare account/migration** — domain must be on Cloudflare (or use workers.dev subdomain)
- **More complex deployment** — separate CI/CD pipeline for Worker code
- **Auth cookie verification at edge is non-trivial** — need to replicate HMAC verification in Worker
- **Two systems to maintain** — token issuance in Next.js, token verification in Worker
- **Cold start latency** — Workers have minimal cold starts but still non-zero

### Implementation Sketch

```
1. Deploy Cloudflare Worker bound to R2 bucket
   → Worker has R2 binding (internal, no public bucket access)

2. App generates short-lived HMAC token (same as current)
   → Token encodes answerId + expiry + signature

3. Client requests PDF from Worker URL with token in cookie or header
   → GET pdf.<domain>/[answerId]
   → Cookie: upscat_pdf_<answerId>=<token>

4. Worker validates HMAC token
   → Rejects expired/invalid tokens with 403
   → On success: streams R2 object to client

5. Worker adds security headers
   → Cache-Control: private, no-store
   → X-Robots-Tag: noindex, nofollow
   → Content-Disposition: inline
```

### Architecture Diagram

```
┌─────────┐   POST /api/answer-source   ┌───────────────┐
│  Client │ ────────────────────────────▶│  Vercel Fn    │
│         │ ◀────────────────────────────│  (token only) │
│         │   Set-Cookie + viewerUrl     └───────────────┘
│         │
│         │   GET pdf.<domain>/[answerId]
│         │   Cookie: token
│         │ ────────────────────────────▶┌───────────────┐
│         │ ◀────────────────────────────│  CF Worker    │
│         │   PDF byte stream            │  ↕ R2 binding │
└─────────┘                              └───────────────┘
```

---

## Recommendation

### Phase 1 (Now): Keep Current Proxy

The current proxy architecture is secure, tested, and working. Optimize later when cost or latency becomes a measurable problem.

**When to stay here:**
- Monthly PDF views < 50,000
- Vercel bandwidth costs < $50/month
- No user-reported latency issues

### Phase 2 (When Costs Matter): Cloudflare Worker-Gated R2

When Vercel function costs or latency become a concern, move to Option C. It preserves the same security model (no URL leakage, server-validated tokens) while eliminating Vercel bandwidth costs entirely.

**Trigger to migrate:**
- Vercel PDF-related function costs exceed $100/month
- P95 PDF load time exceeds 3 seconds
- Need for per-user watermarking or edge analytics

### Why Not Option B?

Option B (signed URLs) is a valid middle ground for cost reduction, but the URL leakage risk makes it less desirable for educational content protection. A leaked signed URL — even if short-lived — could be shared on Telegram/WhatsApp groups and accessed by many users within the 5-minute window. Option C provides the same cost benefits without this risk.

---

## Security Rules (All Options)

These rules apply regardless of which delivery option is active:

1. **Never expose permanent R2/S3 URLs** — all access must be token-gated and time-limited
2. **Never put PDF URLs in query parameters** — referrer headers leak query strings to third-party sites
3. **Never cache PDF responses publicly** — use `private, no-store` or `private, max-age=<short>`
4. **Never allow direct R2 bucket access without auth** — bucket must remain private; all access through proxy or Worker
5. **Never log full PDF URLs in client-visible responses** — answerId is the only identifier the client should see
6. **Never serve PDFs without origin/token validation** — every PDF byte request must be authenticated
7. **Never embed real bucket names in client bundles** — all storage references stay server-side only
8. **Always use HttpOnly cookies for tokens** — never expose tokens to JavaScript

---

## Migration Checklist (When Moving to Option C)

- [ ] Cloudflare account with R2 bucket provisioned
- [ ] Worker deployed with R2 binding
- [ ] HMAC secret shared between Next.js app and Worker (via Worker secrets)
- [ ] Token format documented and versioned (current: v1)
- [ ] Worker validates token expiry, purpose, answerId, signature
- [ ] Worker sets all security headers (Cache-Control, X-Robots-Tag, CSP)
- [ ] Smoke test: PDF loads from Worker URL with valid token
- [ ] Smoke test: Worker rejects expired/invalid/missing tokens
- [ ] Update `PdfViewerPage` sourceUrl to point to Worker domain
- [ ] Remove byte-streaming logic from Vercel API route (keep token issuance)
- [ ] Monitor Worker analytics for error rates
- [ ] Update `docs/ai-decisions.md` with migration decision
