# Auth & Progress Audit

> Generated from source code scan. Only documents what the code actually does.

---

## Auth State Audit

### Is auth active in production?

**No — currently QA-disabled via environment-based flag.**

The flag is controlled by `src/lib/auth-availability.ts`:

- `isAuthTemporarilyDisabledForQa()` returns `true` in non-production environments by default.
- In production (`NODE_ENV=production` or `VERCEL_ENV=production`), auth is **NOT** disabled — `isProductionLikePublicRuntime()` returns `true`, causing `isAuthTemporarilyDisabledForQa()` to return `false`.
- The env var `NEXT_PUBLIC_TEMPORARY_QA_AUTH_DISABLED` can explicitly override: set to `"true"` to disable, `"false"` to enable. If unset in non-production, defaults to disabled.

**Production behavior:** Auth is active if and only if `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (or their fallback names) are set and valid. If they are missing in production, `shouldFailClosedForMissingAuth()` returns `true` and routes return HTTP 503.

### Auth mechanism

**Supabase SSR (`@supabase/ssr`)** — email/password authentication via `signInWithPassword` and `signUp`.

- Session is managed via Supabase auth cookies (pattern: `sb-*-auth-token`).
- Middleware (`src/proxy.ts`) calls `updateSession()` which only runs the Supabase cookie refresh when auth cookies are present on the request.
- No OAuth/social providers configured.

### Routes with auth checks

| Route | Auth mechanism | Current status |
|-------|---------------|----------------|
| `POST /api/auth/login` | `isEmailPasswordAuthConfigured()` gate → Supabase `signInWithPassword` | QA-disabled (returns 503) |
| `POST /api/auth/logout` | `isEmailPasswordAuthConfigured()` gate → Supabase `signOut` | QA-disabled (no-ops with `{ok:true}`) |
| `POST /api/auth/register` | `isEmailPasswordAuthConfigured()` gate → Supabase `signUp` | QA-disabled (returns 503) |
| `GET /api/progress` | `requireSessionResponseIfConfigured()` → `getUser()` | QA-disabled (returns `{entries:[], configured:false}`) |
| `PUT /api/progress` | `requireSessionResponseIfConfigured()` → `getUser()` | QA-disabled (returns 503) |
| `POST /api/answer-source` | `requireSessionResponseIfConfigured()` after PDF access check | QA-disabled (session check skipped) |
| `GET /api/answer-source/[answerId]` | `requireSessionResponseIfConfigured()` after PDF access check | QA-disabled (session check skipped) |
| `GET /api/official-questions/[questionId]` | `requireSessionResponseIfConfigured()` | QA-disabled (session check skipped) |
| `GET /api/workspace-questions/[questionId]` | `requireSessionResponseIfConfigured()` | QA-disabled (session check skipped) |
| `/pdf/[answerId]` (page) | `shouldFailClosedForMissingAuth()` + `isEmailPasswordAuthConfigured()` + `getAuthenticatedUser()` | QA-disabled (auth check skipped) |
| `/account` (page) | `getPublicAuthState()` → renders QA-disabled copy | QA-disabled (informational page only) |

### Middleware matcher

`src/proxy.ts` applies Supabase session refresh to:
- `/account`
- `/api/auth/:path*`
- `/api/progress`
- `/api/answer-source/:path*`
- `/pdf/:path*`

The middleware skips entirely if no `sb-*-auth-token` cookie is present (avoids unnecessary Supabase calls for anonymous users).

---

## Supabase Tables and RLS

Source: `supabase/migrations/`

### `public.user_progress`

- **Migration:** `20260605_user_progress.sql`
- **Columns:** `user_id` (UUID, PK part), `item_type` (text, PK part), `item_id` (text, PK part), `done` (boolean), `updated_at` (timestamptz)
- **RLS enabled:** Yes
- **Policies:**
  - `user_progress_select_own` — SELECT for `authenticated` WHERE `auth.uid() = user_id` ✓
  - `user_progress_insert_own` — INSERT for `authenticated` WITH CHECK `auth.uid() = user_id` ✓
  - `user_progress_update_own` — UPDATE for `authenticated` USING/WITH CHECK `auth.uid() = user_id` ✓
- **Auth.uid() scoped:** Yes — all three policies correctly reference `auth.uid()`

### `public.feedback`

- **Migration:** `20260615_feedback.sql`
- **Columns:** `id` (UUID, PK), `user_id` (UUID, nullable FK → `auth.users`), `page_path` (text), `category` (text), `message` (text), `created_at` (timestamptz)
- **RLS enabled:** Yes
- **Policies:**
  - `feedback_insert` — INSERT for `authenticated, anon` WITH CHECK `true` (anyone can submit)
  - `feedback_select` — SELECT for `service_role` USING `true` (admin-only read)
- **Auth.uid() scoped:** No — insert is open to anonymous users; select is service-role only. This is intentional for the feedback use case.

---

## Progress Sync Audit

### Client-side storage mechanism

**Library:** `src/lib/local-user-store.ts`

**localStorage keys:**
- `upscat:{scope}:pyq-progress-v4` — current progress map (scope = user email or `"anon"`)
- `upscat:{scope}:activity-v1` — activity heatmap data
- `upscat:{scope}:merged-anon-v1` — one-time merge marker (prevents re-merging anon → user)
- `openupsc:pyq-progress-v2` — legacy progress (migrated on read)
- `openupsc:done-pyqs` — legacy done list (migrated on read)

**Progress map shape:**
```typescript
type ProgressMap = Record<string, {
  done: boolean;
  notes: boolean;
  answer: boolean;
  full: boolean;
  itemType?: "pyq" | "relevant_question" | "topper_copy";
  updatedAt: string | null;
}>;
```

Item IDs use composite format: `{itemType}:{itemId}` (e.g., `pyq:question-123`).

### Server-side sync mechanism

**API route:** `/api/progress` (GET for read, PUT for write)

**DB table:** `public.user_progress` (Supabase/Postgres)

**Sync flow (in `UserDataProvider.tsx`):**
1. On auth state change to `authenticated`, client calls `GET /api/progress`
2. Merges remote entries with local progress using "local wins" strategy (`overrideProgressMap`)
3. Writes merged result back to localStorage AND calls `PUT /api/progress` with all entries
4. On each `toggleProgress()` call, writes to localStorage immediately and fires a best-effort `PUT /api/progress`

**Data mapped to server:** Only `itemType`, `itemId`, and `done` are synced to the server. The `notes`, `answer`, `full`, and `updatedAt` fields are localStorage-only.

### What happens if DB is unavailable?

- `GET /api/progress` returns HTTP 500 with `"Progress sync is temporarily unavailable."`
- `PUT /api/progress` returns HTTP 500 with same message
- **Client resilience:** The `syncRemoteProgress()` function catches all errors silently — local progress remains the source of truth. The comment in code states: _"Local progress remains the source of truth when sync is unavailable."_
- Individual `toggleProgress` writes also fail silently on network error (best-effort sync only)

---

## Data Loss Scenarios

### 1. User browses without auth → marks progress → later enables auth

**What happens:**
- Progress is stored in `localStorage` under the `"anon"` scope key
- When user signs in, `UserDataProvider` detects `userScope` change from `"anon"` to the user's email
- `mergeAnonIntoUserScope(userScope)` runs **once** — merges anon progress into the user-scoped localStorage key
- A one-time marker (`upscat:{email}:merged-anon-v1 = "1"`) prevents re-merging on subsequent logins
- After merge, `syncRemoteProgress()` pushes the merged set to the server

**Risk:** If the merge marker is set but the server push fails, anon progress is in localStorage but not in the DB. A subsequent login on a different device will not have this progress.

### 2. User logs in on device A → marks progress → logs in on device B

**What happens:**
- Device A: `toggleProgress()` writes to localStorage immediately. If online, fires `PUT /api/progress` (best-effort, no retry queue).
- Device B: On login, `GET /api/progress` fetches server state. Merges with local using "local wins on conflicts" (`overrideProgressMap`).

**Sync guarantee:** If the `PUT` from device A succeeded, device B will see the progress. If the PUT failed (offline, network error, rate-limited), the progress is **lost** for device B — it only exists in device A's localStorage.

**No offline queue exists.** The current implementation is fire-and-forget. There is no retry mechanism, no queuing, and no conflict resolution beyond "local overrides remote."

### 3. Auth re-enabled but Supabase env vars missing

**What breaks:**
- `getSupabasePublicConfigState()` returns `{ ok: false, reason: "missing Supabase URL and publishable key" }`
- In production: `shouldFailClosedForMissingAuth()` returns `true`
- All protected routes (`/api/progress`, `/api/answer-source`, `/pdf/[answerId]`) return **HTTP 503** with `"Authentication is required but Supabase auth is not configured."`
- The `/account` page renders: _"Authentication temporarily unavailable. Account sync is closed until production authentication configuration is repaired."_
- The middleware cookie refresh no-ops (config not OK → skips `createServerClient`)
- **Public browse/study pages still work** — they do not import auth utilities

---

## Recommendations

### Immediate (before production launch)

1. **Set Supabase env vars in production** — `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` must be configured, and the `20260605_user_progress.sql` migration must be applied.

2. **Verify `NEXT_PUBLIC_TEMPORARY_QA_AUTH_DISABLED` is unset or `"false"` in production** — The code defaults to disabled in non-production, but production detection relies on `NODE_ENV=production` or `VERCEL_ENV=production` being set.

3. **Implement an offline write queue** — Current best-effort sync has no retry. Progress writes lost on network failure are permanently lost from the server. The design doc specifies `src/lib/progress-queue.ts` (Phase 3, task 6.3).

### Short-term

4. **Sync `notes`, `answer`, `full` fields to server** — Currently only `done` is synced. Users lose all other progress markers when switching devices.

5. **Add last-write-wins with timestamps** — Current merge strategy is "local overrides remote" which can cause data loss when multiple devices are used. The `updatedAt` field exists in localStorage but is not used for conflict resolution during sync.

6. **Add a DELETE policy for `user_progress`** — Users currently cannot un-mark progress via RLS. The `update_own` policy covers toggling `done` to `false`, but a DELETE policy may be needed for future "reset progress" features.

### Medium-term

7. **Migrate Supabase to `ap-south-1` (Mumbai)** — Latency for Indian users. Documented separately in `docs/supabase-mumbai-migration.md` (task 6.2).

8. **Add integration test for auth flow** — No automated test verifies the full login → sync → logout cycle.

9. **Rate limiting per-user instead of per-IP** — Current `checkRateLimit` is IP-based. Authenticated users behind shared NAT may get unfairly limited.
